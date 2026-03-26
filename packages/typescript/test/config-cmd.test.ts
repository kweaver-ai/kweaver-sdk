import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { run } from "../src/cli.js";

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

describe("kweaver config", () => {
  let origDir: string | undefined;
  let origBd: string | undefined;
  let tempDir: string;

  beforeEach(() => {
    origDir = process.env.KWEAVERC_CONFIG_DIR;
    origBd = process.env.KWEAVER_BUSINESS_DOMAIN;
    tempDir = mkdtempSync(join(tmpdir(), "kw-cfg-"));
    process.env.KWEAVERC_CONFIG_DIR = tempDir;
    delete process.env.KWEAVER_BUSINESS_DOMAIN;
    // Set up a fake current platform with base64 of "https://example.com"
    const platformsDir = join(tempDir, "platforms", "aHR0cHM6Ly9leGFtcGxlLmNvbQ");
    mkdirSync(platformsDir, { recursive: true });
    writeFileSync(join(platformsDir, "client.json"), JSON.stringify({ baseUrl: "https://example.com", clientId: "x", clientSecret: "s", redirectUri: "http://localhost", logoutRedirectUri: "http://localhost", scope: "openid" }));
    writeFileSync(join(tempDir, "state.json"), JSON.stringify({ currentPlatform: "https://example.com" }));
  });

  afterEach(() => {
    if (origDir === undefined) delete process.env.KWEAVERC_CONFIG_DIR;
    else process.env.KWEAVERC_CONFIG_DIR = origDir;
    if (origBd === undefined) delete process.env.KWEAVER_BUSINESS_DOMAIN;
    else process.env.KWEAVER_BUSINESS_DOMAIN = origBd;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("config show prints bd_public by default", async () => {
    const { code, stdout } = await runCli(["config", "show"]);
    assert.equal(code, 0);
    assert.ok(stdout.includes("bd_public"), `expected bd_public in: ${stdout}`);
  });

  it("config set-bd saves and config show reflects it", async () => {
    const r1 = await runCli(["config", "set-bd", "my-uuid"]);
    assert.equal(r1.code, 0);
    const r2 = await runCli(["config", "show"]);
    assert.equal(r2.code, 0);
    assert.ok(r2.stdout.includes("my-uuid"), `expected my-uuid in: ${r2.stdout}`);
  });

  it("config --help shows usage", async () => {
    const { code, stdout } = await runCli(["config", "--help"]);
    assert.equal(code, 0);
    assert.ok(stdout.includes("set-bd"));
    assert.ok(stdout.includes("list-bd"));
  });

  it("config list-bd prints domains from API", async () => {
    const platformsDir = join(tempDir, "platforms", "aHR0cHM6Ly9leGFtcGxlLmNvbQ");
    writeFileSync(
      join(platformsDir, "token.json"),
      JSON.stringify({
        baseUrl: "https://example.com",
        accessToken: "tok",
        tokenType: "Bearer",
        scope: "openid",
        obtainedAt: "2020-01-01T00:00:00Z",
      }),
    );
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(JSON.stringify([{ id: "bd_public", name: "Public", description: "d" }]), {
        status: 200,
      });
    try {
      const { code, stdout } = await runCli(["config", "list-bd"]);
      assert.equal(code, 0);
      const data = JSON.parse(stdout) as {
        currentId: string;
        domains: Array<{ id: string; current: boolean }>;
      };
      assert.equal(data.domains.length, 1);
      assert.equal(data.domains[0].id, "bd_public");
      assert.equal(data.domains[0].current, true);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
