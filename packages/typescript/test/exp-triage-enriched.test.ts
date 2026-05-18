import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildTriagePrompt } from "../src/trace-ai/exp/providers/triage-client.js";
import type { RoundData, QueryFailureAnalysis } from "../src/trace-ai/exp/schemas.js";

const round: RoundData = {
  round: 3,
  trial_version: 3,
  scores: { outcome: 0.5, trajectory: 1.0, guardrail: 1.0, guardrail_hard_fail: false },
  per_query_results: [
    {
      query_id: "Q38",
      assertion_results: [{ type: "semantic_match", verdict: "fail", reason: "wrong cars" }],
      trajectory_summary: { tool_call_sequence: [], retry_count: 0, latency_ms: 0, error_codes: [] },
    },
  ],
};

const failureAnalysis: QueryFailureAnalysis[] = [
  {
    query_id: "Q38",
    verdict: "fail",
    assertion_reason: "agent returned 别克-君越 5816辆, expected 大众-朗逸 42780辆",
    tool_call_summary: ["kn_search(vehicle_sales)→10 records", "kn_search(brand)→5 records"],
  },
];

describe("buildTriagePrompt", () => {
  it("includes FAILURE ANALYSIS section when failureAnalysis provided", () => {
    const prompt = buildTriagePrompt({ currentRound: round, prevRounds: [], candidateConfig: {}, failureAnalysis });
    assert.ok(prompt.includes("FAILURE ANALYSIS"), "prompt should contain FAILURE ANALYSIS section");
    assert.ok(prompt.includes("Q38"), "prompt should mention Q38");
    assert.ok(prompt.includes("5816辆"), "prompt should include assertion reason excerpt");
    assert.ok(prompt.includes("kn_search(vehicle_sales)"), "prompt should include tool call summary");
  });

  it("falls back to FAILED QUERIES section when no failureAnalysis", () => {
    const prompt = buildTriagePrompt({ currentRound: round, prevRounds: [], candidateConfig: {} });
    assert.ok(prompt.includes("FAILED QUERIES"), "prompt should fall back to FAILED QUERIES");
  });
});
