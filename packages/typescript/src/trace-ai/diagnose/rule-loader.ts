import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";

import { RuleSchema } from "./schemas.js";
import { resolvePredicate } from "./predicate-registry.js";
import { rubricOutputToZod, OutputSchemaConversionError } from "./output-schema-converter.js";
import type { Rule, RubricSpec } from "./types.js";

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

  let predicateRef: string | null = null;
  let rubric: RubricSpec | null = null;

  if (r.predicate) {
    // resolvePredicate throws PredicateNotFoundError; rewrap for uniform caller experience.
    try {
      resolvePredicate(r.predicate);
    } catch (e) {
      throw new RuleLoadError(`${filePath}: ${(e as Error).message}`);
    }
    predicateRef = r.predicate;
  } else if (r.rubric) {
    // Compile output_schema → zod at load time so authors see schema errors
    // up-front via `trace diagnose rules validate <path>`, not at LLM call time.
    let outputZodSchema;
    try {
      outputZodSchema = rubricOutputToZod(r.rubric);
    } catch (e) {
      if (e instanceof OutputSchemaConversionError) {
        throw new RuleLoadError(`${filePath}: rubric.output_schema: ${e.message}`);
      }
      throw e;
    }
    rubric = {
      judgeQuestion: r.rubric.judge_question,
      inputs: r.rubric.inputs.map((i) => ({ kind: i.kind, source: i.source })),
      outputSchemaRaw: r.rubric.output_schema as unknown as Record<string, unknown>,
      outputZodSchema,
      agentBinding: {
        provider: r.rubric.agent_binding.provider,
        promptTemplateRef: r.rubric.agent_binding.prompt_template_ref,
      },
    };
  } else {
    // RuleSchema's XOR refinement should have already caught this; keep an
    // explicit branch so the failure mode is obvious if schemas drift.
    throw new RuleLoadError(`${filePath}: rule has neither predicate nor rubric`);
  }

  return {
    schemaVersion: r.schema_version,
    id: r.id,
    severity: r.severity,
    symptom: r.symptom,
    taxonomy: { signalsAxis: r.taxonomy.signals_axis, msClass: r.taxonomy.ms_class },
    suggestedFix: { target: r.suggested_fix.target, changeTemplate: r.suggested_fix.change_template },
    verifyWith: { assertionTemplates: r.verify_with.assertion_templates },
    predicateRef,
    rubric,
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
