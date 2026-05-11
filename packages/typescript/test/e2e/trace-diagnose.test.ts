import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

import { diagnose } from "../../src/trace-core/diagnose/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(__dirname, "..", "fixtures/trace-diagnose");

interface MockCall { url: string; method: string; body: unknown; }

function mockFetchSequence(responses: unknown[]) {
  const orig = globalThis.fetch;
  const calls: MockCall[] = [];
  let i = 0;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    let body: unknown;
    if (init?.body && typeof init.body === "string") {
      try { body = JSON.parse(init.body); } catch { body = init.body; }
    }
    calls.push({ url, method: init?.method ?? "GET", body });
    const r = responses[i++] ?? {};
    return new Response(typeof r === "string" ? r : JSON.stringify(r), { status: 200 });
  };
  return { calls, restore: () => { globalThis.fetch = orig; } };
}

async function loadFixture(p: string) { return JSON.parse(await fs.readFile(p, "utf8")); }

const RULE_FIXTURES: Array<{ ruleId: string; fixture: string }> = [
  { ruleId: "tool_loop_no_state_change", fixture: "synthetic/tool-loop-no-state-change.json" },
  { ruleId: "tool_error_swallowed", fixture: "synthetic/tool-error-swallowed.json" },
  { ruleId: "retrieval_empty_no_fallback", fixture: "synthetic/retrieval-empty-no-fallback.json" },
  { ruleId: "llm_response_truncated_no_continue", fixture: "synthetic/llm-response-truncated-no-continue.json" },
  { ruleId: "excessive_tool_calls_per_turn", fixture: "synthetic/excessive-tool-calls-per-turn.json" },
];

for (const { ruleId, fixture } of RULE_FIXTURES) {
  test(`e2e: synthetic fixture for ${ruleId} produces exactly that finding`, async () => {
    const data = await loadFixture(path.join(FIX, fixture));
    const m = mockFetchSequence([data]);
    const tmpOut = path.join(os.tmpdir(), `diag-${Date.now()}-${ruleId}.yaml`);
    try {
      const r = await diagnose("tr_synth", {
        out: tmpOut,
        rulesDir: null,
        noBuiltin: false,
        noLlm: true,
        agentProvider: null,
        timeoutMs: 60000,
        baseUrl: "https://mock.kweaver.test",
        token: "tk",
        businessDomain: "bd_public",
      });
      const ruleHits = r.findings.filter((f) => f.ruleId === ruleId);
      assert.equal(ruleHits.length, 1, `expected 1 finding for ${ruleId}, got ${r.findings.length} total`);
      assert.equal(r.run.synthesizerMode, "template");
      assert.ok(r.summary.headline.includes(ruleHits[0].symptom), `expected headline to include symptom '${ruleHits[0].symptom}', got: ${r.summary.headline}`);
    } finally {
      m.restore();
      await fs.rm(tmpOut, { force: true });
    }
  });
}

test("e2e: real fixture (status_quo de39cbe9) triggers zero findings", async () => {
  const data = await loadFixture(path.join(FIX, "real/de39cbe9.json"));
  const m = mockFetchSequence([data]);
  const tmpOut = path.join(os.tmpdir(), `diag-real-${Date.now()}.yaml`);
  try {
    const r = await diagnose("de39cbe95e46cb7f28d85db9cf3a4dc9", {
      out: tmpOut,
      rulesDir: null,
      noBuiltin: false,
      noLlm: true,
      agentProvider: null,
      timeoutMs: 60000,
      baseUrl: "https://mock.kweaver.test",
      token: "tk",
      businessDomain: "bd_public",
    });
    assert.equal(r.findings.length, 0, `expected 0 findings on real successful trace, got ${r.findings.length}: ${JSON.stringify(r.findings.map((f) => f.ruleId))}`);
    assert.equal(r.summary.headline, "No findings");
  } finally {
    m.restore();
    await fs.rm(tmpOut, { force: true });
  }
});

test("e2e: report file is valid yaml conforming to schema", async () => {
  const yaml = await import("js-yaml");
  const { ReportSchema } = await import("../../src/trace-core/diagnose/schemas.js");
  const data = await loadFixture(path.join(FIX, "synthetic/tool-loop-no-state-change.json"));
  const m = mockFetchSequence([data]);
  const tmpOut = path.join(os.tmpdir(), `diag-yaml-${Date.now()}.yaml`);
  try {
    await diagnose("tr_synth", {
      out: tmpOut,
      rulesDir: null,
      noBuiltin: false,
      noLlm: true,
      agentProvider: null,
      timeoutMs: 60000,
      baseUrl: "https://mock.kweaver.test",
      token: "tk",
      businessDomain: "bd_public",
    });
    const written = await fs.readFile(tmpOut, "utf8");
    const parsed = yaml.load(written);
    const result = ReportSchema.safeParse(parsed);
    assert.equal(result.success, true, JSON.stringify((result as any).error?.issues, null, 2));
  } finally {
    m.restore();
    await fs.rm(tmpOut, { force: true });
  }
});
