import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { tmpdir } from "node:os";
import fs from "node:fs/promises";
import yaml from "js-yaml";

import { run } from "../src/trace-ai/eval-set/test-runner.js";
import type { RunOpts, RunnerDeps } from "../src/trace-ai/eval-set/test-runner.js";
import { createBuiltinSemanticMatchProvider } from "../src/trace-ai/eval-set/semantic-match-provider.js";
import { StubAgentProvider } from "../src/agent-providers/providers/stub.js";
import { PromptTemplateRegistry } from "../src/agent-providers/prompt-template.js";
import type { TraceSpan } from "../src/api/conversations.js";

// ── helpers ───────────────────────────────────────────────────────────────────

async function mkTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(tmpdir(), "m5-runner-"));
}

async function writeEvalSet(
  dir: string,
  cases: object[],
): Promise<void> {
  const indexYaml = yaml.dump({
    schema_version: "trace-eval-set-index/v1",
    eval_set_id: "test-set",
    shards: [{ path: "cases.yaml" }],
  });
  const casesYaml = yaml.dump({
    schema_version: "trace-eval-set/v1",
    cases,
  });
  await fs.writeFile(path.join(dir, "index.yaml"), indexYaml);
  await fs.writeFile(path.join(dir, "cases.yaml"), casesYaml);
}

function okDeps(overrides: Partial<RunnerDeps> = {}): RunnerDeps {
  return {
    fetchAgent: async () => ({ id: "agt_1", key: "key_1", version: "1" }),
    sendChat: async ({ query }) => ({
      text: `answer for: ${query}`,
      conversationId: "conv_001",
    }),
    fetchTrace: async () => ({ spans: [] }),
    ...overrides,
  };
}

// ── basic report structure ────────────────────────────────────────────────────

test("run: produces trace-test-report/v1 with correct meta fields", async () => {
  const evalSetDir = await mkTempDir();
  const outDir = await mkTempDir();
  try {
    await writeEvalSet(evalSetDir, [
      {
        query_id: "q1",
        input: { user_message: "充电桩有多少家企业？" },
        assertions: [{ type: "contains", value: "78" }],
      },
    ]);

    await run({
      evalSetDir,
      candidateAgentId: "agt_1",
      outDir,
      deps: okDeps({ sendChat: async () => ({ text: "共78家企业", conversationId: "c1" }) }),
    } as RunOpts);

    const reportRaw = await fs.readFile(path.join(outDir, "report.yaml"), "utf8");
    const report = yaml.load(reportRaw) as Record<string, unknown>;

    assert.equal(report["schema_version"], "trace-test-report/v1");
    const meta = report["meta"] as Record<string, unknown>;
    assert.equal((meta["candidate"] as Record<string, unknown>)["agent_id"], "agt_1");
    assert.ok(typeof meta["ran_at"] === "string");
    assert.ok(typeof meta["duration_ms"] === "number");
  } finally {
    await fs.rm(evalSetDir, { recursive: true, force: true });
    await fs.rm(outDir, { recursive: true, force: true });
  }
});

// ── pass / fail summary ───────────────────────────────────────────────────────

test("run: summary counts pass and fail correctly", async () => {
  const evalSetDir = await mkTempDir();
  const outDir = await mkTempDir();
  try {
    await writeEvalSet(evalSetDir, [
      {
        query_id: "pass_case",
        input: { user_message: "充电桩" },
        assertions: [{ type: "contains", value: "78家" }],
      },
      {
        query_id: "fail_case",
        input: { user_message: "动力系统" },
        assertions: [{ type: "contains", value: "不存在的字符串xyz" }],
      },
    ]);

    await run({
      evalSetDir,
      candidateAgentId: "agt_1",
      outDir,
      deps: okDeps({ sendChat: async ({ query }) => ({ text: `${query} 78家企业`, conversationId: "c1" }) }),
    } as RunOpts);

    const report = yaml.load(
      await fs.readFile(path.join(outDir, "report.yaml"), "utf8"),
    ) as Record<string, unknown>;
    const summary = report["summary"] as Record<string, unknown>;

    assert.equal(summary["pass"], 1);
    assert.equal(summary["fail"], 1);
    assert.equal(summary["error"], 0);
    assert.equal(summary["total"], 2);
  } finally {
    await fs.rm(evalSetDir, { recursive: true, force: true });
    await fs.rm(outDir, { recursive: true, force: true });
  }
});

// ── error handling ────────────────────────────────────────────────────────────

