/**
 * Gates-on test: a rubric rule with gates_on:[tool_loop_no_state_change]
 * should only run for traces where that symbolic rule fired. Traces without
 * the symbolic rule should not appear in any rubric batch call.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";

import { runBatch } from "../../src/trace-ai/scan/index.js";
import { defaultRegistry } from "../../src/agent-providers/registry.js";
import { StubAgentProvider } from "../../src/agent-providers/providers/stub.js";
import { tmpOutDir, mockTraceFetcher, FIX } from "./_scan-helpers.js";

test("e2e batch gates_on: rubric only runs on traces where symbolic gate fired", async () => {
  // Two traces that fire tool_loop (3 retrieval calls with identical args)
  const loopFixture = JSON.parse(
    await fs.readFile(path.join(FIX, "synthetic/tool-loop-with-agent-id.json"), "utf8"),
  );
  // Two traces that do NOT fire tool_loop (de39cbe9 has no matching patterns)
  const noLoopFixture = JSON.parse(
    await fs.readFile(path.join(FIX, "real/de39cbe9.json"), "utf8"),
  );
  // Add agent_id to the no-loop fixture spans
  const noLoopFixtureWithAgent = {
    hits: {
      hits: noLoopFixture.hits.hits.map((h: { _source: Record<string, unknown> }) => ({
        _source: {
          ...h._source,
          attributes: {
            ...((h._source.attributes as Record<string, unknown>) ?? {}),
            "gen_ai.agent.id": "agent_loop_tester",
          },
        },
      })),
    },
  };

  const fetcher = mockTraceFetcher(
    new Map([
      ["gate_loop_a", loopFixture],
      ["gate_loop_b", loopFixture],
      ["gate_noloop_a", noLoopFixtureWithAgent],
      ["gate_noloop_b", noLoopFixtureWithAgent],
    ]),
  );

  // Write a custom rubric rule with gates_on: [tool_loop_no_state_change]
  const out = await tmpOutDir("batch-gates");
  const rulesDir = path.join(out, "custom-rules");
  await fs.mkdir(rulesDir, { recursive: true });
  const gatedRuleYaml = yaml.dump({
    schema_version: "diagnosis-rule/v1",
    id: "gated_rubric_check",
    severity: "medium",
    symptom: "gated_symptom",
    taxonomy: { signals_axis: "execution", ms_class: "retry_loop" },
    suggested_fix: {
      target: "agent.prompt",
      change_template: "fix gated issue",
    },
    verify_with: { assertion_templates: [] },
    rubric: {
      judge_question: "Did the agent handle the retry correctly?",
      inputs: [
        { kind: "span_sequence", source: "filter_by_kind:[tool,llm]" },
      ],
      output_schema: {
        type: "object",
        required: ["category", "reasoning", "severity", "first_violating_step_id"],
        properties: {
          category: { type: "string", enum: ["ok", "bad"] },
          reasoning: { type: "string" },
          severity: { type: "string", enum: ["low", "medium", "high"] },
          confidence: { type: "string", enum: ["low", "medium", "high"] },
          first_violating_step_id: { type: "string" },
          evidence_span_ids: { type: "array", items: { type: "string" } },
        },
      },
      agent_binding: {
        provider: "claude-code",
        prompt_template_ref: "builtin:rubric-judge-batch-v1",
      },
      gates_on: ["tool_loop_no_state_change"],
    },
  });
  await fs.writeFile(path.join(rulesDir, "gated.yaml"), gatedRuleYaml, "utf8");

  // Capture which trace_ids appear in stub rubric calls
  const promptsReceived: string[] = [];
  const stub = new StubAgentProvider({
    name: "claude-code",
    capabilities: ["structured_output"],
    responseFn: async (prompt: string) => {
      if (/Cross-Trace Synthesizer/i.test(prompt)) {
        return {
          headline: "loop gating test",
          primary_root_cause: null,
          fix_priority: [],
          cross_rule_links: [],
        };
      }
      // Batched rubric call: record the prompt and return valid verdicts
      promptsReceived.push(prompt);
      // Extract trace_ids and their first real span from the prompt
      const traceBlocks = [...prompt.matchAll(/- trace_id:\s+(\S+)/g)];
      const spansForTrace = new Map<string, string[]>();
      const spansMatches = [...prompt.matchAll(/trace_id:\s+(\S+)[\s\S]*?spans:\n((?:\s*- \S+\n)*)/g)];
      for (const m of spansMatches) {
        const traceId = m[1];
        const spansBlock = m[2];
        const spanIds = [...spansBlock.matchAll(/- (\S+)/g)].map((s) => s[1]);
        spansForTrace.set(traceId, spanIds);
      }
      const results = traceBlocks.map((m) => {
        const traceId = m[1];
        const spanIds = spansForTrace.get(traceId) ?? ["root"];
        return {
          trace_id: traceId,
          category: "ok",
          reasoning: `gated rubric for ${traceId}`,
          severity: "low",
          first_violating_step_id: spanIds[0] ?? "root",
          evidence_span_ids: spanIds,
        };
      });
      return { trace_results: results };
    },
  });
  defaultRegistry.register(stub, { setAsDefault: true });

  try {
    await runBatch({
      traces: ["gate_loop_a", "gate_loop_b", "gate_noloop_a", "gate_noloop_b"],
      out,
      rulesDir,
      noBuiltin: false,
      noArtifacts: true,
      timeoutMs: 60000,
      maxParallel: 4,
      baseUrl: "http://mock.kweaver.test",
      token: "tk",
      businessDomain: "bd_public",
    });

    // The rubric was gated — it should only have been called for the 2 loop traces
    assert.ok(
      promptsReceived.length > 0,
      "at least one rubric batch call must have occurred",
    );
    for (const prompt of promptsReceived) {
      assert.ok(
        !prompt.includes("gate_noloop_a") && !prompt.includes("gate_noloop_b"),
        "non-gated traces must NOT appear in rubric batch prompts",
      );
      // Loop traces should appear
      assert.ok(
        prompt.includes("gate_loop_a") || prompt.includes("gate_loop_b"),
        "gated loop traces should appear in the rubric prompt",
      );
    }
  } finally {
    fetcher.restore();
    await fs.rm(out, { recursive: true, force: true });
  }
});
