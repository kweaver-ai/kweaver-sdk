/**
 * E2E tests for `kweaver agent trace` against a live trace-ai backend (kweaver-sdk#115).
 *
 * Required env vars:
 *   KWEAVER_BASE_URL                     — e.g. https://192.168.40.62
 *   KWEAVER_TRACE_TEST_CONVERSATION_ID   — a conversation_id known to have traces
 *
 * Optional:
 *   NODE_TLS_REJECT_UNAUTHORIZED=0       — for self-signed HTTPS
 *
 * Run:
 *   npm run build
 *   KWEAVER_BASE_URL=https://192.168.40.62 \
 *   KWEAVER_TRACE_TEST_CONVERSATION_ID=01KQ7129HD1XGB1XWBT9QTF58W \
 *   NODE_TLS_REJECT_UNAUTHORIZED=0 \
 *     npm run test:e2e -- --test-name-pattern='agent trace'
 */

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const kweaverBin = join(__dirname, "../../bin/kweaver.js");

function runTrace(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const env = { ...process.env };
  delete env.KWEAVER_TOKEN;
  env.KWEAVER_NO_AUTH = "1";
  const r = spawnSync(process.execPath, [kweaverBin, "agent", "trace", ...args], {
    encoding: "utf8",
    env,
    maxBuffer: 16 * 1024 * 1024,
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function liveSetup(): { skip: boolean; reason?: string; cid?: string } {
  if (!process.env.KWEAVER_BASE_URL?.trim()) {
    return { skip: true, reason: "KWEAVER_BASE_URL not set" };
  }
  const cid = process.env.KWEAVER_TRACE_TEST_CONVERSATION_ID?.trim();
  if (!cid) {
    return { skip: true, reason: "KWEAVER_TRACE_TEST_CONVERSATION_ID not set" };
  }
  return { skip: false, cid };
}

const live = liveSetup();

test(
  "e2e agent trace --json: 2-jump returns spans with the requested traceId(s)",
  { skip: live.skip },
  () => {
    const r = runTrace([live.cid!, "--json", "--compact"]);
    assert.equal(r.status, 0, `non-zero exit. stderr:\n${r.stderr}\nstdout:\n${r.stdout.slice(0, 500)}`);
    // The first stdout line is the JSON payload (TracesByConversationResult).
    const firstLine = r.stdout.split("\n").find((l) => l.trim().startsWith("{"));
    assert.ok(firstLine, "expected a JSON line in stdout");
    const result = JSON.parse(firstLine!) as {
      conversationId: string;
      traceIds: string[];
      spans: Array<{ traceId: string; spanId: string; name: string }>;
      truncated: boolean;
    };
    assert.equal(result.conversationId, live.cid);
    assert.ok(result.traceIds.length > 0, `expected at least one traceId, got ${JSON.stringify(result.traceIds)}`);
    assert.ok(result.spans.length > 0, `expected spans, got ${result.spans.length}`);
    // Sanity: every span belongs to one of the returned traceIds.
    const allowed = new Set(result.traceIds);
    for (const span of result.spans) {
      assert.ok(allowed.has(span.traceId), `span ${span.spanId} has unexpected traceId ${span.traceId}`);
    }
  },
);

test(
  "e2e agent trace --view tree: emits a hierarchical tree with service tags",
  { skip: live.skip },
  () => {
    const r = runTrace([live.cid!, "--view", "tree"]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /── Tree ──/);
    // Real traces always go through agent-factory or agent-executor.
    assert.match(r.stdout, /\[agent-(factory|executor)\]/);
    // Tree should render at least one span with a non-zero duration.
    assert.match(r.stdout, /\d+\.\d+ms/);
  },
);

test(
  "e2e agent trace --view perf: aggregates by category",
  { skip: live.skip },
  () => {
    const r = runTrace([live.cid!, "--view", "perf"]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /── Perf ──/);
    assert.match(r.stdout, /类别/);
    assert.match(r.stdout, /累计耗时/);
  },
);

test(
  "e2e agent trace --view evidence: lists tool steps with hit data when present",
  { skip: live.skip },
  () => {
    const r = runTrace([live.cid!, "--view", "evidence"]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /── Evidence ──/);
    // Either tool steps or LLM line should appear.
    assert.match(r.stdout, /(execute_tool|LLM:)/);
  },
);

test(
  "e2e agent trace --view reasoning: surfaces input/output messages from the chat span",
  { skip: live.skip },
  () => {
    const r = runTrace([live.cid!, "--view", "reasoning"]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /── Reasoning ──/);
    // Reasoning view should show the LLM model + at least one assistant message.
    assert.match(r.stdout, /LLM: \S+/);
    assert.match(r.stdout, /\[\d+\] (system|user|assistant|tool)/);
  },
);

test(
  "e2e agent trace --view all: concatenates all four views",
  { skip: live.skip },
  () => {
    const r = runTrace([live.cid!, "--view", "all"]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /── Tree ──/);
    assert.match(r.stdout, /── Perf ──/);
    assert.match(r.stdout, /── Evidence ──/);
    assert.match(r.stdout, /── Reasoning ──/);
  },
);

test(
  "e2e agent trace: legacy two-arg form still works",
  { skip: live.skip },
  () => {
    // Pass a junk agent_id followed by the real conversation_id.
    const r = runTrace(["any-agent-id", live.cid!, "--view", "tree"]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /── Tree ──/);
  },
);

test(
  "e2e agent trace: missing conversation_id yields non-zero exit and clear error",
  () => {
    const r = runTrace([]);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /Missing conversation_id/);
  },
);
