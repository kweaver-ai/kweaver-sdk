import yaml from "js-yaml";

import type { AgentProvider } from "../../agent-providers/types.js";
import { AgentProviderError } from "../../agent-providers/types.js";
import { PromptTemplateRegistry, render as renderPrompt, languageInstructionFor, type AgentOutputLang } from "../../agent-providers/prompt-template.js";
import { ScanSummaryShape } from "./scan-summary-schema.js";
import type { AggregatesBlock } from "./aggregator.js";
import type { SamplerOutput } from "./sampler.js";
import { ArtifactWriter } from "./artifacts/writer.js";

export interface CrossTraceSynthesizerResult {
  summary: import("zod").infer<typeof ScanSummaryShape> | null;
  /** Non-null when summary is null (schema_violation / transport / etc.). */
  fallbackReason?: string;
}

export interface RunCrossTraceSynthesizerOpts {
  agentId: string;
  aggregates: AggregatesBlock;
  samples: SamplerOutput;
  nTotal: number;
  provider: AgentProvider;
  promptRegistry: PromptTemplateRegistry;
  promptRef?: string;
  lang?: AgentOutputLang;
  artifacts?: ArtifactWriter;
  timeoutMs?: number;
}

const SUMMARY_OUTPUT_SCHEMA_DESCRIPTION = {
  type: "object",
  required: ["headline", "primary_root_cause", "fix_priority", "cross_rule_links"],
  properties: {
    headline: { type: "string", maxLength: 160 },
    primary_root_cause: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          required: ["rule_ids", "description", "target_for_fix"],
          properties: {
            rule_ids: { type: "array", items: { type: "string" }, minItems: 1 },
            description: { type: "string" },
            target_for_fix: { type: "string" },
          },
        },
      ],
    },
    fix_priority: {
      type: "array",
      items: {
        type: "object",
        required: ["rule_id", "affected_trace_count", "reason"],
        properties: {
          rule_id: { type: "string" },
          affected_trace_count: { type: "integer", minimum: 0 },
          reason: { type: "string" },
        },
      },
    },
    cross_rule_links: {
      type: "array",
      items: {
        type: "object",
        required: ["rule_ids", "relation"],
        properties: {
          rule_ids: { type: "array", items: { type: "string" }, minItems: 2 },
          relation: { type: "string" },
        },
      },
    },
  },
};

function formatRatio(k: number, n: number): string {
  if (n === 0) return "0%";
  return `${Math.round((k / n) * 100)}%`;
}

export async function runCrossTraceSynthesizer(opts: RunCrossTraceSynthesizerOpts): Promise<CrossTraceSynthesizerResult> {
  const { agentId, aggregates, samples, nTotal, provider, promptRegistry, artifacts } = opts;
  const ref = opts.promptRef ?? "builtin:cross-trace-synthesizer-v1";
  const sampleCount = samples.samples.length;

  if (artifacts) await artifacts.writeStageFourInputs(aggregates, samples);

  const tpl = promptRegistry.get(ref);
  const prompt = renderPrompt(tpl, {
    n_total: nTotal,
    sample_count: sampleCount,
    sample_ratio: formatRatio(sampleCount, nTotal),
    agent_id: agentId,
    aggregates: yaml.dump(aggregates, { lineWidth: 120 }),
    samples_yaml: yaml.dump(samples, { lineWidth: 120 }),
    output_schema: SUMMARY_OUTPUT_SCHEMA_DESCRIPTION,
    language_instruction: languageInstructionFor(opts.lang ?? "en"),
  });

  if (artifacts) await artifacts.writeStageFourPrompt(prompt);

  try {
    const resp = await provider.invoke({
      prompt,
      outputSchema: ScanSummaryShape,
      tier: "std",
      timeoutMs: opts.timeoutMs,
      correlationId: `stage-4/${agentId}`,
    });
    if (artifacts) await artifacts.writeStageFourResponse(resp.output);
    return { summary: resp.output };
  } catch (e) {
    const kind = e instanceof AgentProviderError ? e.kind : "transport";
    if (artifacts) {
      await artifacts.writeStageFourResponse({ error: String(e) });
      await artifacts.writeStageFourParseErrors([{ reason: `agent-error:${kind}`, detail: String(e) }]);
    }
    return { summary: null, fallbackReason: `agent-error:${kind}` };
  }
}
