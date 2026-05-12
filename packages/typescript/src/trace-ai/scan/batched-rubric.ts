import yaml from "js-yaml";
import { z } from "zod";

import type { AgentProvider } from "../../agent-providers/types.js";
import { AgentProviderError } from "../../agent-providers/types.js";
import {
  PromptTemplateRegistry,
  render as renderPrompt,
  languageInstructionFor,
  type AgentOutputLang,
} from "../../agent-providers/prompt-template.js";
import { ArtifactWriter } from "./artifacts/writer.js";

export interface BatchTraceItem {
  traceId: string;
  /** Real span_ids present in this trace; used to validate `first_violating_step_id`. */
  spans: string[];
  /** Inputs resolved per the rule's `inputs` schema. */
  inputs: Record<string, unknown>;
}

export interface BatchedRubricRule {
  ruleId: string;
  judgeQuestion: string;
  outputSchema: z.ZodTypeAny;
  outputSchemaRaw: Record<string, unknown>;
  promptTemplateRef: string;
}

export interface BatchedRubricVerdict {
  traceId: string;
  category: string;
  reasoning: string;
  severity: "low" | "medium" | "high";
  firstViolatingStepId: string;
  evidenceSpanIds: string[];
}

export interface BatchedRubricSkipped {
  traceId: string;
  reason: string;
}

export interface BatchedRubricResult {
  verdicts: BatchedRubricVerdict[];
  skipped: BatchedRubricSkipped[];
}