test("run: chat error → case status is error, not thrown", async () => {
  const evalSetDir = await mkTempDir();
  const outDir = await mkTempDir();
  try {
    await writeEvalSet(evalSetDir, [
      {
        query_id: "err_case",
        input: { user_message: "会超时的问题" },
        assertions: [{ type: "contains", value: "anything" }],
      },
    ]);

    await run({
      evalSetDir,
      candidateAgentId: "agt_1",
      outDir,
      deps: okDeps({
        sendChat: async () => { throw new Error("HTTP 502"); },
      }),
    } as RunOpts);

    const report = yaml.load(
      await fs.readFile(path.join(outDir, "report.yaml"), "utf8"),
    ) as Record<string, unknown>;
    const summary = report["summary"] as Record<string, unknown>;
    const cases = report["cases"] as Array<Record<string, unknown>>;

    assert.equal(summary["error"], 1);
    assert.equal(cases[0]["status"], "error");
    assert.ok(String(cases[0]["error_message"]).includes("502"));
  } finally {
    await fs.rm(evalSetDir, { recursive: true, force: true });
    await fs.rm(outDir, { recursive: true, force: true });
  }
});

// ── tool_call_count via trace spans ──────────────────────────────────────────

test("run: tool_call_count uses fetched trace spans", async () => {
  const evalSetDir = await mkTempDir();
  const outDir = await mkTempDir();
  try {
    await writeEvalSet(evalSetDir, [
      {
        query_id: "tool_case",
        input: { user_message: "BMS节点" },
        assertions: [
          { type: "tool_call_count", tool: "query_object_instance", op: "lte", value: 2 },
        ],
      },
    ]);

    const mockSpan = (name: string): TraceSpan => ({
      traceId: "t1", spanId: `s-${name}`, name, kind: "tool",
      startTime: "0", attributes: { "gen_ai.tool.name": name },
    });

    await run({
      evalSetDir,
      candidateAgentId: "agt_1",
      outDir,
      deps: okDeps({
        sendChat: async () => ({ text: "BMS有9家企业", conversationId: "c1" }),
        fetchTrace: async () => ({
          spans: [
            mockSpan("query_object_instance"),
            mockSpan("query_object_instance"),
          ],
        }),
      }),
    } as RunOpts);

    const report = yaml.load(
      await fs.readFile(path.join(outDir, "report.yaml"), "utf8"),
    ) as Record<string, unknown>;
    const cases = report["cases"] as Array<Record<string, unknown>>;
    assert.equal(cases[0]["status"], "pass");
  } finally {
    await fs.rm(evalSetDir, { recursive: true, force: true });
    await fs.rm(outDir, { recursive: true, force: true });
  }
});

// ── by_assertion_type breakdown ───────────────────────────────────────────────

test("run: by_assertion_type shows per-type pass/fail breakdown", async () => {
  const evalSetDir = await mkTempDir();
  const outDir = await mkTempDir();
  try {
    await writeEvalSet(evalSetDir, [
      {
        query_id: "q1",
        input: { user_message: "问题1" },
        assertions: [
          { type: "contains", value: "pass" },
          { type: "regex", pattern: "pass" },
        ],
      },
    ]);

    await run({
      evalSetDir,
      candidateAgentId: "agt_1",
      outDir,
      deps: okDeps({ sendChat: async () => ({ text: "pass result", conversationId: "c1" }) }),
    } as RunOpts);

    const report = yaml.load(
      await fs.readFile(path.join(outDir, "report.yaml"), "utf8"),
    ) as Record<string, unknown>;
    const summary = report["summary"] as Record<string, unknown>;
    const byType = summary["by_assertion_type"] as Record<string, { pass: number; fail: number }>;

    assert.equal(byType["contains"]?.pass, 1);
    assert.equal(byType["contains"]?.fail, 0);
    assert.equal(byType["regex"]?.pass, 1);
  } finally {
    await fs.rm(evalSetDir, { recursive: true, force: true });
    await fs.rm(outDir, { recursive: true, force: true });
  }
});

// ── H1: trace_id populated from spans[0].traceId ──────────────────────────────

