// The Sunday (UTC) on or before the given date, as yyyy-mm-dd — the
// canonical "week_start" a stress_events row is keyed on, so the weekly job
// stays idempotent no matter what time of day it actually runs.
export function getWeekStart(date: Date = new Date()): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}
