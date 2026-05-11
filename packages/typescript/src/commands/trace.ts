import yargs from "yargs";

import { diagnose, TraceNotFoundError } from "../trace-core/diagnose/index.js";
import { RuleLoadError } from "../trace-core/diagnose/rule-loader.js";
import { RuleProbeError } from "../trace-core/diagnose/signal-probe.js";
import { RuleSchema } from "../trace-core/diagnose/schemas.js";
import yaml from "js-yaml";
import fs from "node:fs/promises";

export interface ParsedTraceArgs {
  subcommand: "diagnose" | "rules-validate" | "help";
  traceId?: string;
  rulePath?: string;
  out: string | null;
  rulesDir: string | null;
  noBuiltin: boolean;
  noLlm: boolean;
  baseUrl: string | null;
  token: string | null;
  businessDomain: string | null;
}

export function parseTraceArgs(argv: string[]): ParsedTraceArgs {
  if (argv.length === 0) {
    return defaults("help");
  }
  const head = argv[0];
  if (head !== "diagnose") {
    return defaults("help");
  }
  if (argv[1] === "rules" && argv[2] === "validate") {
    return { ...defaults("rules-validate"), rulePath: argv[3] };
  }
  // diagnose <traceId> [flags...]
  const parsed = yargs(argv.slice(1))
    .option("out", { type: "string", default: undefined })
    .option("rules", { type: "string", default: undefined })
    .option("builtin", { type: "boolean", default: true })  // --no-builtin sets this to false
    .option("llm", { type: "boolean", default: false })  // PR-A: forced false (--no-llm)
    .option("token", { type: "string" })
    .option("base-url", { type: "string" })
    .option("business-domain", { alias: "bd", type: "string" })
    .help(false)
    .parseSync();

  return {
    subcommand: "diagnose",
    traceId: String(parsed._[0] ?? ""),
    out: parsed.out ?? null,
    rulesDir: parsed.rules ?? null,
    noBuiltin: !(parsed.builtin as boolean),
    noLlm: !(parsed.llm as boolean),
    baseUrl: (parsed.baseUrl as string | undefined) ?? null,
    token: (parsed.token as string | undefined) ?? null,
    businessDomain: (parsed.businessDomain as string | undefined) ?? null,
  };
}

function defaults(sub: ParsedTraceArgs["subcommand"]): ParsedTraceArgs {
  return {
    subcommand: sub,
    out: null,
    rulesDir: null,
    noBuiltin: false,
    noLlm: true,
    baseUrl: null,
    token: null,
    businessDomain: null,
  };
}

function printHelp(): void {
  process.stdout.write(`kweaver trace — trace diagnosis commands

Subcommands:
  trace diagnose <trace_id>                   Diagnose a single trace; emit YAML report
    --out <file>                              Write report to file (default: stdout)
    --rules <dir>                             Override <cwd>/diagnosis-rules/
    --no-builtin                              Disable the 5 builtin baseline rules
    --no-llm                                  PR-A: always on; PR-B will allow disabling

  trace diagnose rules validate <rule.yaml>   Validate a rule yaml file (exit 0 ok, 6 fail)

Auth flags (any subcommand): --token, --base-url, --business-domain (-bd).
`);
}

export async function runTraceCommand(rest: string[]): Promise<number> {
  const args = parseTraceArgs(rest);
  if (args.subcommand === "help") {
    printHelp();
    return 0;
  }
  if (args.subcommand === "rules-validate") {
    return await runRulesValidate(args.rulePath ?? "");
  }
  // diagnose
  if (!args.traceId) {
    process.stderr.write("error: missing <trace_id>\n");
    return 2;
  }
  const baseUrl = args.baseUrl ?? process.env.KWEAVER_BASE_URL ?? "";
  const token = args.token ?? process.env.KWEAVER_TOKEN ?? "";
  const bd = args.businessDomain ?? "bd_public";
  if (!baseUrl || !token) {
    process.stderr.write("error: missing --base-url / --token (or KWEAVER_BASE_URL / KWEAVER_TOKEN env)\n");
    return 5;
  }
  try {
    await diagnose(args.traceId, {
      out: args.out,
      rulesDir: args.rulesDir,
      noBuiltin: args.noBuiltin,
      noLlm: true,
      agentProvider: null,
      timeoutMs: 60000,
      baseUrl,
      token,
      businessDomain: bd,
    });
    return 0;
  } catch (e) {
    if (e instanceof TraceNotFoundError) {
      process.stderr.write(`error: ${e.message}; check time window / tenant\n`);
      return 4;
    }
    if (e instanceof RuleLoadError) {
      process.stderr.write(`error: ${e.message}\n`);
      return 6;
    }
    if (e instanceof RuleProbeError) {
      process.stderr.write(`error: ${e.message}\n`);
      return 6;
    }
    process.stderr.write(`error: ${(e as Error).message}\n`);
    return 1;
  }
}

async function runRulesValidate(rulePath: string): Promise<number> {
  if (!rulePath) {
    process.stderr.write("error: missing <rule.yaml> path\n");
    return 2;
  }
  let raw: string;
  try {
    raw = await fs.readFile(rulePath, "utf8");
  } catch (e) {
    process.stderr.write(`error: cannot read ${rulePath}: ${(e as Error).message}\n`);
    return 6;
  }
  let parsed: unknown;
  try {
    parsed = yaml.load(raw);
  } catch (e) {
    process.stderr.write(`error: yaml parse error: ${(e as Error).message}\n`);
    return 6;
  }
  const result = RuleSchema.safeParse(parsed);
  if (!result.success) {
    process.stderr.write(`error: schema validation failed:\n${result.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n")}\n`);
    return 6;
  }
  process.stdout.write(`ok: ${rulePath} validates against diagnosis-rule/v1\n`);
  return 0;
}
