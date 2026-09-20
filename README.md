# Daiisi

Satellite and weather monitoring for smallholder farmers, explained in plain words.

A farmer draws their fields on a map. Every week Daiisi reads the latest Sentinel-2 satellite image and real weather data for each field, decides whether it is fine, worth watching, or needs action now, and explains why in a short recommendation. The farmer can talk to it: a spoken note like "I irrigated the north plot on Tuesday" is turned into a structured record and changes the advice straight away. Sign-in is just a phone number.

## What it does

- **My fields.** Draw a plot on the map, name it, say what is planted and when. Fields are saved per phone number.
- **My results.** Summary tiles across all fields, then a card per plot ranked by urgency. Each card has:
  - an **AI take**: one priority line and a sentence or two of why, which can also be **read aloud**
  - the recommended actions, and a weekly NDVI (crop greenness) chart
  - **Record intervention**: record or upload a voice note about what was done or seen
- **Weekly memory.** Each week's snapshot of a field is stored. When a new recommendation is written, only a small, varied set of similar past weeks from that same field is shown to the model (greedy facility-location, a submodular method, over embeddings), together with what happened afterwards.
- **Text messages.** A weekly digest of the fields that need attention can be sent by SMS (Twilio, US numbers), and a farmer's reply is turned into a note the same way a voice note is.
- **Languages.** The interface can be translated, with hand-written wording for the labels that machine translation gets wrong.
- **Replay.** Open the app with `?asOf=2023-09-05` to see fields as they were on a past date, using real satellite and weather data from then.

## How a recommendation is made

1. **Data.** Sentinel-2 (true colour, NDVI and a 90-day greenness history) from Copernicus Data Space; rainfall, evapotranspiration, heat, a 5-year rain normal and a seasonal outlook from Open-Meteo.
2. **Verdict by rules.** `lib/stressEvent.ts` combines water balance, greenness trend and rain against normal into OK, Watch or Act. The model does not decide the verdict.
3. **Explanation by model.** Groq (`openai/gpt-oss-20b`) writes the recommendation from those numbers, the crop and planting date, the farmer's recent notes and the similar past weeks.
4. **Guard.** Before anything is shown, `lib/ai/grounding.ts` rejects an answer that quotes a number that was not in the data, contradicts the verdict, invents a cause for a past week, or misdates a note. It retries once, then falls back to plain text written from the data.

## Tech stack

| | |
|---|---|
| App | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS |
| Map and charts | Leaflet with Geoman, Recharts |
| Satellite | Copernicus Data Space / Sentinel Hub (Sentinel-2 L2A) |
| Weather | Open-Meteo (forecast, archive, seasonal) |
| Voice | Deepgram Nova-3 (speech to text) and Aura (text to speech) |
| AI | Groq for note interpretation and recommendations; MiniLM embeddings run locally |
| Database | Postgres on Neon with pgvector |
| Messaging | Twilio (SMS) |
| Translation | Google Cloud Translation |

## Run it locally

```bash
npm install
cp .env.example .env.local   # then fill in the values; never commit real keys
npm run dev                  # http://localhost:3000
```

Database migrations are the numbered files in `db/migrations/`. Apply them in order to your Postgres database (use the direct, unpooled connection string for that). `npm run dev` uses `scripts/dev.mjs`, which ignores stale satellite credentials left in your shell.

Environment variables (see `.env.example`): `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `CDSE_CLIENT_ID`, `CDSE_CLIENT_SECRET`, `DEEPGRAM_API_KEY`, `GROQ_API_KEY`, `GOOGLE_API_KEY` (translation), the `TWILIO_*` values for SMS, and `CRON_SECRET` for the weekly job.

```bash
npm test        # unit tests, no network or database needed
npm run build   # production build
```

## Honest limits

- **No ground truth yet.** Nothing confirms a plot was really stressed. NDVI is a proxy, so "the satellite agrees with the weather" is not proof. Asking farmers whether an alert was right is the next step.
- **Rain is not soil moisture.** The water figure compares recent rainfall with the crop's estimated water use, not the water actually in the soil. It cannot see irrigation, so irrigated fields can look dry while the crop is fine.
- **Small plots.** Sentinel-2 pixels are 10 m across, so plots under about 0.1 ha give a rough greenness reading.
- **Free-tier limits.** The AI service allows about 8,000 tokens a minute, so many quick requests can be rate limited.

More detail on the two main screens is in [`docs/`](./docs).
