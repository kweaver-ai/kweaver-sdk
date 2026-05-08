import { createInterface } from "node:readline";
import { resolveBusinessDomain } from "../config/store.js";

// ── Shared polling helper with exponential backoff ───────────────────────────

export interface PollOptions<T> {
  fn: () => Promise<{ done: boolean; value: T }>;
  interval: number;
  timeout: number;
  maxInterval?: number;
  _sleep?: (ms: number) => Promise<void>;
}

export async function pollWithBackoff<T>(opts: PollOptions<T>): Promise<T> {
  const { fn, timeout, maxInterval = 15000, _sleep = (ms) => new Promise(r => setTimeout(r, ms)) } = opts;
  let currentInterval = opts.interval;
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const result = await fn();
    if (result.done) return result.value;
    await _sleep(currentInterval);
    currentInterval = Math.min(currentInterval * 2, maxInterval);
  }

  throw new Error(`Polling timed out after ${timeout}ms`);
}

// ── JSON parsing helpers ─────────────────────────────────────────────────────

export function parseJsonObject(text: string, errorMessage: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(errorMessage);
  }

  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error(errorMessage);
  }

  return parsed as Record<string, unknown>;
}

export function parseSearchAfterArray(text: string): unknown[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Invalid value for --search-after. Expected a JSON array string.");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Invalid value for --search-after. Expected a JSON array string.");
  }

  return parsed;
}

// ── Ontology query flag parsing ──────────────────────────────────────────────

/** Parse common flags for ontology-query subcommands; returns { filteredArgs, pretty, businessDomain } */
export function parseOntologyQueryFlags(args: string[]): {
  filteredArgs: string[];
  pretty: boolean;
  businessDomain: string;
} {
  let pretty = true;
  let businessDomain = "";
  const filteredArgs: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      throw new Error("help");
    }
    if (arg === "--pretty") {
      pretty = true;
      continue;
    }
    if ((arg === "-bd" || arg === "--biz-domain") && args[i + 1]) {
      businessDomain = args[i + 1];
      i += 1;
      continue;
    }
    filteredArgs.push(arg);
  }
  if (!businessDomain) businessDomain = resolveBusinessDomain();
  return { filteredArgs, pretty, businessDomain };
}

// ── Schema detection helpers ─────────────────────────────────────────────────

export const DISPLAY_HINTS = ["name", "title", "label", "display_name", "description"];

export interface PkCandidate { name: string; cardinality: number; }

export interface PkDetectionResult {
  /** Detected PK column name, or null when detection is not confident. */
  pk: string | null;
  /** All columns sorted by cardinality desc. Empty when no sample. */
  candidates: PkCandidate[];
  /** 0 when no sample data was provided. */
  sampleSize: number;
}

export const PK_NAME_HINTS = ["id", "_id", "pk"];

/**
 * Detect primary key from a row sample. Returns null pk when no column has
 * unique values across the sample — caller must fail-fast and prompt for --pk-map.
 * Among columns that ARE fully unique, prefers PK-like names (id, *_id, pk).
 */
export function detectPrimaryKey(
  table: { name: string; columns: Array<{ name: string; type: string }> },
  rows?: Array<Record<string, string | null>>,
): PkDetectionResult {
  if (!rows || rows.length === 0) {
    return { pk: null, candidates: [], sampleSize: 0 };
  }

  const candidates: PkCandidate[] = table.columns
    .map((col) => {
      const unique = new Set(rows.map((r) => r[col.name]));
      return { name: col.name, cardinality: unique.size };
    })
    .sort((a, b) => b.cardinality - a.cardinality);

  const fullCardinality = candidates.filter((c) => c.cardinality === rows.length);
  if (fullCardinality.length === 0) {
    return { pk: null, candidates, sampleSize: rows.length };
  }

  const named = fullCardinality.find((c) => {
    const lower = c.name.toLowerCase();
    return PK_NAME_HINTS.some((h) => lower === h || lower.endsWith(`_${h}`));
  });

  return {
    pk: named?.name ?? fullCardinality[0]!.name,
    candidates,
    sampleSize: rows.length,
  };
}

export interface PkResolution {
  /** Resolved PK column name, or null when caller must fail-fast. */
  pk: string | null;
  /** Origin of the resolution — used by callers for messaging and warnings. */
  source: "override" | "schema" | "sample" | "ambiguous";
  /** For 'sample' source: cardinality candidates from `detectPrimaryKey`. */
  candidates?: PkCandidate[];
  /** For 'sample' source: rows seen, propagated for error formatting. */
  sampleSize?: number;
  /** For 'ambiguous' source: schema-declared composite PK columns. */
  ambiguous?: string[];
}

/**
 * Resolve a single PK for a BKN object type, in priority order:
 *   1. caller-provided override (e.g. --pk-map)
 *   2. schema-declared single PK from datasource metadata
 *   3. sample-based detection (CSV / schemaless sources)
 * Composite SQL PKs intentionally surface as `source: "ambiguous"` — BKN
 * object types take a single PK, so the caller must pick via --pk-map.
 */
