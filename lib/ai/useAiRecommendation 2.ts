"use client";

import { useEffect, useState } from "react";
import type { EvidenceCandidate } from "@/lib/retrieval";

export interface AiRecommendationState {
  recommendation: string | null;
  evidence: EvidenceCandidate[];
  loading: boolean;
  error: string | null;
}

// Fetches (and, server-side, generates + caches) the AI recommendation for a
// stress event. Pulled out of the card UI so it can be called once per card
// on mount — independent of whether the card is currently hovered or
// pinned open — so hovering feels instant instead of triggering a fetch.
export function useAiRecommendation(stressEventId: string | null): AiRecommendationState {
  const [recommendation, setRecommendation] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<EvidenceCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!stressEventId) return;
    fetch(`/api/stress-events/${stressEventId}/recommendation`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? `Request failed: ${res.status}`);
        setRecommendation(json.recommendation);
        setEvidence(Array.isArray(json.evidence) ? json.evidence : []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [stressEventId]);

  return { recommendation, evidence, loading, error };
}

// The model sometimes wraps its priority line in "**...**" — this strips
// markdown and returns just that first line, for compact previews.
export function firstLine(recommendation: string): string {
  return recommendation.split("\n")[0].replace(/\*\*/g, "").trim();
}
