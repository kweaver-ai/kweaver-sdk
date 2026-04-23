/**
 * `buildOauth2SigninPostBody` — guards against EACP `client_type` whitelist regressions.
 *
 * Strict deployments (e.g. dip-poc.aishu.cn for admin@eisoo.com) reject `client_type: "unknown"` with
 * `管理员已禁止此类客户端登录`, surfaced upstream as `request_forbidden — No CSRF value available
 * in the session cookie`. `console_web` is the canonical CLI value (matches `kweaver-admin` and
 * `kweaver/deploy/auto_cofig/auto_config.sh`).
 */
import assert from "node:assert/strict";
import test from "node:test";

import { buildOauth2SigninPostBody } from "../src/auth/oauth.js";

test("buildOauth2SigninPostBody: device.client_type is 'console_web' (EACP whitelist)", () => {
  const body = buildOauth2SigninPostBody({
    csrftoken: "csrf-1",
    challenge: "ch-1",
    account: "alice@example.com",
    passwordCipher: "<encrypted>",
    remember: false,
  });
  const device = body.device as Record<string, unknown>;
  assert.equal(
    device.client_type,
    "console_web",
    "client_type must be 'console_web' so EACP whitelist accepts the sign-in for both admin and regular accounts",
  );
});

test("buildOauth2SigninPostBody: includes _csrf, challenge, account, password, remember", () => {
  const body = buildOauth2SigninPostBody({
    csrftoken: "csrf-2",
    challenge: "ch-2",
    account: "bob",
    passwordCipher: "cipher-text",
    remember: true,
  });
  assert.equal(body._csrf, "csrf-2");
  assert.equal(body.challenge, "ch-2");
  assert.equal(body.account, "bob");
  assert.equal(body.password, "cipher-text");
  assert.equal(body.remember, true);
});

test("buildOauth2SigninPostBody: vcode and dualfactorauthinfo present-but-empty (eachttpserver requires these)", () => {
  const body = buildOauth2SigninPostBody({
    csrftoken: "c",
    challenge: "c",
    account: "a",
    passwordCipher: "p",
    remember: false,
  });
  assert.deepEqual(body.vcode, { id: "", content: "" });
  assert.deepEqual(body.dualfactorauthinfo, {
    validcode: { vcode: "" },
    OTP: { OTP: "" },
  });
});

test("buildOauth2SigninPostBody: device shape stays empty except client_type", () => {
  const body = buildOauth2SigninPostBody({
    csrftoken: "c",
    challenge: "c",
    account: "a",
    passwordCipher: "p",
    remember: false,
  });
  assert.deepEqual(body.device, {
    name: "",
    description: "",
    client_type: "console_web",
    udids: [],
  });
});
