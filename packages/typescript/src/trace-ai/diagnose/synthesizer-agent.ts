/**
 * Stage-3 — agent-driven within-trace synthesizer.
 *
 * Takes the N findings produced by Stages 1+2 and asks the LLM to compose
 * a `Summary` (headline + root cause + ordered fix priority + cross-finding
 * links). Falls back to the deterministic `templateSynthesize` if:
 *   - findings.length === 0 (no narrative needed)
 *   - no provider registered / provider unavailable
 *   - the agent invocation fails for any reason (we still want a usable
 *     report even when the LLM judge times out)
 *
 * The agent path remains a *narrative* layer — symbolic and rubric findings
 * are already in hand; the synthesizer doesn't fabricate new findings, only
 * organizes the ones it was given. This keeps the contract small and the
 * failure modes containable.
 */

import type { Finding, Summary } from "./types.js";
import type { AgentProvider } from "../../agent-providers/types.js";
import { AgentProviderError } from "../../agent-providers/types.js";
import {
  PromptTemplateRegistry,
  render as renderPrompt,
  languageInstructionFor,
  type AgentOutputLang,
} from "../../agent-providers/prompt-template.js";
import { SummaryOutputSchema } from "./schemas.js";
import { templateSynthesize } from "./synthesizer-template.js";

export interface AgentSynthesizeOpts {
  findings: Finding[];
  traceId: string;
  agentId: string | null;
  provider: AgentProvider | null;
  promptRegistry: PromptTemplateRegistry;
  promptRef?: string;                  // default 'builtin:within-trace-synthesizer-v1'
  timeoutMs?: number;
  /** Output locale for synthesizer prose. Default 'en'. */
  lang?: AgentOutputLang;
}

export interface AgentSynthesizeResult {
  summary: Summary;
  mode: "agent" | "template";
  /** Reason set when mode === 'template' under a non-default branch. */
  fallbackReason?: string;
}

/** Map zod-validated agent output (snake_case Summary) → internal camelCase Summary. */
function toInternalSummary(out: import("./schemas.js").SummaryOutput): Summary {
  return {
    headline: out.headline,
    primaryRootCause:
      out.primary_root_cause === null
        ? null
        : {
            findingIds: out.primary_root_cause.finding_ids,
            description: out.primary_root_cause.description,
            targetForFix: out.primary_root_cause.target_for_fix,
          },
    fixPriority: out.fix_priority.map((p) => ({ findingId: p.finding_id, reason: p.reason })),
    crossFindingLinks: out.cross_finding_links.map((l) => ({
      findingIds: l.finding_ids,
      relation: l.relation,
    })),
  };
}

/** Snake-case projection of Finding for the prompt — matches the YAML
 *  representation users already see, so the model doesn't have to translate. */
function findingForPrompt(f: Finding, idx: number) {
  return {
    index: idx,
    rule_id: f.ruleId,
    judgment_kind: f.judgmentKind,
    severity: f.severity,
    symptom: f.symptom,
    likely_cause: f.likelyCause,
    evidence_spans: f.evidence.spans,
    excerpt: f.evidence.excerpt,
    suggested_fix_target: f.suggestedFix.target,
    suggested_fix_change: f.suggestedFix.change,
    confidence: f.confidence,
  };
}

/**
 * The output_schema rendered into the prompt is a JSON-Schema-ish
 * description of the Summary contract. Authored inline rather than
 * derived from the zod schema to keep the prompt human-readable.
 */
const SUMMARY_OUTPUT_SCHEMA_DESCRIPTION = {
  type: "object",
  required: ["headline", "primary_root_cause", "fix_priority", "cross_finding_links"],
  properties: {
    headline: { type: "string", maxLength: 160 },
    primary_root_cause: {
      type: "object_or_null",
      required: ["finding_ids", "description", "target_for_fix"],
      properties: {
        finding_ids: { type: "array", items: { type: "integer" } },
        description: { type: "string" },
        target_for_fix: { type: "string" },
      },
    },
    fix_priority: {
      type: "array",
      items: {
        type: "object",
        required: ["finding_id", "reason"],
        properties: { finding_id: { type: "integer" }, reason: { type: "string" } },
      },
    },
    cross_finding_links: {
      type: "array",
      items: {
        type: "object",
        required: ["finding_ids", "relation"],
        properties: {
          finding_ids: { type: "array", items: { type: "integer" }, minItems: 2 },
          relation: { type: "string" },
        },
      },
    },
  },
};

export async function agentSynthesize(opts: AgentSynthesizeOpts): Promise<AgentSynthesizeResult> {
  // Empty findings: no narrative to compose. Both modes produce the same
  // summary here, so default to `template` so reports don't claim the
  // agent ran when it didn't.
  if (opts.findings.length === 0) {
    return { summary: templateSynthesize([]), mode: "template" };
  }
  if (!opts.provider) {
    return {
      summary: templateSynthesize(opts.findings),
      mode: "template",
      fallbackReason: "no-provider-registered",
    };
  }

  const ref = opts.promptRef ?? "builtin:within-trace-synthesizer-v1";
  if (!opts.promptRegistry.has(ref)) {
    return {
      summary: templateSynthesize(opts.findings),
      mode: "template",
      fallbackReason: `prompt-template-missing:${ref}`,
    };
  }
  const tpl = opts.promptRegistry.get(ref);
  const prompt = renderPrompt(tpl, {
    trace_id: opts.traceId,
    agent_id: opts.agentId ?? "<unknown>",
    findings: opts.findings.map((f, i) => findingForPrompt(f, i)),
    output_schema: SUMMARY_OUTPUT_SCHEMA_DESCRIPTION,
    language_instruction: languageInstructionFor(opts.lang ?? "en"),
  });

  try {
    if (!(await opts.provider.isAvailable())) {
      return {
        summary: templateSynthesize(opts.findings),
        mode: "template",
        fallbackReason: `provider-not-available:${opts.provider.name}`,
      };
    }
    const resp = await opts.provider.invoke({
      prompt,
      outputSchema: SummaryOutputSchema,
      timeoutMs: opts.timeoutMs,
      correlationId: `synthesize:${opts.traceId}`,
    });
    return { summary: toInternalSummary(resp.output), mode: "agent" };
  } catch (e) {
    if (e instanceof AgentProviderError) {
      return {
        summary: templateSynthesize(opts.findings),
        mode: "template",
        fallbackReason: `agent-error:${e.kind}`,
      };
    }
    throw e;
  }
}
