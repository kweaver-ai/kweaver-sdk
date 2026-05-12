// packages/typescript/test/scan-summary-markdown.test.ts
import test from "node:test";
import assert from "node:assert/strict";

import { renderScanSummaryMarkdown } from "../src/trace-ai/scan/scan-summary-markdown.js";
import type { ScanSummary } from "../src/trace-ai/scan/scan-summary-schema.js";

function makeScanSummary(overrides: Partial<ScanSummary> = {}): ScanSummary {
  return {
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
      headline: "tool_loop dominates",
      primary_root_cause: {
        rule_ids: ["tool_loop_no_state_change"],
        description: "loop pattern",
        target_for_fix: "decision_agent.prompt",
      },
      fix_priority: [
        { rule_id: "tool_loop_no_state_change", affected_trace_count: 4, reason: "dominant" },
      ],
      cross_rule_links: [],
    },
    aggregates: {
      rule_frequency: [
        { rule_id: "tool_loop_no_state_change", count: 4, severity_breakdown: { high: 3, medium: 1, low: 0 } },
      ],
    },
    per_trace_index: [
      { trace_id: "tr_a", conversation_id: "conv_a", report_path: "conv_a.yaml", finding_count: 1 },
    ],
    ...overrides,
  };
}

test("renderScanSummaryMarkdown: title + agent banner + headline", () => {
  const md = renderScanSummaryMarkdown(makeScanSummary());
  assert.match(md, /^# Trace Diagnose Batch Summary — agent `01KR_x`/m);
  assert.match(md, /\*\*tool_loop dominates\*\*/);
});

test("renderScanSummaryMarkdown: aggregates rule_frequency rendered as table", () => {
  const md = renderScanSummaryMarkdown(makeScanSummary());
  assert.match(md, /## Aggregates/);
  assert.match(md, /\| Rule \| Count \| high \| medium \| low \|/);
  assert.match(md, /\| `tool_loop_no_state_change` \| 4 \| 3 \| 1 \| 0 \|/);
});

test("renderScanSummaryMarkdown: per_trace_index rendered as table with report_path", () => {
  const md = renderScanSummaryMarkdown(makeScanSummary());
  assert.match(md, /## Per-Trace Reports/);
  assert.match(md, /\| `conv_a` \| .* \| 1 \| \[yaml\]\(conv_a\.yaml\) \/ \[md\]\(conv_a\.md\) \|/);
});

test("renderScanSummaryMarkdown: summary=null → Stage-4 failure note + aggregates still rendered", () => {
  const md = renderScanSummaryMarkdown(makeScanSummary({ summary: null }));
  assert.match(md, /## Summary/);
  assert.match(md, /Stage-4 synthesizer did not complete/);
  assert.match(md, /## Aggregates/);
});

test("renderScanSummaryMarkdown: fix_priority omitted when summary is null", () => {
  const md = renderScanSummaryMarkdown(makeScanSummary({ summary: null }));
  assert.ok(!/## Fix priority/.test(md));
});

test("renderScanSummaryMarkdown: cross_rule_links section rendered when non-empty", () => {
  const md = renderScanSummaryMarkdown(makeScanSummary({
    summary: {
      headline: "h",
      primary_root_cause: null,
      fix_priority: [],
      cross_rule_links: [{ rule_ids: ["a", "b"], relation: "same span sequence" }],
    },
  }));
  assert.match(md, /## Cross-rule links/);
  assert.match(md, /- `a` ↔ `b` — same span sequence/);
});

test("renderScanSummaryMarkdown: resume banner shown when resumed_from_partial=true", () => {
  const md = renderScanSummaryMarkdown(makeScanSummary({
    scan: { ...makeScanSummary().scan, resumed_from_partial: true, traces_reused: 6, traces_freshly_diagnosed: 4 },
  }));
  assert.match(md, /resumed — 6 reused, 4 freshly diagnosed/);
});
