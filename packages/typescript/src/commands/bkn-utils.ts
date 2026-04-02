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

/** Detect primary key: first column (left-to-right) with all unique values in the sample. */
export function detectPrimaryKey(
  table: { name: string; columns: Array<{ name: string; type: string }> },
  rows?: Array<Record<string, string | null>>,
): string {
  if (rows && rows.length > 0) {
    for (const col of table.columns) {
      const values = rows.map((r) => r[col.name]);
      const unique = new Set(values);
      if (unique.size === rows.length) return col.name;
    }
  }
  // Fallback: first column
  return table.columns[0]?.name ?? "id";
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
