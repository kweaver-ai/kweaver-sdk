import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { fileURLToPath } from "node:url";

import { getSpansByConversationId, type RawSpan } from "../../api/trace.js";
import { assembleTraceTree } from "./trace-shaper.js";
import { loadRules, RuleLoadError } from "./rule-loader.js";
import { runRules, RuleProbeError, rubricRules } from "./signal-probe.js";
import { agentSynthesize } from "./synthesizer-agent.js";
import { evaluateRubricRules } from "./agent-binding.js";
import { assembleReport, reportToYamlObject, symbolicHitsToFindings } from "./report-assembler.js";
import { renderReportMarkdown } from "./report-markdown.js";
import type { DiagnoseOpts, Report } from "./types.js";
import type { AgentRegistry } from "../agent/registry.js";
import { defaultRegistry } from "../agent/registry.js";
import {
  defaultPromptRegistry,
  PromptTemplateRegistry,
} from "../agent/prompt-template.js";

import "./builtin-rules/register.js";  // side effect: registers all builtin predicates

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUILTIN_DIR = path.join(__dirname, "builtin-rules");
const SHARED_PROMPT_DIR = path.join(__dirname, "..", "agent", "prompts");

export class TraceNotFoundError extends Error {
  constructor(conversationId: string) {
    super(`no spans found for conversation: ${conversationId}`);
    this.name = "TraceNotFoundError";
  }
}

/**
 * Allow callers (CLI, tests, future scan-mode) to inject a custom registry
 * + prompt registry without globals. The CLI in `commands/trace.ts` calls
 * `diagnose()` and registers the default ClaudeCodeSubprocessProvider into
 * `defaultRegistry` ahead of time; tests pass their own registry containing
 * a StubAgentProvider.
 */
export interface DiagnoseInternalOpts {
  /** Override the AgentRegistry used for rubric rules + synthesizer. */
  registry?: AgentRegistry;
  /** Override the PromptTemplateRegistry. */
  promptRegistry?: PromptTemplateRegistry;
}

let sharedPromptsLoaded = false;
async function ensureBuiltinPromptsLoaded(reg: PromptTemplateRegistry): Promise<void> {
  if (reg !== defaultPromptRegistry) {
    // Caller-provided registry: load on every call so test-specific
    // overrides see their content (cheap; ENOENT is no-op).
    await reg.loadBuiltinDir(SHARED_PROMPT_DIR);
    return;
  }
  if (sharedPromptsLoaded) return;
  await reg.loadBuiltinDir(SHARED_PROMPT_DIR);
  sharedPromptsLoaded = true;
}

