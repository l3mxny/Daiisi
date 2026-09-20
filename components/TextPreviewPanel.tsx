"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import { useLanguage } from "./LanguageProvider";
import SatellitePanel from "./SatellitePanel";
import { composeDigest } from "@/lib/smsDigest";
import {
  decideSimulatedSend,
  isValidE164,
  makeSimulatedMessage,
  type MessageStatus,
  type SendDecision,
  type SimulatedMessage,
} from "@/lib/smsSimulation";
import type { Plot } from "@/lib/types";

const STATUS_STYLE: Record<MessageStatus, string> = {
  queued: "bg-zinc-100 text-zinc-700",
  sent: "bg-blue-100 text-blue-800",
  delivered: "bg-green-100 text-green-800",
};

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

export default function TextPreviewPanel({
  plots,
  outbox,
  onOutboxChange,
}: {
  plots: Plot[];
  outbox: SimulatedMessage[];
  onOutboxChange: Dispatch<SetStateAction<SimulatedMessage[]>>;
}) {
  const { language } = useLanguage();
  const [phone, setPhone] = useState("");
  const [notice, setNotice] = useState<SendDecision | null>(null);
  const [attachPhoto, setAttachPhoto] = useState(false);

  const tracked = plots.filter((p) => p.saved && p.data !== null);
  const pending = plots.filter((p) => p.saved && p.data === null && p.status === "loading").length;
  const digest = composeDigest(tracked.map((p) => ({ id: p.id, name: p.label, data: p.data! })), { language });

  // The satellite photo of the field at the top of the text, if there is one to attach.
  const topPlot = tracked.find((p) => p.id === digest.lines[0]?.id);
  const topPhoto = topPlot?.data?.observation.trueColorImage ?? null;
  const photoUrl = attachPhoto ? topPhoto : null;

  const phoneOk = isValidE164(phone);
  const phoneProblem = phone !== "" && !phoneOk;

  function advance(id: string, status: MessageStatus) {
    onOutboxChange((prev) => prev.map((m) => (m.id === id ? { ...m, status } : m)));
  }

  function handleSend() {
    const decision = decideSimulatedSend(digest, outbox[0]);
    setNotice(decision);
    if (!decision.send) return;
    const message = makeSimulatedMessage(phone, digest, Date.now(), photoUrl);
    onOutboxChange((prev) => [message, ...prev]);
    // Twilio reports queued -> sent -> delivered; mimic that pacing.
    setTimeout(() => advance(message.id, "sent"), 800);
    setTimeout(() => advance(message.id, "delivered"), 1800);
  }

  return (
    <div className="h-full overflow-y-auto p-8">
      <header>
        <h1 className="font-serif text-3xl text-zinc-900">Farmer&apos;s text</h1>
        <p className="mt-1 max-w-3xl text-sm text-zinc-500">
          A simulation of the texts an upgraded Twilio account would send, built from the same analysis as the Results
          tab. Nothing leaves this page and no SMS provider is connected.
        </p>
      </header>

      {tracked.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-center text-sm text-zinc-500">
          {pending > 0
            ? "Loading your fields…"
            : "No saved fields yet. Draw and save a field on the Field input tab to preview the text."}
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-8 xl:grid-cols-[23rem_1fr]">
          <div className="flex flex-col gap-6">
            <div>
              <div className="mx-auto w-full max-w-xs rounded-[2.5rem] border-8 border-zinc-800 bg-zinc-100 p-4 shadow-lg">
                <div className="mb-3 text-center text-xs font-medium text-zinc-500">FarmOS</div>
                <div className="overflow-hidden rounded-2xl rounded-tl-sm bg-white text-sm leading-relaxed text-zinc-900 shadow-sm">
                  {photoUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photoUrl} alt={`Satellite photo of ${topPlot?.label ?? "the field"}`} className="h-40 w-full object-cover" />
                  )}
                  <div translate="no" className="px-4 py-3 whitespace-pre-wrap">{digest.text}</div>
                </div>
                <div className="mt-2 px-1 text-[11px] text-zinc-400">Today&apos;s text, not sent</div>
              </div>

              <div className="mx-auto mt-4 max-w-xs">
                <div className="flex justify-between text-xs text-zinc-500">
                  <span>
                    {digest.chars} characters · {digest.segments} {digest.segments === 1 ? "SMS segment" : "SMS segments"}
                  </span>
                  <span>{digest.perSegment} per segment</span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-zinc-200">
                  <div
                    className={`h-full rounded-full ${digest.chars > digest.perSegment ? "bg-amber-500" : "bg-green-600"}`}
                    style={{ width: `${Math.min(100, Math.round((digest.chars / digest.perSegment) * 100))}%` }}
                  />
                </div>
                {digest.chars > digest.perSegment && (
                  <p className="mt-1 text-xs text-amber-700">
                    Over {digest.perSegment} characters, so it splits into more than one text.
                  </p>
                )}
                {digest.encoding === "ucs2" && (
                  <p className="mt-1 text-xs text-zinc-500">
                    This language needs a different text encoding, so each text holds only 70 characters and long
                    messages split sooner.
                  </p>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-zinc-200 bg-white p-4">
              <div className="text-xs font-semibold tracking-wide text-zinc-400 uppercase">Simulate sending</div>
              <label className="mt-3 block text-sm text-zinc-600" htmlFor="farmer-phone">
                Farmer&apos;s phone number
              </label>
              <input
                id="farmer-phone"
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value.trim());
                  setNotice(null);
                }}
                placeholder="+254712345678"
                inputMode="tel"
                className={`mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-1 ${
                  phoneProblem ? "border-red-400 focus:ring-red-400" : "border-zinc-300 focus:ring-green-600"
                }`}
              />
              {phoneProblem && (
                <p className="mt-1 text-xs text-red-600">
                  Start with + and the country code, then digits only (like +254712345678, not 0712345678).
                </p>
              )}
              <label className={`mt-3 flex items-start gap-2 text-xs ${topPhoto ? "text-zinc-600" : "text-zinc-400"}`}>
                <input
                  type="checkbox"
                  checked={attachPhoto && topPhoto !== null}
                  disabled={topPhoto === null}
                  onChange={(e) => setAttachPhoto(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  Attach the satellite photo (MMS)
                  <span className="block text-zinc-400">
                    MMS is mainly available for US and Canadian numbers; elsewhere the farmer would get text only.
                  </span>
                </span>
              </label>
              <button
                onClick={handleSend}
                disabled={!phoneOk}
                className="mt-3 w-full rounded-full bg-green-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Send (simulated)
              </button>
              {notice && (
                <p className={`mt-2 text-xs ${notice.send ? "text-green-700" : "text-amber-700"}`}>
                  {notice.send ? `Sent: ${notice.reason}` : notice.reason}
                </p>
              )}
            </div>

            <div>
              <div className="text-xs font-semibold tracking-wide text-zinc-400 uppercase">
                Outbox (simulated){outbox.length > 0 ? ` · ${outbox.length}` : ""}
              </div>
              {outbox.length === 0 ? (
                <p className="mt-2 text-sm text-zinc-500">No texts yet. Enter a number and press Send.</p>
              ) : (
                <ul className="mt-2 flex flex-col gap-2">
                  {outbox.map((m) => (
                    <li key={m.id} className="rounded-lg border border-zinc-200 bg-white p-3">
                      <div className="flex items-center justify-between gap-2 text-xs text-zinc-500">
                        <span className="truncate">
                          To {m.to} · {formatTime(m.createdAt)}
                        </span>
                        <span className={`shrink-0 rounded px-2 py-0.5 font-semibold ${STATUS_STYLE[m.status]}`}>
                          {m.status}
                        </span>
                      </div>
                      {m.imageUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={m.imageUrl} alt="Attached satellite photo" className="mt-2 h-28 w-full rounded-md object-cover" />
                      )}
                      <pre translate="no" className="mt-2 font-sans text-sm whitespace-pre-wrap text-zinc-900">{m.body}</pre>
                      <div className="mt-2 text-[11px] text-zinc-400">
                        {m.chars} chars · {m.segments} {m.segments === 1 ? "segment" : "segments"}
                        {m.imageUrl ? " · with photo (MMS)" : ""} · {m.id}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <SatellitePanel plots={tracked} digest={digest} />
        </div>
      )}
    </div>
  );
}
