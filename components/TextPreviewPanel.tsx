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
    <div className="h-full overflow-y-auto bg-cream p-8 font-[family-name:var(--font-mono-ui)]">
      <header>
        <h1 className="font-[family-name:var(--font-display)] text-4xl leading-tight font-extrabold tracking-tight text-olive uppercase">
          SMS updates
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-olive/80">
          The text a farmer would get on their phone, built from the same analysis as My results. It is a simulation:
          nothing leaves this page and no SMS service is connected.
        </p>
      </header>

      {tracked.length === 0 ? (
        <div className="mt-6 border border-dashed border-olive/30 bg-white/60 p-8 text-center text-sm text-olive/70">
          {pending > 0
            ? "Loading your fields…"
            : "No saved fields yet. Draw and save a field on My fields to preview the text."}
        </div>
      ) : (
        <>
          {/* The message is the main thing: a large phone, with the send controls beside it */}
          <div className="mt-8 grid grid-cols-1 items-start gap-10 lg:grid-cols-[26rem_minmax(0,1fr)]">
            <div className="mx-auto w-full max-w-[26rem]">
              <div className="rounded-[2.75rem] border-[10px] border-zinc-900 bg-zinc-100 px-5 pt-4 pb-6 shadow-2xl">
                <div className="mx-auto mb-3 h-1.5 w-16 rounded-full bg-zinc-300" />
                <div className="mb-4 text-center text-xs font-semibold tracking-wide text-zinc-500 uppercase">FarmOS</div>
                <div className="overflow-hidden rounded-3xl rounded-tl-md bg-white text-[15px] leading-relaxed text-zinc-900 shadow-sm">
                  {photoUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photoUrl} alt={`Satellite photo of ${topPlot?.label ?? "the field"}`} className="h-48 w-full object-cover" />
                  )}
                  <div translate="no" className="min-h-40 px-5 py-4 whitespace-pre-wrap">{digest.text}</div>
                </div>
                <div className="mt-3 px-1 text-[11px] text-zinc-400">Today&apos;s text, not sent</div>
              </div>

              <div className="mt-5">
                <div className="flex justify-between text-xs text-olive/70">
                  <span>
                    {digest.chars} characters · {digest.segments} {digest.segments === 1 ? "SMS segment" : "SMS segments"}
                  </span>
                  <span>{digest.perSegment} per segment</span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden bg-olive/10">
                  <div
                    className={`h-full ${digest.chars > digest.perSegment ? "bg-amber-500" : "bg-olive"}`}
                    style={{ width: `${Math.min(100, Math.round((digest.chars / digest.perSegment) * 100))}%` }}
                  />
                </div>
                {digest.chars > digest.perSegment && (
                  <p className="mt-1.5 text-xs text-amber-700">
                    Over {digest.perSegment} characters, so it splits into more than one text.
                  </p>
                )}
                {digest.encoding === "ucs2" && (
                  <p className="mt-1.5 text-xs text-olive/70">
                    This language needs a different text encoding, so each text holds only 70 characters and long
                    messages split sooner.
                  </p>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-6">
              <div className="border border-zinc-200 bg-white p-5 shadow-sm">
                <h2 className="inline-block border-b border-olive pb-1 font-[family-name:var(--font-display)] text-sm font-bold tracking-wide text-olive uppercase">
                  Send it
                </h2>
                <label className="mt-4 block text-xs text-olive" htmlFor="farmer-phone">
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
                  className={`mt-1.5 w-full border bg-zinc-100/70 px-3 py-2 text-xs text-olive outline-none focus:border-olive ${
                    phoneProblem ? "border-red-400" : "border-zinc-200"
                  }`}
                />
                {phoneProblem && (
                  <p className="mt-1 text-xs text-red-600">
                    Start with + and the country code, then digits only (like +254712345678, not 0712345678).
                  </p>
                )}
                <label className={`mt-4 flex items-start gap-2 text-xs ${topPhoto ? "text-olive" : "text-zinc-400"}`}>
                  <input
                    type="checkbox"
                    checked={attachPhoto && topPhoto !== null}
                    disabled={topPhoto === null}
                    onChange={(e) => setAttachPhoto(e.target.checked)}
                    className="mt-0.5 accent-olive"
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
                  className="mt-5 w-full bg-olive px-4 py-3 text-xs font-semibold tracking-wide text-white uppercase transition-colors hover:bg-olive-soft disabled:cursor-not-allowed disabled:opacity-40"
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
                <h2 className="text-xs font-semibold tracking-wide text-olive/70 uppercase">
                  Outbox (simulated){outbox.length > 0 ? ` · ${outbox.length}` : ""}
                </h2>
                {outbox.length === 0 ? (
                  <p className="mt-2 text-sm text-olive/60">No texts yet. Enter a number and press Send.</p>
                ) : (
                  <ul className="mt-2 flex flex-col gap-2">
                    {outbox.map((m) => (
                      <li key={m.id} className="border border-zinc-200 bg-white p-3">
                        <div className="flex items-center justify-between gap-2 text-xs text-zinc-500">
                          <span className="truncate">
                            To {m.to} · {formatTime(m.createdAt)}
                          </span>
                          <span className={`shrink-0 px-2 py-0.5 font-semibold ${STATUS_STYLE[m.status]}`}>{m.status}</span>
                        </div>
                        {m.imageUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={m.imageUrl} alt="Attached satellite photo" className="mt-2 h-28 w-full object-cover" />
                        )}
                        <pre translate="no" className="mt-2 font-[family-name:var(--font-mono-ui)] text-xs whitespace-pre-wrap text-zinc-900">{m.body}</pre>
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
          </div>

          {/* The pictures behind the text, in equal columns under the message */}
          <div className="mt-12 border-t border-olive/20 pt-8">
            <SatellitePanel plots={tracked} digest={digest} />
          </div>
        </>
      )}
    </div>
  );
}
