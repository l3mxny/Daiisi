# Results page

The Results tab ranks every saved field by urgency and explains what's happening on each
one — combining a fast rule-based system that's always available with an AI layer that
reasons over history, and a background job that keeps building that history over time.

## Component tree

```
FarmOSApp
└─ ResultsPanel
   ├─ SummaryTiles        — 4 aggregate stats across all fields
   └─ PlotCard (one per field, in a responsive grid)
      ├─ collapsed: name + one-line headline + severity badge
      ├─ hover preview: AI text (or rule-based fallback) + stat pills
      └─ pinned (click) full detail:
         ├─ satellite thumbnail
         ├─ what/why/last-time grid (rule-based)
         ├─ seasonal outlook banner
         ├─ AiRecommendation — full AI text + retrieved evidence
         ├─ rule-based recommended actions
         ├─ InterventionLogger — "what did you do?"
         └─ NdviChart
```

`PlotCard` fetches its AI recommendation once on mount (`useAiRecommendation`, in
`lib/ai/useAiRecommendation.ts`) regardless of hover/pin state — so hovering just toggles
CSS visibility of already-loaded content instead of triggering a fetch, and feels instant.

## Two recommendation systems, on purpose

**Rule-based (`lib/recommendations.ts`, `lib/stressEvent.ts`)** — plain if/else thresholds
on water ratio, NDVI trend, heat days, and rainfall-vs-historical-normal. Always available,
zero latency, zero external dependency. This existed before any of the AI/graph work and
is kept as the fallback shown while the AI text is loading (or if Groq is unreachable).

**AI-generated (`lib/ai/recommendation.ts`)** — calls Groq (`openai/gpt-oss-20b`) with the
same current signals *plus* the seasonal outlook *plus* a handful of similar past
situations on that same field, and asks for a short narrative with a stated priority and
an explanation citing the actual numbers. The result is cached on the `stress_events` row
(`ai_recommendation` column) so viewing it twice doesn't re-call the model.

Both are shown — the AI take is the prominent one, the rule-based list is kept as a
secondary, dependency-free reference.

## Where every input signal comes from

| Signal | Source |
|---|---|
| Soil water %, 16-day rain forecast, heat days | Open-Meteo forecast API (`lib/weather.ts`) — free, no key |
| 30-day rainfall vs. historical normal | Open-Meteo Archive API, averaged over up to 5 prior years (`lib/climate.ts`) |
| NDVI value/trend, satellite thumbnail, cloud cover | Sentinel Hub / Copernicus Dataspace (`lib/sentinelHub.ts`), or the bundled fixture if credentials/imagery are unavailable (`lib/fallback.ts`) |
| Seasonal outlook (wetter/drier/hotter/cooler + confidence) | Open-Meteo Seasonal Forecast API — **ECMWF SEAS5, not NOAA CFSv2** (see note below) — 51-member ensemble compared against a 5-year forward-looking normal (`lib/seasonalOutlook.ts`) |
| Similar past events + their outcomes | Postgres `stress_events`/`outcomes` tables, via the retrieval pipeline below |

> **Why ECMWF and not NOAA CFSv2:** NOAA's CPC seasonal outlook is only distributed as
> GIS shapefiles (no JSON API) — parsing it would need shapefile-parsing + point-in-polygon
> geometry code. Open-Meteo's seasonal endpoint (ECMWF SEAS5) gives an equivalent
> ensemble-probability product as a plain JSON fetch, consistent with every other data
> source in this app. This was a deliberate tradeoff, not an oversight.

`lib/fieldSnapshot.ts` (`computeFieldSnapshot`) is the one function that bundles all of the
above into a single "current state of this field" object — it's called both by a live
`/api/field` request (when a farmer views/refreshes a field) and by the weekly background
job, so both paths compute a field's condition identically.

## The weekly job and the knowledge graph

`GET /api/cron/weekly-check` (scheduled via `vercel.ts`, Sundays 00:00 UTC) loops over
every saved field and, for each one:

