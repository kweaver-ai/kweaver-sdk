// packages/typescript/test/scan-summary-schema.test.ts
import test from "node:test";
import assert from "node:assert/strict";

import { ScanSummarySchema, ScanSummaryShape } from "../src/trace-ai/scan/scan-summary-schema.js";

const minimal = {
  schema_version: "scan-summary/v1",
  scan: {
    agent_id: "01KR_x",
    trace_count: 10,
    traces_with_findings: 4,
    traces_reused: 0,
    traces_freshly_diagnosed: 10,
    resumed_from_partial: false,
    diagnosed_at: "2026-05-12T00:00:00.000Z",
    cli_version: "0.7.4",
    synthesizer_mode: "agent",
  },
  summary: {
    headline: "h",
    primary_root_cause: {
      rule_ids: ["tool_loop_no_state_change"],
      description: "d",
      target_for_fix: "decision_agent.prompt",
    },
    fix_priority: [{ rule_id: "tool_loop_no_state_change", affected_trace_count: 4, reason: "r" }],
    cross_rule_links: [],
  },
  aggregates: {
    rule_frequency: [
      { rule_id: "tool_loop_no_state_change", count: 4, severity_breakdown: { high: 3, medium: 1, low: 0 } },
    ],
  },
  per_trace_index: [
    { trace_id: "tr_a", conversation_id: "conv_a", report_path: "diagnosis/conv_a.yaml", finding_count: 1 },
  ],
};

test("ScanSummarySchema: minimal valid object parses", () => {
  const r = ScanSummarySchema.parse(minimal);
  assert.equal(r.scan.agent_id, "01KR_x");
});

test("ScanSummarySchema: summary nullable (Stage-4 failure)", () => {
  const withNull = { ...minimal, summary: null };
  const r = ScanSummarySchema.parse(withNull);
  assert.equal(r.summary, null);
});

test("ScanSummarySchema: agent_id required (cannot be empty string)", () => {
  const bad = { ...minimal, scan: { ...minimal.scan, agent_id: "" } };
  const r = ScanSummarySchema.safeParse(bad);
  assert.equal(r.success, false);
});

test("ScanSummarySchema: synthesizer_mode must be 'agent' (no template in batch)", () => {
  const bad = { ...minimal, scan: { ...minimal.scan, synthesizer_mode: "template" } };
  const r = ScanSummarySchema.safeParse(bad);
  assert.equal(r.success, false);
});

test("ScanSummarySchema: traces_reused + traces_freshly_diagnosed = trace_count invariant NOT enforced (informational fields)", () => {
  const inconsistent = { ...minimal, scan: { ...minimal.scan, traces_reused: 5, traces_freshly_diagnosed: 2 } };
  const r = ScanSummarySchema.safeParse(inconsistent);
  assert.equal(r.success, true);
});

test("ScanSummaryShape (Stage-4 LLM output) parses without scan/aggregates/per_trace_index (those are filled by orchestrator)", () => {
  const llmOutput = {
    headline: "x",
    primary_root_cause: null,
    fix_priority: [],
    cross_rule_links: [],
  };
  const r = ScanSummaryShape.parse(llmOutput);
  assert.equal(r.headline, "x");
});