export interface RunBatchedRubricOpts {
  rule: BatchedRubricRule;
  traces: BatchTraceItem[];
  agentId: string;
  provider: AgentProvider;
  promptRegistry: PromptTemplateRegistry;
  chunkSize: number;
  lang?: AgentOutputLang;
  artifacts?: ArtifactWriter;
  timeoutMs?: number;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function buildTracesYaml(chunk: BatchTraceItem[]): string {
  return yaml.dump(
    chunk.map((t) => ({ trace_id: t.traceId, spans: t.spans, inputs: t.inputs })),
    { lineWidth: 120 },
  );
}

/**
 * Takes the single-verdict raw JSON Schema object (from rule YAML's `output_schema`
 * block) and returns a wrapper schema that:
 *   1. Injects `trace_id` into the item's `required` array and `properties` map.
 *   2. Wraps the augmented item inside `{ trace_results: array<augmented-item> }`.
 *
 * This ensures the prompt's `output_schema` block instructs the LLM to emit
 * `trace_id` on every verdict, matching the zod schema used for validation.
 */
function wrapSchemaForBatch(single: Record<string, unknown>): Record<string, unknown> {
  const required = Array.isArray(single.required)
    ? [...(single.required as string[]), "trace_id"]
    : ["trace_id"];
  const properties: Record<string, unknown> = {
    ...((single.properties as Record<string, unknown>) ?? {}),
    trace_id: { type: "string", description: "Echo back the trace_id from input" },
  };
  return {
    type: "object",
    required: ["trace_results"],
    properties: {
      trace_results: {
        type: "array",
        items: { ...single, type: "object", required, properties },
      },
    },
  };
}

/**
 * Stage-2 batched rubric evaluator. Splits flagged traces into chunks of K
 * (default 10), one LLM call per chunk, then validates each per-trace verdict
 * against the rule's output schema PLUS two ground-truth checks:
 *   - trace_id must echo back one of this chunk's input trace_ids
 *   - first_violating_step_id must be a real span_id in THAT trace's spans
 * Failures isolate to the affected trace; chunk-wide LLM failures skip the
 * whole chunk with agent-error:<kind>.
 */
export async function runBatchedRubric(opts: RunBatchedRubricOpts): Promise<BatchedRubricResult> {
  const { rule, traces, agentId, provider, promptRegistry, chunkSize, artifacts } = opts;
  const verdicts: BatchedRubricVerdict[] = [];
  const skipped: BatchedRubricSkipped[] = [];

  if (artifacts) {
    await artifacts.writeStageTwoWorkQueue(rule.ruleId, traces.map((t) => t.traceId));
  }

  const tpl = promptRegistry.get(rule.promptTemplateRef);
  const chunks = chunkArray(traces, chunkSize);

  for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
    const chunk = chunks[chunkIdx];
    const traceIdSet = new Set(chunk.map((t) => t.traceId));
    const spansByTraceId = new Map(chunk.map((t) => [t.traceId, new Set(t.spans)]));

    const prompt = renderPrompt(tpl, {
      rule_id: rule.ruleId,
      batch_size: chunk.length,
      agent_id: agentId,
      judge_question: rule.judgeQuestion,
      traces_yaml: buildTracesYaml(chunk),
      output_schema: wrapSchemaForBatch(rule.outputSchemaRaw),
      language_instruction: languageInstructionFor(opts.lang ?? "en"),
    });

    if (artifacts) await artifacts.writeStageTwoPrompt(rule.ruleId, chunkIdx, prompt);

    // rule.outputSchema is the SINGLE-verdict shape (zod converted from rule YAML's
    // output_schema block). The Stage-2 batched prompt asks the LLM to return
    // { trace_results: [<verdict>, ...] }, so we wrap before validation.
    // We also extend each array item with trace_id (the LLM echoes back the
    // trace_id from the input; the raw prompt schema enforces this via
    // wrapSchemaForBatch above, so the zod schema must match).
    const batchedOutputSchema = z.object({
      trace_results: z.array(
        (rule.outputSchema as z.ZodTypeAny).and(z.object({ trace_id: z.string() })),
      ),
    });

    let response: unknown;
    try {
      const resp = await provider.invoke({
        prompt,
        outputSchema: batchedOutputSchema,
        tier: "fast",
        timeoutMs: opts.timeoutMs,
        correlationId: `stage-2/${rule.ruleId}/chunk-${chunkIdx}`,
      });
      response = resp.output;
    } catch (e) {
      const kind = e instanceof AgentProviderError ? e.kind : "transport";
      for (const t of chunk) skipped.push({ traceId: t.traceId, reason: `agent-error:${kind}` });
      if (artifacts) await artifacts.writeStageTwoResponse(rule.ruleId, chunkIdx, { error: String(e) });
      continue;
    }

    if (artifacts) await artifacts.writeStageTwoResponse(rule.ruleId, chunkIdx, response);

    const parseErrors: { traceId: string; reason: string }[] = [];
    const items = (response as { trace_results?: unknown[] }).trace_results ?? [];
    const seenInChunk = new Set<string>(); // NEW: defend against LLM emitting same trace_id twice
    for (const item of items) {
      const itm = item as Record<string, unknown>;
      const traceId = typeof itm.trace_id === "string" ? itm.trace_id : undefined;
      if (!traceId || !traceIdSet.has(traceId)) {
        // Unrecognized trace_id: silently discard — the "missing in trace_results"
        // loop below will create a schema_violation entry for the actual input trace.
        continue;
      }
      if (seenInChunk.has(traceId)) {
        // LLM violated "no duplicates" — drop the duplicate verdict, record parse-error.
        // The first occurrence has already been accepted; we keep that one as the verdict.
        parseErrors.push({ traceId, reason: "schema_violation: duplicate trace_id in trace_results" });
        continue;
      }
      seenInChunk.add(traceId);
      const first = typeof itm.first_violating_step_id === "string" ? itm.first_violating_step_id : undefined;
      if (!first || !spansByTraceId.get(traceId)!.has(first)) {
        parseErrors.push({
          traceId,
          reason: `schema_violation: first_violating_step_id '${first}' not in trace's spans`,
        });
        continue;
      }
      verdicts.push({
        traceId,
        category: String(itm.category ?? "other"),
        reasoning: String(itm.reasoning ?? ""),
        severity: (itm.severity as "low" | "medium" | "high") ?? "low",
        firstViolatingStepId: first,
        evidenceSpanIds: Array.isArray(itm.evidence_span_ids)
          ? itm.evidence_span_ids.map(String)
          : [first],
      });
    }

    // Any trace_id in this chunk's input that didn't appear in trace_results → schema_violation.
    const verdictTraceIds = new Set(items.map((i) => (i as Record<string, unknown>).trace_id));
    for (const t of chunk) {
      if (!verdictTraceIds.has(t.traceId)) {
        parseErrors.push({
          traceId: t.traceId,
          reason: "schema_violation: missing in trace_results",
        });
      }
    }

    for (const pe of parseErrors) skipped.push({ traceId: pe.traceId, reason: `agent-error:${pe.reason}` });
    if (parseErrors.length > 0 && artifacts) {
      await artifacts.writeStageTwoParseErrors(rule.ruleId, chunkIdx, parseErrors);
    }
  }

  return { verdicts, skipped };
}
