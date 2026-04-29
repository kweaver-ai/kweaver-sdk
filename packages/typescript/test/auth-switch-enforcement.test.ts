import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

function createDir(): string {
  return mkdtempSync(join(tmpdir(), "kweaver-enforce-"));
}

async function freshAuthCmd(configDir: string, profile?: string) {
  process.env.KWEAVERC_CONFIG_DIR = configDir;
  if (profile === undefined) delete process.env.KWEAVER_PROFILE;
  else process.env.KWEAVER_PROFILE = profile;
  const url = pathToFileURL(join(process.cwd(), "src/commands/auth.ts")).href;
  return import(`${url}?t=${Date.now()}-${Math.random()}`);
}

function seedPlatform(configDir: string, baseUrl: string, userId: string) {
  // Build the on-disk shape the store expects so auth use / switch have
  // something to operate on without a real OAuth flow.
  const enc = Buffer.from(baseUrl, "utf8")
    .toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  const userDir = join(configDir, "platforms", enc, "users", userId);
  mkdirSync(userDir, { recursive: true });
  writeFileSync(join(userDir, "token.json"), JSON.stringify({
    baseUrl,
    accessToken: "tok",
    tokenType: "bearer",
    scope: "openid",
    obtainedAt: "2026-04-29T00:00:00.000Z",
    idToken: "",
  }));
}

function captureStderr(): { restore: () => string } {
  const orig = process.stderr.write.bind(process.stderr);
  let buf = "";
  // @ts-expect-error stub
  process.stderr.write = (chunk: any) => {
    buf += typeof chunk === "string" ? chunk : chunk.toString();
    return true;
  };
  return {
    restore: () => {
      process.stderr.write = orig;
      return buf;
    },
  };
}

test("auth switch refuses without KWEAVER_PROFILE", async () => {
  const dir = createDir();
  const url = "https://x.example.com";
  seedPlatform(dir, url, "user-1");
  const mod = await freshAuthCmd(dir, undefined);
  const cap = captureStderr();
  const code = await mod.runAuthCommand(["switch", url, "--user", "user-1"]);
  const err = cap.restore();
  assert.equal(code, 1);
  assert.match(err, /KWEAVER_PROFILE/);
  assert.match(err, /--user/); // hint to use the transient flag
  assert.match(err, /--global/); // hint to escape-hatch
});

test("auth use refuses without KWEAVER_PROFILE", async () => {
  const dir = createDir();
  const url = "https://x.example.com";
  seedPlatform(dir, url, "user-1");
  const mod = await freshAuthCmd(dir, undefined);
  const cap = captureStderr();
  const code = await mod.runAuthCommand(["use", url]);
  const err = cap.restore();
  assert.equal(code, 1);
  assert.match(err, /KWEAVER_PROFILE/);
});

test("auth switch succeeds with KWEAVER_PROFILE set", async () => {
  const dir = createDir();
  const url = "https://x.example.com";
  seedPlatform(dir, url, "user-1");
  const mod = await freshAuthCmd(dir, "shellA");
  const code = await mod.runAuthCommand(["switch", url, "--user", "user-1"]);
  assert.equal(code, 0);
  // State file landed under the profile dir.
  assert.equal(existsSync(join(dir, "profiles", "shellA", "state.json")), true);
});

test("auth switch --global succeeds without KWEAVER_PROFILE", async () => {
  const dir = createDir();
  const url = "https://x.example.com";
  seedPlatform(dir, url, "user-1");
  const mod = await freshAuthCmd(dir, undefined);
  const code = await mod.runAuthCommand(["switch", "--global", url, "--user", "user-1"]);
  assert.equal(code, 0);
  // State file at root (no profile dir).
  assert.equal(existsSync(join(dir, "state.json")), true);
  assert.equal(existsSync(join(dir, "profiles")), false);
});
