// Who may trigger the weekly job: it fails closed.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isCronAuthorized } from "../lib/cronAuth.ts";

describe("weekly job access", () => {
  it("with no CRON_SECRET it refuses everyone in production and on previews", () => {
    assert.equal(isCronAuthorized(null, { NODE_ENV: "production" }), false);
    assert.equal(isCronAuthorized("Bearer anything", { NODE_ENV: "production" }), false);
    assert.equal(isCronAuthorized(null, {}), false);
    assert.equal(isCronAuthorized("Bearer ", { CRON_SECRET: "", NODE_ENV: "production" }), false);
  });

  it("with no CRON_SECRET it only lets a local `next dev` run through", () => {
    assert.equal(isCronAuthorized(null, { NODE_ENV: "development" }), true);
  });

  it("with a secret it needs exactly that bearer token", () => {
    const env = { CRON_SECRET: "s3cret-value", NODE_ENV: "production" };
    assert.equal(isCronAuthorized("Bearer s3cret-value", env), true);
    assert.equal(isCronAuthorized(null, env), false);
    assert.equal(isCronAuthorized("Bearer wrong-value!", env), false);
    assert.equal(isCronAuthorized("Bearer s3cret-valu", env), false);
    assert.equal(isCronAuthorized("s3cret-value", env), false);
    assert.equal(isCronAuthorized("Bearer s3cret-value", { ...env, NODE_ENV: "development" }), true);
    assert.equal(isCronAuthorized(null, { ...env, NODE_ENV: "development" }), false, "a secret in dev is still required");
  });
});
