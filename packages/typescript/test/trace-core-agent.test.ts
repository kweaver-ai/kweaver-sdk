import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import {
  AgentRegistry,
  PromptTemplateRegistry,
  StubAgentProvider,
  AgentProviderError,
  render,
} from "../src/agent-providers/index.js";

// ── AgentRegistry ───────────────────────────────────────────────────────────

test("AgentRegistry: first registered becomes default; explicit setAsDefault swaps it", () => {
  const reg = new AgentRegistry();
  const a = new StubAgentProvider({ name: "a" });
  const b = new StubAgentProvider({ name: "b" });
  reg.register(a);
  assert.equal(reg.resolve()?.name, "a");
  reg.register(b);                          // implicit: keep current default
  assert.equal(reg.resolve()?.name, "a");
  reg.register(b, { setAsDefault: true });  // explicit override
  assert.equal(reg.resolve()?.name, "b");
});

test("AgentRegistry: resolve by preferred name throws AgentProviderError on miss", () => {
  const reg = new AgentRegistry();
  reg.register(new StubAgentProvider({ name: "x" }));
  assert.equal(reg.resolve({ preferred: "x" })?.name, "x");
  assert.throws(
    () => reg.resolve({ preferred: "nope" }),
    (err: unknown) => {
      assert.ok(err instanceof AgentProviderError);
      assert.equal((err as AgentProviderError).kind, "not_available");
      return true;
    },
  );
});

test("AgentRegistry: requiredCapabilities filters; null when missing", () => {
  const reg = new AgentRegistry();
  reg.register(new StubAgentProvider({ name: "p", capabilities: ["structured_output"] }));
  assert.ok(reg.resolve({ requiredCapabilities: ["structured_output"] }));
  assert.equal(reg.resolve({ requiredCapabilities: ["vision"] }), null);
});

test("AgentRegistry: unregister drops provider and recomputes default", () => {
  const reg = new AgentRegistry();
  reg.register(new StubAgentProvider({ name: "a" }));
  reg.register(new StubAgentProvider({ name: "b" }));
  reg.unregister("a");
  assert.deepEqual(reg.list(), ["b"]);
  assert.equal(reg.resolve()?.name, "b");
});

// ── StubAgentProvider ───────────────────────────────────────────────────────

const OutputSchema = z.object({ category: z.enum(["legitimate_retry", "other"]), reasoning: z.string() });

test("StubAgentProvider: FIFO queue replay; records calls", async () => {
  const stub = new StubAgentProvider({
    responses: [{ category: "legitimate_retry", reasoning: "ok" }],
  });
  const r = await stub.invoke({ prompt: "p1", outputSchema: OutputSchema });
  assert.equal(r.output.category, "legitimate_retry");
  assert.equal(r.providerName, "stub");
  assert.equal(stub.calls.length, 1);
  assert.equal(stub.pending(), 0);
});

test("StubAgentProvider: empty queue throws internal error so tests notice over-invocation", async () => {
  const stub = new StubAgentProvider();
  await assert.rejects(
    () => stub.invoke({ prompt: "p", outputSchema: OutputSchema }),
    (err: unknown) => err instanceof AgentProviderError && (err as AgentProviderError).kind === "internal",
  );
});

test("StubAgentProvider: response that violates outputSchema throws schema_violation", async () => {
  const stub = new StubAgentProvider({ responses: [{ category: "nope", reasoning: "x" }] });
  await assert.rejects(
    () => stub.invoke({ prompt: "p", outputSchema: OutputSchema }),
    (err: unknown) => err instanceof AgentProviderError && (err as AgentProviderError).kind === "schema_violation",
  );
});

test("StubAgentProvider: responseFn picks by prompt", async () => {
  const stub = new StubAgentProvider({
    responseFn: (prompt) =>
      prompt.includes("retry") ? { category: "legitimate_retry", reasoning: "yes" } : { category: "other", reasoning: "no" },
  });
  const r1 = await stub.invoke({ prompt: "should retry?", outputSchema: OutputSchema });
  const r2 = await stub.invoke({ prompt: "ignore", outputSchema: OutputSchema });
  assert.equal(r1.output.category, "legitimate_retry");
  assert.equal(r2.output.category, "other");
});

test("StubAgentProvider: unavailable flag surfaces as not_available", async () => {
  const stub = new StubAgentProvider({ unavailable: true });
  assert.equal(await stub.isAvailable(), false);
  await assert.rejects(
    () => stub.invoke({ prompt: "p", outputSchema: OutputSchema }),
    (err: unknown) => err instanceof AgentProviderError && (err as AgentProviderError).kind === "not_available",
  );
});

// ── PromptTemplateRegistry / render ─────────────────────────────────────────

test("PromptTemplateRegistry: registerInline + render with simple vars", () => {
  const reg = new PromptTemplateRegistry();
  reg.registerInline("builtin:t1", "tool={{tool_name}} loop={{loop_count}}");
  const out = render(reg.get("builtin:t1"), { tool_name: "search", loop_count: 4 });
  assert.equal(out, "tool=search loop=4");
});

test("render: unknown variable throws (no silent retention of placeholder)", () => {
  const reg = new PromptTemplateRegistry();
  reg.registerInline("builtin:t1", "{{unknown}}");
  assert.throws(() => render(reg.get("builtin:t1"), {}));
});

test("render: object var is JSON-stringified", () => {
  const reg = new PromptTemplateRegistry();
  reg.registerInline("builtin:t1", "spans:\n{{spans}}");
  const out = render(reg.get("builtin:t1"), { spans: [{ id: "a" }, { id: "b" }] });
  assert.match(out, /"id": "a"/);
  assert.match(out, /"id": "b"/);
});

test("render: null / undefined var renders as empty string", () => {
  const reg = new PromptTemplateRegistry();
  reg.registerInline("builtin:t1", "[{{maybe}}]");
  assert.equal(render(reg.get("builtin:t1"), { maybe: null }), "[]");
  assert.equal(render(reg.get("builtin:t1"), { maybe: undefined }), "[]");
});

test("PromptTemplateRegistry: get() throws with helpful list on unknown ref", () => {
  const reg = new PromptTemplateRegistry();
  reg.registerInline("builtin:a", "x");
  assert.throws(() => reg.get("builtin:missing"), /builtin:a/);
});

test("PromptTemplateRegistry.loadBuiltinDir: loads *.prompt.md, skips others", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "promptdir-"));
  try {
    await fs.writeFile(path.join(tmp, "rubric-judge-v1.prompt.md"), "judge: {{q}}");
    await fs.writeFile(path.join(tmp, "synth.prompt.md"), "synth body");
    await fs.writeFile(path.join(tmp, "ignored.md"), "not a prompt");
    const reg = new PromptTemplateRegistry();
    await reg.loadBuiltinDir(tmp);
    assert.deepEqual(reg.list().sort(), ["builtin:rubric-judge-v1", "builtin:synth"]);
    assert.equal(render(reg.get("builtin:rubric-judge-v1"), { q: "ok?" }), "judge: ok?");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("PromptTemplateRegistry.loadBuiltinDir: missing directory is a no-op (ENOENT)", async () => {
  const reg = new PromptTemplateRegistry();
  await reg.loadBuiltinDir(path.join(os.tmpdir(), "does-not-exist-" + Date.now()));
  assert.deepEqual(reg.list(), []);
});
