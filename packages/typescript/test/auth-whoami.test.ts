import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { run } from "../src/cli.js";

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.fake-signature`;
}

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

describe("kweaver auth whoami", () => {
  let origDir: string | undefined;
  let tempDir: string;

  beforeEach(() => {
    origDir = process.env.KWEAVERC_CONFIG_DIR;
    tempDir = mkdtempSync(join(tmpdir(), "kw-whoami-"));
    process.env.KWEAVERC_CONFIG_DIR = tempDir;
  });

  afterEach(() => {
    if (origDir === undefined) delete process.env.KWEAVERC_CONFIG_DIR;
    else process.env.KWEAVERC_CONFIG_DIR = origDir;
    rmSync(tempDir, { recursive: true, force: true });
  });

  function setupPlatform(tokenOverrides: Record<string, unknown> = {}): void {
    const userId = "test-user";
    const userDir = join(tempDir, "platforms", PLATFORM_DIR_NAME, "users", userId);
    mkdirSync(userDir, { recursive: true });
    writeFileSync(
      join(userDir, "token.json"),
      JSON.stringify({
        baseUrl: BASE_URL,
        accessToken: "at-1",
        tokenType: "Bearer",
        scope: "openid",
        refreshToken: "rt-1",
        obtainedAt: new Date().toISOString(),
        ...tokenOverrides,
      }),
    );
    writeFileSync(
      join(tempDir, "state.json"),
      JSON.stringify({ currentPlatform: BASE_URL, activeUsers: { [BASE_URL]: userId } }),
    );
  }

  it("shows user identity from id_token", async () => {
    const idToken = makeJwt({
      sub: "user-id-123",
      iss: "https://example.com:443",
      sid: "session-abc",
      iat: 1700000000,
      exp: 1700003600,
    });
    setupPlatform({ idToken });

    const { code, stdout } = await runCli(["auth", "whoami"]);
    assert.equal(code, 0);
    assert.match(stdout, /Platform:\s+https:\/\/example\.com/);
    assert.match(stdout, /User ID:\s+user-id-123/);
    assert.match(stdout, /Issuer:\s+https:\/\/example\.com:443/);
    assert.match(stdout, /Session:\s+session-abc/);
    assert.match(stdout, /Issued:/);
    assert.match(stdout, /Expires:/);
  });

  it("outputs JSON with --json flag", async () => {
    const idToken = makeJwt({
      sub: "user-id-456",
      iss: "https://example.com:443",
      aud: ["client-abc"],
      iat: 1700000000,
      exp: 1700003600,
    });
    setupPlatform({ idToken });

    const { code, stdout } = await runCli(["auth", "whoami", "--json"]);
    assert.equal(code, 0);
    const parsed = JSON.parse(stdout);
    assert.equal(parsed.platform, BASE_URL);
    assert.equal(parsed.sub, "user-id-456");
    assert.equal(parsed.iss, "https://example.com:443");
    assert.deepEqual(parsed.aud, ["client-abc"]);
  });

  it("fails when no platform is active", async () => {
    const { code, stderr } = await runCli(["auth", "whoami"]);
    assert.equal(code, 1);
    assert.match(stderr, /No active platform/);
  });

  it("fails when no token is saved", async () => {
    const platformsDir = join(tempDir, "platforms", PLATFORM_DIR_NAME);
    mkdirSync(platformsDir, { recursive: true });
    writeFileSync(
      join(tempDir, "state.json"),
      JSON.stringify({ currentPlatform: BASE_URL }),
    );

    const { code, stderr } = await runCli(["auth", "whoami"]);
    assert.equal(code, 1);
    assert.match(stderr, /No saved token/);
  });

  it("fails when id_token is missing from saved token", async () => {
    setupPlatform();

    const { code, stderr } = await runCli(["auth", "whoami"]);
    assert.equal(code, 1);
    assert.match(stderr, /No id_token/);
  });

  it("shows help with --help", async () => {
    const { code, stdout } = await runCli(["auth", "whoami", "--help"]);
    assert.equal(code, 0);
    assert.match(stdout, /whoami/);
    assert.match(stdout, /--json/);
  });

  it("shows (unknown) when sub is missing from payload", async () => {
    const idToken = makeJwt({ iss: "https://example.com:443" });
    setupPlatform({ idToken });

    const { code, stdout } = await runCli(["auth", "whoami"]);
    assert.equal(code, 0);
    assert.match(stdout, /User ID:\s+\(unknown\)/);
  });
});
