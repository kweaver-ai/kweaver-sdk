import test from "node:test";
import assert from "node:assert/strict";

import { renderReportMarkdown } from "../src/trace-ai/diagnose/report-markdown.js";
import { derivePaths } from "../src/trace-ai/diagnose/index.js";
import type { Finding, Report, Summary } from "../src/trace-ai/diagnose/types.js";

function makeReport(overrides: Partial<Report> = {}): Report {
  const summary: Summary = {
    headline: "h",
    primaryRootCause: null,
    fixPriority: [],
    crossFindingLinks: [],
  };
  return {
    schemaVersion: "trace-diagnose-report/v1",
    trace: { traceId: "2854f77162dcf3675d1e7297a956cd24", agentId: "agent_x", tenant: null },
    run: {
      diagnosedAt: "2026-05-12T01:00:00.000Z",
      cliVersion: "0.7.4",
      mode: "hybrid",
      rulesApplied: ["rule_a", "rule_b"],
      rulesSkipped: [],
      synthesizerMode: "agent",
    },
    summary,
    findings: [],
    ...overrides,
  };
}

const symbolicFinding: Finding = {
  ruleId: "tool_loop_no_state_change",
  judgmentKind: "symbolic",
  severity: "high",
  symptom: "repeated_tool_call_without_state_change",
  likelyCause: "repeated_tool_call_without_state_change",
  evidence: { spans: ["sp_7", "sp_8", "sp_9"], excerpt: "retrieval called 3× identical args" },
  suggestedFix: { target: "decision_agent.prompt", change: "add stop condition after 3 retries" },
  confidence: "low",
  verifyWith: { suggestedEvalCase: { queryId: null, query: null, assertions: ["count(retrieval) <= 2"] } },
};

const rubricFinding: Finding = {
  ruleId: "tool_retry_intent_mismatch",
  judgmentKind: "rubric",
  severity: "high",
  symptom: "repeated_tool_call_without_state_change",
  likelyCause: "stale_results",
  evidence: { spans: ["sp_7", "sp_8"], excerpt: "agent did not detect stale retrieval results" },
  suggestedFix: { target: "decision_agent.prompt", change: "after second identical retrieval response, switch to clarification" },
  confidence: "high",
  verifyWith: { suggestedEvalCase: { queryId: null, query: null, assertions: [] } },
};

