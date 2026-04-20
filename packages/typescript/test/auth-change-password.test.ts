/**
 * kweaver auth change-password CLI (EACP modifypassword).
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

function createConfigDir(): string {
  return mkdtempSync(join(tmpdir(), "kweaver-auth-chpwd-"));
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

test("change-password: posts to modifypassword and passes -k (TLS insecure)", async () => {
  const configDir = createConfigDir();
  process.env.KWEAVERC_CONFIG_DIR = configDir;
  const t = `${Date.now()}-${Math.random()}`;
  const auth = await import(`${pathToFileURL(join(process.cwd(), "src/commands/auth.ts")).href}?${t}`);

  let sawInsecure = false;
  const originalTls = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = requestUrl(input);
    if (u.includes("/api/eacp/v1/auth1/modifypassword")) {
      if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") sawInsecure = true;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("unexpected", { status: 500 });
  };

  try {
    const code = await auth.runAuthCommand([
      "change-password",
      "https://plat.example.com/",
      "-u",
      "alice",
      "-o",
      "oldsecret",
      "-n",
      "newsecret123456",
      "-k",
    ]);
    assert.equal(code, 0);
    assert.equal(sawInsecure, true);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalTls === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = originalTls;
  }
});

test("change-password: non-TTY missing -o / -n exits 1 without fetch", async () => {
  const configDir = createConfigDir();
  process.env.KWEAVERC_CONFIG_DIR = configDir;
  const t = `${Date.now()}-${Math.random()}`;
  const auth = await import(`${pathToFileURL(join(process.cwd(), "src/commands/auth.ts")).href}?${t}`);

  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalls++;
    return new Response("{}", { status: 200 });
  };
  const originalStdinIsTTY = process.stdin.isTTY;
  const originalStderrIsTTY = process.stderr.isTTY;
  process.stdin.isTTY = false;
  process.stderr.isTTY = false;

  try {
    const code = await auth.runAuthCommand([
      "change-password",
      "https://plat.example.com/",
      "-u",
      "alice",
      "-n",
      "newsecret123456",
    ]);
    assert.equal(code, 1);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    process.stdin.isTTY = originalStdinIsTTY;
    process.stderr.isTTY = originalStderrIsTTY;
  }
});

test("change-password: omitted URL falls back to current platform", async () => {
  const configDir = createConfigDir();
  process.env.KWEAVERC_CONFIG_DIR = configDir;
  const t = `${Date.now()}-${Math.random()}`;
  const auth = await import(`${pathToFileURL(join(process.cwd(), "src/commands/auth.ts")).href}?${t}`);
  const store = await import(`${pathToFileURL(join(process.cwd(), "src/config/store.ts")).href}?${t}`);

  store.saveNoAuthPlatform("https://plat.example.com/", { tlsInsecure: false });
  store.setCurrentPlatform("https://plat.example.com");

  let postUrl = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    postUrl = requestUrl(input);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const code = await auth.runAuthCommand([
      "change-password",
      "-u",
      "alice",
      "-o",
      "oldsecret",
      "-n",
      "newsecret123456",
    ]);
    assert.equal(code, 0);
    assert.ok(postUrl.startsWith("https://plat.example.com/"), `posted to ${postUrl}`);
    assert.ok(postUrl.includes("/api/eacp/v1/auth1/modifypassword"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("change-password: omitted -u defaults to active user displayName", async () => {
  const configDir = createConfigDir();
  process.env.KWEAVERC_CONFIG_DIR = configDir;
  const t = `${Date.now()}-${Math.random()}`;
  const auth = await import(`${pathToFileURL(join(process.cwd(), "src/commands/auth.ts")).href}?${t}`);
  const store = await import(`${pathToFileURL(join(process.cwd(), "src/config/store.ts")).href}?${t}`);

  const baseUrl = "https://plat.example.com";
  store.saveNoAuthPlatform(`${baseUrl}/`, { tlsInsecure: false });
  store.setCurrentPlatform(baseUrl);
  // Persist a synthetic token with a displayName so the command can default the account.
  const userId = "default";
  store.saveTokenConfig({
    baseUrl,
    accessToken: "no-auth",
    tokenType: "Bearer",
    scope: "",
    obtainedAt: new Date().toISOString(),
    displayName: "alice",
  });
  store.setActiveUser(baseUrl, userId);

  let postBody = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    if (requestUrl(input).includes("/api/eacp/v1/auth1/modifypassword")) {
      postBody = typeof init?.body === "string" ? init.body : "";
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("unexpected", { status: 500 });
  };

  try {
    const code = await auth.runAuthCommand([
      "change-password",
      "-o",
      "oldsecret",
      "-n",
      "newsecret123456",
    ]);
    assert.equal(code, 0);
    const parsed = JSON.parse(postBody) as { account?: string };
    assert.equal(parsed.account, "alice");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("change-password: omitted URL with no current platform exits 1", async () => {
  const configDir = createConfigDir();
  process.env.KWEAVERC_CONFIG_DIR = configDir;
  const t = `${Date.now()}-${Math.random()}`;
  const auth = await import(`${pathToFileURL(join(process.cwd(), "src/commands/auth.ts")).href}?${t}`);

  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalls++;
    return new Response("{}", { status: 200 });
  };

  try {
    const code = await auth.runAuthCommand([
      "change-password",
      "-u",
      "alice",
      "-o",
      "oldsecret",
      "-n",
      "newsecret123456",
    ]);
    assert.equal(code, 1);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("change-password: server 4xx JSON message is surfaced", async () => {
  const configDir = createConfigDir();
  process.env.KWEAVERC_CONFIG_DIR = configDir;
  const t = `${Date.now()}-${Math.random()}`;
  const auth = await import(`${pathToFileURL(join(process.cwd(), "src/commands/auth.ts")).href}?${t}`);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({ message: "bad old password", cause: "eacp" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );

  try {
    const code = await auth.runAuthCommand([
      "change-password",
      "https://plat.example.com/",
      "-u",
      "alice",
      "-o",
      "wrong",
      "-n",
      "newsecret123456",
    ]);
    assert.equal(code, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
