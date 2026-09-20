// The Postgres notes store, against a fake connection: no test touches a real database.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PgNoteStore, listNotesForPrompt } from "../db/fieldNotes.ts";
import { FieldNotFoundError, StorageUnavailableError } from "../lib/noteStoreTypes.ts";

// Saturday 19 September 2026; the week starts on Sunday 13 September (UTC), the same rule as lib/week.ts
const NOW = new Date("2026-09-19T15:00:00Z");
const WEEK = "2026-09-13";
const FIELD = "0b5c1e7a-0000-4000-8000-000000000001";
const norm = (sql) => sql.replace(/\s+/g, " ").trim();

const row = (over = {}) => ({
  id: "n1",
  field_id: FIELD,
  event_type: "irrigated",
  event_date: "2026-09-15",
  detail: "irrigated north plot Tuesday",
  raw_transcript: "irrigated north plot Tuesday.",
  confidence: "0.9",
  created_at: new Date("2026-09-19T15:00:01Z"),
  ...over,
});

// script(sql, params) returns { rows } or throws; every statement is recorded in order
function fake(script = () => ({ rows: [] }), { connectError } = {}) {
  const calls = [];
  const state = { released: 0 };
  const client = {
    async query(sql, params) {
      calls.push({ sql: norm(sql), params });
      return script(norm(sql), params);
    },
    release() {
      state.released++;
    },
  };
  const pool = {
    connect: async () => {
      if (connectError) throw connectError;
      return client;
    },
    query: client.query,
  };
  return { pool: () => pool, calls, state, sqls: () => calls.map((c) => c.sql.split(" ")[0]) };
}
const pgError = (code) => Object.assign(new Error("db error " + code), { code });
const note = { fieldId: FIELD, eventType: "irrigated", eventDate: "2026-09-15", detail: "irrigated north plot Tuesday", rawTranscript: "irrigated north plot Tuesday.", confidence: 0.9 };

