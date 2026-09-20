"use client";

import { useLanguage } from "./LanguageProvider";
import { languageByCode, type LanguageCode } from "@/lib/languages";

const VISIBLE = 3; // suggestions shown up front; the rest sit behind "More languages"

export default function LanguagePicker() {
  const { language, setLanguage, ranked, chosen, locationKnown, translation } = useLanguage();

  const top = ranked.slice(0, VISIBLE).map((r) => r.code);
  // The current language is always visible, even if it isn't among the top suggestions.
  const visible: LanguageCode[] = top.includes(language) ? top : [...top.slice(0, VISIBLE - 1), language];
  const more = ranked.map((r) => r.code).filter((code) => !visible.includes(code));

  const caption = chosen ? "Your choice" : locationKnown ? "Suggested for your location" : "Suggested for you";

  return (
    <div className="text-xs">
      <div className="flex items-center justify-between">
        <span className="font-medium tracking-wide text-white/70 uppercase">Language</span>
        <span className="sr-only">{caption}</span>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {visible.map((code) => {
          const lang = languageByCode(code);
          const active = code === language;
          return (
            <button
              key={code}
              lang={code}
              translate="no"
              aria-pressed={active}
              onClick={() => setLanguage(code)}
              className={`px-2.5 py-1 text-[11px] font-medium transition-colors ${
                active ? "bg-lime text-olive" : "bg-white text-olive hover:bg-lime/60"
              }`}
            >
              {lang.nativeName}
            </button>
          );
        })}
      </div>

      {translation !== "idle" && (
        <p className={`mt-2 ${translation === "error" ? "text-amber-300" : "text-white/60"}`}>
          {translation === "translating" && "Translating…"}
          {translation === "done" && "Translated automatically by Google. It may not be perfect."}
          {translation === "error" && "Couldn't translate right now, so this is showing English."}
        </p>
      )}

      {more.length > 0 && (
        <select
          aria-label="More languages"
          value=""
          onChange={(e) => {
            const code = e.target.value as LanguageCode;
            if (code) setLanguage(code);
          }}
          className="mt-2 w-full bg-white/10 px-2.5 py-1.5 text-[11px] text-white outline-none hover:bg-white/20"
        >
          <option value="">More languages…</option>
          {more.map((code) => {
            const lang = languageByCode(code);
            return (
              <option key={code} value={code} translate="no" className="text-zinc-900">
                {lang.nativeName} ({lang.name})
              </option>
            );
          })}
        </select>
      )}
    </div>
  );
}
