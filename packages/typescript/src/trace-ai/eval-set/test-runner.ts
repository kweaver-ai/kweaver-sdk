import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";

import type { TraceSpan } from "../../api/conversations.js";
import type { SemanticMatchProvider } from "./assertion-evaluator.js";
import { evaluateAssertion } from "./assertion-evaluator.js";
import { EvalSetIndexSchema, EvalSetShardSchema, TestReportSchema } from "./schemas.js";
import type { EvalCase } from "./types.js";

// ── injectable dependencies ───────────────────────────────────────────────────

export interface RunnerDeps {
  fetchAgent: (agentId: string, version?: string) => Promise<{ id: string; key: string; version: string }>;
  sendChat: (opts: {
    agentInfo: { id: string; key: string; version: string };
    query: string;
    conversationId?: string;
  }) => Promise<{ text: string; conversationId?: string }>;
  fetchTrace: (conversationId: string) => Promise<{ spans: TraceSpan[] }>;
  semanticMatchProvider?: SemanticMatchProvider;
}

export interface RunOpts {
  evalSetDir: string;
  candidateAgentId: string;
  candidateAgentVersion?: string;
  outDir: string;
  maxParallel?: number;
  deps: RunnerDeps;
}

// ── eval-set loader ───────────────────────────────────────────────────────────

async function loadEvalCases(evalSetDir: string): Promise<EvalCase[]> {
  const indexRaw = await fs.readFile(path.join(evalSetDir, "index.yaml"), "utf8");
  const index = EvalSetIndexSchema.parse(yaml.load(indexRaw));
  const cases: EvalCase[] = [];
  for (const shard of index.shards) {
    const shardRaw = await fs.readFile(path.join(evalSetDir, shard.path), "utf8");
    const parsed = EvalSetShardSchema.parse(yaml.load(shardRaw));
    cases.push(...(parsed.cases as EvalCase[]));
  }
  return cases;
}

// ── case runner ───────────────────────────────────────────────────────────────

async function runCase(
  evalCase: EvalCase,
  agentInfo: { id: string; key: string; version: string },
  deps: RunnerDeps,
) {
  const startMs = Date.now();
  let conversationId: string | null = null;
  let traceId: string | null = null;
  let spans: TraceSpan[] = [];
  let answerText = "";
  let stage: "chat" | "trace" = "chat";

  try {
    const chatResult = await deps.sendChat({
      agentInfo,
      query: evalCase.input.user_message,
    });
    answerText = chatResult.text;
    conversationId = chatResult.conversationId ?? null;

    if (conversationId) {
      stage = "trace";
      const traceResult = await deps.fetchTrace(conversationId);
      spans = traceResult.spans;
      traceId = spans[0]?.traceId ?? null;
    }
  } catch (e) {
    const durationMs = Date.now() - startMs;
    return {
      query_id: evalCase.query_id,
      status: "error" as const,
      conversation_id: conversationId,
      trace_id: traceId,
      duration_ms: durationMs,
      assertion_results: [],
      error_message: e instanceof Error ? e.message : String(e),
      error_code: stage === "trace" ? "trace-fetch-failed" : "chat-failed",
    };
  }

  const durationMs = Date.now() - startMs;
  const assertionResults = [];

  for (const assertion of evalCase.assertions ?? []) {
    const result = await evaluateAssertion(assertion, {
      answer: answerText,
      spans,
      reference: evalCase.reference,
      durationMs,
      question: evalCase.input.user_message,
      semanticMatchProvider: deps.semanticMatchProvider,
    });
    assertionResults.push({ assertion, verdict: result.verdict, actual: result.actual });
  }

  // A case may pass schema with reference-only (no assertions), but without
  // assertions there is no pass/fail signal — mark skip so it does not
  // silently inflate the pass count.
  if (assertionResults.length === 0) {
    return {
      query_id: evalCase.query_id,
      status: "skip" as const,
      conversation_id: conversationId,
      trace_id: traceId,
      duration_ms: durationMs,
      assertion_results: assertionResults,
      failure_reason:
        "no assertions configured; case has reference but no judge (e.g. semantic_match) wired",
    };
  }

  const hasFail = assertionResults.some((r) => r.verdict === "fail");
  const allSkip = assertionResults.every((r) => r.verdict === "skip");
  const status = hasFail ? "fail" : allSkip ? "skip" : "pass";

  return {
    query_id: evalCase.query_id,
    status: status as "pass" | "fail" | "skip",
    conversation_id: conversationId,
    trace_id: traceId,
    duration_ms: durationMs,
    assertion_results: assertionResults,
  };
}

// ── main runner ───────────────────────────────────────────────────────────────

export async function run(opts: RunOpts): Promise<void> {
  const { evalSetDir, candidateAgentId, candidateAgentVersion, outDir, deps } = opts;
  const maxParallel = opts.maxParallel ?? 4;

  const [cases, agentInfo] = await Promise.all([
    loadEvalCases(evalSetDir),
    deps.fetchAgent(candidateAgentId, candidateAgentVersion),
  ]);

  // Fetch eval_set_id from index
  const indexRaw = await fs.readFile(path.join(evalSetDir, "index.yaml"), "utf8");
  const index = EvalSetIndexSchema.parse(yaml.load(indexRaw));

  const ranAt = new Date().toISOString();
  const overallStart = Date.now();

  // Bounded concurrency via promise pool: each worker pulls the next index
  // until the queue is drained. Slot is freed immediately on case completion,
  // so a single slow case does not block the rest of its "chunk" from starting.
  // Results are written by index to preserve input order regardless of
  // completion order.
  type CaseResult = Awaited<ReturnType<typeof runCase>>;
  const caseResults = new Array<CaseResult>(cases.length);
  let nextIdx = 0;
  const workerCount = Math.max(1, Math.min(maxParallel, cases.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const idx = nextIdx++;
      if (idx >= cases.length) return;
      caseResults[idx] = await runCase(cases[idx], agentInfo, deps);
    }
  });
  await Promise.all(workers);

  const overallDurationMs = Date.now() - overallStart;

  // Build summary
  const counts = { total: caseResults.length, pass: 0, fail: 0, error: 0, skip: 0 };
  const byType: Record<string, { pass: number; fail: number }> = {};

  for (const cr of caseResults) {
    counts[cr.status]++;
    for (const ar of cr.assertion_results) {
      const t = (ar.assertion as Record<string, unknown>)["type"] as string;
      if (!byType[t]) byType[t] = { pass: 0, fail: 0 };
      if (ar.verdict === "pass") byType[t].pass++;
      else if (ar.verdict === "fail") byType[t].fail++;
    }
  }

  const report = TestReportSchema.parse({
    schema_version: "trace-test-report/v1",
    meta: {
      eval_set_dir: evalSetDir,
      eval_set_id: index.eval_set_id,
      candidate: { agent_id: agentInfo.id, agent_version: agentInfo.version },
      cli_version: "0.0.0",
      ran_at: ranAt,
      duration_ms: overallDurationMs,
    },
    summary: { ...counts, by_assertion_type: byType },
    cases: caseResults,
  });

  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(
    path.join(outDir, "report.yaml"),
    yaml.dump(report, { lineWidth: 120 }),
    "utf8",
  );
}
