/**
 * Stage-2 — rubric judgments: resolve rubric.inputs against a TraceTree,
 * render the prompt template, invoke the agent provider, and map the
 * schema-validated output to a `Finding`.
 *
 * Why this layer exists separate from `signal-probe`:
 *   - Async / I/O-bound (subprocess or HTTP) vs. sync predicates
 *   - Per-rule provider lookup + skip-on-unavailable
 *   - Error semantics differ (skip + record vs. throw RuleProbeError)
 *
 * Convergence invariant (enforced upstream in schemas.ts): every rubric
 * `output_schema.required` includes `first_violating_step_id`, so each
 * rubric finding always points at a concrete span and can be correlated
 * with symbolic findings on the same span by the synthesizer.
 */

import type {
  Finding,
  Rule,
  RubricInputSpec,
  Span,
  TraceTree,
} from "./types.js";
import type { AgentProvider } from "../../agent-providers/types.js";
import { AgentProviderError } from "../../agent-providers/types.js";
import type { AgentRegistry } from "../../agent-providers/registry.js";
import {
  PromptTemplateRegistry,
  render as renderPrompt,
  languageInstructionFor,
  type AgentOutputLang,
} from "../../agent-providers/prompt-template.js";
import type { ArtifactWriter } from "../scan/artifacts/writer.js";

export interface RubricEvaluateOpts {
  rules: Rule[];                        // mixed; non-rubric rules are skipped here
  tree: TraceTree;
  registry: AgentRegistry;
  promptRegistry: PromptTemplateRegistry;
  /** If true, all rubric rules are skipped with reason='no-llm-flag-set'. */
  noLlm?: boolean;
  /** Per-invocation timeout in ms; provider may apply its own ceiling. */
  timeoutMs?: number;
  /** Output locale for natural-language fields in the agent reply. Default 'en'. */
  lang?: AgentOutputLang;
  /** When provided, writes Stage-2 prompt/response artifacts per rule invocation. */
  artifacts?: ArtifactWriter;
}

export interface RubricEvaluateResult {
  findings: Finding[];
  skipped: { ruleId: string; reason: string }[];
}

/** Resolve one rubric input spec against the trace and return a value
 *  suitable for prompt interpolation. Pure for testability. */
export function resolveRubricInput(
  spec: RubricInputSpec,
  tree: TraceTree,
): unknown {
  const colon = spec.source.indexOf(":");
  if (colon === -1) {
    throw new AgentBindingError(
      `rubric input source missing prefix (expected '<scheme>:...'): '${spec.source}'`,
    );
  }
  const scheme = spec.source.slice(0, colon);
  const payload = spec.source.slice(colon + 1);
  switch (scheme) {
    case "extract_from_root_attr": {
      // dotted path against root.attributes (nested attr lookups are common).
      const root = tree.root;
      if (!root) return null;
      return getDottedPath(root.attributes, payload);
    }
    case "filter_by_kind": {
      // payload form: '[kind1,kind2,...]' or 'kind1,kind2,...'
      const inner = payload.replace(/^\[|\]$/g, "");
      const kinds = inner.split(",").map((s) => s.trim()).filter(Boolean);
      const acc: Array<Pick<Span, "spanId" | "name" | "kind" | "attributes" | "durationMs" | "status">> = [];
      for (const k of kinds) {
        const spans = tree.byKind.get(k as Span["kind"]) ?? [];
        for (const s of spans) {
          acc.push({
            spanId: s.spanId,
            name: s.name,
            kind: s.kind,
            attributes: s.attributes,
            durationMs: s.durationMs,
            status: s.status,
          });
        }
      }
      // Order chronologically so the agent reads a coherent timeline.
      acc.sort((a, b) => {
        const sa = tree.byId.get(a.spanId)?.startTimeUnixNano ?? "0";
        const sb = tree.byId.get(b.spanId)?.startTimeUnixNano ?? "0";
        return Number(BigInt(sa) - BigInt(sb));
      });
      return acc;
    }
    case "literal":
      try {
        return JSON.parse(payload);
      } catch (e) {
        throw new AgentBindingError(
          `literal source has invalid JSON: ${(e as Error).message}`,
        );
      }
    default:
      throw new AgentBindingError(`unknown rubric input source scheme: '${scheme}'`);
  }
}