test("renderReportMarkdown: title contains short trace_id, meta line carries full id + agent", () => {
  const md = renderReportMarkdown(makeReport());
  assert.match(md, /^# Trace Diagnose Report — `2854f77162dcf367…`/);
  assert.match(md, /trace `2854f77162dcf3675d1e7297a956cd24`/);
  assert.match(md, /agent `agent_x`/);
  assert.match(md, /tenant `—`/, "null tenant renders as em-dash");
});

test("renderReportMarkdown: empty findings → 'No findings were emitted' line, no fix-priority or cross-link sections", () => {
  const md = renderReportMarkdown(makeReport());
  assert.match(md, /## Findings \(0\)/);
  assert.match(md, /No findings were emitted by any of the 2 applied rules/);
  assert.ok(!/## Fix priority/.test(md), "Fix priority section must be omitted when empty");
  assert.ok(!/## Cross-finding links/.test(md), "Cross-finding links section must be omitted when empty");
});

test("renderReportMarkdown: primary root cause block included when non-null", () => {
  const md = renderReportMarkdown(makeReport({
    summary: {
      headline: "Agent looped on stale retrievals",
      primaryRootCause: { findingIds: [0, 1], description: "Loop + stale-results handling failure on same span sequence", targetForFix: "decision_agent.prompt" },
      fixPriority: [],
      crossFindingLinks: [],
    },
  }));
  assert.match(md, /\*\*Agent looped on stale retrievals\*\*/);
  assert.match(md, /Primary root cause spans findings #0, #1/);
  assert.match(md, /target for fix: `decision_agent\.prompt`/);
  assert.match(md, /> Loop \+ stale-results handling failure/);
});

test("renderReportMarkdown: primary root cause description with newlines collapses to single blockquote line", () => {
  const md = renderReportMarkdown(makeReport({
    summary: {
      headline: "x",
      primaryRootCause: { findingIds: [0], description: "line one\n\nline two", targetForFix: "t" },
      fixPriority: [],
      crossFindingLinks: [],
    },
  }));
  assert.match(md, /> line one line two/);
});

test("renderReportMarkdown: fix priority table maps finding_id to rule + severity + judgment", () => {
  const md = renderReportMarkdown(makeReport({
    findings: [symbolicFinding, rubricFinding],
    summary: {
      headline: "h",
      primaryRootCause: null,
      fixPriority: [
        { findingId: 0, reason: "highest severity; root of cascading retry" },
        { findingId: 1, reason: "same incident as f0 from semantic angle" },
      ],
      crossFindingLinks: [],
    },
  }));
  assert.match(md, /## Fix priority/);
  assert.match(md, /\| 1 \| #0 \| `tool_loop_no_state_change` \[high\/symbolic\] \| highest severity; root of cascading retry \|/);
  assert.match(md, /\| 2 \| #1 \| `tool_retry_intent_mismatch` \[high\/rubric\] \| same incident as f0 from semantic angle \|/);
});

test("renderReportMarkdown: fix priority cell escapes pipes and collapses newlines", () => {
  const md = renderReportMarkdown(makeReport({
    findings: [symbolicFinding],
    summary: {
      headline: "h",
      primaryRootCause: null,
      fixPriority: [{ findingId: 0, reason: "raw|pipe and\nnewline here" }],
      crossFindingLinks: [],
    },
  }));
  assert.match(md, /raw\\\|pipe and newline here/);
});

test("renderReportMarkdown: finding section has severity/judgment header, blockquoted excerpt, span ids in backticks", () => {
  const md = renderReportMarkdown(makeReport({ findings: [symbolicFinding] }));
  assert.match(md, /### #0 `tool_loop_no_state_change` — \[high\/symbolic\]/);
  assert.match(md, /> retrieval called 3× identical args/);
  assert.match(md, /\*\*evidence spans\*\*: `sp_7`, `sp_8`, `sp_9`/);
  assert.match(md, /\*\*suggested fix\*\* → `decision_agent\.prompt`: add stop condition after 3 retries/);
  assert.match(md, /\*\*verify with\*\*:\s*\n\s+- count\(retrieval\) <= 2/);
});

test("renderReportMarkdown: finding with empty assertions list omits the 'verify with' bullet", () => {
  const md = renderReportMarkdown(makeReport({ findings: [rubricFinding] }));
  assert.match(md, /### #0 `tool_retry_intent_mismatch`/);
  assert.ok(!/\*\*verify with\*\*/.test(md), "verify-with bullet must be omitted when assertions is empty");
});

test("renderReportMarkdown: multi-line excerpt is rendered as multi-line blockquote", () => {
  const finding: Finding = {
    ...symbolicFinding,
    evidence: { spans: ["sp_1"], excerpt: "first line\nsecond line\nthird line" },
  };
  const md = renderReportMarkdown(makeReport({ findings: [finding] }));
  assert.match(md, /> first line\n> second line\n> third line/);
});

test("renderReportMarkdown: cross-finding links section uses ↔ between ids", () => {
  const md = renderReportMarkdown(makeReport({
    findings: [symbolicFinding, rubricFinding],
    summary: {
      headline: "h",
      primaryRootCause: null,
      fixPriority: [],
      crossFindingLinks: [{ findingIds: [0, 1], relation: "same span sequence" }],
    },
  }));
  assert.match(md, /## Cross-finding links/);
  assert.match(md, /- #0 ↔ #1 — same span sequence/);
});

test("renderReportMarkdown: Run section lists applied rules and reasons for skipped ones", () => {
  const md = renderReportMarkdown(makeReport({
    run: {
      diagnosedAt: "2026-05-12T01:00:00.000Z",
      cliVersion: "0.7.4",
      mode: "hybrid",
      rulesApplied: ["rule_a", "rule_b", "rule_c"],
      rulesSkipped: [
        { ruleId: "rule_c", reason: "no-llm-flag-set" },
        { ruleId: "rule_d", reason: "provider-not-available:claude-code" },
      ],
      synthesizerMode: "template",
    },
  }));
  assert.match(md, /\*\*mode\*\*: `hybrid` · \*\*synthesizer\*\*: `template` · \*\*rules\*\*: 3 applied, 2 skipped/);
  assert.match(md, /\*\*applied\*\*: `rule_a`, `rule_b`, `rule_c`/);
  assert.match(md, /- `rule_c` — no-llm-flag-set/);
  assert.match(md, /- `rule_d` — provider-not-available:claude-code/);
});

test("renderReportMarkdown: short trace_id (<=16 chars) is rendered without ellipsis", () => {
  const md = renderReportMarkdown(makeReport({
    trace: { traceId: "short_id", agentId: null, tenant: null },
  }));
  assert.match(md, /# Trace Diagnose Report — `short_id`/);
  assert.ok(!/short_id…/.test(md), "no ellipsis for short ids");
});

test("renderReportMarkdown: agentId null renders as em-dash in meta line", () => {
  const md = renderReportMarkdown(makeReport({
    trace: { traceId: "tr_x_y_z_1234567890123", agentId: null, tenant: "acme" },
  }));
  assert.match(md, /agent `—` · tenant `acme`/);
});

// ── How to verify section ───────────────────────────────────────────────────

test("renderReportMarkdown: verification section emits 'kweaver call' command containing the trace_id", () => {
  const md = renderReportMarkdown(makeReport({ findings: [symbolicFinding] }), {
    conversationId: "01KCONV",
    businessDomain: "bd_public",
  });
  assert.match(md, /## How to verify/);
  assert.match(md, /kweaver call -X POST '\/api\/agent-observability\/v1\/traces\/_search'/);
  assert.match(md, /"term":\{"traceId":"2854f77162dcf3675d1e7297a956cd24"\}/);
});

test("renderReportMarkdown: verification emits 'kweaver trace diagnose <conv_id>' with the supplied conversationId", () => {
  const md = renderReportMarkdown(makeReport(), { conversationId: "01KCONV", businessDomain: "bd_public" });
  assert.match(md, /kweaver trace diagnose 01KCONV --no-llm --out \/tmp\/verify\.yaml -bd bd_public/);
});

test("renderReportMarkdown: missing conversationId falls back to <conversation_id> placeholder", () => {
  const md = renderReportMarkdown(makeReport());
  assert.match(md, /kweaver trace diagnose <conversation_id> --no-llm/);
});

test("renderReportMarkdown: -bd flag is omitted when businessDomain is undefined", () => {
  const md = renderReportMarkdown(makeReport(), { conversationId: "01KCONV" });
  assert.match(md, /kweaver trace diagnose 01KCONV --no-llm --out \/tmp\/verify\.yaml\n/, "no -bd suffix on diagnose command");
  // The fetch command also has no -bd flag.
  assert.ok(!/\}'  \\\n/.test(md), "no stray -bd injection");
});

test("renderReportMarkdown: per-finding inspect block lists exactly that finding's evidence spans", () => {
  const md = renderReportMarkdown(makeReport({ findings: [symbolicFinding, rubricFinding] }), {
    conversationId: "01KCONV", businessDomain: "bd_public",
  });
  assert.match(md, /Finding #0 \(`tool_loop_no_state_change`\):/);
  assert.match(md, /"terms":\{"spanId":\["sp_7", "sp_8", "sp_9"\]\}/);
  assert.match(md, /Finding #1 \(`tool_retry_intent_mismatch`\):/);
  assert.match(md, /"terms":\{"spanId":\["sp_7", "sp_8"\]\}/);
});

test("renderReportMarkdown: zero findings → verification section keeps re-fetch + re-diagnose + recurrence but omits the 'inspect spans' block", () => {
  const md = renderReportMarkdown(makeReport(), { conversationId: "01KCONV", businessDomain: "bd_public" });
  assert.match(md, /## How to verify/);
  assert.match(md, /### 1\. Re-fetch the raw trace/);
  assert.match(md, /### 2\. Re-run diagnosis/);
  assert.ok(!/### 3\. Inspect the suspect spans/.test(md), "no inspect section when no findings");
  // recurrence becomes section 3 when no findings
  assert.match(md, /### 3\. Check whether this pattern recurs/);
});

test("renderReportMarkdown: recurrence section is suppressed when agentId is null (no agent to query)", () => {
  const md = renderReportMarkdown(makeReport({
    trace: { traceId: "tr_x", agentId: null, tenant: null },
    findings: [symbolicFinding],
  }), { conversationId: "01KCONV" });
  assert.ok(!/Check whether this pattern recurs/.test(md), "no recurrence section without an agent id");
});

test("renderReportMarkdown: a finding whose evidence.spans is empty does not emit an empty inspect block", () => {
  const noSpansFinding: Finding = { ...symbolicFinding, evidence: { spans: [], excerpt: "no spans" } };
  const md = renderReportMarkdown(makeReport({ findings: [noSpansFinding] }), {
    conversationId: "01KCONV", businessDomain: "bd_public",
  });
  // The 'Inspect' section header exists (we have ≥1 finding) but no finding-#0 sub-block.
  assert.match(md, /### 3\. Inspect the suspect spans/);
  assert.ok(!/Finding #0 \(`tool_loop_no_state_change`\):/.test(md), "should skip findings with no spans");
});

test("derivePaths: format=yaml writes only yaml at the given path", () => {
  assert.deepEqual(derivePaths("diagnosis/refund.yaml", "yaml"), { yamlPath: "diagnosis/refund.yaml", mdPath: null });
  assert.deepEqual(derivePaths("anything.foo", "yaml"), { yamlPath: "anything.foo", mdPath: null });
});

test("derivePaths: format=markdown writes only md at the given path", () => {
  assert.deepEqual(derivePaths("diagnosis/refund.md", "markdown"), { yamlPath: null, mdPath: "diagnosis/refund.md" });
});

test("derivePaths: format=both with .yaml --out derives .md sibling", () => {
  assert.deepEqual(derivePaths("diagnosis/refund.yaml", "both"), { yamlPath: "diagnosis/refund.yaml", mdPath: "diagnosis/refund.md" });
});

test("derivePaths: format=both with .yml --out derives .md sibling", () => {
  assert.deepEqual(derivePaths("out/r.yml", "both"), { yamlPath: "out/r.yml", mdPath: "out/r.md" });
});

test("derivePaths: format=both with .md --out derives .yaml sibling", () => {
  assert.deepEqual(derivePaths("diagnosis/refund.md", "both"), { yamlPath: "diagnosis/refund.yaml", mdPath: "diagnosis/refund.md" });
});

test("derivePaths: format=both with extensionless --out appends .yaml and .md", () => {
  assert.deepEqual(derivePaths("diagnosis/refund", "both"), { yamlPath: "diagnosis/refund.yaml", mdPath: "diagnosis/refund.md" });
});
