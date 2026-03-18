/**
 * E2E test setup for KWeaver TS CLI against a real KWeaver environment.
 *
 * - Auto-loads ~/.env.secrets into process.env
 * - Provides runCli() to capture stdout/stderr from CLI
 * - Skip logic: tests require KWEAVER_BASE_URL
 * - Destructive tests gated by E2E_RUN_DESTRUCTIVE=1
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { run } from "../../src/cli.js";

const SECRETS_PATH = join(homedir(), ".env.secrets");

function loadEnvSecrets(): void {
  if (!existsSync(SECRETS_PATH)) return;
  const content = readFileSync(SECRETS_PATH, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const withoutExport = trimmed.replace(/^export\s+/, "");
    const eqIdx = withoutExport.indexOf("=");
    if (eqIdx < 0) continue;
    const key = withoutExport.slice(0, eqIdx).trim();
    let value = withoutExport.slice(eqIdx + 1).trim();
    value = value.replace(/^["']|["']$/g, "");
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadEnvSecrets();

export function getE2eEnv(): {
  baseUrl: string;
  token: string;
  businessDomain: string;
  dbHost: string;
  dbPort: string;
  dbName: string;
  dbUser: string;
  dbPass: string;
  dbType: string;
  dbSchema: string;
} {
  return {
    baseUrl: process.env.KWEAVER_BASE_URL ?? "",
    token: process.env.KWEAVER_TOKEN ?? "",
    businessDomain: process.env.KWEAVER_BUSINESS_DOMAIN ?? "bd_public",
    dbHost: process.env.KWEAVER_TEST_DB_HOST ?? "",
    dbPort: process.env.KWEAVER_TEST_DB_PORT ?? "3306",
    dbName: process.env.KWEAVER_TEST_DB_NAME ?? "",
    dbUser: process.env.KWEAVER_TEST_DB_USER ?? "",
    dbPass: process.env.KWEAVER_TEST_DB_PASS ?? "",
    dbType: process.env.KWEAVER_TEST_DB_TYPE ?? "mysql",
    dbSchema: process.env.KWEAVER_TEST_DB_SCHEMA ?? "",
  };
}

export function shouldSkipE2e(): boolean {
  const env = getE2eEnv();
  return !env.baseUrl;
}

export function shouldRunDestructive(): boolean {
  return process.env.E2E_RUN_DESTRUCTIVE === "1";
}

export async function runCli(args: string[]): Promise<{
  code: number;
  stdout: string;
  stderr: string;
}> {
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