export class AgentBindingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentBindingError";
  }
}

/** OTel attribute keys are typically flat strings with literal dots
 *  (e.g. `gen_ai.user.message`), but some traces nest objects under a
 *  parent attribute. Try direct lookup first; fall back to nested walk. */
function getDottedPath(obj: unknown, path: string): unknown {
  if (obj === null || obj === undefined || typeof obj !== "object") return undefined;
  const flat = (obj as Record<string, unknown>)[path];
  if (flat !== undefined) return flat;
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

interface RubricAgentOutput {
  reasoning?: string;
  severity?: "low" | "medium" | "high";
  confidence?: "low" | "medium" | "high";
  category?: string;
  first_violating_step_id: string;
  evidence_span_ids?: string[];
  [k: string]: unknown;
}

function buildPromptVars(
  rule: Rule,
  tree: TraceTree,
  resolvedInputs: Record<string, unknown>,
  lang: AgentOutputLang,
) {
  // Surface enough context that builtin:rubric-judge-v1 can be a generic
  // template without per-rule knowledge: judge question + inputs blob +
  // rule metadata. `language_instruction` localizes prose fields only;
  // schema-fixed values (enums, span IDs) stay English regardless.
  return {
    rule_id: rule.id,
    judge_question: rule.rubric?.judgeQuestion ?? "",
    output_schema: rule.rubric?.outputSchemaRaw ?? {},
    inputs: resolvedInputs,
    trace_id: tree.traceId,
    language_instruction: languageInstructionFor(lang),
  };
}

async function evaluateOne(
  rule: Rule,
  tree: TraceTree,
  provider: AgentProvider,
  promptRegistry: PromptTemplateRegistry,
  timeoutMs?: number,
  lang: AgentOutputLang = "en",
  artifacts?: ArtifactWriter,
): Promise<Finding> {
  const rubric = rule.rubric!;  // caller guarantees
  // Resolve inputs.
  const resolvedInputs: Record<string, unknown> = {};
  for (const inp of rubric.inputs) {
    resolvedInputs[inp.kind] = resolveRubricInput(inp, tree);
  }
  // Render prompt.
  const tpl = promptRegistry.get(rubric.agentBinding.promptTemplateRef);
  const prompt = renderPrompt(tpl, buildPromptVars(rule, tree, resolvedInputs, lang));
  if (artifacts) {
    await artifacts.writeStageTwoPrompt(rule.id, 0, prompt);  // chunk-000 — single-trace mode K=1
  }

  // Invoke.
  const resp = await provider.invoke<RubricAgentOutput>({
    prompt,
    outputSchema: rubric.outputZodSchema as unknown as import("zod").ZodType<RubricAgentOutput>,
    timeoutMs,
    correlationId: `${tree.traceId}/${rule.id}`,
  });
  if (artifacts) {
    await artifacts.writeStageTwoResponse(rule.id, 0, resp.output);
  }

  const out = resp.output;
  const firstSpan = out.first_violating_step_id;
  const otherSpans = Array.isArray(out.evidence_span_ids) ? out.evidence_span_ids : [];
  // Convergence: ensure first_violating_step_id is in evidence.spans.
  const spans = otherSpans.includes(firstSpan) ? otherSpans : [firstSpan, ...otherSpans];

  return {
    ruleId: rule.id,
    judgmentKind: "rubric",
    severity: out.severity ?? rule.severity,        // agent may upgrade/downgrade
    symptom: rule.symptom,
    likelyCause: out.category ?? out.reasoning ?? rule.symptom,
    evidence: {
      spans,
      excerpt: out.reasoning ?? "",
    },
    suggestedFix: {
      target: rule.suggestedFix.target,
      // Render changeTemplate with rubric output as bindings (best-effort:
      // string-keyed values; complex shapes pass through unchanged).
      change: renderChangeTemplate(rule.suggestedFix.changeTemplate, out),
    },
    confidence: out.confidence ?? "medium",          // rubric default > symbolic
    verifyWith: {
      suggestedEvalCase: {
        queryId: null,
        query: null,
        assertions: rule.verifyWith.assertionTemplates.map((t) =>
          renderChangeTemplate(t, out),
        ),
      },
    },
  };
}

function renderChangeTemplate(tpl: string, bindings: Record<string, unknown>): string {
  return tpl.replace(/{{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*}}/g, (_, key) => {
    const v = bindings[key];
    if (v === undefined || v === null) return `{{${key}}}`;
    return typeof v === "string" ? v : JSON.stringify(v);
  });
}

/**
 * Evaluate every rubric rule in `rules` and return findings + skip records.
 *
 * A rule is *skipped* (not failed) when:
 *   - `--no-llm` is set → reason: 'no-llm-flag-set'
 *   - rule's named provider isn't registered or `isAvailable()` is false
 *     → reason: `provider-not-available:<name>`
 *   - rule's prompt template isn't registered
 *     → reason: `prompt-template-missing:<ref>`
 *
 * Schema violations / transport errors from the provider are surfaced
 * as `AgentBindingError` (let the CLI decide whether to fail the whole
 * run or skip the single rule). Default callsite (`index.ts`) catches
 * these and records them in `rules_skipped` rather than aborting.
 */
export async function evaluateRubricRules(
  opts: RubricEvaluateOpts,
): Promise<RubricEvaluateResult> {
  const findings: Finding[] = [];
  const skipped: { ruleId: string; reason: string }[] = [];

  for (const rule of opts.rules) {
    if (!rule.rubric) continue;
    if (opts.noLlm) {
      skipped.push({ ruleId: rule.id, reason: "no-llm-flag-set" });
      continue;
    }

    // Resolve provider for this rule.
    let provider: AgentProvider | null;
    try {
      provider = opts.registry.resolve({
        preferred: rule.rubric.agentBinding.provider,
        requiredCapabilities: ["structured_output"],
      });
    } catch (e) {
      if (e instanceof AgentProviderError && e.kind === "not_available") {
        skipped.push({
          ruleId: rule.id,
          reason: `provider-not-available:${rule.rubric.agentBinding.provider}`,
        });
        continue;
      }
      throw e;
    }
    if (!provider) {
      skipped.push({
        ruleId: rule.id,
        reason: `provider-not-available:${rule.rubric.agentBinding.provider}`,
      });
      continue;
    }
    if (!(await provider.isAvailable())) {
      skipped.push({
        ruleId: rule.id,
        reason: `provider-not-available:${rule.rubric.agentBinding.provider}`,
      });
      continue;
    }
    if (!opts.promptRegistry.has(rule.rubric.agentBinding.promptTemplateRef)) {
      skipped.push({
        ruleId: rule.id,
        reason: `prompt-template-missing:${rule.rubric.agentBinding.promptTemplateRef}`,
      });
      continue;
    }

    try {
      // Write work-queue once per rule before invoking (single-trace: 1 entry).
      await opts.artifacts?.writeStageTwoWorkQueue(rule.id, [opts.tree.traceId]);
      const finding = await evaluateOne(rule, opts.tree, provider, opts.promptRegistry, opts.timeoutMs, opts.lang ?? "en", opts.artifacts);
      findings.push(finding);
    } catch (e) {
      if (e instanceof AgentProviderError) {
        // Provider-level failures (timeout / transport / schema_violation) downgrade
        // to a skip; the rest of the run still produces a usable report.
        skipped.push({
          ruleId: rule.id,
          reason: `agent-error:${e.kind}`,
        });
        continue;
      }
      throw e;
    }
  }

  return { findings, skipped };
}
