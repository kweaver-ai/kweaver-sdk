/**
 * E2E: OAuth refresh_token flow against real ~/.kweaver (shared with Python OAuth login).
 * Requires KWEAVER_BASE_URL, token.json with refreshToken, and client.json with clientId/clientSecret.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { loadClientConfig, loadTokenConfig, saveTokenConfig } from "../../src/config/store.js";
import { getE2eEnv, runCli, shouldSkipE2e } from "./setup.js";

function shouldSkipTokenRefreshE2e(): boolean {
  if (shouldSkipE2e()) return true;
  const baseUrl = getE2eEnv().baseUrl;
  if (!baseUrl) return true;
  const token = loadTokenConfig(baseUrl);
  const client = loadClientConfig(baseUrl);
  if (!token?.refreshToken?.trim()) return true;
  if (!client?.clientId?.trim() || !client?.clientSecret?.trim()) return true;
  return false;
}

test(
  "e2e: bkn list succeeds after artificial token expiry (refresh)",
  { skip: shouldSkipTokenRefreshE2e() },
  async () => {
    const baseUrl = getE2eEnv().baseUrl;
    const before = loadTokenConfig(baseUrl);
    assert.ok(before);

    saveTokenConfig({
      ...before,
      expiresAt: new Date(Date.now() - 120_000).toISOString(),
    });

    const { code, stderr } = await runCli(["bkn", "list", "--limit", "1"]);
    assert.equal(code, 0, stderr || "bkn list should succeed after auto-refresh");

    const after = loadTokenConfig(baseUrl);
    assert.ok(after);
    assert.ok(
      after.expiresAt && Date.parse(after.expiresAt) > Date.now(),
      "token should have a future expiresAt after refresh",
    );
  },
);

test(
  "e2e: auth status reports active token after refresh path",
  { skip: shouldSkipTokenRefreshE2e() },
  async () => {
    const baseUrl = getE2eEnv().baseUrl;
    const before = loadTokenConfig(baseUrl);
    assert.ok(before);

    saveTokenConfig({
      ...before,
      expiresAt: new Date(Date.now() - 120_000).toISOString(),
    });

    const { code: listCode } = await runCli(["bkn", "list", "--limit", "1"]);
    assert.equal(listCode, 0);

    const { code: statusCode, stdout } = await runCli(["auth", "status", baseUrl]);
    assert.equal(statusCode, 0);
    assert.match(stdout, /Token status: active|expires in/);
  },
);
