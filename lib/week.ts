// The Sunday (UTC) on or before the given date, as yyyy-mm-dd — the
// canonical "week_start" a stress_events row is keyed on, so the weekly job
// stays idempotent no matter what time of day it actually runs.
export function getWeekStart(date: Date = new Date()): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}

// The Sunday one week before the given date's week — used to look up the
// stress_events row a new snapshot should evaluate the outcome of.
export function getPreviousWeekStart(date: Date = new Date()): string {
  const d = new Date(`${getWeekStart(date)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 7);
  return d.toISOString().slice(0, 10);
}