describe("saving a note", () => {
  it("inserts it and clears this week's cached AI recommendation in ONE transaction", async () => {
    const f = fake((sql) => (sql.startsWith("INSERT") ? { rows: [row()] } : { rows: [] }));
    const saved = await new PgNoteStore(f.pool, () => NOW).add(note);
    assert.deepEqual(f.sqls(), ["BEGIN", "INSERT", "UPDATE", "COMMIT"]);
    const insert = f.calls[1];
    const clear = f.calls[2];
    assert.match(insert.sql, /INSERT INTO field_notes \(field_id, event_type, event_date, detail, raw_transcript, confidence\)/);
    assert.deepEqual(insert.params, [FIELD, "irrigated", "2026-09-15", "irrigated north plot Tuesday", "irrigated north plot Tuesday.", 0.9]);
    assert.match(clear.sql, /UPDATE stress_events SET ai_recommendation = NULL, ai_recommendation_generated_at = NULL WHERE field_id = \$1 AND week_start = \$2/);
    assert.deepEqual(clear.params, [FIELD, WEEK], "only the CURRENT week's advice is cleared");
    assert.equal(f.state.released, 1, "the connection is always returned to the pool");
    assert.deepEqual(saved, {
      id: "n1",
      fieldId: FIELD,
      eventType: "irrigated",
      eventDate: "2026-09-15",
      detail: "irrigated north plot Tuesday",
      rawTranscript: "irrigated north plot Tuesday.",
      confidence: 0.9,
      createdAt: "2026-09-19T15:00:01.000Z",
    });
  });

  it("uses the week the note is saved in, whatever day it is", async () => {
    for (const [now, week] of [
      ["2026-09-13T00:00:00Z", "2026-09-13"],
      ["2026-09-12T23:59:59Z", "2026-09-06"],
      ["2026-09-19T15:00:00Z", "2026-09-13"],
    ]) {
      const f = fake((sql) => (sql.startsWith("INSERT") ? { rows: [row()] } : { rows: [] }));
      await new PgNoteStore(f.pool, () => new Date(now)).add(note);
      assert.equal(f.calls[2].params[1], week, now);
    }
  });

  it("rolls everything back and says the field isn't saved when the field doesn't exist", async () => {
    const f = fake((sql) => {
      if (sql.startsWith("INSERT")) throw pgError("23503");
      return { rows: [] };
    });
    await assert.rejects(new PgNoteStore(f.pool, () => NOW).add(note), FieldNotFoundError);
    assert.deepEqual(f.sqls(), ["BEGIN", "INSERT", "ROLLBACK"], "no commit, and the cache is not cleared");
    assert.equal(f.state.released, 1);
  });

  it("a field id that isn't a valid uuid is the same clear error", async () => {
    const f = fake((sql) => {
      if (sql.startsWith("INSERT")) throw pgError("22P02");
      return { rows: [] };
    });
    await assert.rejects(new PgNoteStore(f.pool, () => NOW).add({ ...note, fieldId: "plot-123" }), FieldNotFoundError);
  });

  it("says so when the migration hasn't been run", async () => {
    const f = fake((sql) => {
      if (sql.startsWith("INSERT")) throw pgError("42P01");
      return { rows: [] };
    });
    await assert.rejects(new PgNoteStore(f.pool, () => NOW).add(note), (e) => e instanceof StorageUnavailableError && /0007_field_notes/.test(e.message));
  });

  it("says so when the database can't be reached, without leaking details", async () => {
    for (const code of ["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "57P01", "08006"]) {
      const f = fake(undefined, { connectError: pgError(code) });
      await assert.rejects(new PgNoteStore(f.pool, () => NOW).add(note), (e) => e instanceof StorageUnavailableError && /can't be reached/.test(e.message), code);
    }
  });

  it("if clearing the cache fails, the note is NOT saved either (they succeed or fail together)", async () => {
    const f = fake((sql) => {
      if (sql.startsWith("INSERT")) return { rows: [row()] };
      if (sql.startsWith("UPDATE")) throw pgError("40001");
      return { rows: [] };
    });
    await assert.rejects(new PgNoteStore(f.pool, () => NOW).add(note));
    assert.deepEqual(f.sqls(), ["BEGIN", "INSERT", "UPDATE", "ROLLBACK"]);
  });
});

describe("deleting a note", () => {
  it("removes it and clears the cached recommendation of ITS field, in one transaction", async () => {
    const f = fake((sql) => (sql.startsWith("DELETE") ? { rows: [row()] } : { rows: [] }));
    const removed = await new PgNoteStore(f.pool, () => NOW).remove("n1");
    assert.deepEqual(f.sqls(), ["BEGIN", "DELETE", "UPDATE", "COMMIT"]);
    assert.deepEqual(f.calls[1].params, ["n1"]);
    assert.deepEqual(f.calls[2].params, [FIELD, WEEK]);
    assert.equal(removed.id, "n1");
  });

  it("a note that doesn't exist returns null and touches nothing else", async () => {
    const f = fake();
    assert.equal(await new PgNoteStore(f.pool, () => NOW).remove("nope"), null);
    assert.ok(!f.sqls().includes("UPDATE"));
  });

  it("an id that isn't a valid uuid just matches no note", async () => {
    const f = fake((sql) => {
      if (sql.startsWith("DELETE")) throw pgError("22P02");
      return { rows: [] };
    });
    assert.equal(await new PgNoteStore(f.pool, () => NOW).remove("not-a-uuid"), null);
  });
});

describe("listing notes", () => {
  it("returns a field's notes newest first, within the last N days", async () => {
    const f = fake(() => ({ rows: [row({ id: "b", event_date: "2026-09-18" }), row({ id: "a", event_date: new Date("2026-09-15T00:00:00Z") })] }));
    const notes = await new PgNoteStore(f.pool, () => NOW).notesFor(FIELD, 30, NOW);
    assert.match(f.calls[0].sql, /WHERE field_id = \$1 AND event_date >= \$2 ORDER BY event_date DESC, created_at DESC/);
    assert.deepEqual(f.calls[0].params, [FIELD, "2026-08-20"]);
    assert.deepEqual(notes.map((n) => [n.id, n.eventDate]), [["b", "2026-09-18"], ["a", "2026-09-15"]]);
  });

  it("an invalid field id simply has no notes", async () => {
    const f = fake(() => {
      throw pgError("22P02");
    });
    assert.deepEqual(await new PgNoteStore(f.pool, () => NOW).notesFor("plot-1", 30, NOW), []);
  });
});

describe("notes for the AI recommendation", () => {
  it("asks for the last 14 days plus the latest planting note, capped", async () => {
    const f = fake(() => ({ rows: [row({ id: "x", event_type: "planted", event_date: "2026-05-12" })] }));
    const notes = await listNotesForPrompt(FIELD, { now: NOW, pool: f.pool });
    assert.deepEqual(f.calls[0].params, [FIELD, "2026-09-05", 8]);
    assert.match(f.calls[0].sql, /event_date >= \$2 OR id = \(SELECT id FROM field_notes WHERE field_id = \$1 AND event_type = 'planted' ORDER BY event_date DESC, created_at DESC LIMIT 1\)/);
    assert.match(f.calls[0].sql, /ORDER BY event_date DESC, created_at DESC LIMIT \$3/);
    assert.equal(notes[0].eventType, "planted");
  });
});
