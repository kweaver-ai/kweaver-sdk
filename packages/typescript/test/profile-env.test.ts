import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

function createDir(): string {
  return mkdtempSync(join(tmpdir(), "kweaver-profile-"));
}

async function importStore(configDir: string, profile?: string) {
  process.env.KWEAVERC_CONFIG_DIR = configDir;
  if (profile === undefined) delete process.env.KWEAVER_PROFILE;
  else process.env.KWEAVER_PROFILE = profile;
  const url = pathToFileURL(join(process.cwd(), "src/config/store.ts")).href;
  return import(`${url}?t=${Date.now()}-${Math.random()}`);
}

test("KWEAVER_PROFILE rejects invalid names (path traversal)", async () => {
  const dir = createDir();
  const store = await importStore(dir, "../evil");
  assert.throws(() => store.getCurrentPlatform(), /KWEAVER_PROFILE/);
});

test("KWEAVER_PROFILE accepts safe names", async () => {
  const dir = createDir();
  const store = await importStore(dir, "acct-a_1");
  assert.equal(store.getCurrentPlatform(), null);
});

test("unset KWEAVER_PROFILE writes state.json at config-dir root", async () => {
  const dir = createDir();
  const store = await importStore(dir, undefined);
  store.saveTokenConfig({
    baseUrl: "https://z.example.com",
    accessToken: "tok-z",
    tokenType: "bearer",
    scope: "openid",
    obtainedAt: "2026-04-29T00:00:00.000Z",
  });
  store.setCurrentPlatform("https://z.example.com");
  assert.equal(existsSync(join(dir, "state.json")), true);
  assert.equal(existsSync(join(dir, "profiles")), false);
});

test("two profiles share tokens but isolate currentPlatform", async () => {
  const dir = createDir();

  const storeA = await importStore(dir, "a");
  storeA.saveTokenConfig({
    baseUrl: "https://x.example.com",
    accessToken: "tok-x",
    tokenType: "bearer",
    scope: "openid",
    obtainedAt: "2026-04-29T00:00:00.000Z",
  });
  storeA.setCurrentPlatform("https://x.example.com");

  const storeB = await importStore(dir, "b");
  // No current platform in profile B even though token store is shared.
  assert.equal(storeB.getCurrentPlatform(), null);
  // Profile B can still load profile A's token by URL (shared platforms/).
  assert.equal(
    storeB.loadTokenConfig("https://x.example.com")?.accessToken,
    "tok-x",
  );

  storeB.saveTokenConfig({
    baseUrl: "https://y.example.com",
    accessToken: "tok-y",
    tokenType: "bearer",
    scope: "openid",
    obtainedAt: "2026-04-29T00:00:00.000Z",
  });
  storeB.setCurrentPlatform("https://y.example.com");

  // Profile A's currentPlatform unchanged.
  const storeAReloaded = await importStore(dir, "a");
  assert.equal(storeAReloaded.getCurrentPlatform(), "https://x.example.com");
});
