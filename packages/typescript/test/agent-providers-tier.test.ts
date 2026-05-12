import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import { ClaudeCodeSubprocessProvider } from "../src/agent-providers/providers/claude-code-subprocess.js";
import { StubAgentProvider } from "../src/agent-providers/providers/stub.js";

const OutputSchema = z.object({ ok: z.boolean() });

test("StubAgentProvider records tier on each invocation", async () => {
  const stub = new StubAgentProvider({ name: "stub", responses: [{ ok: true }, { ok: true }, { ok: true }] });
  await stub.invoke({ prompt: "p1", outputSchema: OutputSchema });
  await stub.invoke({ prompt: "p2", outputSchema: OutputSchema, tier: "fast" });
  await stub.invoke({ prompt: "p3", outputSchema: OutputSchema, tier: "std" });
  assert.equal(stub.calls.length, 3);
  assert.equal(stub.calls[0].tier, undefined);
  assert.equal(stub.calls[1].tier, "fast");
  assert.equal(stub.calls[2].tier, "std");
});

test("ClaudeCodeSubprocessProvider modelByTier defaults to haiku/sonnet", () => {
  const p = new ClaudeCodeSubprocessProvider();
  assert.equal((p as unknown as { modelByTier: { fast: string; std: string } }).modelByTier.fast, "haiku");
  assert.equal((p as unknown as { modelByTier: { fast: string; std: string } }).modelByTier.std, "sonnet");
});

test("ClaudeCodeSubprocessProvider modelByTier override", () => {
  const p = new ClaudeCodeSubprocessProvider({ modelByTier: { fast: "haiku-5-0", std: "opus" } });
  assert.equal((p as unknown as { modelByTier: { fast: string; std: string } }).modelByTier.fast, "haiku-5-0");
  assert.equal((p as unknown as { modelByTier: { fast: string; std: string } }).modelByTier.std, "opus");
});

test("ClaudeCodeSubprocessProvider buildSpawnArgs: no tier → no --model flag", () => {
  const p = new ClaudeCodeSubprocessProvider();
  const args = (p as unknown as { buildSpawnArgs: (tier?: "fast" | "std") => string[] }).buildSpawnArgs(undefined);
  assert.equal(args.includes("--model"), false);
});

test("ClaudeCodeSubprocessProvider buildSpawnArgs: tier=fast → --model haiku", () => {
  const p = new ClaudeCodeSubprocessProvider();
  const args = (p as unknown as { buildSpawnArgs: (tier?: "fast" | "std") => string[] }).buildSpawnArgs("fast");
  const idx = args.indexOf("--model");
  assert.ok(idx >= 0);
  assert.equal(args[idx + 1], "haiku");
});

test("ClaudeCodeSubprocessProvider buildSpawnArgs: tier=std → --model sonnet", () => {
  const p = new ClaudeCodeSubprocessProvider();
  const args = (p as unknown as { buildSpawnArgs: (tier?: "fast" | "std") => string[] }).buildSpawnArgs("std");
  const idx = args.indexOf("--model");
  assert.ok(idx >= 0);
  assert.equal(args[idx + 1], "sonnet");
});
