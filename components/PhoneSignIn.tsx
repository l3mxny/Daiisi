"use client";

import { useState, type FormEvent } from "react";
import LanguagePicker from "./LanguagePicker";
import Logo from "./Logo";
import { normalizePhone } from "@/lib/phone";

// The photo goes in public/login-bg.jpg. Without it the screen shows the dark green behind it instead.
const BACKGROUND =
  "linear-gradient(rgba(6, 16, 6, 0.74), rgba(6, 16, 6, 0.74)), url(/login-bg.jpg), linear-gradient(#1c3a17, #14290f)";

export default function PhoneSignIn({ onSignIn }: { onSignIn: (phone: string) => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [languageOpen, setLanguageOpen] = useState(false);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const normalized = normalizePhone(value);
    if (!normalized) {
      setError("Enter a valid phone number.");
      return;
    }
    onSignIn(normalized);
  }

  return (
    <div
      className="relative flex h-screen w-screen items-center justify-center bg-cover bg-center px-4 font-[family-name:var(--font-cutive)]"
      style={{ backgroundImage: BACKGROUND }}
    >
      {/* Language */}
      <div className="absolute top-5 right-6 flex flex-col items-end gap-2">
        <button
          type="button"
          onClick={() => setLanguageOpen((o) => !o)}
          aria-expanded={languageOpen}
          aria-label="Change language"
          title="Language"
          className="text-coral transition-opacity hover:opacity-80"
        >
          <svg viewBox="0 0 32 32" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 5h15v11H9l-4 4v-4H3z" />
            <path d="M7 12l2.5-5.5L12 12M8 10.5h3" />
            <path d="M14 15h14v11h-2v4l-4-4h-8z" transform="translate(0 -2)" />
            <path d="M18 12.5h7M21.5 11v1.5M19 18c1.5-1 2.5-3 2.7-5.5M24 18c-1.5-1-2.5-3-2.7-5.5" />
          </svg>
        </button>
        {languageOpen && (
          <div className="w-56 bg-olive/95 p-3 shadow-lg">
            <LanguagePicker />
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="flex w-full max-w-xl flex-col items-center text-center text-coral">
        <Logo className="h-48 w-auto text-coral" />
        <h1
          className="mt-3 origin-top font-[family-name:var(--font-wordmark)] text-8xl leading-none tracking-wide uppercase"
          style={{ transform: "scale(0.78, 1.15)" }}
        >
          Daiisi
        </h1>

        <label htmlFor="phone" className="mt-14 text-lg [text-shadow:0_1px_6px_rgba(0,0,0,0.6)]">
          To get started, please enter your phone number:
        </label>
        <input
          id="phone"
          type="tel"
          inputMode="tel"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          placeholder="XXX-XXX-XXXX"
          autoFocus
          className="mt-4 w-full max-w-lg bg-coral/85 px-4 py-3 text-center text-2xl text-white outline-none placeholder:text-white/85 focus:bg-coral"
        />
        {error && <p className="mt-2 text-sm text-white">{error}</p>}

        <button type="submit" className="mt-6 text-xl tracking-wide [text-shadow:0_1px_6px_rgba(0,0,0,0.6)] transition-opacity hover:opacity-80">
          Continue
        </button>
      </form>
    </div>
  );
}
