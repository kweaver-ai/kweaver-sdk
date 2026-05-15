import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import yargs from "yargs";

import { derivePaths, diagnose, TraceNotFoundError } from "../trace-ai/diagnose/index.js";
import { RuleLoadError } from "../trace-ai/diagnose/rule-loader.js";
import { RuleProbeError } from "../trace-ai/diagnose/signal-probe.js";
import { RuleSchema } from "../trace-ai/diagnose/schemas.js";
import { ensureValidToken } from "../auth/oauth.js";
import { defaultRegistry } from "../agent-providers/registry.js";
import { PromptTemplateRegistry } from "../agent-providers/prompt-template.js";
import { ClaudeCodeSubprocessProvider } from "../agent-providers/providers/claude-code-subprocess.js";
import { runBatch } from "../trace-ai/scan/index.js";
import { parseTracesList, TracesListError } from "../trace-ai/scan/traces-list-parser.js";
import { SingleAgentValidationError } from "../trace-ai/scan/single-agent-validator.js";
import { build, BuilderError } from "../trace-ai/eval-set/index.js";
import { run as runEvalSetTest } from "../trace-ai/eval-set/test-runner.js";
import { createBuiltinSemanticMatchProvider } from "../trace-ai/eval-set/semantic-match-provider.js";
import type { SemanticMatchProvider } from "../trace-ai/eval-set/assertion-evaluator.js";
import { fetchAgentInfo, sendChatRequest } from "../api/agent-chat.js";
import { getTracesByConversation } from "../api/conversations.js";
import {
  EvalSetIndexSchema,
  EvalSetShardSchema,
  EvalSetInputSchema,
  TestReportSchema,
} from "../trace-ai/eval-set/schemas.js";
import yaml from "js-yaml";
import fs from "node:fs/promises";
import { runExpCommand } from "../trace-ai/exp/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVAL_SET_RUBRIC_DIR = path.join(__dirname, "..", "trace-ai", "eval-set", "rubric-templates");

function resolveClaudeBinary(): string {
  if (process.env["CLAUDE_BIN"]) return process.env["CLAUDE_BIN"];
  try {
    const resolved = execSync("which claude", { encoding: "utf8", timeout: 3000 }).trim();
    if (resolved && !resolved.includes(" ")) return resolved;
  } catch { /* fall through */ }
  for (const p of ["/Users/" + (process.env["USER"] ?? "") + "/.local/bin/claude", "/opt/homebrew/bin/claude", "/usr/local/bin/claude"]) {
    try { execSync(`test -x "${p}"`, { timeout: 1000 }); return p; } catch { /* try next */ }
  }
  return "claude";
}

/** Register the default agent provider once per CLI process. Idempotent. */
function ensureDefaultProviderRegistered(): void {
  if (defaultRegistry.has("claude-code")) return;
  defaultRegistry.register(new ClaudeCodeSubprocessProvider({
    binary: resolveClaudeBinary(),
    defaultTimeoutMs: 120_000,
  }), { setAsDefault: true });
}

export interface ParsedTraceArgs {
  subcommand: "diagnose" | "rules-validate" | "eval-set-build" | "eval-set-test" | "schema-validate" | "help";
  mode?: "single" | "batch";
  conversationId?: string;       // single mode
  traces?: string;               // batch mode raw value (string or "@path") — resolved at runtime
  rulePath?: string;
  out: string | null;
  rulesDir: string | null;
  noBuiltin: boolean;
  noLlm: boolean;
  noArtifacts: boolean;
  maxParallel: number;
  format: 'yaml' | 'markdown' | 'both' | null;
  lang: 'en' | 'zh' | null;
  baseUrl: string | null;
  token: string | null;
  businessDomain: string | null;
  // ── M5 PR-A 新增字段 ────────────────────────────────────────────────
  queriesPath?: string;
  diagnosisPath?: string;
  onConflict?: "fail" | "skip" | "overwrite";
  redactionRules?: string;
  evalSetId?: string;
  // Task 9 schema validate
  schemaValidatePath?: string;
  schemaKind?: string;
  // M5 PR-B eval-set test
  evalSetPath?: string;
  candidateAgentId?: string;
  candidateAgentVersion?: string;
}

