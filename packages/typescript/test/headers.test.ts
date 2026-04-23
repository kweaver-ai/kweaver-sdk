import test from "node:test";
import assert from "node:assert/strict";

import { buildHeaders } from "../src/api/headers.js";
import { NO_AUTH_TOKEN } from "../src/config/no-auth.js";

test("buildHeaders omits authorization and token for no-auth sentinel", () => {
  const h = buildHeaders(NO_AUTH_TOKEN, "bd_public");
  assert.equal(h["authorization"], undefined);
  assert.equal(h.token, undefined);
  assert.equal(h["x-business-domain"], "bd_public");
  assert.ok(h.accept);
});

test("buildHeaders sets authorization and token for normal token", () => {
  const h = buildHeaders("real-token", "bd_x");
  assert.equal(h.authorization, "Bearer real-token");
  assert.equal(h.token, "real-token");
});
