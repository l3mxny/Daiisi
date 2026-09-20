import { NextRequest, NextResponse } from "next/server";
import { FieldNotFoundError, getNoteStore, StorageUnavailableError } from "@/lib/notesStore";
import { DATE_RE, isEventType } from "@/lib/noteTypes";

// Saved voice notes.
//   POST   /api/notes                    save a note the farmer has reviewed and confirmed
//   GET    /api/notes?fieldId=&days=     a field's notes, most recent first (default: last 90 days)
//   DELETE /api/notes?id=                delete a note
// Storage is the temporary JSON file for now (see lib/notesStore.ts); only getNoteStore() changes when the
// database replaces it. Like the rest of the app, these routes have no sign-in yet.

const MAX_TEXT_CHARS = 2_000;
const MAX_ID_CHARS = 200;
const MAX_DAYS = 3_650;

function fail(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function isRealDate(iso: string): boolean {
  if (!DATE_RE.test(iso)) return false;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

function storageError(err: unknown) {
  if (err instanceof StorageUnavailableError) return fail(err.message, 503);
  if (err instanceof FieldNotFoundError) return fail(err.message, 409);
  console.error("[/api/notes] unexpected error:", err instanceof Error ? err.name : "unknown");
  return fail("Something went wrong with the notes.", 500);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return fail("Send a JSON body.", 400);
  const { fieldId, eventType, eventDate, detail, rawTranscript, confidence, confirmed } = body as Record<string, unknown>;

  // A note is only ever saved after the farmer has seen it and pressed Save.
  if (confirmed !== true) return fail("Notes are only saved after the farmer confirms them.", 400);
  if (typeof fieldId !== "string" || fieldId === "" || fieldId.length > MAX_ID_CHARS) return fail("fieldId is required.", 400);
  if (!isEventType(eventType)) return fail("eventType must be planted, irrigated, sprayed, harvested or observation.", 400);
  if (typeof eventDate !== "string" || !isRealDate(eventDate)) return fail("eventDate must be a real date (yyyy-mm-dd).", 400);
  if (eventDate > new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10)) return fail("eventDate can't be in the future.", 400);
  if (typeof detail !== "string" || detail.trim() === "" || detail.length > MAX_TEXT_CHARS) return fail("detail is required.", 400);
  if (typeof rawTranscript !== "string" || rawTranscript.length > MAX_TEXT_CHARS) return fail("rawTranscript must be text.", 400);
  if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) return fail("confidence must be between 0 and 1.", 400);

  try {
    const note = await getNoteStore().add({ fieldId, eventType, eventDate, detail: detail.trim(), rawTranscript, confidence });
    return NextResponse.json({ note }, { status: 201 });
  } catch (err) {
    return storageError(err);
  }
}

export async function GET(req: NextRequest) {
  const fieldId = req.nextUrl.searchParams.get("fieldId");
  if (!fieldId || fieldId.length > MAX_ID_CHARS) return fail("fieldId is required.", 400);
  const days = Number(req.nextUrl.searchParams.get("days") ?? 90);
  if (!Number.isFinite(days) || days < 1 || days > MAX_DAYS) return fail("days must be between 1 and 3650.", 400);
  try {
    return NextResponse.json({ notes: await getNoteStore().notesFor(fieldId, days) });
  } catch (err) {
    return storageError(err);
  }
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id || id.length > MAX_ID_CHARS) return fail("id is required.", 400);
  try {
    return (await getNoteStore().remove(id)) !== null ? NextResponse.json({ deleted: true }) : fail("No such note.", 404);
  } catch (err) {
    return storageError(err);
  }
}
