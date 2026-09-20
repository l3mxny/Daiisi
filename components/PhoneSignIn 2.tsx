"use client";

import { useState, type FormEvent } from "react";
import { normalizePhone } from "@/lib/phone";

export default function PhoneSignIn({ onSignIn }: { onSignIn: (phone: string) => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

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
    <div className="flex h-screen w-screen items-center justify-center bg-[#f7f3ea] px-4">
      <form
        onSubmit={handleSubmit}
        className="flex w-full max-w-sm flex-col gap-4 rounded-3xl border border-zinc-100 bg-white p-8 shadow-sm"
      >
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-green-600 text-lg font-bold text-white">
            D
          </span>
          <h1 className="font-serif text-2xl text-zinc-900">Welcome to Daiisi</h1>
          <p className="text-sm text-zinc-500">Enter your phone number to see your fields.</p>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-zinc-600">Phone number</span>
          <input
            type="tel"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            placeholder="e.g. (555) 123-4567"
            autoFocus
            className="rounded-xl border border-zinc-200 px-3 py-2.5 text-sm outline-none focus:border-green-400"
          />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          className="rounded-full bg-green-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-green-700"
        >
          Continue
        </button>

        <p className="text-center text-xs text-zinc-400">No password needed — just your phone number.</p>
      </form>
    </div>
  );
}
