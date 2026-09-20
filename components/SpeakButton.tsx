"use client";

import { useEffect, useRef, useState } from "react";

// "Listen" button: sends the text to /api/speak (Deepgram text-to-speech) and plays the audio. Press again to stop.
export default function SpeakButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "loading" | "playing">("idle");
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  function teardown() {
    const audio = audioRef.current;
    audioRef.current = null;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.removeAttribute("src");
    }
  }

  useEffect(() => teardown, []);

  // The audio element is created and started right inside the click, pointing straight at /api/speak.
  // Browsers (Safari, phones) only allow sound that starts from the click itself, not after a fetch.
  function toggle() {
    if (state !== "idle") {
      teardown();
      setState("idle");
      return;
    }
    setError(null);
    setState("loading");
    const audio = new Audio(`/api/speak?text=${encodeURIComponent(text)}`);
    audioRef.current = audio;
    audio.onplaying = () => setState("playing");
    audio.onended = () => {
      teardown();
      setState("idle");
    };
    audio.onerror = async () => {
      // The element can't say why it failed, so ask the route for its message.
      const res = await fetch(`/api/speak?text=${encodeURIComponent(text)}`).catch(() => null);
      const body = res && !res.ok ? ((await res.json().catch(() => null)) as { error?: string } | null) : null;
      teardown();
      setError(body?.error ?? "Couldn't play the audio.");
      setState("idle");
    };
    audio.play().catch((err: unknown) => {
      if (audioRef.current !== audio) return; // stopped meanwhile
      if (err instanceof DOMException && err.name === "AbortError") return;
      teardown();
      setError("Your browser blocked the sound. Check it isn't muted, then try again.");
      setState("idle");
    });
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          toggle();
        }}
        className="rounded-full border border-green-200 bg-white px-2.5 py-1 text-xs font-medium text-green-800 hover:bg-green-50"
      >
        {state === "loading" ? "Loading…" : state === "playing" ? "■ Stop" : "▶ Listen"}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
