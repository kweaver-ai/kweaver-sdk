import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getCurrentPlatform,
  isNoAuth,
  loadPlatformBusinessDomain,
  loadTokenConfig,
  resolveBusinessDomain,
  saveNoAuthPlatform,
  savePlatformBusinessDomain,
} from "../src/config/store.js";

describe("platform config (businessDomain)", () => {
  let origDir: string | undefined;
  let tempDir: string;

  beforeEach(() => {
    origDir = process.env.KWEAVERC_CONFIG_DIR;
    tempDir = mkdtempSync(join(tmpdir(), "kw-cfg-"));
    process.env.KWEAVERC_CONFIG_DIR = tempDir;
  });

  afterEach(() => {
    if (origDir === undefined) delete process.env.KWEAVERC_CONFIG_DIR;
    else process.env.KWEAVERC_CONFIG_DIR = origDir;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns null when no config exists", () => {
    const bd = loadPlatformBusinessDomain("https://example.com");
    assert.equal(bd, null);
  });

  it("saves and loads businessDomain", () => {
    savePlatformBusinessDomain("https://example.com", "my-uuid-bd");
    const bd = loadPlatformBusinessDomain("https://example.com");
    assert.equal(bd, "my-uuid-bd");
  });

  it("resolveBusinessDomain prefers env var", () => {
    savePlatformBusinessDomain("https://example.com", "from-config");
    process.env.KWEAVER_BUSINESS_DOMAIN = "from-env";
    try {
      assert.equal(resolveBusinessDomain("https://example.com"), "from-env");
    } finally {
      delete process.env.KWEAVER_BUSINESS_DOMAIN;
    }
  });

  it("resolveBusinessDomain falls back to config then bd_public", () => {
    assert.equal(resolveBusinessDomain("https://no-config.com"), "bd_public");
    savePlatformBusinessDomain("https://example.com", "uuid-bd");
    assert.equal(resolveBusinessDomain("https://example.com"), "uuid-bd");
  });

  it("saveNoAuthPlatform persists sentinel and sets current platform", () => {
    const url = "https://no-oauth.example.com";
    const tok = saveNoAuthPlatform(url);
    assert.ok(isNoAuth(tok.accessToken));
    assert.equal(getCurrentPlatform(), url.replace(/\/+$/, ""));
    const loaded = loadTokenConfig(url);
    assert.ok(loaded);
    assert.ok(isNoAuth(loaded!.accessToken));
    assert.equal(loaded!.tokenType, "none");
  });
});
