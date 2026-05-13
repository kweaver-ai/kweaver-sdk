/**
 * M5 eval-set redactor — PII pattern matching + replacement.
 *
 * Three rule sources, in priority order (chain):
 *   1. --redaction-rules=<path>      (CLI flag, highest)
 *   2. <repo>/redaction-rules/*.yaml (repo-local)
 *   3. BUILTIN_RULES                 (5 low-fidelity defaults)
 *
 * Builtin rules cover common Chinese-context PII: phone / email / id_card /
 * bank_card / ip. Organizations write more rules in <repo>/redaction-rules/
 * for their business-specific patterns.
 *
 * Rule yaml format:
 *   rules:
 *     - name: <id>
 *       pattern: <regex source string>
 *       replace: <replacement template; supports {hash6} placeholder>
 *
 * Malformed regex causes loadRules to throw RedactorError (no silent fallback).
 */

import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import yaml from "js-yaml";

import type { RedactionRule } from "./types.js";

export class RedactorError extends Error {
  constructor(message: string, public readonly path?: string) {
    super(message);
    this.name = "RedactorError";
  }
}

/**
 * 5 builtin low-fidelity PII patterns. Tuned for Chinese-context defaults;
 * organizations override with their own rules in <repo>/redaction-rules/.
 */
export const BUILTIN_RULES: RedactionRule[] = [
  {
    name: "phone",
    pattern: /1[3-9]\d{9}/g,
    replace: "<phone:{hash6}>",
  },
  {
    name: "email",
    pattern: /[\w.+-]+@[\w.-]+\.\w+/g,
    replace: "<email:{hash6}>",
  },
  {
    name: "id_card",
    pattern: /\b\d{17}[\dXx]\b/g,
    replace: "<id_card:{hash6}>",
  },
  {
    name: "bank_card",
    pattern: /\b\d{15,19}\b/g, // 银行卡号长度 15-19 位
    replace: "<bank_card:{hash6}>",
  },
  {
    name: "ip",
    pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    replace: "<ip:{hash6}>",
  },
];

export interface LoadRulesOpts {
  /** From `--redaction-rules=<path>`; highest priority */
  cliFlag: string | undefined;
  /** From `<repo>/redaction-rules/` (resolved by caller — usually `path.join(repoRoot, "redaction-rules")`) */
  repoDir: string | undefined;
}

export interface LoadRulesResult {
  rules: RedactionRule[];
  source: "cli-flag" | "repo" | "builtin";
}

interface RuleYamlEntry {
  name: string;
  pattern: string;
  replace: string;
}

interface RuleYamlFile {
  rules: RuleYamlEntry[];
}

function compileRule(entry: RuleYamlEntry, srcPath: string): RedactionRule {
  let pattern: RegExp;
  try {
    pattern = new RegExp(entry.pattern, "g");
  } catch (e) {
    throw new RedactorError(
      `invalid regex in rule '${entry.name}' at ${srcPath}: ${(e as Error).message}`,
      srcPath,
    );
  }
  return { name: entry.name, pattern, replace: entry.replace };
}

async function readRulesFile(filePath: string): Promise<RedactionRule[]> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (e) {
    throw new RedactorError(
      `failed to read rule file ${filePath}: ${(e as Error).message}`,
      filePath,
    );
  }
  let parsed: unknown;
  try {
    parsed = yaml.load(raw);
  } catch (e) {
    throw new RedactorError(
      `failed to parse yaml ${filePath}: ${(e as Error).message}`,
      filePath,
    );
  }
  const doc = parsed as RuleYamlFile;
  if (!doc || !Array.isArray(doc.rules)) {
    throw new RedactorError(`rule file ${filePath} must have top-level 'rules: []'`, filePath);
  }
  return doc.rules.map((e) => compileRule(e, filePath));
}

export async function loadRules(opts: LoadRulesOpts): Promise<LoadRulesResult> {
  if (opts.cliFlag) {
    const rules = await readRulesFile(opts.cliFlag);
    return { rules, source: "cli-flag" };
  }
  if (opts.repoDir) {
    let stats;
    try {
      stats = await stat(opts.repoDir);
    } catch {
      stats = null;
    }
    if (stats && stats.isDirectory()) {
      const entries = await readdir(opts.repoDir);
      const yamlFiles = entries
        .filter((e) => e.endsWith(".yaml") || e.endsWith(".yml"))
        .map((e) => path.join(opts.repoDir!, e));
      if (yamlFiles.length > 0) {
        const allRules: RedactionRule[] = [];
        for (const f of yamlFiles) {
          allRules.push(...(await readRulesFile(f)));
        }
        return { rules: allRules, source: "repo" };
      }
    }
  }
  return { rules: BUILTIN_RULES, source: "builtin" };
}

function hash6(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 6);
}

export function applyRules(text: string, rules: RedactionRule[]): string {
  let out = text;
  for (const rule of rules) {
    out = out.replace(rule.pattern, (match) =>
      rule.replace.replace("{hash6}", hash6(match)),
    );
  }
  return out;
}
