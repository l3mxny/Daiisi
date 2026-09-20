import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { PgNoteStore } from "../db/fieldNotes";
import { StorageUnavailableError, type NoteStore } from "./noteStoreTypes";
import type { NewNote, StoredNote } from "./noteTypes";

export { FieldNotFoundError, StorageUnavailableError, type NoteStore } from "./noteStoreTypes";

// Where notes are kept. With a database configured (DATABASE_URL) they go to Postgres (db/fieldNotes.ts),
// where saving or deleting a note also clears that field's cached AI recommendation so the next one sees it.
// Without a database (a quick local run) they fall back to the small JSON file below, which is only good
// for a demo: it needs a writable disk (not a Vercel deployment) and has no recommendation to refresh.

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

  remove(id: string): Promise<StoredNote | null> {
    return this.run(async () => {
      const notes = await this.readAll();
      const removed = notes.find((n) => n.id === id) ?? null;
      if (!removed) return null;
      await this.writeAll(notes.filter((n) => n.id !== id));
      return removed;
    });
  }
}

let store: NoteStore | null = null;

export function getNoteStore(): NoteStore {
  if (!store) {
    if (process.env.DATABASE_URL) {
      store = new PgNoteStore();
    } else if (process.env.VERCEL) {
      // A function's disk is temporary on Vercel, so a JSON file would "save" notes and then lose them. Refuse instead.
      throw new StorageUnavailableError("Notes need a database: DATABASE_URL is not set on this deployment.");
    } else {
      store = new JsonFileNoteStore(process.env.NOTES_FILE ?? path.join(process.cwd(), "data", "notes.json"));
    }
  }
  return store;
}
