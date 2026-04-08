/**
 * Token refresh, ensureValidToken, withTokenRetry — uses isolated KWEAVERC_CONFIG_DIR per import.
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { HttpError } from "../src/utils/http.js";

function createConfigDir(): string {
  return mkdtempSync(join(tmpdir(), "kweaver-oauth-"));
}

async function importOauthAndStore(configDir: string) {
  process.env.KWEAVERC_CONFIG_DIR = configDir;
  delete process.env.KWEAVER_TOKEN;
  delete process.env.KWEAVER_BASE_URL;
  const t = `${Date.now()}-${Math.random()}`;
  const store = await import(`../src/config/store.ts?t=${t}`);
  const oauth = await import(`../src/auth/oauth.ts?t=${t}`);
  return { store, oauth };
}

test("refreshAccessToken: happy path saves new access token", async () => {
  const configDir = createConfigDir();
  const { store, oauth } = await importOauthAndStore(configDir);

  const baseUrl = "https://platform.example.com";
  store.saveClientConfig(baseUrl, {
    baseUrl,
    clientId: "cid",
    clientSecret: "csecret",
  });
  store.setCurrentPlatform(baseUrl);
  const oldToken = {
    baseUrl,
    accessToken: "old-access",
    tokenType: "Bearer",
    scope: "s",
    refreshToken: "rt-1",
    obtainedAt: new Date().toISOString(),
  };
  store.saveTokenConfig(oldToken);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const u = typeof input === "string" ? input : input.toString();
    assert.ok(u.includes("/oauth2/token"));
    return new Response(
      JSON.stringify({
        access_token: "new-access",
        token_type: "Bearer",
        expires_in: 7200,
        scope: "s2",
        refresh_token: "rt-2",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  try {
    const out = await oauth.refreshAccessToken(store.loadTokenConfig(baseUrl)!);
    assert.equal(out.accessToken, "new-access");
    assert.equal(out.refreshToken, "rt-2");
    assert.equal(out.expiresIn, 7200);
    const disk = store.loadTokenConfig(baseUrl);
    assert.equal(disk?.accessToken, "new-access");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("refreshAccessToken: preserves refresh_token when server omits it", async () => {
  const configDir = createConfigDir();
  const { store, oauth } = await importOauthAndStore(configDir);
  const baseUrl = "https://platform.example.com";
  store.saveClientConfig(baseUrl, { baseUrl, clientId: "c", clientSecret: "s" });
  store.setCurrentPlatform(baseUrl);
  store.saveTokenConfig({
    baseUrl,
    accessToken: "a",
    tokenType: "Bearer",
    scope: "",
    refreshToken: "keep-me",
    obtainedAt: new Date().toISOString(),
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        access_token: "new",
        expires_in: 3600,
      }),
      { status: 200 },
    );
  try {
    const out = await oauth.refreshAccessToken(store.loadTokenConfig(baseUrl)!);
    assert.equal(out.refreshToken, "keep-me");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("refreshAccessToken: throws when refresh_token is missing", async () => {
  const configDir = createConfigDir();
  const { store, oauth } = await importOauthAndStore(configDir);
  const baseUrl = "https://platform.example.com";
  store.saveClientConfig(baseUrl, { baseUrl, clientId: "c", clientSecret: "s" });
  store.setCurrentPlatform(baseUrl);
  store.saveTokenConfig({
    baseUrl,
    accessToken: "a",
    tokenType: "Bearer",
    scope: "",
    obtainedAt: new Date().toISOString(),
  });

  await assert.rejects(() => oauth.refreshAccessToken(store.loadTokenConfig(baseUrl)!), /no refresh_token/);
});

test("refreshAccessToken: throws when client credentials missing", async () => {
  const configDir = createConfigDir();
  const { store, oauth } = await importOauthAndStore(configDir);
  const baseUrl = "https://platform.example.com";
  store.setCurrentPlatform(baseUrl);
  store.saveTokenConfig({
    baseUrl,
    accessToken: "a",
    tokenType: "Bearer",
    scope: "",
    refreshToken: "rt",
    obtainedAt: new Date().toISOString(),
  });

  await assert.rejects(() => oauth.refreshAccessToken(store.loadTokenConfig(baseUrl)!), /client\.json/);
});

test("refreshAccessToken: invalid_grant surfaces HttpError body", async () => {
  const configDir = createConfigDir();
  const { store, oauth } = await importOauthAndStore(configDir);
  const baseUrl = "https://platform.example.com";
  store.saveClientConfig(baseUrl, { baseUrl, clientId: "c", clientSecret: "s" });
  store.setCurrentPlatform(baseUrl);
  store.saveTokenConfig({
    baseUrl,
    accessToken: "a",
    tokenType: "Bearer",
    scope: "",
    refreshToken: "bad-rt",
    obtainedAt: new Date().toISOString(),
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: "invalid_grant", error_description: "expired" }), {
      status: 400,
      statusText: "Bad Request",
    });
  try {
    await assert.rejects(oauth.refreshAccessToken(store.loadTokenConfig(baseUrl)!), (err: unknown) => {
      assert.ok(err instanceof HttpError);
      assert.equal((err as HttpError).status, 400);
      assert.match((err as HttpError).body, /invalid_grant/);
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ensureValidToken: refreshes when token is near expiry", async () => {
  const configDir = createConfigDir();
  const { store, oauth } = await importOauthAndStore(configDir);
  const baseUrl = "https://platform.example.com";
  store.saveClientConfig(baseUrl, { baseUrl, clientId: "c", clientSecret: "s" });
  store.setCurrentPlatform(baseUrl);
  const soon = new Date(Date.now() + 30_000).toISOString();
  store.saveTokenConfig({
    baseUrl,
    accessToken: "old",
    tokenType: "Bearer",
    scope: "",
    expiresAt: soon,
    refreshToken: "rt",
    obtainedAt: new Date().toISOString(),
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({ access_token: "fresh", expires_in: 3600 }),
      { status: 200 },
    );
  try {
    const t = await oauth.ensureValidToken();
    assert.equal(t.accessToken, "fresh");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ensureValidToken: near expiry without refresh_token throws", async () => {
  const configDir = createConfigDir();
  const { store, oauth } = await importOauthAndStore(configDir);
  const baseUrl = "https://platform.example.com";
  store.setCurrentPlatform(baseUrl);
  store.saveTokenConfig({
    baseUrl,
    accessToken: "old",
    tokenType: "Bearer",
    scope: "",
    expiresAt: new Date(Date.now() + 30_000).toISOString(),
    obtainedAt: new Date().toISOString(),
  });

  await assert.rejects(() => oauth.ensureValidToken(), /refresh failed|expired/);
});

test("ensureValidToken: forceRefresh calls token endpoint", async () => {
  const configDir = createConfigDir();
  const { store, oauth } = await importOauthAndStore(configDir);
  const baseUrl = "https://platform.example.com";
  store.saveClientConfig(baseUrl, { baseUrl, clientId: "c", clientSecret: "s" });
  store.setCurrentPlatform(baseUrl);
  store.saveTokenConfig({
    baseUrl,
    accessToken: "a",
    tokenType: "Bearer",
    scope: "",
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    refreshToken: "rt",
    obtainedAt: new Date().toISOString(),
  });

  let tokenCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: any) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.includes("/oauth2/token")) {
      tokenCalls += 1;
      return new Response(JSON.stringify({ access_token: "forced", expires_in: 3600 }), { status: 200 });
    }
    return new Response("", { status: 404 });
  };
  try {
    const t = await oauth.ensureValidToken({ forceRefresh: true });
    assert.equal(t.accessToken, "forced");
    assert.equal(tokenCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// KWEAVER_USER env var: load a specific user's token
// ---------------------------------------------------------------------------

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.fake-signature`;
}

test("ensureValidToken: KWEAVER_USER loads specific user token", async () => {
  const configDir = createConfigDir();
  const { store, oauth } = await importOauthAndStore(configDir);
  const baseUrl = "https://multi.example.com";
  store.setCurrentPlatform(baseUrl);

  // Save two users
  store.saveTokenConfig({
    baseUrl,
    accessToken: "token-alice",
    tokenType: "Bearer",
    scope: "",
    idToken: makeJwt({ sub: "uid-alice" }),
    displayName: "alice",
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    obtainedAt: new Date().toISOString(),
  });
  store.saveTokenConfig({
    baseUrl,
    accessToken: "token-bob",
    tokenType: "Bearer",
    scope: "",
    idToken: makeJwt({ sub: "uid-bob" }),
    displayName: "bob",
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    obtainedAt: new Date().toISOString(),
  });

  // Active user is bob (last saved)
  const defaultToken = await oauth.ensureValidToken();
  assert.equal(defaultToken.accessToken, "token-bob");

  // KWEAVER_USER=alice → loads alice's token
  process.env.KWEAVER_USER = "alice";
  try {
    const aliceToken = await oauth.ensureValidToken();
    assert.equal(aliceToken.accessToken, "token-alice");
  } finally {
    delete process.env.KWEAVER_USER;
  }

  // KWEAVER_USER=uid-alice also works (by userId)
  process.env.KWEAVER_USER = "uid-alice";
  try {
    const aliceToken = await oauth.ensureValidToken();
    assert.equal(aliceToken.accessToken, "token-alice");
  } finally {
    delete process.env.KWEAVER_USER;
  }
});

test("ensureValidToken: KWEAVER_USER with unknown user throws", async () => {
  const configDir = createConfigDir();
  const { store, oauth } = await importOauthAndStore(configDir);
  const baseUrl = "https://multi.example.com";
  store.setCurrentPlatform(baseUrl);
  store.saveTokenConfig({
    baseUrl,
    accessToken: "a",
    tokenType: "Bearer",
    scope: "",
    idToken: makeJwt({ sub: "uid-1" }),
    obtainedAt: new Date().toISOString(),
  });

  process.env.KWEAVER_USER = "nonexistent";
  try {
    await assert.rejects(() => oauth.ensureValidToken(), /not found/);
  } finally {
    delete process.env.KWEAVER_USER;
  }
});

test("with401RefreshRetry: runs without saved token (no upfront auth)", async () => {
  const configDir = createConfigDir();
  const { oauth } = await importOauthAndStore(configDir);
  const r = await oauth.with401RefreshRetry(async () => "no-auth-needed");
  assert.equal(r, "no-auth-needed");
});

test("withTokenRetry: returns on first success", async () => {
  const configDir = createConfigDir();
  const { store, oauth } = await importOauthAndStore(configDir);
  const baseUrl = "https://platform.example.com";
  store.setCurrentPlatform(baseUrl);
  store.saveTokenConfig({
    baseUrl,
    accessToken: "a",
    tokenType: "Bearer",
    scope: "",
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    obtainedAt: new Date().toISOString(),
  });
  let n = 0;
  const r = await oauth.withTokenRetry(async (tok) => {
    n += 1;
    assert.ok(tok.accessToken);
    return 42;
  });
  assert.equal(r, 42);
  assert.equal(n, 1);
});

test("withTokenRetry: retries once after 401 when refresh succeeds", async () => {
  const configDir = createConfigDir();
  const { store, oauth } = await importOauthAndStore(configDir);
  const baseUrl = "https://platform.example.com";
  store.saveClientConfig(baseUrl, { baseUrl, clientId: "c", clientSecret: "s" });
  store.setCurrentPlatform(baseUrl);
  store.saveTokenConfig({
    baseUrl,
    accessToken: "a1",
    tokenType: "Bearer",
    scope: "",
    refreshToken: "rt",
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    obtainedAt: new Date().toISOString(),
  });

  let tokenCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: any) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.includes("/oauth2/token")) {
      tokenCalls += 1;
      return new Response(JSON.stringify({ access_token: "a2", expires_in: 3600 }), { status: 200 });
    }
    return new Response("", { status: 404 });
  };

  try {
    let attempts = 0;
    const r = await oauth.withTokenRetry(async (tok) => {
      attempts += 1;
      if (attempts === 1) {
        assert.equal(tok.accessToken, "a1");
        throw new HttpError(401, "Unauthorized", "{}");
      }
      assert.equal(tok.accessToken, "a2");
      return "ok";
    });
    assert.equal(r, "ok");
    assert.equal(attempts, 2);
    assert.equal(tokenCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("withTokenRetry: 401 without refresh capability throws", async () => {
  const configDir = createConfigDir();
  const { store, oauth } = await importOauthAndStore(configDir);
  const baseUrl = "https://platform.example.com";
  store.setCurrentPlatform(baseUrl);
  store.saveTokenConfig({
    baseUrl,
    accessToken: "a",
    tokenType: "Bearer",
    scope: "",
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    obtainedAt: new Date().toISOString(),
  });

  await assert.rejects(
    () =>
      oauth.withTokenRetry(async () => {
        throw new HttpError(401, "Unauthorized", "{}");
      }),
    /refresh did not succeed|no refresh_token/,
  );
});

test("withTokenRetry: non-401 error is not retried", async () => {
  const configDir = createConfigDir();
  const { store, oauth } = await importOauthAndStore(configDir);
  const baseUrl = "https://platform.example.com";
  store.setCurrentPlatform(baseUrl);
  store.saveTokenConfig({
    baseUrl,
    accessToken: "a",
    tokenType: "Bearer",
    scope: "",
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    obtainedAt: new Date().toISOString(),
  });
  await assert.rejects(
    () =>
      oauth.withTokenRetry(async () => {
        throw new HttpError(500, "Error", "{}");
      }),
    (e: unknown) => {
      assert.ok(e instanceof HttpError);
      assert.equal((e as HttpError).status, 500);
      return true;
    },
  );
});

test("loadClientConfig and saveClientConfig round-trip", async () => {
  const configDir = createConfigDir();
  const { store } = await importOauthAndStore(configDir);
  const baseUrl = "https://x.example.com";
  store.setCurrentPlatform(baseUrl);
  store.saveTokenConfig({
    baseUrl,
    accessToken: "t",
    tokenType: "bearer",
    scope: "",
    obtainedAt: new Date().toISOString(),
  });
  store.saveClientConfig(baseUrl, {
    baseUrl,
    clientId: "id1",
    clientSecret: "sec1",
    redirectUri: "http://localhost/cb",
  });
  const c = store.loadClientConfig(baseUrl);
  assert.equal(c?.clientId, "id1");
  assert.equal(c?.clientSecret, "sec1");
  assert.equal(c?.redirectUri, "http://localhost/cb");
});

test("formatHttpError: fetch failed with TLS cause shows root cause and hint", async () => {
  const configDir = createConfigDir();
  const { oauth } = await importOauthAndStore(configDir);
  const err = new TypeError("fetch failed");
  (err as Error & { cause?: Error }).cause = new Error("self-signed certificate");
  const msg = oauth.formatHttpError(err);
  assert.match(msg, /self-signed certificate/);
  assert.match(msg, /--insecure/);
});

test("formatHttpError: generic error without cause unchanged", async () => {
  const configDir = createConfigDir();
  const { oauth } = await importOauthAndStore(configDir);
  const msg = oauth.formatHttpError(new Error("something else"));
  assert.equal(msg, "something else");
});

test("refreshAccessToken: preserves tlsInsecure flag on refreshed token", async () => {
  const configDir = createConfigDir();
  const { store, oauth } = await importOauthAndStore(configDir);
  const baseUrl = "https://platform.example.com";
  store.saveClientConfig(baseUrl, { baseUrl, clientId: "c", clientSecret: "s" });
  store.setCurrentPlatform(baseUrl);
  store.saveTokenConfig({
    baseUrl,
    accessToken: "a",
    tokenType: "Bearer",
    scope: "",
    refreshToken: "rt",
    obtainedAt: new Date().toISOString(),
    tlsInsecure: true,
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ access_token: "new", expires_in: 3600 }), { status: 200 });
  try {
    const out = await oauth.refreshAccessToken(store.loadTokenConfig(baseUrl)!);
    assert.equal(out.tlsInsecure, true);
    const disk = store.loadTokenConfig(baseUrl);
    assert.equal(disk?.tlsInsecure, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("refreshAccessToken: no tlsInsecure when original token lacks it", async () => {
  const configDir = createConfigDir();
  const { store, oauth } = await importOauthAndStore(configDir);
  const baseUrl = "https://platform.example.com";
  store.saveClientConfig(baseUrl, { baseUrl, clientId: "c", clientSecret: "s" });
  store.setCurrentPlatform(baseUrl);
  store.saveTokenConfig({
    baseUrl,
    accessToken: "a",
    tokenType: "Bearer",
    scope: "",
    refreshToken: "rt",
    obtainedAt: new Date().toISOString(),
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ access_token: "new", expires_in: 3600 }), { status: 200 });
  try {
    const out = await oauth.refreshAccessToken(store.loadTokenConfig(baseUrl)!);
    assert.equal(out.tlsInsecure, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// --- refreshTokenLogin ---

test("refreshTokenLogin: exchanges refresh token, saves client + token, sets current platform", async () => {
  const configDir = createConfigDir();
  const { store, oauth } = await importOauthAndStore(configDir);
  const baseUrl = "https://headless.example.com";

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const u = typeof input === "string" ? input : input.toString();
    assert.ok(u.includes("/oauth2/token"));
    return new Response(
      JSON.stringify({
        access_token: "headless-at",
        token_type: "Bearer",
        expires_in: 7200,
        scope: "openid",
        refresh_token: "new-rt",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  try {
    const token = await oauth.refreshTokenLogin(baseUrl, {
      clientId: "cid-remote",
      clientSecret: "csec-remote",
      refreshToken: "original-rt",
    });
    assert.equal(token.accessToken, "headless-at");
    assert.equal(token.refreshToken, "new-rt");
    assert.equal(token.expiresIn, 7200);

    const client = store.loadClientConfig(baseUrl);
    assert.equal(client?.clientId, "cid-remote");
    assert.equal(client?.clientSecret, "csec-remote");

    const disk = store.loadTokenConfig(baseUrl);
    assert.equal(disk?.accessToken, "headless-at");

    assert.equal(store.getCurrentPlatform(), baseUrl);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("refreshTokenLogin: preserves tlsInsecure flag", async () => {
  const configDir = createConfigDir();
  const { store, oauth } = await importOauthAndStore(configDir);
  const baseUrl = "https://tls.example.com";

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ access_token: "at", expires_in: 3600 }), { status: 200 });
  try {
    const token = await oauth.refreshTokenLogin(baseUrl, {
      clientId: "c",
      clientSecret: "s",
      refreshToken: "rt",
      tlsInsecure: true,
    });
    assert.equal(token.tlsInsecure, true);
    const disk = store.loadTokenConfig(baseUrl);
    assert.equal(disk?.tlsInsecure, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("refreshTokenLogin: throws on invalid refresh token", async () => {
  const configDir = createConfigDir();
  const { oauth } = await importOauthAndStore(configDir);
  const baseUrl = "https://fail.example.com";

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: "invalid_grant", error_description: "expired" }), {
      status: 400,
      statusText: "Bad Request",
    });
  try {
    await assert.rejects(
      () => oauth.refreshTokenLogin(baseUrl, { clientId: "c", clientSecret: "s", refreshToken: "bad" }),
      (err: unknown) => {
        assert.ok(err instanceof HttpError);
        assert.equal((err as HttpError).status, 400);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// --- buildCopyCommand ---

test("buildCopyCommand: includes all parts", async () => {
  const configDir = createConfigDir();
  const { oauth } = await importOauthAndStore(configDir);
  const cmd = oauth.buildCopyCommand("https://ex.com/", "cid", "csec", "rt123", false);
  assert.match(cmd, /kweaver/);
  assert.match(cmd, /auth/);
  assert.match(cmd, /login/);
  assert.match(cmd, /--client-id/);
  assert.match(cmd, /cid/);
  assert.match(cmd, /--client-secret/);
  assert.match(cmd, /csec/);
  assert.match(cmd, /--refresh-token/);
  assert.match(cmd, /rt123/);
  assert.ok(!cmd.includes("--insecure"));
});

test("buildCopyCommand: includes --insecure when tlsInsecure", async () => {
  const configDir = createConfigDir();
  const { oauth } = await importOauthAndStore(configDir);
  const cmd = oauth.buildCopyCommand("https://ex.com", "c", "s", "r", true);
  assert.match(cmd, /--insecure/);
});

test("buildCopyCommand: omits --client-secret when empty", async () => {
  const configDir = createConfigDir();
  const { oauth } = await importOauthAndStore(configDir);
  const cmd = oauth.buildCopyCommand("https://ex.com", "c", "", "r", false);
  assert.ok(!cmd.includes("--client-secret"));
});

test("buildCopyCommand: omits --refresh-token when undefined", async () => {
  const configDir = createConfigDir();
  const { oauth } = await importOauthAndStore(configDir);
  const cmd = oauth.buildCopyCommand("https://ex.com", "c", "s", undefined, false);
  assert.ok(!cmd.includes("--refresh-token"));
});

// --- buildCallbackHtml ---

test("buildCallbackHtml: contains key elements", async () => {
  const configDir = createConfigDir();
  const { oauth } = await importOauthAndStore(configDir);
  const html = oauth.buildCallbackHtml("kweaver auth login 'https://ex.com' --client-id 'c' --client-secret 's' --refresh-token 'r'");
  assert.match(html, /Login successful/);
  assert.match(html, /Headless machine/);
  assert.match(html, /no browser/);
  assert.match(html, /Copy command/);
  assert.match(html, /kw-copy/);
  assert.match(html, /kw-cmd/);
  assert.match(html, /credentials secure/);
  assert.match(html, /--client-id/);
  assert.match(html, /--refresh-token/);
});

test("buildCallbackHtml: escapes HTML entities", async () => {
  const configDir = createConfigDir();
  const { oauth } = await importOauthAndStore(configDir);
  const html = oauth.buildCallbackHtml("kweaver auth login '<script>alert(1)</script>'");
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.match(html, /&lt;script&gt;/);
});