test("run: trace_id is populated from spans[0].traceId when trace is fetched", async () => {
  const evalSetDir = await mkTempDir();
  const outDir = await mkTempDir();
  try {
    await writeEvalSet(evalSetDir, [
      {
        query_id: "q1",
        input: { user_message: "BMS" },
        assertions: [{ type: "contains", value: "ok" }],
      },
    ]);

    await run({
      evalSetDir,
      candidateAgentId: "agt_1",
      outDir,
      deps: okDeps({
        sendChat: async () => ({ text: "ok", conversationId: "c1" }),
        fetchTrace: async () => ({
          spans: [
            {
              traceId: "trace-abc",
              spanId: "s1",
              name: "root",
              kind: "tool",
              startTime: "0",
              attributes: { "gen_ai.tool.name": "search" },
            } as TraceSpan,
          ],
        }),
      }),
    } as RunOpts);

    const report = yaml.load(
      await fs.readFile(path.join(outDir, "report.yaml"), "utf8"),
    ) as Record<string, unknown>;
    const cases = report["cases"] as Array<Record<string, unknown>>;
    assert.equal(cases[0]["trace_id"], "trace-abc");
  } finally {
    await fs.rm(evalSetDir, { recursive: true, force: true });
    await fs.rm(outDir, { recursive: true, force: true });
  }
});

// ── H2: trace-fetch failure is distinguished from chat-failure ────────────────

test("run: fetchTrace error → error_code=trace-fetch-failed (not chat-failed)", async () => {
  const evalSetDir = await mkTempDir();
  const outDir = await mkTempDir();
  try {
    await writeEvalSet(evalSetDir, [
      {
        query_id: "trace_err",
        input: { user_message: "Q" },
        assertions: [{ type: "contains", value: "x" }],
      },
    ]);

    await run({
      evalSetDir,
      candidateAgentId: "agt_1",
      outDir,
      deps: okDeps({
        sendChat: async () => ({ text: "fine", conversationId: "c1" }),
        fetchTrace: async () => { throw new Error("HTTP 504 trace"); },
      }),
    } as RunOpts);

    const report = yaml.load(
      await fs.readFile(path.join(outDir, "report.yaml"), "utf8"),
    ) as Record<string, unknown>;
    const cases = report["cases"] as Array<Record<string, unknown>>;
    assert.equal(cases[0]["status"], "error");
    assert.equal(cases[0]["error_code"], "trace-fetch-failed");
    assert.equal(cases[0]["conversation_id"], "c1");
  } finally {
    await fs.rm(evalSetDir, { recursive: true, force: true });
    await fs.rm(outDir, { recursive: true, force: true });
  }
});

// ── H3: reference-only case (no assertions) → skip, not pass ──────────────────

test("run: case with reference but no assertions → status=skip with failure_reason", async () => {
  const evalSetDir = await mkTempDir();
  const outDir = await mkTempDir();
  try {
    await writeEvalSet(evalSetDir, [
      {
        query_id: "ref_only",
        input: { user_message: "Q" },
        reference: { answer: "expected reference answer" },
      },
    ]);

    await run({
      evalSetDir,
      candidateAgentId: "agt_1",
      outDir,
      deps: okDeps({ sendChat: async () => ({ text: "anything", conversationId: "c1" }) }),
    } as RunOpts);

    const report = yaml.load(
      await fs.readFile(path.join(outDir, "report.yaml"), "utf8"),
    ) as Record<string, unknown>;
    const summary = report["summary"] as Record<string, unknown>;
    const cases = report["cases"] as Array<Record<string, unknown>>;

    assert.equal(cases[0]["status"], "skip");
    assert.equal(summary["skip"], 1);
    assert.equal(summary["pass"], 0);
    assert.ok(String(cases[0]["failure_reason"] ?? "").length > 0);
  } finally {
    await fs.rm(evalSetDir, { recursive: true, force: true });
    await fs.rm(outDir, { recursive: true, force: true });
  }
});

// ── D5: semantic_match end-to-end via builtin adapter + stub provider ────────

