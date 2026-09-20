import type { NewNote, StoredNote } from "./noteTypes";

// What every notes store (the Postgres one and the local-file fallback) provides, so the routes never
// care which one is behind them.

export interface NoteStore {
  add(note: NewNote): Promise<StoredNote>;
  // Notes dated within the last `days` days, most recent first.
  notesFor(fieldId: string, days: number, now?: Date): Promise<StoredNote[]>;
  // Deletes a note and returns it (so the caller knows which field it belonged to), or null if there was none.
  remove(id: string): Promise<StoredNote | null>;
}

// The store can't be used right now (no writable disk, database unreachable, table not created yet).
export class StorageUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageUnavailableError";
  }
}

// The note names a field the database doesn't have (for example a field that was never saved).
export class FieldNotFoundError extends Error {
  constructor(message = "This field isn't saved yet, so it can't have notes.") {
    super(message);
    this.name = "FieldNotFoundError";
  }
}
