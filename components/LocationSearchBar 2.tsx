"use client";

import { useEffect, useRef, useState } from "react";
import { searchLocations, type GeocodeResult } from "@/lib/geocode";

export default function LocationSearchBar({
  onSelectLocation,
}: {
  onSelectLocation: (loc: { lat: number; lng: number }) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 3) return;
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const found = await searchLocations(query);
        setResults(found);
        setOpen(true);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  function handleSelect(result: GeocodeResult) {
    onSelectLocation({ lat: result.lat, lng: result.lng });
    setQuery(result.label);
    setOpen(false);
  }

  return (
    <div className="relative">
      <div className="relative">
        <SearchIcon />
        <input
          value={query}
          onChange={(e) => {
            const value = e.target.value;
            setQuery(value);
            if (value.trim().length < 3) {
              setResults([]);
              setOpen(false);
            }
          }}
          onFocus={() => results.length > 0 && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Search for a place…"
          className="w-full rounded-full border border-zinc-200 bg-white py-2.5 pl-9 pr-4 text-sm text-zinc-700 shadow-sm outline-none placeholder:text-zinc-400 focus:border-green-400"
        />
        {loading && <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs text-zinc-400">…</span>}
      </div>
      {open && results.length > 0 && (
        <ul className="absolute mt-1.5 w-full overflow-hidden rounded-2xl border border-zinc-100 bg-white py-1 shadow-lg">
          {results.map((result, i) => (
            <li key={i}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleSelect(result)}
                className="block w-full truncate px-4 py-2 text-left text-sm text-zinc-600 hover:bg-green-50"
              >
                {result.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SearchIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <circle cx="7" cy="7" r="4.5" />
      <path d="M13 13l-2.5-2.5" strokeLinecap="round" />
    </svg>
  );
}
