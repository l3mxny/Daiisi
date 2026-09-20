// Replay mode: open the app with ?asOf=2023-09-01 and every field is shown as it was on that date (satellite
// and weather both from the past), so a real growing-season dry spell can be demonstrated whatever today's
// date is. Read once from the address bar; only call this in the browser.
export function getReplayDate(): string | null {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get("asOf");
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}
