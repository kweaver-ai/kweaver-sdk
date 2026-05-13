/**
 * M5 eval-set query picker — two lift functions:
 *   - liftFromQueriesFile(path)   reads `trace-eval-set-input/v1` simplified yaml
 *   - liftFromDiagnosis(dir)      reads M4 diagnose report yamls (added in Task 4)
 *
 * Both return EvalCase[] (without query_id auto-fill — that happens in builder.ts).
 */

import { readFile } from "node:fs/promises";
import yaml from "js-yaml";

import { EvalSetInputSchema } from "./schemas.js";
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

// liftFromDiagnosis: implemented in Task 4