export async function diagnose(
  conversationId: string,
  opts: DiagnoseOpts,
  internal: DiagnoseInternalOpts = {},
): Promise<Report> {
  const cwdRulesDir = opts.rulesDir ?? path.join(process.cwd(), "diagnosis-rules");
  const registry = internal.registry ?? defaultRegistry;
  const promptRegistry = internal.promptRegistry ?? defaultPromptRegistry;
  await ensureBuiltinPromptsLoaded(promptRegistry);

  // ── 1. Fetch + shape spans ──────────────────────────────────────────────
  const fetched = await getSpansByConversationId({
    baseUrl: opts.baseUrl,
    token: opts.token,
    businessDomain: opts.businessDomain,
    conversationId,
  });
  const rawSpans: RawSpan[] = fetched.spans;
  if (rawSpans.length === 0) throw new TraceNotFoundError(conversationId);

  const observedTraceIds = fetched.traceIds.length > 0
    ? fetched.traceIds
    : [...new Set(rawSpans.map((s) => s.traceId).filter((t): t is string => Boolean(t)))];
  const primaryTraceId = observedTraceIds[0] ?? conversationId;
  if (observedTraceIds.length > 1) {
    process.stderr.write(
      `warning: conversation ${conversationId} has ${observedTraceIds.length} traces; diagnosing the first (${primaryTraceId})\n`,
    );
  }
  const spansForPrimary = observedTraceIds.length > 0
    ? rawSpans.filter((s) => !s.traceId || s.traceId === primaryTraceId)
    : rawSpans;

  const tree = assembleTraceTree(primaryTraceId, spansForPrimary);

  // ── 2. Load rules + run Stage-1 (symbolic) ──────────────────────────────
  const rules = await loadRules({
    builtinDir: BUILTIN_DIR,
    cwdRulesDir,
    extraRulesDir: null,
    noBuiltin: opts.noBuiltin,
  });

  const hits = await runRules(rules, tree);
  const symbolicFindings = symbolicHitsToFindings(rules, hits);

  // ── 3. Stage-2 (rubric) — skip everything when --no-llm ─────────────────
  const haveRubric = rubricRules(rules).length > 0;
  let rubricFindings: typeof symbolicFindings = [];
  let rulesSkipped: { ruleId: string; reason: string }[] = [];
  if (haveRubric) {
    const r = await evaluateRubricRules({
      rules,
      tree,
      registry,
      promptRegistry,
      noLlm: opts.noLlm,
      timeoutMs: opts.timeoutMs,
    });
    rubricFindings = r.findings;
    rulesSkipped = r.skipped;
  }

  const allFindings = [...symbolicFindings, ...rubricFindings];

  // ── 4. Stage-3 — agent synthesizer (template fallback) ──────────────────
  const synthProvider = opts.noLlm
    ? null
    : registry.resolve({ preferred: opts.agentProvider ?? undefined });
  const synth = await agentSynthesize({
    findings: allFindings,
    traceId: primaryTraceId,
    agentId: extractAgentId(tree),
    provider: synthProvider,
    promptRegistry,
    timeoutMs: opts.timeoutMs,
  });

  // ── 5. Assemble report ──────────────────────────────────────────────────
  const haveSymbolic = rules.some((r) => r.predicateRef !== null);
  const ranRubric = haveRubric && !opts.noLlm;
  const mode: 'symbolic-only' | 'rubric-only' | 'hybrid' = haveSymbolic && ranRubric
    ? "hybrid"
    : ranRubric
      ? "rubric-only"
      : "symbolic-only";

  const version = await cliVersion();
  const report: Report = assembleReport({
    traceId: primaryTraceId,
    agentId: extractAgentId(tree),
    tenant: extractTenant(tree),
    cliVersion: version,
    rules,
    hits,
    extraFindings: rubricFindings,
    summary: synth.summary,
    mode,
    rulesSkipped,
    synthesizerMode: synth.mode,
  });

  // ── 6. Emit ──────────────────────────────────────────────────────────────
  const yamlText = yaml.dump(reportToYamlObject(report));
  const format = opts.format ?? (opts.out !== null ? "both" : "yaml");
  if (opts.out !== null) {
    await fs.mkdir(path.dirname(opts.out), { recursive: true });
    const { yamlPath, mdPath } = derivePaths(opts.out, format);
    if (yamlPath !== null) await fs.writeFile(yamlPath, yamlText, "utf8");
    if (mdPath !== null) await fs.writeFile(mdPath, renderReportMarkdown(report), "utf8");
  } else {
    // stdout — markdown to stdout would corrupt downstream `yq` / yaml consumers, so
    // 'both' degrades to yaml-only. Users who want md on stdout pass --format=markdown.
    if (format === "markdown") {
      process.stdout.write(renderReportMarkdown(report));
    } else {
      process.stdout.write(yamlText);
    }
  }
  if (report.findings.length === 0) {
    process.stderr.write("no findings\n");
  }
  return report;
}

/** Resolve which file paths to write given the user-supplied --out and format.
 *  Both: derive the missing extension from the given one; if --out had no
 *  recognized extension, append .yaml / .md. Single-format: write to --out
 *  verbatim (caller's extension is honored as-is). */
export function derivePaths(out: string, format: 'yaml' | 'markdown' | 'both'): { yamlPath: string | null; mdPath: string | null } {
  if (format === "yaml") return { yamlPath: out, mdPath: null };
  if (format === "markdown") return { yamlPath: null, mdPath: out };
  // both
  const lower = out.toLowerCase();
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) {
    const stem = out.slice(0, out.lastIndexOf("."));
    return { yamlPath: out, mdPath: `${stem}.md` };
  }
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) {
    const stem = out.slice(0, out.lastIndexOf("."));
    return { yamlPath: `${stem}.yaml`, mdPath: out };
  }
  return { yamlPath: `${out}.yaml`, mdPath: `${out}.md` };
}

function extractAgentId(tree: ReturnType<typeof assembleTraceTree>): string | null {
  for (const s of tree.spans) {
    const v = s.attributes["gen_ai.agent.id"];
    if (typeof v === "string") return v;
  }
  return null;
}

function extractTenant(tree: ReturnType<typeof assembleTraceTree>): string | null {
  for (const s of tree.spans) {
    const v = s.attributes["tenant"];
    if (typeof v === "string") return v;
  }
  return null;
}

async function cliVersion(): Promise<string> {
  try {
    const pkgPath = path.join(__dirname, "..", "..", "..", "package.json");
    const txt = await fs.readFile(pkgPath, "utf8");
    return JSON.parse(txt).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export { TraceNotFoundError as DiagnoseTraceNotFound, RuleLoadError, RuleProbeError };