export function parseTraceArgs(argv: string[]): ParsedTraceArgs {
  if (argv.length === 0) {
    return defaults("help");
  }
  const head = argv[0];
  if (head !== "diagnose" && head !== "eval-set" && head !== "schema") {
    return defaults("help");
  }
  if (argv[1] === "rules" && argv[2] === "validate") {
    return { ...defaults("rules-validate"), rulePath: argv[3] };
  }
  // M5 PR-A: eval-set build
  if (head === "eval-set" && argv[1] === "build") {
    const parsed = yargs(argv.slice(2))
      .option("queries", { type: "string", default: undefined })
      .option("diagnosis", { type: "string", default: undefined })
      .option("out", { type: "string", default: undefined })
      .option("on-conflict", {
        type: "string",
        choices: ["fail", "skip", "overwrite"],
        default: "fail",
      })
      .option("redaction-rules", { type: "string", default: undefined })
      .option("eval-set-id", { type: "string", default: undefined })
      .help(false)
      .parseSync();
    return {
      ...defaults("eval-set-build"),
      queriesPath: parsed.queries as string | undefined,
      diagnosisPath: parsed.diagnosis as string | undefined,
      out: (parsed.out as string | undefined) ?? null,
      onConflict: parsed["on-conflict"] as "fail" | "skip" | "overwrite",
      redactionRules: parsed["redaction-rules"] as string | undefined,
      evalSetId: parsed["eval-set-id"] as string | undefined,
    };
  }
  // M5 PR-B: eval-set test
  if (head === "eval-set" && argv[1] === "test") {
    const parsed = yargs(argv.slice(2))
      .option("candidate", { type: "string", default: undefined })
      .option("out", { type: "string", default: undefined })
      .option("max-parallel", { type: "number", default: 4 })
      .option("lang", { type: "string", default: undefined })
      .help(false)
      .parseSync();
    const candidateRaw = (parsed.candidate as string | undefined) ?? "";
    const atIdx = candidateRaw.indexOf("@");
    const candidateAgentId = atIdx >= 0 ? candidateRaw.slice(0, atIdx) : candidateRaw;
    const candidateAgentVersion = atIdx >= 0 ? candidateRaw.slice(atIdx + 1) : undefined;
    return {
      ...defaults("eval-set-test"),
      evalSetPath: String(parsed._[0] ?? ""),
      candidateAgentId,
      candidateAgentVersion,
      out: (parsed.out as string | undefined) ?? null,
      maxParallel: parsed["max-parallel"] as number,
      lang: (parsed.lang as "en" | "zh" | undefined) ?? null,
    };
  }
  // M5 PR-A: schema validate
  if (head === "schema" && argv[1] === "validate") {
    const parsed = yargs(argv.slice(2))
      .option("kind", { type: "string", default: undefined })
      .help(false)
      .parseSync();
    return {
      ...defaults("schema-validate"),
      schemaValidatePath: String(parsed._[0] ?? ""),
      schemaKind: parsed.kind as string | undefined,
    };
  }
  // diagnose [<conversation_id>] [flags...]
  const parsed = yargs(argv.slice(1))
    .option("out", { type: "string", default: undefined })
    .option("rules", { type: "string", default: undefined })
    .option("builtin", { type: "boolean", default: true })    // --no-builtin sets this to false
    .option("llm", { type: "boolean", default: true })        // --no-llm sets this to false (PR-B reversal)
    .option("artifacts", { type: "boolean", default: true }) // --no-artifacts sets this to false
    .option("traces", { type: "string", default: undefined })
    .option("max-parallel", { type: "number", default: 4 })
    .option("format", { type: "string", choices: ["yaml", "markdown", "both"], default: undefined })
    .option("lang", { type: "string", choices: ["en", "zh"], default: undefined })
    .option("token", { type: "string" })
    .option("base-url", { type: "string" })
    .option("business-domain", { alias: "bd", type: "string" })
    .help(false)
    .parseSync();

  const positional = String(parsed._[0] ?? "");
  const tracesArg = parsed.traces as string | undefined;
  const mode: "single" | "batch" | undefined =
    tracesArg !== undefined ? "batch" : (positional ? "single" : undefined);

  return {
    subcommand: "diagnose",
    mode,
    conversationId: mode === "single" ? positional : undefined,
    traces: tracesArg,
    out: parsed.out ?? null,
    rulesDir: parsed.rules ?? null,
    noBuiltin: !(parsed.builtin as boolean),
    noLlm: !(parsed.llm as boolean),
    noArtifacts: !(parsed.artifacts as boolean),
    maxParallel: parsed["max-parallel"] as number,
    format: (parsed.format as 'yaml' | 'markdown' | 'both' | undefined) ?? null,
    lang: (parsed.lang as 'en' | 'zh' | undefined) ?? null,
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
    noLlm: false,
    noArtifacts: false,
    maxParallel: 4,
    format: null,
    lang: null,
    baseUrl: null,
    token: null,
    businessDomain: null,
  };
}

