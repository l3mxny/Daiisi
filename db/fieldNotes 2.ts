import type { Pool, PoolClient } from "pg";
import { getWeekStart } from "../lib/week";
import { FieldNotFoundError, StorageUnavailableError, type NoteStore } from "../lib/noteStoreTypes";
import type { EventType, NewNote, StoredNote } from "../lib/noteTypes";
import { getDb } from "./index";

// Voice notes in Postgres (table field_notes, migration 0007). Saving or deleting a note also clears the
// field's cached AI recommendation for the current week, in the SAME transaction: lib/ai/recommendation.ts
// caches the advice on the stress_events row and reuses it all week, so without this a new note would
// change nothing until next week. Clearing only touches this week; older weeks keep the advice that was
// actually shown at the time.

type Queryable = Pick<PoolClient, "query">;
type PoolLike = Pick<Pool, "connect" | "query">;

interface NoteRow {
  id: string;
  field_id: string;
  event_type: EventType;
  event_date: string | Date; // the app's pg setup returns DATE as "yyyy-mm-dd"; tolerate a Date anyway
  detail: string;
  raw_transcript: string;
  confidence: number | string;
  created_at: string | Date;
}

function toStored(row: NoteRow): StoredNote {
  return {
    id: row.id,
    fieldId: row.field_id,
    eventType: row.event_type,
    eventDate: row.event_date instanceof Date ? row.event_date.toISOString().slice(0, 10) : row.event_date,
    detail: row.detail,
    rawTranscript: row.raw_transcript,
    confidence: Number(row.confidence),
    createdAt: new Date(row.created_at).toISOString(),
  };
}

// Turns database failures into the two errors the routes know how to answer.
function mapError(err: unknown): unknown {
  const code = (err as { code?: string })?.code;
  if (code === "23503" || code === "22P02") return new FieldNotFoundError(); // no such field, or not a valid field id
  if (code === "42P01") return new StorageUnavailableError("The notes table doesn't exist yet: migration 0007_field_notes.sql hasn't been run.");
  if (code && /^(08|57|53)/.test(code)) return new StorageUnavailableError("The database can't be reached right now.");
  if (code && /^(ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|EAI_AGAIN)$/.test(code)) return new StorageUnavailableError("The database can't be reached right now.");
  return err;
}

async function clearCachedRecommendation(client: Queryable, fieldId: string, now: Date): Promise<void> {
  await client.query(
    "UPDATE stress_events SET ai_recommendation = NULL, ai_recommendation_generated_at = NULL WHERE field_id = $1 AND week_start = $2",
    [fieldId, getWeekStart(now)]
  );
}

export class PgNoteStore implements NoteStore {
  constructor(
    private readonly pool: () => PoolLike = getDb,
    private readonly clock: () => Date = () => new Date()
  ) {}

  private async inTransaction<T>(work: (client: Queryable) => Promise<T>): Promise<T> {
    let client: PoolClient;
    try {
      client = await this.pool().connect();
    } catch (err) {
      throw mapError(err);
    }
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw mapError(err);
    } finally {
      client.release();
    }
  }

  add(note: NewNote): Promise<StoredNote> {
    return this.inTransaction(async (client) => {
      const { rows } = await client.query<NoteRow>(
        `INSERT INTO field_notes (field_id, event_type, event_date, detail, raw_transcript, confidence)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [note.fieldId, note.eventType, note.eventDate, note.detail, note.rawTranscript, note.confidence]
      );
      await clearCachedRecommendation(client, note.fieldId, this.clock());
      return toStored(rows[0]);
    });
  }

  async notesFor(fieldId: string, days: number, now: Date = this.clock()): Promise<StoredNote[]> {
    const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
    try {
      const { rows } = await this.pool().query<NoteRow>(
        `SELECT * FROM field_notes WHERE field_id = $1 AND event_date >= $2
         ORDER BY event_date DESC, created_at DESC`,
        [fieldId, cutoff]
      );
      return rows.map(toStored);
    } catch (err) {
      if ((err as { code?: string })?.code === "22P02") return []; // not a valid field id: it has no notes
      throw mapError(err);
    }
  }

  async remove(id: string): Promise<StoredNote | null> {
    try {
      return await this.inTransaction(async (client) => {
        const { rows } = await client.query<NoteRow>("DELETE FROM field_notes WHERE id = $1 RETURNING *", [id]);
        if (rows.length === 0) return null;
        await clearCachedRecommendation(client, rows[0].field_id, this.clock());
        return toStored(rows[0]);
      });
    } catch (err) {
      if (err instanceof FieldNotFoundError) return null; // an id that isn't a valid uuid matches no note
      throw err;
    }
  }
}

// The notes the AI recommendation should know about: everything from the last `days` days, plus the most
// recent planting note whatever its age (it says how old the crop is), newest first, capped.
export async function listNotesForPrompt(
  fieldId: string,
  options: { now?: Date; days?: number; limit?: number; pool?: () => PoolLike } = {}
): Promise<StoredNote[]> {
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - (options.days ?? 14) * 86_400_000).toISOString().slice(0, 10);
  const { rows } = await (options.pool ?? getDb)().query<NoteRow>(
    `SELECT * FROM field_notes
     WHERE field_id = $1
       AND (event_date >= $2
            OR id = (SELECT id FROM field_notes WHERE field_id = $1 AND event_type = 'planted'
                     ORDER BY event_date DESC, created_at DESC LIMIT 1))
     ORDER BY event_date DESC, created_at DESC
     LIMIT $3`,
    [fieldId, cutoff, options.limit ?? 8]
  );
  return rows.map(toStored);
}
