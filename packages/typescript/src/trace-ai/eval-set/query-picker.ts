/**
 * M5 eval-set query picker — two lift functions:
 *   - liftFromQueriesFile(path)   reads `trace-eval-set-input/v1` simplified yaml
 *   - liftFromDiagnosis(dir)      reads M4 diagnose report yamls (added in Task 4)
 *
 * Both return EvalCase[] (without query_id auto-fill — that happens in builder.ts).
 */

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";

import { EvalSetInputSchema } from "./schemas.js";
import { ReportSchema } from "../diagnose/schemas.js";
import type { EvalCase } from "./types.js";

export class QueryPickerError extends Error {
  constructor(message: string, public readonly path?: string) {
    super(message);
    this.name = "QueryPickerError";
  }
}

export async function liftFromQueriesFile(filePath: string): Promise<EvalCase[]> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      throw new QueryPickerError(`file not found: ${filePath}`, filePath);
    }
    throw new QueryPickerError(`failed to read ${filePath}: ${err.message}`, filePath);
  }

  let parsed: unknown;
  try {
    parsed = yaml.load(raw);
  } catch (e) {
    throw new QueryPickerError(
      `failed to parse yaml ${filePath}: ${(e as Error).message}`,
      filePath,
    );
  }

  const result = EvalSetInputSchema.safeParse(parsed);
  if (!result.success) {
    const firstIssue = result.error.issues[0];
    const where = firstIssue.path.join(".");
    throw new QueryPickerError(
      `schema validation failed for ${filePath} at '${where}': ${firstIssue.message}`,
      filePath,
    );
  }

  return result.data.cases.map((c) => ({
    query_id: c.query_id ?? "", // empty → builder.ensureQueryId fills it; undefined would break downstream
    input: c.input,
    reference: c.reference,
    assertions: c.assertions as EvalCase["assertions"],
    tags: c.tags,
  }));
}

export interface LiftFromDiagnosisResult {
  cases: EvalCase[];
  skipped_findings_count: number;
  skipped_findings_summary: string[];
}

/**
 * Read all *.yaml / *.yml files in `dirPath`, validate each as `trace-diagnose-report/v1`,
 * and extract `findings[*].verify_with.suggested_eval_case` as EvalCases.
 *
 * Skips findings where:
 *   - `suggested_eval_case.query` is null (M4 has no user query → can't construct EvalCase.input)
 *   - `suggested_eval_case.assertions` is empty (refinement would fail; no reference either)
 *
 * Lifts:
 *   - `EvalCase.input.user_message = suggested_eval_case.query`
 *   - `EvalCase.query_id = suggested_eval_case.query_id ?? ""` (empty → builder.ensureQueryId fills)
 *   - `EvalCase.assertions` = M4 string templates wrapped as placeholder `contains` assertions
 *     with `_note` flagging "convert to structured manually"
 *   - `EvalCase.reference = undefined` (M4 doesn't emit reference)
 *
 * Files that fail to schema-validate cause a fail-fast error (all *.yaml in dir
 * must be diagnose reports — picker doesn't filter by content).
 */
export async function liftFromDiagnosis(dirPath: string): Promise<LiftFromDiagnosisResult> {
  let entries: string[];
  try {
    entries = await readdir(dirPath);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      throw new QueryPickerError(`directory not found: ${dirPath}`, dirPath);
    }
    throw new QueryPickerError(`failed to read directory ${dirPath}: ${err.message}`, dirPath);
  }

  const yamlFiles = entries
    .filter((e) => e.endsWith(".yaml") || e.endsWith(".yml"))
    .map((e) => path.join(dirPath, e));

  // Accumulate by query_id so multiple findings from the same conversation
  // collapse into one case with merged assertions (avoids intra-batch dup error).
  const byQueryId = new Map<string, EvalCase>();
  let skipped = 0;
  const skippedSummary: string[] = [];

  for (const file of yamlFiles) {
    let raw: string;
    try {
      raw = await readFile(file, "utf8");
    } catch (e) {
      throw new QueryPickerError(`failed to read ${file}: ${(e as Error).message}`, file);
    }

    let parsed: unknown;
    try {
      parsed = yaml.load(raw);
    } catch (e) {
      throw new QueryPickerError(`failed to parse yaml ${file}: ${(e as Error).message}`, file);
    }

    const result = ReportSchema.safeParse(parsed);
    if (!result.success) {
      const firstIssue = result.error.issues[0];
      const where = firstIssue.path.join(".");
      throw new QueryPickerError(
        `schema validation failed for ${file} at '${where}': ${firstIssue.message}`,
        file,
      );
    }

    for (const finding of result.data.findings) {
      const sec = finding.verify_with.suggested_eval_case;
      if (sec.query === null) {
        skipped += 1;
        skippedSummary.push(
          `${path.basename(file)}: rule=${finding.rule_id} (query=null; upgrade M4 trace to populate input.messages)`,
        );
        continue;
      }
      if (sec.assertions.length === 0) {
        skipped += 1;
        skippedSummary.push(
          `${path.basename(file)}: rule=${finding.rule_id} (empty assertions; refinement would fail)`,
        );
        continue;
      }
      const placeholderAssertions = sec.assertions.map((t) => ({
        type: "contains" as const,
        value: t,
        _note: "auto-lifted from M4 assertion template; convert to structured assertion manually",
      }));
      const queryId = sec.query_id ?? "";
      const existing = byQueryId.get(queryId);
      if (existing) {
        existing.assertions = [...(existing.assertions ?? []), ...placeholderAssertions];
      } else {
        byQueryId.set(queryId, {
          query_id: queryId,
          input: { user_message: sec.query },
          reference: undefined,
          assertions: placeholderAssertions,
          tags: undefined,
        });
      }
    }
  }

  return { cases: [...byQueryId.values()], skipped_findings_count: skipped, skipped_findings_summary: skippedSummary };
}
