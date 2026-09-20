"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import NoteReview, { type NoteDraft } from "./NoteReview";
import SavedNotes from "./SavedNotes";
import { captureDate, toIso } from "@/lib/noteDates";
import type { FieldRef, ParsedNote } from "@/lib/noteTypes";

// Optional voice notes for one field. Nothing here runs, and the microphone is never touched, until the
// farmer clicks "Additional information" and then presses Record:
//   - no getUserMedia() on page load or when the panel opens; the browser's permission prompt appears on
//     the first Record press, tied to something the farmer deliberately did
//   - recording ends on a second click or at MAX_SECONDS, whichever comes first
//   - the mic is only live while recording: every track is stopped when a recording ends, when the panel
//     is closed, when the card collapses or the tab changes (unmount), and when the page is hidden/closed
//   - what was said is shown as text, then interpreted (field, kind of event, date), then the farmer
//     reviews and can correct it; a note is only saved when they press Save
// The rest of FarmOS works the same whether or not this is ever used.

const MAX_SECONDS = 60;
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

type Phase = "idle" | "requesting" | "recording" | "transcribing" | "done" | "error";

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((t) => MediaRecorder.isTypeSupported(t));
}

function extensionFor(mime: string): string {
  if (mime.includes("mp4")) return ".m4a";
  if (mime.includes("ogg")) return ".ogg";
  if (mime.includes("wav")) return ".wav";
  return ".webm";
}

function formatTime(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function micErrorMessage(err: unknown): string {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Microphone access was blocked. Allow it for this site in your browser settings and try again, or upload a recording instead.";
  }
  if (name === "NotFoundError") return "No microphone was found. You can upload a recording instead.";
  if (name === "NotReadableError") return "The microphone is being used by another app. Close it and try again, or upload a recording.";
  return "Couldn't start the microphone. You can upload a recording instead.";
}

// If the server can't be reached to interpret a note, the farmer still gets a plain observation to review.
function localFallback(fieldId: string, transcript: string, capture: { at: string; tz: number }): ParsedNote {
  return {
    fieldId,
    eventType: "observation",
    date: toIso(captureDate(capture.at, capture.tz)),
    dateAssumed: true,
    detail: transcript,
    confidence: 0,
    rawTranscript: transcript,
    fieldMatch: "default",
    usedFallback: true,
    fallbackReason: "We couldn't reach the server to interpret it",
  };
}

