// Reading a recommendation aloud (Deepgram text-to-speech), against a fake fetch: nothing calls Deepgram.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DeepgramError } from "../lib/deepgram.ts";
import { cleanForSpeech, limitForSpeech, synthesizeSpeech } from "../lib/deepgramSpeak.ts";

describe("text for speech", () => {
  it("drops markdown and line breaks", () => {
    assert.equal(cleanForSpeech("**High priority** — irrigate.\n\nSoil is dry.  "), "High priority — irrigate. Soil is dry.");
  });
});

describe("long text", () => {
  it("is cut at the last full sentence instead of refused", () => {
    const long = "Water the field now. ".repeat(200).trim();
    const out = limitForSpeech(long, 100);
    assert.ok(out.length <= 100 && out.endsWith("."));
    assert.equal(limitForSpeech("short."), "short.");
  });
});

describe("synthesizeSpeech", () => {
  it("posts the text with the key and asks for mp3", async () => {
    let seen;
    const fetchImpl = async (url, init) => {
      seen = { url, init };
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    };
    const audio = await synthesizeSpeech("hello", { apiKey: "k", fetchImpl });
    assert.equal(audio.byteLength, 3);
    assert.match(seen.url, /\/v1\/speak\?model=aura-2-thalia-en&encoding=mp3/);
    assert.equal(seen.init.headers.Authorization, "Token k");
    assert.equal(seen.init.body, JSON.stringify({ text: "hello" }));
  });

  it("turns upstream failures into safe errors", async () => {
    for (const [status, expected] of [[401, 502], [402, 502], [429, 429], [500, 502]]) {
      const fetchImpl = async () => new Response("secret detail", { status });
      await assert.rejects(synthesizeSpeech("hi", { apiKey: "k", fetchImpl }), (e) => e instanceof DeepgramError && e.status === expected && !/secret/.test(e.message));
    }
  });

  it("says so when the service can't be reached", async () => {
    const fetchImpl = async () => {
      throw new Error("boom");
    };
    await assert.rejects(synthesizeSpeech("hi", { apiKey: "k", fetchImpl }), (e) => e instanceof DeepgramError && /can't be reached/.test(e.message));
  });
});
