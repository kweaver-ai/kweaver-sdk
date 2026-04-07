/**
 * E2E test setup for KWeaver TS CLI against a real KWeaver environment.
 *
 * - Auto-loads ~/.env.secrets into process.env
 * - Provides runCli() to capture stdout/stderr from CLI
 * - Skip logic: tests require KWEAVER_BASE_URL
 * - Destructive tests gated by E2E_RUN_DESTRUCTIVE=1
 *
 * Token refresh is handled by the `ensure-token.ts` pretest script
 * (run once before `node --test`, not per test file).
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { run } from "../../src/cli.js";
import { setCurrentPlatform } from "../../src/config/store.js";
import { normalizeBaseUrl } from "../../src/auth/oauth.js";

/** Find repo root by walking up from this file looking for .git */
function findRepoRoot(): string | null {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i += 1) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const REPO_ROOT = findRepoRoot();
const LOCAL_ENV_PATH = REPO_ROOT ? join(REPO_ROOT, ".env.e2e") : null;
const GLOBAL_ENV_PATH = join(homedir(), ".env.secrets");

function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  const content = readFileSync(path, "utf-8");
  for (const line of content.split(/\r?\n/)) {
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

// Local .env.e2e takes priority, then global ~/.env.secrets as fallback
if (LOCAL_ENV_PATH) loadEnvFile(LOCAL_ENV_PATH);
loadEnvFile(GLOBAL_ENV_PATH);

// Remove stale KWEAVER_TOKEN from env so CLI commands fall back to
// ~/.kweaver/ config which supports auto-refresh via ensureValidToken().
// KWEAVER_BASE_URL is kept — it's used by shouldSkipE2e() to detect
// whether an e2e environment is configured at all.
delete process.env.KWEAVER_TOKEN;

// Ensure CLI targets the e2e platform (set by ensure-token.ts pretest script)
const _baseUrl = process.env.KWEAVER_BASE_URL;
if (_baseUrl) {
  setCurrentPlatform(normalizeBaseUrl(_baseUrl));
}

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

/** Extract array entries from CLI JSON output (handles entries/data/datas/array). */
export function extractCliJsonEntries(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    for (const key of ["entries", "data", "datas", "records"]) {
      if (Array.isArray(obj[key])) return obj[key] as unknown[];
    }
  }
  return [];
}

export interface FirstObjectTypeQueryResult {
  knId: string;
  otId: string;
  stdout: string;
}

/**
 * Find the first (KN, OT) pair for which `bkn object-type query` exits 0.
 * Schema-only OTs without indexed instances often return HTTP errors — this scans up to maxKn KNs with OTs.
 */
export async function findFirstSuccessfulObjectTypeQuery(options?: {
  maxKn?: number;
  maxOtPerKn?: number;
}): Promise<FirstObjectTypeQueryResult | null> {
  const maxKn = options?.maxKn ?? 20;
  const maxOtPerKn = options?.maxOtPerKn ?? 15;
  const { code, stdout } = await runCli(["bkn", "list", "--limit", String(Math.max(maxKn, 5))]);
  if (code !== 0) return null;
  let kns: unknown[];
  try {
    kns = extractCliJsonEntries(JSON.parse(stdout));
  } catch {
    return null;
  }
  let knProcessed = 0;
  for (const item of kns as Array<{ id?: string }>) {
    if (!item.id) continue;
    if (knProcessed >= maxKn) break;
    knProcessed += 1;
    const knId = item.id;
    const { code: otCode, stdout: otOut } = await runCli(["bkn", "object-type", "list", knId]);
    if (otCode !== 0) continue;
    let ots: unknown[];
    try {
      ots = extractCliJsonEntries(JSON.parse(otOut));
    } catch {
      continue;
    }
    let otCount = 0;
    for (const ot of ots as Array<{ id?: string }>) {
      if (otCount >= maxOtPerKn) break;
      otCount += 1;
      const otId = ot.id;
      if (!otId) continue;
      const { code: qCode, stdout: qOut } = await runCli([
        "bkn",
        "object-type",
        "query",
        knId,
        otId,
        "{}",
        "--limit",
        "5",
      ]);
      if (qCode === 0) return { knId, otId, stdout: qOut };
    }
  }
  return null;
}
