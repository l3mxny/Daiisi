// Repeat views of a field reuse the last snapshot for a few minutes; failures are never remembered.
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { clearSnapshotCache, getCachedSnapshot } from "../lib/snapshotCache.ts";

const BBOX = [1, 2, 3, 4];
beforeEach(() => clearSnapshotCache());

describe("snapshot cache", () => {
  it("computes once for repeat and simultaneous requests, then again after ten minutes", async () => {
    let calls = 0;
    const compute = async () => ({ n: ++calls });
    const [a, b] = await Promise.all([getCachedSnapshot(BBOX, { withImages: true }, compute, 0), getCachedSnapshot(BBOX, { withImages: true }, compute, 1000)]);
    assert.equal(calls, 1);
    assert.equal(a, b);
    await getCachedSnapshot(BBOX, { withImages: true }, compute, 9 * 60_000);
    assert.equal(calls, 1);
    await getCachedSnapshot(BBOX, { withImages: true }, compute, 11 * 60_000);
    assert.equal(calls, 2);
  });

  it("keeps different fields, different dates and with-or-without images apart", async () => {
    let calls = 0;
    const compute = async () => ({ n: ++calls });
    await getCachedSnapshot(BBOX, { withImages: true }, compute, 0);
    await getCachedSnapshot([1, 2, 3, 5], { withImages: true }, compute, 0);
    await getCachedSnapshot(BBOX, { withImages: false }, compute, 0);
    await getCachedSnapshot(BBOX, { withImages: true, asOf: new Date("2023-09-05") }, compute, 0);
    assert.equal(calls, 4);
  });

  it("does not remember a failure", async () => {
    let calls = 0;
    const compute = async () => {
      if (++calls === 1) throw new Error("upstream hiccup");
      return { n: calls };
    };
    await assert.rejects(getCachedSnapshot(BBOX, { withImages: true }, compute, 0), /hiccup/);
    await new Promise((r) => setTimeout(r, 5));
    assert.deepEqual(await getCachedSnapshot(BBOX, { withImages: true }, compute, 1), { n: 2 });
  });
});

describe("Refresh", () => {
  it("skips the saved copy when the farmer asks for fresh data, and the new one is then reused", async () => {
    let calls = 0;
    const compute = async () => ({ n: ++calls });
    await getCachedSnapshot(BBOX, { withImages: true }, compute, 0);
    assert.deepEqual(await getCachedSnapshot(BBOX, { withImages: true, fresh: true }, compute, 1000), { n: 2 });
    assert.deepEqual(await getCachedSnapshot(BBOX, { withImages: true }, compute, 2000), { n: 2 });
  });
});
