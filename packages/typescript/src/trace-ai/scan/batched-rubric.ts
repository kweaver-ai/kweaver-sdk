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
      output_schema: rule.outputSchemaRaw,
      language_instruction: languageInstructionFor(opts.lang ?? "en"),
    });

    if (artifacts) await artifacts.writeStageTwoPrompt(rule.ruleId, chunkIdx, prompt);

    let response: unknown;
    try {
      const resp = await provider.invoke({
        prompt,
        outputSchema: rule.outputSchema,
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