1. **Evaluates last week's outcome** (`db/outcomes.ts`, `evaluatePendingOutcome`) — looks
   up last week's `stress_events` row, compares its NDVI reading to this week's freshly
   computed one, and records `improved` / `worsened` / `unchanged` (or
   `insufficient_imagery` if either side has no clear satellite scene), alongside whichever
   intervention was logged against it and the *actual* rainfall that fell (not the forecast
   used at the time).
2. **Records this week's snapshot** (`db/stressEvents.ts`, `recordStressEvent`) — builds a
   short text summary of the current situation, embeds it locally with
   `sentence-transformers/all-MiniLM-L6-v2` (384-dim, via `@huggingface/transformers` — no
   API key, runs in-process), and upserts a `stress_events` row (one per field per
   calendar week).

A manual field refresh (`/api/field` with a `fieldId`) runs the same two steps immediately,
so the history stays current even without waiting for Sunday.

This is the "knowledge graph": `fields` → `stress_events` → `interventions` → `outcomes`,
plus a `vector(384)` embedding column with an ANN index (`lakebase_ann`/pgvector) for
semantic search. There's no separate graph database — plain Postgres tables and foreign
keys are the graph.

## Retrieval: finding relevant history without duplicates

`lib/retrieval.ts` (`retrieveSimilarEvents`) is what the AI's "similar past situations"
list comes from:

1. **Candidates** — every other `stress_events` row for the same field (a
   `field_neighbors` concept was designed but explicitly cut — retrieval only looks at a
   field's own history).
2. **Relevance score** per candidate — a weighted blend of semantic similarity (cosine
   distance between embeddings), structured similarity (water ratio / NDVI trend / heat
   days / rain anomaly), recency decay, and a bonus for candidates that have a recorded
   outcome (a case with a known result is more useful evidence than a guess).
3. **Diverse selection** — rather than just taking the top-k by relevance (which can
   return several near-identical events, e.g. five variations of the same heatwave), a
   greedy algorithm maximizes a relevance-weighted facility-location objective:
   `F(S) = Σ relevance(i) × max-similarity(i, S)`. This is a genuinely monotone submodular
   function, so greedy selection has a provable (1 − 1/e) approximation guarantee — the
   standard justification for using greedy here instead of an exhaustive search. In
   practice this means the evidence handed to the AI is relevant *and* mutually
   non-redundant.

## Interventions and outcomes (closing the loop)

`InterventionLogger.tsx` lets a farmer log what they actually did (irrigated / inspected /
did nothing / other) against the current week's `stress_events` row
(`app/api/interventions/route.ts`, `db/interventions.ts`). This is what makes the outcome
evaluation above meaningful — without a farmer's own record of what they did, "the
intervention worked" would just be a guess. The full loop is:

```
recommend → farmer acts → log the action → next week's job measures NDVI + real rainfall → record outcome → feeds future retrieval
```

## Key files

| File | Responsibility |
|---|---|
| `components/ResultsPanel.tsx` | Grid layout, ranking, hover/pin card UI |
| `components/AiRecommendation.tsx` | AI text + evidence list (presentational) |
| `components/InterventionLogger.tsx` | Logging UI |
| `lib/recommendations.ts`, `lib/stressEvent.ts` | Rule-based severity/recommendation logic |
| `lib/fieldSnapshot.ts` | Bundles weather + NDVI + climate + seasonal outlook + severity |
| `lib/seasonalOutlook.ts` | ECMWF seasonal ensemble → wetter/drier/hotter/cooler + confidence |
| `lib/embeddings.ts` | Local MiniLM embeddings |
| `lib/retrieval.ts` | Hybrid similarity scoring + submodular diverse selection |
| `lib/ai/groq.ts`, `lib/ai/recommendation.ts` | Prompt construction + Groq call + caching |
| `db/stressEvents.ts`, `db/interventions.ts`, `db/outcomes.ts` | The knowledge-graph tables |
| `app/api/cron/weekly-check/route.ts` | The scheduled job |
| `app/api/stress-events/[id]/similar/route.ts`, `.../recommendation/route.ts` | Retrieval + AI endpoints |
