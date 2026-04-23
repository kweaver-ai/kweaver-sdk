/**
 * EACP modifypassword RSA encryption and request body shape.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  decryptModifyPwdForTest,
  encryptModifyPwd,
  eacpModifyPassword,
} from "../src/auth/eacp-modify-password.js";

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

test("encryptModifyPwd round-trips with embedded key", () => {
  const plain = "MySecret#1";
  const b64 = encryptModifyPwd(plain);
  assert.match(b64, /^[A-Za-z0-9+/]+=*$/);
  assert.equal(decryptModifyPwdForTest(b64), plain);
});

test("eacpModifyPassword posts expected JSON body", async () => {
  const calls: { url: string; body: string }[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    calls.push({ url, body: typeof init?.body === "string" ? init.body : "" });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    const r = await eacpModifyPassword("https://plat.example.com/", {
      account: "alice",
      oldPassword: "old1",
      newPassword: "newpass123456",
      tlsInsecure: false,
    });
    assert.equal(r.ok, true);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.endsWith("/api/eacp/v1/auth1/modifypassword"));
    const j = JSON.parse(calls[0].body) as Record<string, unknown>;
    assert.equal(j.account, "alice");
    assert.equal(j.isforgetpwd, false);
    const vi = j.vcodeinfo as { uuid: string; vcode: string };
    assert.equal(vi.uuid, "");
    assert.equal(vi.vcode, "");
    assert.equal(decryptModifyPwdForTest(j.oldpwd as string), "old1");
    assert.equal(decryptModifyPwdForTest(j.newpwd as string), "newpass123456");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
