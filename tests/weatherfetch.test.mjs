// Open-Meteo hiccups: retry, then fail with a clear message instead of a raw JSON parse error.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fetchWeatherJson } from "../lib/weather.ts";

const ok = () => new Response(JSON.stringify({ daily: { time: ["2026-09-20"] } }), { status: 200 });
const notJson = () => new Response("Unexpected error, please retry", { status: 200 });

describe("weather fetch", () => {
  it("retries a non-JSON answer and then succeeds", async () => {
    let calls = 0;
    const fetchImpl = async () => (++calls < 3 ? notJson() : ok());
    const json = await fetchWeatherJson("http://x", fetchImpl, 1);
    assert.equal(calls, 3);
    assert.deepEqual(json.daily.time, ["2026-09-20"]);
  });

  it("retries a server error but not a bad request", async () => {
    let calls = 0;
    await assert.rejects(fetchWeatherJson("http://x", async () => (++calls, new Response("no", { status: 503 })), 1), /status 503/);
    assert.equal(calls, 3);
    calls = 0;
    await assert.rejects(fetchWeatherJson("http://x", async () => (++calls, new Response("no", { status: 400 })), 1), /status 400/);
    assert.equal(calls, 1);
  });

  it("gives a clear message, not a JSON parse error, when it never works", async () => {
    await assert.rejects(fetchWeatherJson("http://x", async () => notJson(), 1), (e) => /did not give a usable answer \(unreadable response\)/.test(e.message) && !/JSON/.test(e.message));
  });
});
