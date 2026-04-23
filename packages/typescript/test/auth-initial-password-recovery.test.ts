/**
 * HTTP sign-in: initial password (401001017) typed error and auth CLI hint.
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const SIGNIN_HTML = `<!DOCTYPE html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
  props: { pageProps: { challenge: "ch1", csrftoken: "csrf1" } },
})}</script>`;

function createConfigDir(): string {
  return mkdtempSync(join(tmpdir(), "kweaver-oauth-initpwd-"));
}

async function importOauth(configDir: string) {
  process.env.KWEAVERC_CONFIG_DIR = configDir;
  const t = `${Date.now()}-${Math.random()}`;
  return import(`../src/auth/oauth.ts?t=${t}`);
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function stubFetch401017(baseUrl: string): () => void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = requestUrl(input);
    const method = init?.method ?? "GET";
    if (method === "POST" && u.includes("/oauth2/signin")) {
      return new Response(
        JSON.stringify({
          code: 401001017,
          message: "must change initial password",
        }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
    }
    if (u.includes("/oauth2/auth?")) {
      return new Response(null, {
        status: 302,
        headers: { Location: `${baseUrl}/oauth2/signin?login_challenge=lc1` },
      });
    }
    if (u.includes("/oauth2/signin")) {
      return new Response(SIGNIN_HTML, {
        status: 200,
        headers: { "Content-Type": "text/html" },
      });
    }
    return new Response(`unexpected: ${method} ${u}`, { status: 500 });
  };
  return () => {
    globalThis.fetch = originalFetch;
  };
}

test("oauth2PasswordSigninLogin throws InitialPasswordChangeRequiredError on 401001017", async () => {
  const configDir = createConfigDir();
  const oauth = await importOauth(configDir);
  const { InitialPasswordChangeRequiredError: IPwdErr } = oauth;
  const baseUrl = "https://plat.example.com";
  const restore = stubFetch401017(baseUrl);
  try {
    await assert.rejects(
      () =>
        oauth.oauth2PasswordSigninLogin(baseUrl, {
          username: "u1",
          password: "p1",
          clientId: "cid",
          clientSecret: "sec",
        }),
      (e: unknown) => {
        assert.ok(e instanceof IPwdErr);
        const err = e as InstanceType<typeof IPwdErr>;
        assert.equal(err.code, 401001017);
        assert.equal(err.account, "u1");
        assert.equal(err.httpStatus, 401);
        assert.equal(err.serverMessage, "must change initial password");
        return true;
      },
    );
  } finally {
    restore();
  }
});

test("runAuthCommand: non-TTY exits 1 when 401001017 and no --new-password", async () => {
  const configDir = createConfigDir();
  process.env.KWEAVERC_CONFIG_DIR = configDir;
  const t = `${Date.now()}-${Math.random()}`;
  const auth = await import(`${pathToFileURL(join(process.cwd(), "src/commands/auth.ts")).href}?${t}`);

  const restoreFetch = stubFetch401017("https://plat.example.com");
  const originalStderrIsTTY = process.stderr.isTTY;
  process.stderr.isTTY = false;

  try {
    const code = await auth.runAuthCommand([
      "https://plat.example.com/",
      "-u",
      "u1",
      "-p",
      "old",
      "--client-id",
      "cid",
      "--client-secret",
      "sec",
    ]);
    assert.equal(code, 1);
  } finally {
    restoreFetch();
    process.stderr.isTTY = originalStderrIsTTY;
  }
});