test("run: semantic_match wired through builtin adapter + stub provider produces pass/fail (not skip)", async () => {
  const evalSetDir = await mkTempDir();
  const outDir = await mkTempDir();
  try {
    let promptSeenByStub = "";
    const stub = new StubAgentProvider({
      responseFn: (prompt) => {
        promptSeenByStub = prompt;
        // The stub mimics a real judge: pass when candidate contains the
        // reference keyword, fail otherwise.
        const looksGood = /ok-answer/.test(prompt);
        return looksGood
          ? { verdict: "pass", reasoning: "candidate covers reference" }
          : { verdict: "fail", reasoning: "missing required fact" };
      },
    });
    const promptRegistry = new PromptTemplateRegistry();
    promptRegistry.registerInline(
      "builtin:answer-match-reference",
      "Q={{question}} R={{reference_answer}} C={{candidate_answer}} {{language_instruction}} {{output_schema}}",
    );
    const smp = createBuiltinSemanticMatchProvider({
      provider: stub,
      promptRegistry,
    });

    await writeEvalSet(evalSetDir, [
      {
        query_id: "pass_case",
        input: { user_message: "what is the answer?" },
        reference: { answer: "the correct reference answer" },
        assertions: [{ type: "semantic_match" }],
      },
      {
        query_id: "fail_case",
        input: { user_message: "another question?" },
        reference: { answer: "another reference answer" },
        assertions: [{ type: "semantic_match" }],
      },
    ]);

    await run({
      evalSetDir,
      candidateAgentId: "agt_1",
      outDir,
      deps: okDeps({
        sendChat: async ({ query }) => ({
          // First case's candidate carries the trigger keyword, second does not.
          text: query.startsWith("what") ? "ok-answer here" : "off-topic",
          conversationId: `c-${query}`,
        }),
        semanticMatchProvider: smp,
      }),
    } as RunOpts);

    const report = yaml.load(
      await fs.readFile(path.join(outDir, "report.yaml"), "utf8"),
    ) as Record<string, unknown>;
    const summary = report["summary"] as Record<string, unknown>;
    const cases = report["cases"] as Array<Record<string, unknown>>;

    assert.equal(summary["pass"], 1);
    assert.equal(summary["fail"], 1);
    assert.equal(summary["skip"], 0, "semantic_match must NOT be skipped when provider is wired");
    assert.equal(cases[0]["status"], "pass");
    assert.equal(cases[1]["status"], "fail");
    // by_assertion_type tracks semantic_match pass/fail correctly.
    const byType = summary["by_assertion_type"] as Record<string, { pass: number; fail: number }>;
    assert.equal(byType["semantic_match"]?.pass, 1);
    assert.equal(byType["semantic_match"]?.fail, 1);
    // user_message flowed into the rubric prompt as {{question}} (no explicit
    // assertion.question; fallback path must work).
    assert.ok(
      /Q=another question\?/.test(promptSeenByStub) || /Q=what is the answer\?/.test(promptSeenByStub),
      `expected user_message as Q= in rubric prompt, got: ${promptSeenByStub}`,
    );
  } finally {
    await fs.rm(evalSetDir, { recursive: true, force: true });
    await fs.rm(outDir, { recursive: true, force: true });
  }
});

// ── H4: maxParallel is a real bounded concurrency, not chunked ────────────────

test("run: maxParallel keeps refilling while one slow case is in flight (true pool, not chunked)", async () => {
  const evalSetDir = await mkTempDir();
  const outDir = await mkTempDir();
  try {
    const N = 10;
    const cases = Array.from({ length: N }, (_, i) => ({
      query_id: `q${i}`,
      input: { user_message: `Q${i}` },
      assertions: [{ type: "contains", value: "ok" }],
    }));
    await writeEvalSet(evalSetDir, cases);

    let inFlight = 0;
    let peak = 0;
    let q0Running = false;
    const startedDuringQ0: string[] = [];

    await run({
      evalSetDir,
      candidateAgentId: "agt_1",
      outDir,
      maxParallel: 3,
      deps: okDeps({
        sendChat: async ({ query }) => {
          inFlight++;
          if (inFlight > peak) peak = inFlight;
          if (query === "Q0") {
            q0Running = true;
            await new Promise((r) => setTimeout(r, 80));
            q0Running = false;
          } else {
            if (q0Running) startedDuringQ0.push(query);
            await new Promise((r) => setTimeout(r, 10));
          }
          inFlight--;
          return { text: "ok", conversationId: `c-${query}` };
        },
      }),
    } as RunOpts);

    // Upper bound: never exceeds maxParallel.
    assert.ok(peak <= 3, `peak in-flight ${peak} exceeded maxParallel=3`);

    // Differentiator: in chunked impl, only Q1/Q2 (same chunk as Q0) start
    // while Q0 is alive — chunk 2 (Q3..Q5) waits for chunk 1 to finish.
    // A true pool refills the slot as Q1/Q2/Q3/... finish at ~10ms each,
    // so 6+ other cases will have started before Q0 (80ms) finishes.
    assert.ok(
      startedDuringQ0.length >= 4,
      `expected pool to keep refilling during slow Q0; only ${startedDuringQ0.length} cases started while Q0 was alive (chunked impl would give 2)`,
    );

    const report = yaml.load(
      await fs.readFile(path.join(outDir, "report.yaml"), "utf8"),
    ) as Record<string, unknown>;
    const resultIds = (report["cases"] as Array<Record<string, unknown>>).map(
      (c) => c["query_id"],
    );
    // Order must be preserved (matches input order), not completion order.
    assert.deepEqual(resultIds, cases.map((c) => c.query_id));
  } finally {
    await fs.rm(evalSetDir, { recursive: true, force: true });
    await fs.rm(outDir, { recursive: true, force: true });
  }
});