export default function FieldNotes({ fieldId, fieldLabel, fieldChoices }: { fieldId: string; fieldLabel: string; fieldChoices: FieldRef[] }) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedNote | null>(null);
  const [parseId, setParseId] = useState(0);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const openRef = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const capRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const parseAbortRef = useRef<AbortController | null>(null);
  const captureRef = useRef<{ at: string; tz: number } | null>(null); // when the note was recorded, in the farmer's time zone
  const discardRecordingRef = useRef<(() => void) | null>(null); // marks the CURRENT recording as thrown away, not sent

  function clearTimers() {
    if (timerRef.current) clearInterval(timerRef.current);
    if (capRef.current) clearTimeout(capRef.current);
    timerRef.current = null;
    capRef.current = null;
  }

  // Stops every track so the browser's "microphone in use" indicator goes off.
  function releaseMic() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  // Ends any recording (discarding it) and any request in flight, and makes sure the mic is off.
  const teardown = useCallback(() => {
    discardRecordingRef.current?.();
    discardRecordingRef.current = null;
    abortRef.current?.abort();
    abortRef.current = null;
    parseAbortRef.current?.abort();
    parseAbortRef.current = null;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    recorderRef.current = null;
    if (timerRef.current) clearInterval(timerRef.current);
    if (capRef.current) clearTimeout(capRef.current);
    timerRef.current = null;
    capRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    window.addEventListener("pagehide", teardown);
    return () => {
      window.removeEventListener("pagehide", teardown);
      teardown(); // the card collapsed, the tab changed, or the page went away
    };
  }, [teardown]);

  function resetNote() {
    parseAbortRef.current?.abort();
    parseAbortRef.current = null;
    setTranscript(null);
    setMessage(null);
    setParsed(null);
    setParsing(false);
    setSaving(false);
    setSaveError(null);
    setSavedMessage(null);
  }

  function openPanel() {
    openRef.current = true;
    setOpen(true);
  }

  function closePanel() {
    openRef.current = false;
    teardown();
    setPhase("idle");
    setElapsed(0);
    resetNote();
    setOpen(false);
  }

  // Works out what the transcript means. Never blocks the note: on any failure the farmer still gets a
  // plain observation to review.
  async function interpret(text: string) {
    const capture = captureRef.current ?? { at: new Date().toISOString(), tz: new Date().getTimezoneOffset() };
    parseAbortRef.current?.abort();
    const controller = new AbortController();
    parseAbortRef.current = controller;
    setParsing(true);
    let result: ParsedNote;
    try {
      const res = await fetch("/api/note/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: text, defaultFieldId: fieldId, fields: fieldChoices, capturedAt: capture.at, tzOffsetMinutes: capture.tz }),
        signal: controller.signal,
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json) throw new Error("parse failed");
      result = json as ParsedNote;
    } catch {
      if (controller.signal.aborted) return;
      result = localFallback(fieldId, text, capture);
    }
    if (controller.signal.aborted) return;
    setParsed(result);
    setParseId((n) => n + 1);
    setParsing(false);
  }

  async function send(audio: Blob, filename: string) {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase("transcribing");
    resetNote();
    const form = new FormData();
    form.append("audio", audio, filename);
    form.append("fieldId", fieldId);
    try {
      const res = await fetch("/api/note", { method: "POST", body: form, signal: controller.signal });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? `Request failed: ${res.status}`);
      const text = typeof json?.transcript === "string" ? json.transcript : "";
      setTranscript(text); // shown to the farmer straight away, before anything else happens
      setPhase("done");
      if (text !== "") void interpret(text);
    } catch (err) {
      if (controller.signal.aborted) return; // the panel was closed; nobody is waiting for this
      setPhase("error");
      setMessage(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  async function saveNote(draft: NoteDraft) {
    if (!parsed) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...draft,
          detail: parsed.detail,
          rawTranscript: parsed.rawTranscript,
          confidence: parsed.confidence,
          confirmed: true, // the farmer has seen it and pressed Save
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? `Request failed: ${res.status}`);
      const target = fieldChoices.find((f) => f.id === draft.fieldId)?.label ?? fieldLabel;
      resetNote();
      setPhase("idle");
      setSavedMessage(`Saved to ${target}.`);
      setRefreshKey((n) => n + 1);
    } catch (err) {
      setSaving(false);
      setSaveError(err instanceof Error ? err.message : "Couldn't save the note. Try again.");
    }
  }

  function discardNote() {
    resetNote();
    setPhase("idle");
  }

  function stopRecording() {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop(); // onstop finishes the job
  }

  async function startRecording() {
    resetNote();
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setPhase("error");
      setMessage("This browser can't record audio. You can upload a recording instead.");
      return;
    }

    setPhase("requesting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true }); // the ONLY place the mic is requested
    } catch (err) {
      setPhase("error");
      setMessage(micErrorMessage(err));
      return;
    }
    if (!openRef.current) {
      stream.getTracks().forEach((track) => track.stop()); // the panel was closed while the prompt was open
      return;
    }

    streamRef.current = stream;
    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorderRef.current = recorder;
    chunksRef.current = [];
    let discarded = false; // belongs to this recording only, so a late 'stop' from an old one can't send this one
    discardRecordingRef.current = () => {
      discarded = true;
    };
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      clearTimers();
      releaseMic(); // the mic goes off the moment recording ends
      recorderRef.current = null;
      if (discarded) return;
      const type = recorder.mimeType || mimeType || "audio/webm";
      void send(new Blob(chunksRef.current, { type }), `note${extensionFor(type)}`);
    };

    captureRef.current = { at: new Date().toISOString(), tz: new Date().getTimezoneOffset() }; // when it was SAID
    recorder.start();
    setElapsed(0);
    setPhase("recording");
    const startedAt = Date.now();
    timerRef.current = setInterval(() => setElapsed(Math.min(MAX_SECONDS, Math.floor((Date.now() - startedAt) / 1000))), 250);
    capRef.current = setTimeout(stopRecording, MAX_SECONDS * 1000);
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // so choosing the same file again still fires
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      setPhase("error");
      setMessage("That file is too large (limit 20 MB).");
      return;
    }
    if (file.type && !file.type.startsWith("audio/") && file.type !== "video/webm") {
      setPhase("error");
      setMessage("Please choose an audio file (WAV, MP3, M4A, WebM or OGG).");
      return;
    }
    captureRef.current = { at: new Date().toISOString(), tz: new Date().getTimezoneOffset() }; // an upload is dated as of now
    void send(file, file.name);
  }

  const recording = phase === "recording";
  const busy = phase === "requesting" || recording || phase === "transcribing" || parsing || saving;

  return (
    <div className="mt-4 border-t border-zinc-200 pt-4">
      <button
        type="button"
        onClick={open ? closePanel : openPanel}
        aria-expanded={open}
        aria-controls={panelId}
        className="rounded-full border border-zinc-300 bg-white px-4 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100"
      >
        Additional information
      </button>

      {open && (
        <div id={panelId} className="mt-3 rounded-lg border border-zinc-200 bg-white p-4">
          <h3 className="font-serif text-lg text-zinc-900">Voice note for {fieldLabel}</h3>
          <p className="mt-1 text-xs text-zinc-500">
            Optional. The microphone stays off until you press Record. Your audio is sent to Deepgram to be turned into text,
            and the audio itself is not saved.
          </p>

          <div className="mt-3" role="status" aria-live="polite" data-testid="mic-status">
            {recording ? (
              <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm">
                <span className="h-3 w-3 shrink-0 animate-pulse rounded-full bg-red-600" aria-hidden="true" />
                <span className="font-semibold text-red-700">Recording: microphone is ON</span>
                <span className="ml-auto tabular-nums text-red-700" data-testid="elapsed">
                  {formatTime(elapsed)} / {formatTime(MAX_SECONDS)}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-zinc-500">
                <span className="h-3 w-3 shrink-0 rounded-full bg-zinc-300" aria-hidden="true" />
                {phase === "requesting"
                  ? "Waiting for your permission to use the microphone…"
                  : phase === "transcribing"
                    ? "Microphone is off. Turning your voice into text…"
                    : "Microphone is off"}
              </div>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            {recording ? (
              <button
                type="button"
                onClick={stopRecording}
                data-testid="record-button"
                className="rounded-full bg-red-600 px-5 py-2 text-sm font-medium text-white hover:bg-red-700"
              >
                Stop
              </button>
            ) : (
              <button
                type="button"
                onClick={startRecording}
                disabled={busy}
                data-testid="record-button"
                className="rounded-full bg-green-700 px-5 py-2 text-sm font-medium text-white hover:bg-green-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {phase === "done" ? "Record again" : "Record"}
              </button>
            )}
            <label
              className={`text-sm ${busy ? "cursor-not-allowed text-zinc-300" : "cursor-pointer text-zinc-600 underline hover:text-zinc-900"}`}
            >
              Or upload a recording
              <input type="file" accept="audio/*,.wav,.mp3,.m4a,.webm,.ogg" onChange={handleFile} disabled={busy} className="sr-only" data-testid="upload-input" />
            </label>
            <span className="text-xs text-zinc-400">Up to {MAX_SECONDS} seconds</span>
          </div>

          {phase === "error" && message && (
            <p className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700" data-testid="note-error">
              {message}
            </p>
          )}

          {phase === "done" && transcript !== null && (
            <div className="mt-3" data-testid="transcript-box">
              {transcript === "" ? (
                <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  We couldn&apos;t make out any speech. Try again closer to the microphone, or upload a recording.
                </p>
              ) : (
                <>
                  <div className="text-xs font-semibold tracking-wide text-zinc-400 uppercase">What we heard</div>
                  <blockquote
                    className="mt-1 rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm whitespace-pre-wrap text-zinc-900"
                    data-testid="transcript"
                  >
                    {transcript}
                  </blockquote>
                  {!parsed && !parsing && <p className="mt-1 text-xs text-zinc-500">If that isn&apos;t right, press &ldquo;Record again&rdquo;.</p>}
                </>
              )}
            </div>
          )}

          {parsing && (
            <p className="mt-3 text-sm text-zinc-500" role="status" data-testid="parsing">
              Working out the details…
            </p>
          )}

          {parsed && (
            <NoteReview
              key={parseId}
              parsed={parsed}
              fieldChoices={fieldChoices}
              defaultFieldId={fieldId}
              saving={saving}
              error={saveError}
              onSave={saveNote}
              onDiscard={discardNote}
            />
          )}

          {savedMessage && (
            <p className="mt-3 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800" role="status" data-testid="saved-message">
              {savedMessage}
            </p>
          )}

          <SavedNotes fieldId={fieldId} refreshKey={refreshKey} />
        </div>
      )}
    </div>
  );
}