export function resolvePrimaryKey(
  table: {
    name: string;
    columns: Array<{ name: string; type: string; isPrimaryKey?: boolean }>;
    primaryKeys?: string[];
  },
  sampleRows?: Array<Record<string, string | null>>,
  override?: string | null,
): PkResolution {
  if (override) {
    return { pk: override, source: "override" };
  }

  const schemaPks = collectSchemaPks(table);
  if (schemaPks.length === 1) {
    return { pk: schemaPks[0]!, source: "schema" };
  }
  if (schemaPks.length > 1) {
    return { pk: null, source: "ambiguous", ambiguous: schemaPks };
  }

  const sample = detectPrimaryKey(table, sampleRows);
  return {
    pk: sample.pk,
    source: "sample",
    candidates: sample.candidates,
    sampleSize: sample.sampleSize,
  };
}

function collectSchemaPks(table: {
  columns: Array<{ name: string; isPrimaryKey?: boolean }>;
  primaryKeys?: string[];
}): string[] {
  // Filter against the actual column list — schema metadata can drift (stale
  // catalog, post-rename) and an unusable PK should fall through cleanly to
  // sample/fail rather than poison downstream object-type creation.
  const colNames = new Set(table.columns.map((c) => c.name));
  if (Array.isArray(table.primaryKeys) && table.primaryKeys.length > 0) {
    return table.primaryKeys.filter((n) => colNames.has(n));
  }
  return table.columns.filter((c) => c.isPrimaryKey === true).map((c) => c.name);
}

/** Format a user-facing error message when PK auto-detection fails. */
export function formatPkDetectionError(tableName: string, result: PkDetectionResult): string {
  const lines = [`Cannot auto-detect primary key for table '${tableName}'.`];

  if (result.sampleSize === 0) {
    lines.push(
      `  No sample data available — chain with 'kweaver ds import-csv' or use --pk-map.`
    );
  } else {
    lines.push(`  No column has unique values in the ${result.sampleSize}-row sample.`);
    lines.push(`  Top candidates by cardinality:`);
    const top = result.candidates.slice(0, 5);
    const maxNameLen = Math.max(...top.map((c) => c.name.length));
    for (const c of top) {
      lines.push(`    ${c.name.padEnd(maxNameLen)}  ${c.cardinality} unique`);
    }
  }

  lines.push(``);
  lines.push(`  Re-run with --pk-map to specify explicitly:`);
  lines.push(`    --pk-map ${tableName}:<column>`);
  return lines.join("\n");
}

/**
 * Parse --pk-map string into a Record<table, field>.
 * Format: "<table>:<field>[,<table>:<field>...]". Throws on invalid input.
 */
export function parsePkMap(input: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const pair of input.split(",").map((s) => s.trim()).filter(Boolean)) {
    const idx = pair.indexOf(":");
    if (idx <= 0 || idx >= pair.length - 1) {
      throw new Error(
        `Invalid --pk-map entry '${pair}'. Expected '<table>:<field>[,<table>:<field>...]'`
      );
    }
    const table = pair.slice(0, idx).trim();
    const field = pair.slice(idx + 1).trim();
    if (!table || !field) {
      throw new Error(
        `Invalid --pk-map entry '${pair}'. Expected '<table>:<field>[,<table>:<field>...]'`
      );
    }
    result[table] = field;
  }
  return result;
}

export function detectDisplayKey(
  table: { name: string; columns: Array<{ name: string; type: string }> },
  primaryKey: string
): string {
  for (const col of table.columns) {
    if (DISPLAY_HINTS.some((h) => col.name.toLowerCase().includes(h))) {
      return col.name;
    }
  }
  return primaryKey;
}

// ── Vega catalog id guard ────────────────────────────────────────────────────

const UUID_V4_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Reject legacy data-connection datasource UUIDs.
 *
 * Since the SDK migration to vega-backend (#114), commands that call
 * `listTablesWithColumns` / `scanMetadata` expect a vega catalog id (a short
 * slug like `d7nicrcjto2s73d9g67g`), not the UUID-shaped id stored in
 * data-connection.
 */
export function assertVegaCatalogId(id: string): void {
  if (UUID_V4_RE.test(id)) {
    throw new Error(
      `expected a vega catalog id, got UUID '${id}'. ` +
      `This looks like a legacy data-connection datasource UUID. ` +
      `Run \`kweaver vega catalog list --keyword <name>\` to find the corresponding catalog id.`,
    );
  }
}

// ── Interactive confirmation ─────────────────────────────────────────────────

export function confirmYes(prompt: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${prompt} [y/N] `, (answer) => {
      rl.close();
      const trimmed = answer.trim().toLowerCase();
      resolve(trimmed === "y" || trimmed === "yes");
    });
  });
}
