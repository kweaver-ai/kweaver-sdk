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
