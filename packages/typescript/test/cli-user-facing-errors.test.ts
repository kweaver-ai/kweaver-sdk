import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { run } from "../src/cli.js";
import { fetchEacpUserInfo, formatHttpError } from "../src/auth/oauth.js";
import { HttpError } from "../src/utils/http.js";

/**
 * Three user-facing error fixes covered here:
 *   1. BKN 403 with body `BknBackend.KnowledgeNetwork.NotFound` -> hint user
 *      that the kn-id does not exist (it is *not* a permission problem).
 *   2. `kweaver config list-bd` with an app token -> rewrite the cryptic 401
 *      `invalid user_id` into "This command does not support app accounts."
 *      after a confirming EACP probe.
 *   3. `kweaver auth whoami` in env-token mode -> fetch identity from EACP and
 *      render Type/User ID/Account/Name.
 */

async function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...a: unknown[]) => stdout.push(a.map(String).join(" "));
  console.error = (...a: unknown[]) => stderr.push(a.map(String).join(" "));
  try {
    const code = await run(args);
    return { code, stdout: stdout.join("\n"), stderr: stderr.join("\n") };
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
}

const BASE_URL = "https://example.com";
const PLATFORM_DIR_NAME = Buffer.from(BASE_URL).toString("base64url");

describe("formatHttpError — BKN not-found 403/404 hint (fix #1)", () => {
  it("rewrites 403 BknBackend.KnowledgeNetwork.NotFound with kn-id hint", () => {
    const err = new HttpError(
      403,
      "Forbidden",
      JSON.stringify({ error_code: "BknBackend.KnowledgeNetwork.NotFound", message: "not found" }),
    );
    const msg = formatHttpError(err);
    assert.match(msg, /knowledge network not found/);
    assert.match(msg, /not a permission\/auth issue/);
  });

  it("also matches 404 (defensive — same root cause)", () => {
    const err = new HttpError(404, "Not Found", "BknBackend.KnowledgeNetwork.NotFound");
    assert.match(formatHttpError(err), /knowledge network not found/);
  });

  it("does not add the hint for an unrelated 403", () => {
    const err = new HttpError(403, "Forbidden", "permission denied");
    const msg = formatHttpError(err);
    assert.doesNotMatch(msg, /knowledge network not found/);
  });
});

describe("fetchEacpUserInfo (shared helper)", () => {
  let origFetch: typeof globalThis.fetch;
  beforeEach(() => {
    origFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it("returns user-shape payload (userid -> id)", async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({ type: "user", userid: "u-1", account: "alice@example.com", name: "Alice" }),
        { status: 200 },
      );
    const info = await fetchEacpUserInfo(BASE_URL, "tok");
    assert.deepEqual(info, { type: "user", id: "u-1", account: "alice@example.com", name: "Alice" });
  });

  it("returns app-shape payload (id stays as id, no account)", async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ type: "app", id: "app-42", name: "my-svc" }), { status: 200 });
    const info = await fetchEacpUserInfo(BASE_URL, "tok");
    assert.deepEqual(info, { type: "app", id: "app-42", account: undefined, name: "my-svc" });
  });

  it("returns null on non-2xx", async () => {
    globalThis.fetch = async () => new Response("nope", { status: 500 });
    assert.equal(await fetchEacpUserInfo(BASE_URL, "tok"), null);
  });

  it("returns null on unknown type", async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ type: "robot", userid: "x" }), { status: 200 });
    assert.equal(await fetchEacpUserInfo(BASE_URL, "tok"), null);
  });

  it("returns null on network error (never throws)", async () => {
    globalThis.fetch = async () => {
      throw new Error("ECONNREFUSED");
    };
    assert.equal(await fetchEacpUserInfo(BASE_URL, "tok"), null);
  });
});

