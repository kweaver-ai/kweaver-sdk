import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

function createConfigDir(): string {
  return mkdtempSync(join(tmpdir(), "kw-platnorm-"));
}

async function importAuth(configDir: string) {
  process.env.KWEAVERC_CONFIG_DIR = configDir;
  const moduleUrl = pathToFileURL(join(process.cwd(), "src/commands/auth.ts")).href;
  return import(`${moduleUrl}?t=${Date.now()}-${Math.random()}`);
}

async function importStore(configDir: string) {
  process.env.KWEAVERC_CONFIG_DIR = configDir;
  const moduleUrl = pathToFileURL(join(process.cwd(), "src/config/store.ts")).href;
  return import(`${moduleUrl}?t=${Date.now()}-${Math.random()}`);
}

async function importOauth(configDir: string) {
  process.env.KWEAVERC_CONFIG_DIR = configDir;
  const moduleUrl = pathToFileURL(join(process.cwd(), "src/auth/oauth.ts")).href;
  return import(`${moduleUrl}?t=${Date.now()}-${Math.random()}`);
}

test("auth login rejects bare-host target (no scheme)", async () => {
  const configDir = createConfigDir();
  const store = await importStore(configDir);
  const auth = await importAuth(configDir);

  const errors: string[] = [];
  const origError = console.error;
  console.error = (...args: unknown[]) => { errors.push(args.map(String).join(" ")); };
  try {
    const code = await auth.runAuthCommand(["192.168.40.62", "--no-auth"]);
    assert.equal(code, 1);
    assert.ok(
      errors.some((e) => /must include scheme/.test(e) && /http:\/\/192\.168\.40\.62/.test(e)),
      `expected scheme-required error, got: ${errors.join("\n")}`,
    );
  } finally {
    console.error = origError;
  }

  assert.equal(store.getCurrentPlatform(), null, "no platform should be persisted");
  assert.equal(store.loadTokenConfig("192.168.40.62"), null);
});

test("ensureValidToken rejects bare-host KWEAVER_BASE_URL", async () => {
  const configDir = createConfigDir();
  await importStore(configDir);
  const oauth = await importOauth(configDir);

  const prevBase = process.env.KWEAVER_BASE_URL;
  const prevTok = process.env.KWEAVER_TOKEN;
  process.env.KWEAVER_BASE_URL = "192.168.40.62";
  process.env.KWEAVER_TOKEN = "__NO_AUTH__";
  try {
    await assert.rejects(() => oauth.ensureValidToken(), /must include scheme/);
  } finally {
    if (prevBase === undefined) delete process.env.KWEAVER_BASE_URL; else process.env.KWEAVER_BASE_URL = prevBase;
    if (prevTok === undefined) delete process.env.KWEAVER_TOKEN; else process.env.KWEAVER_TOKEN = prevTok;
  }
});