function printHelp(): void {
  process.stdout.write(`kweaver trace — trace diagnosis commands

Subcommands:
  trace diagnose <conversation_id>            Diagnose the trace produced by a conversation; emit YAML report
                                              (the id is the conversation_id returned by 'agent chat' /
                                              'agent sessions'; spans are fetched from agent-observability)
    --out <file>                              Write report to file (default: stdout)
    --rules <dir>                             Override <cwd>/diagnosis-rules/
    --no-builtin                              Disable the 5+1 builtin baseline rules
    --no-llm                                  Disable LLM-judged rubric rules and the agent synthesizer.
                                              Rubric findings are skipped (recorded in rules_skipped);
                                              the within-trace summary falls back to template mode.
    --no-artifacts                            Disable per-stage artifact persistence (default: artifacts ARE
                                              written next to <out> as <stem>.artifacts/)
    --format <yaml|markdown|both>             Output format. yaml is the machine-readable source of truth;
                                              markdown is the human-readable view (paste into tickets / PRs).
                                              When --out is a file path, both = write <stem>.yaml AND
                                              <stem>.md side by side (default for --out).
                                              When piping to stdout (no --out), default is yaml; pass
                                              --format=markdown to emit markdown instead.
    --lang <en|zh>                            Output locale for agent-judged natural-language fields:
                                              rubric reasoning, synthesizer headline / fix_priority reason.
                                              Default: en. JSON keys, enum values, and span IDs always
                                              remain English regardless of --lang — only prose is localized.

  trace diagnose --traces=<list> --out=<dir>  Batch mode: diagnose N traces for the same agent
    --traces=conv1,conv2,...                  Comma-separated conversation_ids
    --traces=@/path/to/ids.txt               Or @file with one id per line (# comments and blanks ignored)
    --out=<dir>                              Required; fail-fast if missing
    --no-artifacts                            Disable artifact persistence
    --max-parallel <n>                        Concurrency limit (default 4; Sonnet rate-limit friendly)
    --rules <dir>                             Override <cwd>/diagnosis-rules/
    --no-builtin                              Disable the 5+1 builtin baseline rules
    --format <yaml|markdown|both>             Default 'both'
    --lang <en|zh>                            Default 'en'

  trace diagnose rules validate <rule.yaml>   Validate a rule yaml file (exit 0 ok, 6 fail)

  trace eval-set build [--diagnosis=<dir> | --queries=<file>] --out=<dir>
                                              Build a git-trackable eval-set yaml directory from
                                              either M4 diagnosis reports or a simplified
                                              queries+golden-truth input file.
    --diagnosis=<dir>                         Lift suggested_eval_case from M4 report findings
                                              (mutually exclusive with --queries=)
    --queries=<file>                          Lift from simplified trace-eval-set-input/v1 yaml
                                              (mutually exclusive with --diagnosis=)
    --out=<dir>                               Required output directory; index.yaml + cases.yaml
    --on-conflict=fail|skip|overwrite         query_id conflict strategy (default: fail; exit 6 on conflict)
    --redaction-rules=<path>                  Override <repo>/redaction-rules/ source for PII redaction
    --eval-set-id=<id>                        Override default eval_set_id (basename of --out)

  trace eval-set test <eval-set-dir> --candidate=<agent_id>[@<version>] --out=<dir>
                                              Run each case in the eval-set against a candidate agent
                                              and write a trace-test-report/v1 yaml to --out/report.yaml.
    --candidate=<id>[@<version>]              Agent ID to test; optional @version suffix (default: published)
    --out=<dir>                               Required output directory; report.yaml is written here
    --max-parallel=<n>                        Concurrency limit (default 4)
    --lang=en|zh                              Language for semantic_match reasoning text (default en)

  trace schema validate <file> [--kind=<kind>]
                                              Validate a yaml file against its M5/M4 zod schema
                                              (eval-set / eval-set-index / eval-set-input / test-report).
                                              --kind auto-inferred from file path; pass explicitly
                                              if inference fails (exit 2 = kind required).

Auth flags (any subcommand): --token, --base-url, --business-domain (-bd).

Batch mode constraints:
  - All --traces conv_ids must resolve to the same agent_id; mismatch → exit 2
  - --no-llm not supported in batch mode → exit 2 (use single-trace for offline)
  - Per-trace yaml on disk is the resume ground truth; rerunning a scan with
    the same --out reuses existing per-trace reports (atomic .partial → rename)

Rubric rules and the agent synthesizer use the local 'claude' CLI by default
(installed via Claude Code). If 'claude' isn't on PATH, rubric rules are
skipped with reason='provider-not-available:claude-code' and the synthesizer
falls back to deterministic template mode — the rest of the report is still
produced.
`);
}

