/**
 * applyTlsEnvFromSavedTokens — isolated KWEAVERC_CONFIG_DIR per import.
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

function createConfigDir(): string {
  return mkdtempSync(join(tmpdir(), "kweaver-tls-"));
}

async function importModules(configDir: string) {
  process.env.KWEAVERC_CONFIG_DIR = configDir;
  delete process.env.KWEAVER_TLS_INSECURE;
  delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  const t = `${Date.now()}-${Math.random()}`;
  const store = await import(`../src/config/store.ts?t=${t}`);
  const tlsEnv = await import(`../src/config/tls-env.ts?t=${t}`);
  return { store, tlsEnv };
}

test("applyTlsEnvFromSavedTokens: sets NODE_TLS when tlsInsecure token exists", async () => {
  const configDir = createConfigDir();
  const { store, tlsEnv } = await importModules(configDir);
  const baseUrl = "https://insecure.example.com";
  store.setCurrentPlatform(baseUrl);
  store.saveTokenConfig({
    baseUrl,
    accessToken: "a",
    tokenType: "Bearer",
    scope: "",
    obtainedAt: new Date().toISOString(),
    tlsInsecure: true,
  });

  const prev = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  try {
    tlsEnv.applyTlsEnvFromSavedTokens();
    assert.equal(process.env.NODE_TLS_REJECT_UNAUTHORIZED, "0");
  } finally {
    if (prev === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = prev;
  }
});

test("applyTlsEnvFromSavedTokens: no-op when no insecure token", async () => {
  const configDir = createConfigDir();
  const { store, tlsEnv } = await importModules(configDir);
  const baseUrl = "https://secure.example.com";
  store.setCurrentPlatform(baseUrl);
  store.saveTokenConfig({
    baseUrl,
    accessToken: "a",
    tokenType: "Bearer",
    scope: "",
    obtainedAt: new Date().toISOString(),
  });

  delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  tlsEnv.applyTlsEnvFromSavedTokens();
  assert.equal(process.env.NODE_TLS_REJECT_UNAUTHORIZED, undefined);
});

test("applyTlsEnvFromSavedTokens: honors KWEAVER_TLS_INSECURE env var", async () => {
  const configDir = createConfigDir();
  const { tlsEnv } = await importModules(configDir);

  const prev = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  try {
    process.env.KWEAVER_TLS_INSECURE = "1";
    tlsEnv.applyTlsEnvFromSavedTokens();
    assert.equal(process.env.NODE_TLS_REJECT_UNAUTHORIZED, "0");
  } finally {
    delete process.env.KWEAVER_TLS_INSECURE;
    if (prev === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = prev;
  }
});
