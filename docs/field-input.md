# Field Input page

The "Field input" tab is a Leaflet map plus a details form. Its whole job is: let a farmer
draw a rectangle on a map, describe what's planted there, and save it — everything else
(weather, NDVI, recommendations) happens on the Results tab once a field exists.

## Component tree

```
FarmOSApp (owns all state)
└─ FieldInputPanel
   ├─ FieldMap (dynamic import, ssr: false — Leaflet needs `window`)
   │  ├─ DrawHandler       — drag-to-draw a new rectangle
   │  ├─ GeomanEditController — resize/move handles on existing rectangles
   │  ├─ FlyToController   — animates the map to a location
   │  └─ DraftDiscardButton — trash icon on an unsaved field
   ├─ LocationSearchBar    — geocoding search box
   ├─ MapModeControls      — Cursor / Draw toggle (top-right)
   └─ FieldSidebar         — "Field details" form + "Saved fields" list
```

`FarmOSApp.tsx` owns every piece of state (`plots`, `mapMode`, `flyTo`, `selectedPlotId`,
etc.) and passes callbacks down — none of the child components hold state that the parent
needs to know about.

## Drawing: two different tools for two different jobs

Leaflet-Geoman was evaluated for *both* drawing and editing, but its built-in Rectangle
tool is click-click (click a corner, move, click again) and never disables map panning —
so a drag gesture just panned the map instead of drawing. The fix was to split the two
concerns:

- **Creating a rectangle** — `DrawHandler` in `FieldMap.tsx` is a hand-rolled
  mousedown/mousemove/mouseup handler (`useMapEvents`), the same approach used before
  Geoman was introduced. It disables `map.dragging` only for the duration of the drag,
  shows a live dashed preview, and on mouseup either builds a bbox from the two corners or
  (if the drag was shorter than `MIN_DRAG_PIXELS`, measured in screen pixels via
  `map.latLngToContainerPoint` — not lat/lng degrees, which would misclassify drags
  differently depending on zoom level) falls back to a small fixed-size box around the
  click point.
- **Editing an existing rectangle** — `GeomanEditController` toggles
  `map.pm.enableGlobalEditMode()` when in Draw mode, which gives every rectangle on the
  map resize handles at its corners/edges and lets you drag the body to move it. This part
  *is* Geoman, because it's genuinely good at it.

A generic propagation gotcha: Leaflet's `Draggable` (which powers Geoman's resize handles)
never calls `stopPropagation()` on mousedown, so grabbing a handle would otherwise also
bubble up to `DrawHandler` and start a second, unwanted rectangle. `DrawHandler` guards
against this by checking the actual DOM event target for `.leaflet-marker-icon` (any
handle) or `.leaflet-interactive` (any existing shape) and bailing out.

**Only one field can be drawn at a time.** `DrawHandler` is gated on
`!plots.some(p => !p.saved)` — once a draft exists, dragging elsewhere on the map can only
resize/move it, not spawn a second one. Save or discard (the trash-can icon,
`DraftDiscardButton`) to draw a new one.

## Location: geolocation + search

- On mount, `FarmOSApp` calls `getCurrentLocation()` (`lib/geoLocation.ts`, a promisified
  wrapper around the browser Geolocation API) and flies the map there. Failure here is
  silent — no user gesture triggered it, so there's no control to show an error on.
- The "Find my location" button (in `FieldSidebar`) calls the same function again, this
  time surfacing failures inline (permission denied / unavailable / timeout — mapped to
  plain language in `lib/geoLocation.ts`).
- The search bar (`LocationSearchBar.tsx`) debounces input and calls `/api/geocode`, which
  proxies OpenStreetMap's Nominatim (free, no key — same "no auth" pattern as the weather
  APIs). It's proxied server-side rather than called from the browser because Nominatim's
  usage policy requires a descriptive `User-Agent` header, which client-side `fetch()`
  can't set.

## Draft → details → save

1. Drawing a rectangle creates a `Plot` in React state with `saved: false` and empty
   `details` (name/crop/plantedOn/soilType) — nothing is written to the database yet.
2. `FieldSidebar` shows the "Field details" form only for the currently-unsaved plot.
   Typing into it just updates that plot's `details` in local state.
3. Clicking **Save this field**:
   - `persistField()` posts to `POST /api/fields` (needs the signed-in phone number — see
     below), which upserts a row in the `fields` table (`db/fields.ts`).
   - `fetchPlotStats()` then posts to `POST /api/field` with that field's id, which
     computes live weather/NDVI/severity (`lib/fieldSnapshot.ts`) and, because a `fieldId`
     was provided, also records this week's `stress_events` row for it — the same
     computation the weekly background job does (see `results.md`).
4. Resizing or moving a **saved** field's rectangle re-runs both of those steps (persist
   the new bbox, then refetch stats), so a saved field's row and its live data never drift
   out of sync with what's on the map.

## Whose fields are these? (phone-based sign-in)

There's no password or OTP — a farmer identifies themselves with just a phone number
(`components/PhoneSignIn.tsx`), stored client-side in `localStorage`
(`lib/phoneSession.ts`). Every field row in Postgres has a `phone` column, and every API
call that reads/writes/deletes a field requires it and is scoped by it
(`normalizePhone()` in `lib/phone.ts` does light format normalization, not real
verification). On load, `FarmOSApp` reads the stored phone, fetches that number's fields
from `GET /api/fields?phone=...`, and re-runs `fetchPlotStats` for each — this is what
makes fields survive a page refresh instead of resetting to empty.

**This is identification, not authentication** — anyone who knows or guesses a phone
number can see that farmer's fields. That's an explicit, known tradeoff for
frictionless sign-in, not an oversight.

## Key files

| File | Responsibility |
|---|---|
| `components/FarmOSApp.tsx` | All app state, sign-in flow, save/delete/refresh handlers |
| `components/FieldInputPanel.tsx` | Layout: map + sidebar |
| `components/FieldMap.tsx` | Leaflet map, draw/edit logic, overlays |
| `components/FieldSidebar.tsx` | Field details form + saved fields list |
| `components/LocationSearchBar.tsx` | Geocoding search |
| `components/MapModeControls.tsx` | Cursor/Draw toggle |
| `components/PhoneSignIn.tsx` | Sign-in screen |
| `lib/geo.ts` | Bbox math (corners, centroid, area, Leaflet bounds conversion) |
| `lib/geoLocation.ts` | Browser geolocation wrapper |
| `lib/geocode.ts` + `app/api/geocode/route.ts` | Nominatim search proxy |
| `lib/phone.ts`, `lib/phoneSession.ts` | Phone normalization + client-side session |
| `db/fields.ts` | Field persistence, phone-scoped queries |
| `app/api/fields/route.ts`, `app/api/fields/[id]/route.ts` | Field CRUD, phone-scoped |