export async function runTraceCommand(rest: string[]): Promise<number> {
  // exp subcommand — dispatch before other checks (no platform auth needed)
  if (rest[0] === "exp") {
    return runExpCommand(rest.slice(1));
  }

  const args = parseTraceArgs(rest);
  if (args.subcommand === "help") {
    printHelp();
    return 0;
  }
  if (args.subcommand === "rules-validate") {
    return await runRulesValidate(args.rulePath ?? "");
  }
  if (args.subcommand === "eval-set-build") {
    return await runEvalSetBuild(args);
  }
  if (args.subcommand === "eval-set-test") {
    return await runEvalSetTestCmd(args);
  }
  if (args.subcommand === "schema-validate") {
    try {
      return await runSchemaValidate({
        filePath: args.schemaValidatePath ?? "",
        kind: args.schemaKind,
      });
    } catch (e) {
      if (e instanceof SchemaKindRequiredError) {
        process.stderr.write(`error: ${e.message}\n`);
        return 2;
      }
      throw e;
    }
  }
  // diagnose — batch or single
  if (args.mode !== "batch" && !args.conversationId) {
    process.stderr.write("error: missing <conversation_id>\n");
    return 2;
  }
  // Validate batch-mode args BEFORE platform/token resolution so arg-validation
  // failures surface as exit 2 (bad usage) regardless of whether the user has
  // an active platform configured — required for environments like CI.
  if (args.mode === "batch") {
    if (args.noLlm) {
      process.stderr.write(
        "error: --traces (batch mode) does not support --no-llm; the cross-trace synthesizer requires LLM. Use --traces with a fresh run or fall back to single-trace `diagnose <conv_id>` for offline cases.\n",
      );
      return 2;
    }
    if (args.out === null) {
      process.stderr.write(
        "error: --traces requires --out=<dir> to avoid writing N yaml files into the current working directory\n",
      );
      return 2;
    }
    if (!Number.isInteger(args.maxParallel) || args.maxParallel < 1 || args.maxParallel > 64) {
      process.stderr.write(`error: --max-parallel must be a positive integer between 1 and 64; got ${args.maxParallel}\n`);
      return 2;
    }
  }
  let baseUrl = args.baseUrl ?? process.env.KWEAVER_BASE_URL ?? "";
  let token = args.token ?? process.env.KWEAVER_TOKEN ?? "";
  const bd = args.businessDomain ?? process.env.KWEAVER_BUSINESS_DOMAIN ?? "bd_public";
  // Fall back to the active platform from `~/.kweaver/` (same as agent trace),
  // so users don't need to pass --base-url / --token explicitly. Tokens are
  // auto-refreshed for OAuth platforms; "__NO_AUTH__" is returned for no-auth.
  if (!baseUrl || !token) {
    try {
      const t = await ensureValidToken();
      if (!baseUrl) baseUrl = t.baseUrl;
      if (!token) token = t.accessToken;
    } catch (e) {
      process.stderr.write(
        `error: missing --base-url / --token, and no active platform in ~/.kweaver/ — ${(e as Error).message}\n`,
      );
      return 5;
    }
  }
  if (!baseUrl || !token) {
    process.stderr.write("error: missing --base-url / --token (or KWEAVER_BASE_URL / KWEAVER_TOKEN env)\n");
    return 5;
  }

  // ── Batch mode dispatch ──────────────────────────────────────────────────
  if (args.mode === "batch") {
    // Narrowed by the early-validation block above (args.out !== null)
    const outDir = args.out as string;
    let convIds: string[];
    try {
      convIds = await parseTracesList(args.traces!);
    } catch (e) {
      if (e instanceof TracesListError) {
        process.stderr.write(`error: ${e.message}\n`);
        return 2;
      }
      throw e;
    }
    ensureDefaultProviderRegistered();
    try {
      const result = await runBatch({
        traces: convIds,
        out: outDir,
        rulesDir: args.rulesDir,
        noBuiltin: args.noBuiltin,
        noArtifacts: args.noArtifacts,
        format: args.format ?? undefined,    // ← plumb --format through
        lang: args.lang ?? undefined,
        timeoutMs: 60000,
        maxParallel: args.maxParallel,
        baseUrl,
        token,
        businessDomain: bd,
      });
      process.stderr.write(
        `wrote ${result.perTraceReportPaths.length} per-trace reports + ${result.scanSummaryPath} (${result.tracesReused} reused)\n`,
      );
      return 0;
    } catch (e) {
      if (e instanceof SingleAgentValidationError) {
        process.stderr.write(`error: ${e.message}\n`);
        return 2;
      }
      process.stderr.write(`error: ${(e as Error).message}\n`);
      return 1;
    }
  }

  // ── Single-trace dispatch ────────────────────────────────────────────────
  if (!args.noLlm) ensureDefaultProviderRegistered();
  try {
    const report = await diagnose(args.conversationId!, {
      out: args.out,
      rulesDir: args.rulesDir,
      noBuiltin: args.noBuiltin,
      noLlm: args.noLlm,
      format: args.format ?? undefined,
      lang: args.lang ?? undefined,
      agentProvider: null,
      timeoutMs: 60000,
      baseUrl,
      token,
      businessDomain: bd,
    });
    // Tell the user which file(s) we wrote, so they know whether to look for
    // .yaml, .md, or both.
    if (args.out !== null) {
      const fmt = args.format ?? "both";
      const { yamlPath, mdPath } = derivePaths(args.out, fmt);
      const written: string[] = [];
      if (yamlPath !== null) written.push(yamlPath);
      if (mdPath !== null) written.push(mdPath);
      if (written.length > 0) {
        process.stderr.write(`wrote ${written.join(" + ")} (${report.findings.length} findings)\n`);
      }
    }
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

export class SchemaKindRequiredError extends Error {
  constructor(filePath: string) {
    super(
      `cannot infer schema kind for ${filePath}; pass --kind=<eval-set|eval-set-index|eval-set-input|test-report>`,
    );
    this.name = "SchemaKindRequiredError";
  }
}

export function inferKind(filePath: string): string | null {
  const norm = filePath.replace(/\\/g, "/");
  const base = norm.split("/").pop() ?? "";
  // index.yaml in an eval-set dir (absolute or relative path)
  if (base === "index.yaml" && /(^|\/)eval-sets\/[^/]+\/index\.yaml$/.test(norm)) {
    return "eval-set-index";
  }
  if (base.endsWith("-test-report.yaml") || base === "test-report.yaml" || base === "report.yaml") {
    if (/(^|\/)test-runs\//.test(norm) || base.includes("test-report")) return "test-report";
  }
  if (base.endsWith("-eval-set-input.yaml") || base.includes("queries-input")) {
    return "eval-set-input";
  }
  // shard inside eval-set dir (anything not index.yaml)
  if (/(^|\/)eval-sets\/[^/]+\/[^/]+\.yaml$/.test(norm) && base !== "index.yaml") {
    return "eval-set";
  }
  return null;
}

const SCHEMA_BY_KIND: Record<string, { safeParse: (x: unknown) => { success: boolean; error?: { issues: Array<{ message: string; path: PropertyKey[] }> } } }> = {
  "eval-set": EvalSetShardSchema,
  "eval-set-index": EvalSetIndexSchema,
  "eval-set-input": EvalSetInputSchema,
  "test-report": TestReportSchema,
};

export interface RunSchemaValidateOpts {
  filePath: string;
  kind: string | undefined;
}

export async function runSchemaValidate(opts: RunSchemaValidateOpts): Promise<number> {
  if (!opts.filePath) {
    process.stderr.write("error: schema validate requires a file path argument\n");
    return 2;
  }
  const kind = opts.kind ?? inferKind(opts.filePath);
  if (!kind) {
    throw new SchemaKindRequiredError(opts.filePath);
  }
  const schema = SCHEMA_BY_KIND[kind];
  if (!schema) {
    process.stderr.write(`error: unknown --kind=${kind}; valid: ${Object.keys(SCHEMA_BY_KIND).join(", ")}\n`);
    return 2;
  }
  let raw: string;
  try {
    raw = await readFile(opts.filePath, "utf8");
  } catch (e) {
    process.stderr.write(`error: cannot read ${opts.filePath}: ${(e as Error).message}\n`);
    return 1;
  }
  const yamlMod = await import("js-yaml");
  let parsed: unknown;
  try {
    parsed = yamlMod.default.load(raw);
  } catch (e) {
    process.stderr.write(`error: yaml parse failed: ${(e as Error).message}\n`);
    return 1;
  }
  const result = schema.safeParse(parsed);
  if (result.success) {
    process.stdout.write(`✓ ${opts.filePath} valid against ${kind}\n`);
    return 0;
  }
  const issue = result.error!.issues[0];
  const where = issue.path.map(String).join(".");
  process.stderr.write(
    `✗ ${opts.filePath} invalid at '${where}': ${issue.message}\n`,
  );
  return 1;
}

async function runEvalSetBuild(args: ParsedTraceArgs): Promise<number> {
  // 参数检查：互斥 + 必填
  const hasQueries = !!args.queriesPath;
  const hasDiagnosis = !!args.diagnosisPath;
  if (hasQueries === hasDiagnosis) {
    process.stderr.write(
      "error: must pass exactly one of --queries=<file> | --diagnosis=<dir>\n",
    );
    return 2;
  }
  if (!args.out) {
    process.stderr.write("error: --out=<dir> is required\n");
    return 2;
  }

  // eval_set_id 默认 = basename(out)
  const evalSetId = args.evalSetId ?? path.basename(args.out.replace(/\/+$/, ""));
  const repoDir = path.join(process.cwd(), "redaction-rules");

  try {
    const result = await build({
      source: hasQueries
        ? { kind: "queries", path: args.queriesPath! }
        : { kind: "diagnosis", path: args.diagnosisPath! },
      outDir: args.out,
      evalSetId,
      onConflict: args.onConflict ?? "fail",
      redactionRulesCliFlag: args.redactionRules,
      repoDir,
    });
    process.stdout.write(
      `✓ wrote ${result.cases_written} cases (${result.cases_skipped} skipped), ${result.shard_paths.length} shard(s)\n`,
    );
    process.stdout.write(`  redaction_rules: ${result.redaction_rules_source}\n`);
    if (result.conflicts.length > 0) {
      process.stdout.write(`  conflicts: ${result.conflicts.join(", ")}\n`);
    }
    return 0;
  } catch (e) {
    if (e instanceof BuilderError) {
      process.stderr.write(`error: ${e.message}\n`);
      // query_id 冲突 → exit 6 (spec doc §5.4)
      if (e.message.includes("query_id conflict")) return 6;
      return 1;
    }
    process.stderr.write(`error: ${(e as Error).message}\n`);
    return 1;
  }
}

async function runEvalSetTestCmd(args: ParsedTraceArgs): Promise<number> {
  if (!args.evalSetPath) {
    process.stderr.write("error: eval-set directory is required\n");
    return 2;
  }
  if (!args.candidateAgentId) {
    process.stderr.write("error: --candidate=<agent_id> is required\n");
    return 2;
  }
  if (!args.out) {
    process.stderr.write("error: --out=<dir> is required\n");
    return 2;
  }

  let baseUrl = args.baseUrl ?? process.env.KWEAVER_BASE_URL ?? "";
  let token = args.token ?? process.env.KWEAVER_TOKEN ?? "";
  const bd = args.businessDomain ?? process.env.KWEAVER_BUSINESS_DOMAIN ?? "bd_public";
  if (!baseUrl || !token) {
    try {
      const t = await ensureValidToken();
      if (!baseUrl) baseUrl = t.baseUrl;
      if (!token) token = t.accessToken;
    } catch (e) {
      process.stderr.write(
        `error: missing --base-url / --token, and no active platform in ~/.kweaver/ — ${(e as Error).message}\n`,
      );
      return 5;
    }
  }
  if (!baseUrl || !token) {
    process.stderr.write("error: missing --base-url / --token (or KWEAVER_BASE_URL / KWEAVER_TOKEN env)\n");
    return 5;
  }

  // Resolve a SemanticMatchProvider for `semantic_match` assertions (D5).
  // We register claude-code as the default agent-provider, load the builtin
  // rubric template, and only wire the judge in if the provider reports
  // available — otherwise semantic_match assertions skip with a clear reason
  // rather than failing the whole run.
  ensureDefaultProviderRegistered();
  const promptRegistry = new PromptTemplateRegistry();
  await promptRegistry.loadBuiltinDir(EVAL_SET_RUBRIC_DIR);
  let semanticMatchProvider: SemanticMatchProvider | undefined;
  try {
    const provider = defaultRegistry.resolve({
      requiredCapabilities: ["structured_output"],
    });
    if (provider && (await provider.isAvailable())) {
      semanticMatchProvider = createBuiltinSemanticMatchProvider({
        provider,
        promptRegistry,
        lang: args.lang === "zh" ? "zh" : "en",
      });
    } else {
      process.stderr.write(
        "warn: agent provider unavailable — `semantic_match` assertions will be skipped (install `claude` CLI or wire a stub provider)\n",
      );
    }
  } catch (e) {
    process.stderr.write(`warn: could not resolve agent provider — ${(e as Error).message}\n`);
  }

  try {
    await runEvalSetTest({
      evalSetDir: args.evalSetPath,
      candidateAgentId: args.candidateAgentId,
      candidateAgentVersion: args.candidateAgentVersion,
      outDir: args.out,
      maxParallel: args.maxParallel,
      deps: {
        fetchAgent: async (agentId, version) =>
          fetchAgentInfo({
            baseUrl,
            accessToken: token,
            agentId,
            version: version ?? "latest",
            businessDomain: bd,
          }),
        sendChat: async ({ agentInfo, query }) => {
          const result = await sendChatRequest({
            baseUrl,
            accessToken: token,
            agentId: agentInfo.id,
            agentKey: agentInfo.key,
            agentVersion: agentInfo.version,
            query,
            stream: false,
            businessDomain: bd,
          });
          return { text: result.text, conversationId: result.conversationId };
        },
        fetchTrace: async (conversationId) => {
          const r = await getTracesByConversation({
            baseUrl,
            accessToken: token,
            conversationId,
            businessDomain: bd,
          });
          return { spans: r.spans };
        },
        semanticMatchProvider,
      },
    });
    process.stdout.write(`✓ wrote ${args.out}/report.yaml\n`);
    return 0;
  } catch (e) {
    process.stderr.write(`error: ${(e as Error).message}\n`);
    return 1;
  }
}
