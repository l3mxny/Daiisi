"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { restoreEnglish, startDomTranslator, type TranslationStatus } from "@/lib/domTranslator";
import { getCurrentLocation } from "@/lib/geoLocation";
import {
  isLanguageCode,
  parseBrowserLanguages,
  rankLanguages,
  type LanguageCode,
  type RankedLanguage,
} from "@/lib/languages";
import { fetchCountryCode } from "@/lib/reverseGeocode";

const STORAGE_KEY = "farmos.language";

// Browser storage can be missing or throw (private windows, blocked site data), so the choice
// is only a convenience: everything must work without it.
function readSavedLanguage(): LanguageCode | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return isLanguageCode(value) ? value : null;
  } catch {
    return null;
  }
}

function writeSavedLanguage(code: LanguageCode): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, code);
  } catch {
    // ignore: the choice just won't be remembered next visit
  }
}

// These browser values never change while the page is open, so there is nothing to subscribe to.
// useSyncExternalStore just lets us read them on the client without a server/client mismatch.
const subscribeNever = () => () => {};
const browserLanguageKey = () =>
  (navigator.languages?.length ? navigator.languages : [navigator.language]).join(",");

interface LanguageContextValue {
  language: LanguageCode; // what the app should use right now
  setLanguage: (code: LanguageCode) => void;
  ranked: RankedLanguage[]; // every language, best suggestion first
  chosen: boolean; // the farmer picked it (or picked it on an earlier visit)
  locationKnown: boolean; // suggestions are based on where the farmer is
  translation: TranslationStatus; // progress of translating the on-screen text
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be used inside <LanguageProvider>");
  return ctx;
}

export default function LanguageProvider({ children }: { children: ReactNode }) {
  const [picked, setPicked] = useState<LanguageCode | null>(null);
  const [countryCode, setCountryCode] = useState<string | null>(null);
  const [translationStatus, setTranslationStatus] = useState<TranslationStatus>("idle");

  // On the server and during the first render these are empty; the browser's values follow.
  const saved = useSyncExternalStore(subscribeNever, readSavedLanguage, () => null);
  const browserKey = useSyncExternalStore(subscribeNever, browserLanguageKey, () => "");
  const browserLanguages = useMemo(() => parseBrowserLanguages(browserKey ? browserKey.split(",") : []), [browserKey]);
  const chosen = picked ?? saved;

  // Coarse, cached location is plenty to find a country. Denied or slow just means no location
  // suggestion; the browser's language setting still applies.
  useEffect(() => {
    let cancelled = false;
    getCurrentLocation({ enableHighAccuracy: false, timeout: 8000, maximumAge: 3_600_000 })
      .then((loc) => fetchCountryCode(loc.lat, loc.lng))
      .then((code) => {
        if (!cancelled) setCountryCode(code);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const ranked = useMemo(
    () => rankLanguages({ countryCode, browserLanguages, savedChoice: chosen }),
    [countryCode, browserLanguages, chosen]
  );
  // Until the farmer picks, follow the best suggestion, but never force it: they can change it anytime.
  const language = chosen ?? ranked[0].code;

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  // Translate everything on screen into the chosen language (English is the original text, so
  // choosing it just puts the original back).
  useEffect(() => {
    if (language === "en") {
      restoreEnglish();
      return;
    }
    const translator = startDomTranslator(language, setTranslationStatus);
    return () => translator.stop();
  }, [language]);

  const setLanguage = useCallback((code: LanguageCode) => {
    setPicked(code);
    writeSavedLanguage(code);
  }, []);

  const translation: TranslationStatus = language === "en" ? "idle" : translationStatus;
  const value = useMemo<LanguageContextValue>(
    () => ({ language, setLanguage, ranked, chosen: chosen !== null, locationKnown: countryCode !== null, translation }),
    [language, setLanguage, ranked, chosen, countryCode, translation]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}
