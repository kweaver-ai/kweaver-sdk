/**
 * M5 eval-set builder — orchestrates build:
 *   picker → ensureQueryId → redact → write (with conflict resolution) → validate
 *
 * `ensureQueryId` is the deterministic hash-based ID generator (inline here,
 * not a separate file — spec doc §9 "反过度工程" decision).
 */

import { createHash } from "node:crypto";

import type { BuildResult, EvalCase } from "./types.js";
import { liftFromQueriesFile, liftFromDiagnosis, QueryPickerError } from "./query-picker.js";
import { loadRules, applyRules, RedactorError } from "./redactor.js";
import { writeEvalSet, WriterError, type ConflictStrategy } from "./output-writer.js";

export class BuilderError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = "BuilderError";
  }
}

export type BuildSource =
  | { kind: "diagnosis"; path: string }
  | { kind: "queries"; path: string };

export interface BuildOpts {
  source: BuildSource;
  outDir: string;
  evalSetId: string;
  onConflict: ConflictStrategy;
  /** From `--redaction-rules=<path>` */
  redactionRulesCliFlag: string | undefined;
  /** From CWD: usually `path.join(process.cwd(), "redaction-rules")` — caller passes resolved path */
  repoDir: string | undefined;
}

/**
 * Canonical JSON serialization for hashing — keys sorted, no whitespace.
 * Ensures hash(case) is stable across runs.
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(obj[k])).join(",") + "}";
}

export function ensureQueryId(c: { query_id: string; input: unknown; tags?: string[] }): string {
  if (c.query_id && c.query_id.length > 0) return c.query_id;
  const seed = canonicalJson({ input: c.input, tags: c.tags ?? [] });
  return createHash("sha256").update(seed).digest("hex").slice(0, 12);
}

function redactCase(c: EvalCase, applyFn: (s: string) => string): EvalCase {
  const redacted: EvalCase = {
    query_id: c.query_id,
    input: { user_message: applyFn(c.input.user_message) },
    tags: c.tags,
  };
  if (c.reference) {
    redacted.reference = { answer: applyFn(c.reference.answer) };
  }
  if (c.assertions) {
    redacted.assertions = c.assertions; // assertions strings (regex / value) intentionally NOT redacted
                                        // — they are user-authored test expectations, not raw PII
  }
  return redacted;
}

export async function build(opts: BuildOpts): Promise<BuildResult> {
  // Stage 1: pick cases
  let lifted: EvalCase[];
  let skippedFindingsCount = 0;
  try {
    if (opts.source.kind === "queries") {
      lifted = await liftFromQueriesFile(opts.source.path);
    } else {
      const r = await liftFromDiagnosis(opts.source.path);
      lifted = r.cases;
      skippedFindingsCount = r.skipped_findings_count;
    }
  } catch (e) {
    if (e instanceof QueryPickerError) {
      throw new BuilderError(`picker failed: ${e.message}`, e);
    }
    throw e;
  }

  // Stage 2: ensure query_id
  const withIds = lifted.map((c) => ({ ...c, query_id: ensureQueryId(c) }));

  // Stage 3: redact
  let rulesResult;
  try {
    rulesResult = await loadRules({
      cliFlag: opts.redactionRulesCliFlag,
      repoDir: opts.repoDir,
    });
  } catch (e) {
    if (e instanceof RedactorError) {
      throw new BuilderError(`redactor failed: ${e.message}`, e);
    }
    throw e;
  }
  const apply = (s: string) => applyRules(s, rulesResult.rules);
  const redacted = withIds.map((c) => redactCase(c, apply));

  // Stage 4: write + conflict + validate
  let writeRes;
  try {
    writeRes = await writeEvalSet({
      outDir: opts.outDir,
      evalSetId: opts.evalSetId,
      newCases: redacted,
      onConflict: opts.onConflict,
    });
  } catch (e) {
    if (e instanceof WriterError) {
      throw new BuilderError(`writer failed: ${e.message}`, e);
    }
    throw e;
  }

  return {
    cases_written: writeRes.cases_written,
    cases_skipped: writeRes.cases_skipped + skippedFindingsCount,
    conflicts: writeRes.conflicts,
    shard_paths: writeRes.shard_paths,
    redaction_rules_source: rulesResult.source,
  };
}
