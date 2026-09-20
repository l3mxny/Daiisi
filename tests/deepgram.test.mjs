// Deepgram transcription with a mocked fetch: no test calls Deepgram.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEEPGRAM_MODEL, DeepgramError, transcribeAudio } from "../lib/deepgram.ts";

const audio = new Uint8Array([1, 2, 3, 4]).buffer;
const answer = (status, body) => async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
const good = { metadata: { duration: 3.2 }, results: { channels: [{ alternatives: [{ transcript: "  Planted maize in north plot on May 12.  ", confidence: 0.98 }] }] } };

describe("Deepgram request", () => {
  it("uses nova-3 with smart_format, the key as a Token header, and the recording's own content type", async () => {
    let seen;
    const result = await transcribeAudio(audio, "audio/webm;codecs=opus", {
      apiKey: "KEY123",
      fetchImpl: async (url, init) => {
        seen = { url, init };
        return new Response(JSON.stringify(good));
      },
    });
    const url = new URL(seen.url);
    assert.equal(url.origin + url.pathname, "https://api.deepgram.com/v1/listen");
    assert.equal(url.searchParams.get("model"), "nova-3");
    assert.equal(DEEPGRAM_MODEL, "nova-3");
    assert.equal(url.searchParams.get("smart_format"), "true");
    assert.equal(seen.init.headers.Authorization, "Token KEY123");
    assert.equal(seen.init.headers["Content-Type"], "audio/webm;codecs=opus");
    assert.ok(!seen.url.includes("KEY123"), "the key is never put in the URL");
    assert.equal(seen.init.method, "POST");
    assert.equal(seen.init.body, audio);
    assert.deepEqual(result, { transcript: "Planted maize in north plot on May 12.", confidence: 0.98, durationSeconds: 3.2 });
  });
});

describe("answers Deepgram can send back", () => {
  it("an empty, malformed or unexpected answer reads as 'no speech', never a crash", async () => {
    for (const body of [{ results: { channels: [{ alternatives: [{ transcript: "", confidence: 0 }] }] } }, { results: { channels: [] } }, {}, "<html>oops</html>", { results: { channels: [{ alternatives: [{ transcript: 5, confidence: "x" }] }] } }]) {
      const out = await transcribeAudio(audio, "audio/wav", { apiKey: "k", fetchImpl: answer(200, body) });
      assert.equal(out.transcript, "");
    }
  });
  it("maps errors to friendly messages and the right status, without leaking the key or Deepgram's body", async () => {
    for (const [upstream, ours] of [[400, 422], [401, 502], [403, 502], [402, 502], [413, 413], [429, 429], [500, 502], [503, 502]]) {
      await assert.rejects(
        transcribeAudio(audio, "audio/wav", { apiKey: "SECRETKEY", fetchImpl: answer(upstream, { err_msg: "leaky detail SECRETKEY" }) }),
        (err) => err instanceof DeepgramError && err.status === ours && err.upstreamStatus === upstream && !err.message.includes("SECRETKEY") && !err.message.includes("leaky")
      );
    }
  });
  it("a network failure and a hung request both fail cleanly", async () => {
    await assert.rejects(
      transcribeAudio(audio, "audio/wav", { apiKey: "k", fetchImpl: async () => { throw new TypeError("fetch failed"); } }),
      (err) => err instanceof DeepgramError && err.status === 502
    );
    const hung = (_url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason)));
    const keepAlive = setTimeout(() => {}, 1000); // the timeout timer alone would not keep the test process alive
    await assert.rejects(transcribeAudio(audio, "audio/wav", { apiKey: "k", timeoutMs: 20, fetchImpl: hung }), (err) => err instanceof DeepgramError && err.status === 504);
    clearTimeout(keepAlive);
  });
});
