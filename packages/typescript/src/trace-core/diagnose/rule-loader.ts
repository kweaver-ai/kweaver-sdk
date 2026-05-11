import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";

import { RuleSchema } from "./schemas.js";
import { resolvePredicate } from "./predicate-registry.js";
import type { Rule } from "./types.js";

export class RuleLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuleLoadError";
  }
}

export interface LoadRulesOpts {
  builtinDir: string | null;
  cwdRulesDir: string | null;
  extraRulesDir: string | null;
  noBuiltin: boolean;
}

async function listYamls(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && (e.name.endsWith(".yaml") || e.name.endsWith(".yml")))
      .map((e) => path.join(dir, e.name));
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

async function parseOne(filePath: string): Promise<Rule> {
  const raw = await fs.readFile(filePath, "utf8");
  let parsed: unknown;
  try {
    parsed = yaml.load(raw);
  } catch (e) {
    throw new RuleLoadError(`yaml parse error in ${filePath}: ${(e as Error).message}`);
  }
  const result = RuleSchema.safeParse(parsed);
  if (!result.success) {
    throw new RuleLoadError(`schema validation failed for ${filePath}: ${result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  const r = result.data;
  if (!r.predicate) {
    throw new RuleLoadError(`PR-A only supports symbolic rules; ${filePath} has no predicate`);
  }
  // resolvePredicate throws PredicateNotFoundError; rewrap for uniform caller experience.
  try {
    resolvePredicate(r.predicate);
  } catch (e) {
    throw new RuleLoadError(`${filePath}: ${(e as Error).message}`);
  }
  return {
    schemaVersion: r.schema_version,
    id: r.id,
    severity: r.severity,
    symptom: r.symptom,
    taxonomy: { signalsAxis: r.taxonomy.signals_axis, msClass: r.taxonomy.ms_class },
    suggestedFix: { target: r.suggested_fix.target, changeTemplate: r.suggested_fix.change_template },
    verifyWith: { assertionTemplates: r.verify_with.assertion_templates },
    predicateRef: r.predicate,
    params: r.params,
    sourcePath: filePath,
  };
}

export async function loadRules(opts: LoadRulesOpts): Promise<Rule[]> {
  const dirs: string[] = [];
  if (opts.builtinDir && !opts.noBuiltin) dirs.push(opts.builtinDir);
  if (opts.cwdRulesDir) dirs.push(opts.cwdRulesDir);
  if (opts.extraRulesDir) dirs.push(opts.extraRulesDir);

  const seenIds = new Map<string, string>();   // id → first path
  const rules: Rule[] = [];

  for (const dir of dirs) {
    const yamls = await listYamls(dir);
    for (const f of yamls) {
      const r = await parseOne(f);
      const prev = seenIds.get(r.id);
      if (prev) {
        throw new RuleLoadError(
          `rule id conflict for '${r.id}': defined in both ${prev} and ${f}`,
        );
      }
      seenIds.set(r.id, f);
      rules.push(r);
    }
  }
  return rules;
}
