import yargs from "yargs";

import { derivePaths, diagnose, TraceNotFoundError } from "../trace-ai/diagnose/index.js";
import { RuleLoadError } from "../trace-ai/diagnose/rule-loader.js";
import { RuleProbeError } from "../trace-ai/diagnose/signal-probe.js";
import { RuleSchema } from "../trace-ai/diagnose/schemas.js";
import { ensureValidToken } from "../auth/oauth.js";
import { defaultRegistry } from "../agent-providers/registry.js";
import { ClaudeCodeSubprocessProvider } from "../agent-providers/providers/claude-code-subprocess.js";
import { runBatch } from "../trace-ai/scan/index.js";
import { parseTracesList, TracesListError } from "../trace-ai/scan/traces-list-parser.js";
import { SingleAgentValidationError } from "../trace-ai/scan/single-agent-validator.js";
import yaml from "js-yaml";
import fs from "node:fs/promises";

/** Register the default agent provider once per CLI process. Idempotent. */
function ensureDefaultProviderRegistered(): void {
  if (defaultRegistry.has("claude-code")) return;
  defaultRegistry.register(new ClaudeCodeSubprocessProvider(), { setAsDefault: true });
}

export interface ParsedTraceArgs {
  subcommand: "diagnose" | "rules-validate" | "help";
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
  const args = parseTraceArgs(rest);
  if (args.subcommand === "help") {
    printHelp();
    return 0;
  }
  if (args.subcommand === "rules-validate") {
    return await runRulesValidate(args.rulePath ?? "");
  }
  // diagnose — batch or single
  if (args.mode !== "batch" && !args.conversationId) {
    process.stderr.write("error: missing <conversation_id>\n");
    return 2;
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
        out: args.out,
        rulesDir: args.rulesDir,
        noBuiltin: args.noBuiltin,
        noArtifacts: args.noArtifacts,
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
