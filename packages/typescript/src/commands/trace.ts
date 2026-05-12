import yargs from "yargs";

import { derivePaths, diagnose, TraceNotFoundError } from "../trace-ai/diagnose/index.js";
import { RuleLoadError } from "../trace-ai/diagnose/rule-loader.js";
import { RuleProbeError } from "../trace-ai/diagnose/signal-probe.js";
import { RuleSchema } from "../trace-ai/diagnose/schemas.js";
import { ensureValidToken } from "../auth/oauth.js";
import { defaultRegistry } from "../agent-providers/registry.js";
import { ClaudeCodeSubprocessProvider } from "../agent-providers/providers/claude-code-subprocess.js";
import yaml from "js-yaml";
import fs from "node:fs/promises";

/** Register the default agent provider once per CLI process. Idempotent. */
function ensureDefaultProviderRegistered(): void {
  if (defaultRegistry.has("claude-code")) return;
  defaultRegistry.register(new ClaudeCodeSubprocessProvider(), { setAsDefault: true });
}

export interface ParsedTraceArgs {
  subcommand: "diagnose" | "rules-validate" | "help";
  conversationId?: string;
  rulePath?: string;
  out: string | null;
  rulesDir: string | null;
  noBuiltin: boolean;
  noLlm: boolean;
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
  // diagnose <conversation_id> [flags...]
  const parsed = yargs(argv.slice(1))
    .option("out", { type: "string", default: undefined })
    .option("rules", { type: "string", default: undefined })
    .option("builtin", { type: "boolean", default: true })  // --no-builtin sets this to false
    .option("llm", { type: "boolean", default: true })      // --no-llm sets this to false (PR-B reversal)
    .option("format", { type: "string", choices: ["yaml", "markdown", "both"], default: undefined })
    .option("lang", { type: "string", choices: ["en", "zh"], default: undefined })
    .option("token", { type: "string" })
    .option("base-url", { type: "string" })
    .option("business-domain", { alias: "bd", type: "string" })
    .help(false)
    .parseSync();

  return {
    subcommand: "diagnose",
    conversationId: String(parsed._[0] ?? ""),
    out: parsed.out ?? null,
    rulesDir: parsed.rules ?? null,
    noBuiltin: !(parsed.builtin as boolean),
    noLlm: !(parsed.llm as boolean),
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

  trace diagnose rules validate <rule.yaml>   Validate a rule yaml file (exit 0 ok, 6 fail)

Auth flags (any subcommand): --token, --base-url, --business-domain (-bd).

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
  // diagnose
  if (!args.conversationId) {
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
  if (!args.noLlm) ensureDefaultProviderRegistered();
  try {
    const report = await diagnose(args.conversationId, {
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
