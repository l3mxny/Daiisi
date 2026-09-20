import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { NewNote, StoredNote } from "./noteTypes";

// TEMPORARY notes storage: one JSON file on the local disk, behind a small interface so the real database
// (Postgres) can replace it by implementing NoteStore, with no other file changing. Same columns as the
// planned table: id, field_id, event_type, event_date, detail, raw_transcript, confidence, created_at.
//
// Limits that come with a file: it only works where the server can write to disk (local development, not
// a Vercel deployment), and a field's notes are found by its id, which today changes when the page is
// reloaded because fields are not saved yet. Good for a local demo; not a place to keep real data.

export interface NoteStore {
  add(note: NewNote): Promise<StoredNote>;
  // Notes dated within the last `days` days, most recent first.
  notesFor(fieldId: string, days: number, now?: Date): Promise<StoredNote[]>;
  remove(id: string): Promise<boolean>; // false when there was no such note
}

export class StorageUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageUnavailableError";
  }
}

export class JsonFileNoteStore implements NoteStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly file: string) {}

  // Operations run one at a time so two quick saves can never overwrite each other.
  private run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async readAll(): Promise<StoredNote[]> {
    let text: string;
    try {
      text = await fs.readFile(this.file, "utf8");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") return []; // nothing saved yet (a write will report if we can't create it)
      throw new StorageUnavailableError("The notes file couldn't be read.");
    }
    try {
      const parsed: unknown = JSON.parse(text);
      if (!Array.isArray(parsed)) throw new Error("not a list");
      return parsed as StoredNote[];
    } catch {
      // Never overwrite a file we can't understand: that would silently destroy someone's notes.
      throw new StorageUnavailableError("The notes file is damaged, so nothing was changed.");
    }
  }

  private async writeAll(notes: StoredNote[]): Promise<void> {
    const temp = `${this.file}.${process.pid}.tmp`;
    try {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      await fs.writeFile(temp, JSON.stringify(notes, null, 2), "utf8");
      await fs.rename(temp, this.file); // atomic: a crash never leaves a half-written file
    } catch {
      await fs.rm(temp, { force: true }).catch(() => undefined);
      throw new StorageUnavailableError("Notes can't be saved on this server yet (no writable storage).");
    }
  }

  add(note: NewNote): Promise<StoredNote> {
    return this.run(async () => {
      const stored: StoredNote = { ...note, id: randomUUID(), createdAt: new Date().toISOString() };
      await this.writeAll([...(await this.readAll()), stored]);
      return stored;
    });
  }

  notesFor(fieldId: string, days: number, now: Date = new Date()): Promise<StoredNote[]> {
    return this.run(async () => {
      const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
      return (await this.readAll())
        .filter((n) => n.fieldId === fieldId && n.eventDate >= cutoff)
        .sort((a, b) => (a.eventDate === b.eventDate ? b.createdAt.localeCompare(a.createdAt) : b.eventDate.localeCompare(a.eventDate)));
    });
  }

  remove(id: string): Promise<boolean> {
    return this.run(async () => {
      const notes = await this.readAll();
      const kept = notes.filter((n) => n.id !== id);
      if (kept.length === notes.length) return false;
      await this.writeAll(kept);
      return true;
    });
  }
}

let store: NoteStore | null = null;

// The store the app uses. When the database is ready, return its implementation here.
export function getNoteStore(): NoteStore {
  if (!store) store = new JsonFileNoteStore(process.env.NOTES_FILE ?? path.join(process.cwd(), "data", "notes.json"));
  return store;
}