describe("kweaver config list-bd — app account detection (fix #2)", () => {
  let origDir: string | undefined;
  let tempDir: string;
  let origFetch: typeof globalThis.fetch;

  beforeEach(() => {
    origDir = process.env.KWEAVERC_CONFIG_DIR;
    tempDir = mkdtempSync(join(tmpdir(), "kw-listbd-"));
    process.env.KWEAVERC_CONFIG_DIR = tempDir;
    const platformsDir = join(tempDir, "platforms", PLATFORM_DIR_NAME);
    mkdirSync(platformsDir, { recursive: true });
    writeFileSync(
      join(platformsDir, "client.json"),
      JSON.stringify({
        baseUrl: BASE_URL,
        clientId: "x",
        clientSecret: "s",
        redirectUri: "http://localhost",
        logoutRedirectUri: "http://localhost",
        scope: "openid",
      }),
    );
    writeFileSync(
      join(platformsDir, "token.json"),
      JSON.stringify({
        baseUrl: BASE_URL,
        accessToken: "app-tok",
        tokenType: "Bearer",
        scope: "openid",
        obtainedAt: "2020-01-01T00:00:00Z",
      }),
    );
    writeFileSync(
      join(tempDir, "state.json"),
      JSON.stringify({ currentPlatform: BASE_URL }),
    );
    origFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    if (origDir === undefined) delete process.env.KWEAVERC_CONFIG_DIR;
    else process.env.KWEAVERC_CONFIG_DIR = origDir;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("rewrites 401 invalid_user_id into a friendly app-account message after EACP probe", async () => {
    let listBdCalls = 0;
    let eacpCalls = 0;
    globalThis.fetch = async (input) => {
      const url = typeof input === "string" ? input : (input as URL | Request).toString();
      if (url.includes("/business-system/v1/business-domain")) {
        listBdCalls++;
        return new Response(
          JSON.stringify({ error_code: "Auth.InvalidUserId", message: "invalid user_id" }),
          { status: 401 },
        );
      }
      if (url.includes("/api/eacp/v1/user/get")) {
        eacpCalls++;
        return new Response(JSON.stringify({ type: "app", id: "app-42", name: "svc" }), {
          status: 200,
        });
      }
      // withTokenRetry probes a GET on a known endpoint to check token aliveness;
      // succeed so it surfaces the original 401 (wrapped) instead of forcing refresh.
      return new Response("[]", { status: 200 });
    };

    const { code, stderr } = await runCli(["config", "list-bd"]);
    assert.equal(code, 1);
    assert.match(stderr, /This command does not support app accounts\./);
    assert.ok(listBdCalls >= 1, "list-bd should have been attempted");
    assert.ok(eacpCalls >= 1, "EACP probe should have run to confirm app-type");
  });

  it("does NOT rewrite the message when EACP says the token is a user", async () => {
    globalThis.fetch = async (input) => {
      const url = typeof input === "string" ? input : (input as URL | Request).toString();
      if (url.includes("/business-system/v1/business-domain")) {
        return new Response(
          JSON.stringify({ error_code: "Auth.InvalidUserId", message: "invalid user_id" }),
          { status: 401 },
        );
      }
      if (url.includes("/api/eacp/v1/user/get")) {
        return new Response(
          JSON.stringify({ type: "user", userid: "u-1", account: "alice", name: "Alice" }),
          { status: 200 },
        );
      }
      return new Response("[]", { status: 200 });
    };
    const { code, stderr } = await runCli(["config", "list-bd"]);
    assert.equal(code, 1);
    assert.doesNotMatch(stderr, /does not support app accounts/);
  });
});

describe("kweaver auth whoami — env-token EACP enrichment (fix #3)", () => {
  let origDir: string | undefined;
  let origBaseUrl: string | undefined;
  let origToken: string | undefined;
  let tempDir: string;
  let origFetch: typeof globalThis.fetch;

  beforeEach(() => {
    origDir = process.env.KWEAVERC_CONFIG_DIR;
    origBaseUrl = process.env.KWEAVER_BASE_URL;
    origToken = process.env.KWEAVER_TOKEN;
    tempDir = mkdtempSync(join(tmpdir(), "kw-whoami-env-"));
    process.env.KWEAVERC_CONFIG_DIR = tempDir;
    process.env.KWEAVER_BASE_URL = BASE_URL;
    process.env.KWEAVER_TOKEN = "ory_at_opaque_token";
    origFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    if (origDir === undefined) delete process.env.KWEAVERC_CONFIG_DIR;
    else process.env.KWEAVERC_CONFIG_DIR = origDir;
    if (origBaseUrl === undefined) delete process.env.KWEAVER_BASE_URL;
    else process.env.KWEAVER_BASE_URL = origBaseUrl;
    if (origToken === undefined) delete process.env.KWEAVER_TOKEN;
    else process.env.KWEAVER_TOKEN = origToken;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("displays Type/User ID/Account/Name from EACP for a user token", async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({ type: "user", userid: "u-1", account: "alice@example.com", name: "Alice" }),
        { status: 200 },
      );
    const { code, stdout } = await runCli(["auth", "whoami"]);
    assert.equal(code, 0);
    assert.match(stdout, /Source:\s+env \(KWEAVER_TOKEN\)/);
    assert.match(stdout, /Type:\s+user/);
    assert.match(stdout, /User ID:\s+u-1/);
    assert.match(stdout, /Account:\s+alice@example\.com/);
    assert.match(stdout, /Name:\s+Alice/);
  });

  it("displays type=app for an app token", async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ type: "app", id: "app-42", name: "my-svc" }), { status: 200 });
    const { code, stdout } = await runCli(["auth", "whoami"]);
    assert.equal(code, 0);
    assert.match(stdout, /Type:\s+app/);
    assert.match(stdout, /User ID:\s+app-42/);
    assert.match(stdout, /Name:\s+my-svc/);
    assert.doesNotMatch(stdout, /Account:/);
  });

  it("falls back to opaque-token hint when EACP is unreachable", async () => {
    globalThis.fetch = async () => new Response("nope", { status: 500 });
    const { code, stdout } = await runCli(["auth", "whoami"]);
    assert.equal(code, 0);
    assert.match(stdout, /User info unavailable/);
  });

  it("--json includes userInfo from EACP", async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({ type: "user", userid: "u-1", account: "alice", name: "Alice" }),
        { status: 200 },
      );
    const { code, stdout } = await runCli(["auth", "whoami", "--json"]);
    assert.equal(code, 0);
    const parsed = JSON.parse(stdout) as { source: string; userInfo?: { type: string; id: string } };
    assert.equal(parsed.source, "env");
    assert.deepEqual(parsed.userInfo, {
      type: "user",
      id: "u-1",
      account: "alice",
      name: "Alice",
    });
  });
});
