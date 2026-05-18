import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildTriagePrompt } from "../src/trace-ai/exp/providers/triage-client.js";
import type { RoundData, QueryFailureAnalysis, Mission, KnContext, SkillContext } from "../src/trace-ai/exp/schemas.js";

const mission: Mission = {
  schema_version: "trace-mission/v1",
  goal: "reduce retries",
  eval_sets: [{ path: "eval-sets/v1", role: "seed" }],
  current_candidate: { path: "candidates/baseline.yaml" },
  enabled_targets: ["agent.system_prompt", "agent.skills", "kn.object_type", "kn.relation_type", "skill.content"],
};

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

describe("buildTriagePrompt (merged planner)", () => {
  it("includes FAILURE ANALYSIS section when failureAnalysis provided", () => {
    const prompt = buildTriagePrompt({ mission, currentRound: round, prevRounds: [], candidateConfig: {}, failureAnalysis });
    assert.ok(prompt.includes("FAILURE ANALYSIS"));
    assert.ok(prompt.includes("Q38"));
    assert.ok(prompt.includes("5816辆"));
    assert.ok(prompt.includes("kn_search(vehicle_sales)"));
  });

  it("falls back to FAILED QUERIES section when no failureAnalysis", () => {
    const prompt = buildTriagePrompt({ mission, currentRound: round, prevRounds: [], candidateConfig: {} });
    assert.ok(prompt.includes("FAILED QUERIES"));
  });

  it("asks LLM for every field the parser reads", () => {
    const prompt = buildTriagePrompt({ mission, currentRound: round, prevRounds: [], candidateConfig: {} });
    for (const field of ["verdict", "summary", "failure_attribution", "next_change", "hints", "new_memory_token"]) {
      assert.match(prompt, new RegExp(`"${field}"`), `prompt must request field ${field}`);
    }
  });

  it("includes mission goal and candidate config", () => {
    const prompt = buildTriagePrompt({
      mission, currentRound: round, prevRounds: [],
      candidateConfig: { agent: { system_prompt: "the-old-prompt" } },
    });
    assert.match(prompt, /GOAL: reduce retries/);
    assert.match(prompt, /the-old-prompt/);
  });

  it("renders kn_context with data_probes when provided", () => {
    const knCtx: KnContext = {
      kn_id: "kn-x",
      existing_schema: { object_types: [{ concept_name: "vehicle", fields: [{ name: "id", type: "string" }] }], relation_types: [] },
      available_dataviews: [{ id: "dv01", name: "ht_vehicle_sales", columns: [{ name: "sales", type: "int" }] }],
      data_probes: [{ concept_name: "vehicle_sales", data_view_id: "dv01", total_records: 1453 }],
    };
    const prompt = buildTriagePrompt({ mission, currentRound: round, prevRounds: [], candidateConfig: {}, kn_context: knCtx });
    assert.match(prompt, /Existing KN Schema/);
    assert.match(prompt, /Data Probes/);
    assert.match(prompt, /1453 records/);
  });

  it("renders skill_context when provided", () => {
    const skillCtx: SkillContext = {
      bound_skills: [{ id: "query-sop", version: "v1", content: "# Query SOP\nUse kn_search first." }],
    };
    const prompt = buildTriagePrompt({ mission, currentRound: round, prevRounds: [], candidateConfig: {}, skill_context: skillCtx });
    assert.match(prompt, /Currently Bound Skills/);
    assert.match(prompt, /query-sop/);
  });

  it("has output example for every NextChange target", () => {
    const prompt = buildTriagePrompt({ mission, currentRound: round, prevRounds: [], candidateConfig: {} });
    for (const t of ["agent.system_prompt", "agent.skills", "kn.object_type", "kn.relation_type", "skill.content"]) {
      assert.match(prompt, new RegExp(`"target":"${t.replace(/\./g, "\\.")}"`), `missing example for ${t}`);
    }
  });

  it("restricts output examples + suggested_target enum to enabled_targets", () => {
    const restricted: Mission = { ...mission, enabled_targets: ["agent.system_prompt"] };
    const prompt = buildTriagePrompt({ mission: restricted, currentRound: round, prevRounds: [], candidateConfig: {} });
    assert.match(prompt, /"target":"agent\.system_prompt"/, "enabled example must appear");
    assert.doesNotMatch(prompt, /"target":"kn\.object_type"/, "disabled kn example must NOT appear");
    assert.doesNotMatch(prompt, /"target":"skill\.content"/, "disabled skill example must NOT appear");
    assert.match(prompt, /enabled_targets = \[agent\.system_prompt\]/);
  });
});
