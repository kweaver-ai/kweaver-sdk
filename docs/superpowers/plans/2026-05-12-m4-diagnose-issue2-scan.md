# Trace Diagnose Batch + Cross-Trace Synthesizer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `kweaver trace diagnose --traces=<list>` batch mode with cross-trace synthesizer + artifact persistence. Single-trace mode aligns to the same artifact structure.

**Architecture:** Build on PR-B (`feature/120-trace-diagnose-prb-rubric` / #122). Add a peer subtree `src/trace-ai/scan/` (orchestrator + batched rubric + cross-trace synth + aggregator + sampler + artifacts writer). Small extensions to `agent-providers/` (tier abstraction) and `trace-ai/diagnose/` (gates_on field + ArtifactWriter hook). PR-B pipeline shape unchanged.

**Tech Stack:** TypeScript / node:test / zod / js-yaml. Reuses PR-B's `AgentProvider`, `ClaudeCodeSubprocessProvider`, `templateSynthesize`, `report-assembler`, `report-markdown`.

**Spec:** `docs/superpowers/specs/2026-05-12-m4-diagnose-issue2-scan.md` (commit `f125bff`).

**Branch:** `feature/123-trace-diagnose-scan` (off `feature/120-trace-diagnose-prb-rubric`).

---

## File Structure

| Path | Responsibility |
|---|---|
| `src/agent-providers/types.ts` | **Modify**: add `tier?: 'fast' \| 'std'` to `JudgmentRequest` |
| `src/agent-providers/providers/claude-code-subprocess.ts` | **Modify**: `modelByTier` opt + conditional `--model` flag |
| `src/trace-ai/diagnose/schemas.ts` | **Modify**: `RuleSchema.rubric.gates_on` optional array |
| `src/trace-ai/diagnose/index.ts` | **Modify**: add ArtifactWriter hook at emit time (single-trace mode artifacts) |
| `src/trace-ai/scan/artifacts/paths.ts` | **Create**: path strategy (batch vs single-trace) |
| `src/trace-ai/scan/artifacts/writer.ts` | **Create**: `ArtifactWriter` class with per-Stage write methods |
| `src/trace-ai/scan/traces-list-parser.ts` | **Create**: parse `<list>` and `@file` syntax |
| `src/trace-ai/scan/single-agent-validator.ts` | **Create**: fetch agent_id per conv_id; verify consistency |
| `src/trace-ai/scan/scan-summary-schema.ts` | **Create**: zod schema for `scan-summary/v1` |
| `src/trace-ai/scan/aggregator.ts` | **Create**: deterministic `rule_frequency` over per-trace reports |
| `src/trace-ai/scan/sampler.ts` | **Create**: K=5 representative selection |
| `src/trace-ai/scan/batched-rubric.ts` | **Create**: Stage-2 chunked LLM evaluator |
| `src/trace-ai/scan/cross-trace-synthesizer.ts` | **Create**: Stage-4 single LLM call |
| `src/trace-ai/scan/scan-summary-markdown.ts` | **Create**: scan-summary md renderer |
| `src/trace-ai/scan/runner.ts` | **Create**: per-trace Stage-1 + Stage-3-template + resume + atomic write |
| `src/trace-ai/scan/index.ts` | **Create**: `runBatch(opts)` orchestrator |
| `src/trace-ai/scan/prompts/builtin/rubric-judge-batch-v1.prompt.md` | **Create**: batched rubric prompt template |
| `src/trace-ai/scan/prompts/builtin/cross-trace-synthesizer-v1.prompt.md` | **Create**: cross-trace synth prompt template |
| `src/commands/trace.ts` | **Modify**: parse `--traces` / `--no-artifacts` / `--out=<dir>` required; dispatch to runBatch |
| `skills/kweaver-core/references/trace.md` | **Modify**: document batch mode + artifacts |
| `packages/typescript/package.json` | **Modify**: build script copies new prompt templates to `dist/` |

Test files mirror under `packages/typescript/test/` and `packages/typescript/test/e2e/`.

---

## Phase 1: Infrastructure extensions (Tasks 1-5)

### Task 1: AgentProvider tier abstraction

**Files:**
- Modify: `packages/typescript/src/agent-providers/types.ts`
- Modify: `packages/typescript/src/agent-providers/providers/claude-code-subprocess.ts`
- Test: `packages/typescript/test/agent-providers-tier.test.ts`

- [ ] **Step 1: Write failing tests for tier plumbing**

Create `packages/typescript/test/agent-providers-tier.test.ts`:

```typescript
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
  // Internal access for test — checked via instanceof reflection isn't pretty; expose a getter.
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
```

- [ ] **Step 2: Run test to verify failures**

```bash
cd packages/typescript && node --import tsx --test test/agent-providers-tier.test.ts
```

Expected: FAIL — `tier` not on `JudgmentRequest`, `modelByTier` / `buildSpawnArgs` not on provider.

- [ ] **Step 3: Add tier field to JudgmentRequest**

In `packages/typescript/src/agent-providers/types.ts`, find the `JudgmentRequest` interface and add `tier`:

```typescript
export interface JudgmentRequest<TOutput = unknown> {
  prompt: string;
  outputSchema: z.ZodType<TOutput>;
  timeoutMs?: number;
  correlationId?: string;
  /**
   * Task-difficulty intent for the LLM call. Providers map this to a concrete
   * model via their own configuration. `undefined` = provider's default (no
   * `--model` flag passed to claude CLI, preserving PR-B behavior).
   */
  tier?: 'fast' | 'std';
}
```

- [ ] **Step 4: Update StubAgentProvider to record tier**

In `packages/typescript/src/agent-providers/providers/stub.ts`, find `invoke()` and update the call recording shape to include `tier`:

```typescript
async invoke<TOutput>(req: JudgmentRequest<TOutput>): Promise<JudgmentResponse<TOutput>> {
  this.calls.push({ prompt: req.prompt, tier: req.tier, correlationId: req.correlationId });
  // ...existing body unchanged
}
```

If the existing `calls: { prompt: string; correlationId?: string }[]` shape needs widening, update its type to `{ prompt: string; tier?: 'fast' | 'std'; correlationId?: string }[]`.

- [ ] **Step 5: Add modelByTier + buildSpawnArgs to ClaudeCodeSubprocessProvider**

In `packages/typescript/src/agent-providers/providers/claude-code-subprocess.ts`:

```typescript
export interface ClaudeCodeSubprocessProviderOpts {
  binary?: string;
  extraArgs?: string[];
  defaultTimeoutMs?: number;
  cwd?: string;
  env?: Record<string, string>;
  name?: string;
  /**
   * Map the tier intent on a JudgmentRequest to a concrete claude model name.
   * Defaults: fast='haiku', std='sonnet'. `--model {value}` is appended to
   * spawn args only when `req.tier` is set; undefined tier omits the flag
   * and lets claude CLI pick its own default (preserves PR-B behavior).
   */
  modelByTier?: { fast?: string; std?: string };
}

// Inside the class:
private modelByTier: { fast: string; std: string };

constructor(opts: ClaudeCodeSubprocessProviderOpts = {}) {
  this.name = opts.name ?? "claude-code";
  this.binary = opts.binary ?? "claude";
  this.extraArgs = opts.extraArgs ?? [];
  this.defaultTimeoutMs = opts.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  this.cwd = opts.cwd ?? process.cwd();
  this.env = opts.env ?? {};
  this.modelByTier = {
    fast: opts.modelByTier?.fast ?? "haiku",
    std: opts.modelByTier?.std ?? "sonnet",
  };
}

/** Visible for testing. Builds the spawn args list including --model when tier is set. */
buildSpawnArgs(tier: 'fast' | 'std' | undefined): string[] {
  const args = [
    ...this.extraArgs,
    "-p",
    "--output-format=json",
    "--dangerously-skip-permissions",
  ];
  if (tier !== undefined) {
    args.push("--model", this.modelByTier[tier]);
  }
  return args;
}
```

Then change the existing `invoke()` body's args construction to call `buildSpawnArgs(req.tier)` instead of the inline literal array.

- [ ] **Step 6: Run tests to verify pass**

```bash
cd packages/typescript && node --import tsx --test test/agent-providers-tier.test.ts test/claude-code-subprocess.test.ts test/agent-binding.test.ts test/synthesizer-agent.test.ts
```

Expected: all PASS. No regression on existing PR-B tests because tier defaults to `undefined`.

- [ ] **Step 7: Commit**

```bash
git add packages/typescript/src/agent-providers/types.ts \
        packages/typescript/src/agent-providers/providers/stub.ts \
        packages/typescript/src/agent-providers/providers/claude-code-subprocess.ts \
        packages/typescript/test/agent-providers-tier.test.ts
git commit -m "feat(agent-providers): tier='fast'|'std' on JudgmentRequest; modelByTier on claude-code provider"
```

---

### Task 2: RuleSchema.rubric.gates_on field

**Files:**
- Modify: `packages/typescript/src/trace-ai/diagnose/schemas.ts`
- Modify: `packages/typescript/src/trace-ai/diagnose/types.ts` (parallel internal type)
- Modify: `packages/typescript/src/trace-ai/diagnose/rule-loader.ts` (propagate field)
- Test: `packages/typescript/test/rule-loader-gates-on.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/typescript/test/rule-loader-gates-on.test.ts`:

```typescript
import test from "node:test";
import assert from "node:assert/strict";

import { RuleSchema } from "../src/trace-ai/diagnose/schemas.js";

const minimalRubricYaml = {
  schema_version: "diagnosis-rule/v1",
  id: "r_g",
  severity: "high",
  symptom: "x",
  taxonomy: { signals_axis: "execution", ms_class: "retry_loop" },
  suggested_fix: { target: "agent.prompt", change_template: "fix" },
  verify_with: { assertion_templates: [] },
  rubric: {
    judge_question: "q",
    inputs: [{ kind: "user_intent", source: "extract_from_root_attr:gen_ai.user.message" }],
    output_schema: {
      type: "object",
      required: ["category", "reasoning", "severity", "first_violating_step_id"],
      properties: {
        category: { type: "string", enum: ["a", "b"] },
        reasoning: { type: "string" },
        severity: { type: "string", enum: ["low", "medium", "high"] },
        first_violating_step_id: { type: "string" },
      },
    },
    agent_binding: { provider: "stub", prompt_template_ref: "builtin:rubric-judge-v1" },
  },
};

test("RuleSchema: gates_on absent → parses with gates_on undefined", () => {
  const parsed = RuleSchema.parse(minimalRubricYaml);
  assert.equal(parsed.rubric?.gates_on, undefined);
});

test("RuleSchema: gates_on present → parsed as string array", () => {
  const withGates = { ...minimalRubricYaml, rubric: { ...minimalRubricYaml.rubric, gates_on: ["tool_loop_no_state_change"] } };
  const parsed = RuleSchema.parse(withGates);
  assert.deepEqual(parsed.rubric?.gates_on, ["tool_loop_no_state_change"]);
});

test("RuleSchema: gates_on multiple symbolic ids", () => {
  const withGates = { ...minimalRubricYaml, rubric: { ...minimalRubricYaml.rubric, gates_on: ["rule_a", "rule_b"] } };
  const parsed = RuleSchema.parse(withGates);
  assert.deepEqual(parsed.rubric?.gates_on, ["rule_a", "rule_b"]);
});

test("RuleSchema: gates_on must be string array (rejects number)", () => {
  const bad = { ...minimalRubricYaml, rubric: { ...minimalRubricYaml.rubric, gates_on: [123] } };
  const r = RuleSchema.safeParse(bad);
  assert.equal(r.success, false);
});
```

- [ ] **Step 2: Run test to verify failures**

```bash
cd packages/typescript && node --import tsx --test test/rule-loader-gates-on.test.ts
```

Expected: FAIL — `gates_on` not on schema; will be rejected as unknown key in strict mode, OR will pass through as `any` and assertions fail.

- [ ] **Step 3: Add gates_on to RuleSchema**

In `packages/typescript/src/trace-ai/diagnose/schemas.ts`, find the `rubric` zod object (inside `RuleSchema`) and add the optional `gates_on` field:

```typescript
// Inside the rubric schema definition (z.object inside RuleSchema):
rubric: z.object({
  judge_question: z.string().min(1),
  inputs: z.array(/* ...existing... */),
  output_schema: z.record(z.unknown()),
  agent_binding: z.object({
    provider: z.string(),
    prompt_template_ref: z.string(),
  }),
  /**
   * Optional symbolic rule_ids that act as gate for this rubric in batch mode.
   * Empty/missing → rubric runs on all traces (PR-B fallback). In single-trace
   * mode this field is ignored; rubric always runs.
   */
  gates_on: z.array(z.string()).optional(),
}).optional(),
```

- [ ] **Step 4: Propagate gates_on to internal RubricSpec type**

In `packages/typescript/src/trace-ai/diagnose/types.ts`, find `RubricSpec` and add:

```typescript
export interface RubricSpec {
  judgeQuestion: string;
  inputs: { kind: string; source: string }[];
  outputSchemaRaw: Record<string, unknown>;
  outputZodSchema: z.ZodType<unknown>;
  agentBinding: { provider: string; promptTemplateRef: string };
  /** Optional gating; see RuleSchema.rubric.gates_on. */
  gatesOn?: string[];
}
```

- [ ] **Step 5: Propagate gates_on through rule-loader**

In `packages/typescript/src/trace-ai/diagnose/rule-loader.ts`, find where `RubricSpec` is constructed from parsed yaml and add the `gatesOn` mapping:

```typescript
// Wherever the rubric branch builds RubricSpec from parsed.rubric:
const rubric: RubricSpec = {
  judgeQuestion: parsed.rubric.judge_question,
  inputs: parsed.rubric.inputs.map((i) => ({ kind: i.kind, source: i.source })),
  outputSchemaRaw: parsed.rubric.output_schema as Record<string, unknown>,
  outputZodSchema: rubricOutputToZod(parsed.rubric),
  agentBinding: {
    provider: parsed.rubric.agent_binding.provider,
    promptTemplateRef: parsed.rubric.agent_binding.prompt_template_ref,
  },
  gatesOn: parsed.rubric.gates_on,
};
```

- [ ] **Step 6: Run tests to verify pass**

```bash
cd packages/typescript && node --import tsx --test test/rule-loader-gates-on.test.ts test/rule-loader.test.ts test/agent-binding.test.ts
```

Expected: all PASS. Existing rule-loader tests stay green because the field is optional.

- [ ] **Step 7: Commit**

```bash
git add packages/typescript/src/trace-ai/diagnose/schemas.ts \
        packages/typescript/src/trace-ai/diagnose/types.ts \
        packages/typescript/src/trace-ai/diagnose/rule-loader.ts \
        packages/typescript/test/rule-loader-gates-on.test.ts
git commit -m "feat(trace-ai/diagnose): rubric.gates_on optional field on RuleSchema"
```

---

### Task 3: ArtifactWriter paths module

**Files:**
- Create: `packages/typescript/src/trace-ai/scan/artifacts/paths.ts`
- Test: `packages/typescript/test/artifacts-paths.test.ts`

- [ ] **Step 1: Write failing test**

Create `packages/typescript/test/artifacts-paths.test.ts`:

```typescript
import test from "node:test";
import assert from "node:assert/strict";

import { resolveArtifactsBase } from "../src/trace-ai/scan/artifacts/paths.js";

test("batch mode: --out=<dir> → <dir>/artifacts/", () => {
  assert.equal(resolveArtifactsBase({ mode: "batch", out: "diagnosis/ticket-42" }), "diagnosis/ticket-42/artifacts");
});

test("batch mode: trailing slash on --out is normalized", () => {
  assert.equal(resolveArtifactsBase({ mode: "batch", out: "diagnosis/ticket-42/" }), "diagnosis/ticket-42/artifacts");
});

test("single-trace mode: --out=<dir>/<stem>.yaml → <dir>/<stem>.artifacts/", () => {
  assert.equal(resolveArtifactsBase({ mode: "single", out: "diagnosis/refund.yaml" }), "diagnosis/refund.artifacts");
});

test("single-trace mode: --out=<dir>/<stem>.yml → <dir>/<stem>.artifacts/", () => {
  assert.equal(resolveArtifactsBase({ mode: "single", out: "diagnosis/refund.yml" }), "diagnosis/refund.artifacts");
});

test("single-trace mode: --out=<dir>/<stem>.md → <dir>/<stem>.artifacts/", () => {
  assert.equal(resolveArtifactsBase({ mode: "single", out: "diagnosis/refund.md" }), "diagnosis/refund.artifacts");
});

test("single-trace mode: --out without extension → <out>.artifacts/", () => {
  assert.equal(resolveArtifactsBase({ mode: "single", out: "diagnosis/refund" }), "diagnosis/refund.artifacts");
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
cd packages/typescript && node --import tsx --test test/artifacts-paths.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement paths module**

Create `packages/typescript/src/trace-ai/scan/artifacts/paths.ts`:

```typescript
import path from "node:path";

export interface ResolveArtifactsBaseInput {
  /** 'batch' → `<out>/artifacts/`; 'single' → `<stem>.artifacts/` next to the report. */
  mode: "batch" | "single";
  /** Batch: directory path (`--out=<dir>`). Single: file path (`--out=<file.yaml>`). */
  out: string;
}

/**
 * Resolve the artifacts base directory given the caller's `--out` value and
 * mode. Strips known extensions in single-trace mode so `.yaml`, `.yml`, and
 * `.md` all yield the same artifacts dir name.
 */
export function resolveArtifactsBase(input: ResolveArtifactsBaseInput): string {
  if (input.mode === "batch") {
    // Trim trailing slash, then append `artifacts`.
    const trimmed = input.out.replace(/\/+$/, "");
    return path.join(trimmed, "artifacts");
  }
  // single-trace: <dirname>/<stem>.artifacts/
  const dir = path.dirname(input.out);
  const base = path.basename(input.out);
  const stem = base.replace(/\.(yaml|yml|md)$/i, "");
  return path.join(dir, `${stem}.artifacts`);
}
```

- [ ] **Step 4: Run test to verify pass**

```bash
cd packages/typescript && node --import tsx --test test/artifacts-paths.test.ts
```

Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/typescript/src/trace-ai/scan/artifacts/paths.ts \
        packages/typescript/test/artifacts-paths.test.ts
git commit -m "feat(trace-ai/scan): artifacts paths module — resolveArtifactsBase"
```

---

### Task 4: ArtifactWriter core

**Files:**
- Create: `packages/typescript/src/trace-ai/scan/artifacts/writer.ts`
- Test: `packages/typescript/test/artifacts-writer.test.ts`

- [ ] **Step 1: Write failing test**

Create `packages/typescript/test/artifacts-writer.test.ts`:

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ArtifactWriter } from "../src/trace-ai/scan/artifacts/writer.js";

async function tmpDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "artifacts-test-"));
}

test("ArtifactWriter: enabled=false → no-op for all write methods", async () => {
  const base = await tmpDir();
  const w = new ArtifactWriter({ base, enabled: false });
  await w.writeStageTwoPrompt("rule_a", 0, "prompt text");
  await w.writeStageTwoResponse("rule_a", 0, { foo: "bar" });
  await w.writeRunMetadata({ cli_args: {} } as never);
  const entries = await fs.readdir(base).catch(() => []);
  assert.equal(entries.length, 0);
  await fs.rm(base, { recursive: true, force: true });
});

test("ArtifactWriter: stage-2 prompt + response + parse-errors write to <rule_id>/chunk-NNN.*", async () => {
  const base = await tmpDir();
  const w = new ArtifactWriter({ base, enabled: true });
  await w.writeStageTwoWorkQueue("tool_retry_intent_mismatch", ["conv_a", "conv_b"]);
  await w.writeStageTwoPrompt("tool_retry_intent_mismatch", 3, "prompt body");
  await w.writeStageTwoResponse("tool_retry_intent_mismatch", 3, { trace_results: [] });
  await w.writeStageTwoParseErrors("tool_retry_intent_mismatch", 3, [{ trace_id: "x", reason: "bad" }]);

  const ruleDir = path.join(base, "stage-2-rubric", "tool_retry_intent_mismatch");
  const queue = JSON.parse(await fs.readFile(path.join(ruleDir, "work-queue.json"), "utf8"));
  assert.deepEqual(queue, ["conv_a", "conv_b"]);
  const prompt = await fs.readFile(path.join(ruleDir, "chunk-003.prompt.md"), "utf8");
  assert.equal(prompt, "prompt body");
  const response = JSON.parse(await fs.readFile(path.join(ruleDir, "chunk-003.response.json"), "utf8"));
  assert.deepEqual(response, { trace_results: [] });
  const errors = JSON.parse(await fs.readFile(path.join(ruleDir, "chunk-003.parse-errors.json"), "utf8"));
  assert.equal(errors[0].trace_id, "x");
  await fs.rm(base, { recursive: true, force: true });
});

test("ArtifactWriter: chunk indices zero-padded to 3 digits", async () => {
  const base = await tmpDir();
  const w = new ArtifactWriter({ base, enabled: true });
  await w.writeStageTwoPrompt("r", 0, "p0");
  await w.writeStageTwoPrompt("r", 12, "p12");
  await w.writeStageTwoPrompt("r", 999, "p999");
  const dir = path.join(base, "stage-2-rubric", "r");
  const files = (await fs.readdir(dir)).sort();
  assert.ok(files.includes("chunk-000.prompt.md"));
  assert.ok(files.includes("chunk-012.prompt.md"));
  assert.ok(files.includes("chunk-999.prompt.md"));
  await fs.rm(base, { recursive: true, force: true });
});

test("ArtifactWriter: stage-3-synth writes prompt + response (single-trace mode)", async () => {
  const base = await tmpDir();
  const w = new ArtifactWriter({ base, enabled: true });
  await w.writeStageThreeSynthPrompt("synth prompt body");
  await w.writeStageThreeSynthResponse({ headline: "h" });
  assert.equal(await fs.readFile(path.join(base, "stage-3-synth", "prompt.md"), "utf8"), "synth prompt body");
  const r = JSON.parse(await fs.readFile(path.join(base, "stage-3-synth", "response.json"), "utf8"));
  assert.equal(r.headline, "h");
  await fs.rm(base, { recursive: true, force: true });
});

test("ArtifactWriter: stage-4 cross-trace writes aggregates / samples / prompt / response", async () => {
  const base = await tmpDir();
  const w = new ArtifactWriter({ base, enabled: true });
  await w.writeStageFourInputs({ rule_frequency: [] }, { samples: ["conv_a"] });
  await w.writeStageFourPrompt("cross-trace prompt");
  await w.writeStageFourResponse({ headline: "x" });
  const dir = path.join(base, "stage-4-cross-trace-synth");
  assert.ok((await fs.readFile(path.join(dir, "aggregates.json"), "utf8")).includes("rule_frequency"));
  assert.ok((await fs.readFile(path.join(dir, "samples.json"), "utf8")).includes("conv_a"));
  assert.equal(await fs.readFile(path.join(dir, "prompt.md"), "utf8"), "cross-trace prompt");
  const r = JSON.parse(await fs.readFile(path.join(dir, "response.json"), "utf8"));
  assert.equal(r.headline, "x");
  await fs.rm(base, { recursive: true, force: true });
});

test("ArtifactWriter: run-metadata.json written with full shape", async () => {
  const base = await tmpDir();
  const w = new ArtifactWriter({ base, enabled: true });
  await w.writeRunMetadata({
    cli_args: { traces: "a,b", out: "/tmp/out" },
    agent_id: "01KR_x",
    rule_load_summary: { rules_applied: ["r1"], rules_skipped_at_load: [], rules_dir: "builtin" },
    single_agent_validation: { checked_conv_ids: 2, agent_id_resolved: "01KR_x" },
    timing: { stage_1_ms: 10, stage_2_ms: 100, stage_3_ms: 5, stage_4_ms: 50, total_ms: 165 },
    llm_calls: { stage_2_chunks: 1, stage_3: 0, stage_4: 1, total: 2 },
    cost_estimate_usd: { stage_2: 0.005, stage_4: 0.05, total: 0.055, model_price_table_version: "2026-05" },
  });
  const meta = JSON.parse(await fs.readFile(path.join(base, "run-metadata.json"), "utf8"));
  assert.equal(meta.agent_id, "01KR_x");
  assert.equal(meta.llm_calls.total, 2);
  await fs.rm(base, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run test to verify failures**

```bash
cd packages/typescript && node --import tsx --test test/artifacts-writer.test.ts
```

Expected: FAIL — `ArtifactWriter` not implemented.

- [ ] **Step 3: Implement ArtifactWriter**

Create `packages/typescript/src/trace-ai/scan/artifacts/writer.ts`:

```typescript
import fs from "node:fs/promises";
import path from "node:path";

export interface RunMetadata {
  cli_args: Record<string, unknown>;
  agent_id: string;
  rule_load_summary: {
    rules_applied: string[];
    rules_skipped_at_load: string[];
    rules_dir: string;
  };
  single_agent_validation: {
    checked_conv_ids: number;
    agent_id_resolved: string;
  };
  timing: {
    stage_1_ms: number;
    stage_2_ms: number;
    stage_3_ms: number;
    stage_4_ms: number;
    total_ms: number;
  };
  llm_calls: {
    stage_2_chunks: number;
    stage_3: number;
    stage_4: number;
    total: number;
  };
  cost_estimate_usd: {
    stage_2: number;
    stage_4: number;
    total: number;
    model_price_table_version: string;
  };
}

export interface ArtifactWriterOpts {
  /** Base directory; everything else is relative to this. */
  base: string;
  /** When false, all write methods are no-ops. */
  enabled: boolean;
}

/**
 * Persists each Stage's LLM I/O to disk so users can trace why a diagnosis
 * came out the way it did. Used by both single-trace (PR-B `diagnose()`) and
 * batch (`runBatch()`); only the directory base differs.
 *
 * Layout (under `base`):
 *   run-metadata.json
 *   stage-2-rubric/<rule_id>/{work-queue.json, chunk-NNN.{prompt.md, response.json, parse-errors.json}}
 *   stage-3-synth/{prompt.md, response.json}             ← single-trace only
 *   stage-4-cross-trace-synth/{aggregates.json, samples.json, prompt.md, response.json, parse-errors.json}  ← batch only
 */
export class ArtifactWriter {
  private base: string;
  private enabled: boolean;

  constructor(opts: ArtifactWriterOpts) {
    this.base = opts.base;
    this.enabled = opts.enabled;
  }

  private async ensureDir(rel: string): Promise<string> {
    const abs = path.join(this.base, rel);
    await fs.mkdir(abs, { recursive: true });
    return abs;
  }

  private chunkSlug(idx: number): string {
    return `chunk-${String(idx).padStart(3, "0")}`;
  }

  async writeStageTwoWorkQueue(ruleId: string, convIds: string[]): Promise<void> {
    if (!this.enabled) return;
    const dir = await this.ensureDir(path.join("stage-2-rubric", ruleId));
    await fs.writeFile(path.join(dir, "work-queue.json"), JSON.stringify(convIds, null, 2), "utf8");
  }

  async writeStageTwoPrompt(ruleId: string, chunkIdx: number, prompt: string): Promise<void> {
    if (!this.enabled) return;
    const dir = await this.ensureDir(path.join("stage-2-rubric", ruleId));
    await fs.writeFile(path.join(dir, `${this.chunkSlug(chunkIdx)}.prompt.md`), prompt, "utf8");
  }

  async writeStageTwoResponse(ruleId: string, chunkIdx: number, response: unknown): Promise<void> {
    if (!this.enabled) return;
    const dir = await this.ensureDir(path.join("stage-2-rubric", ruleId));
    await fs.writeFile(path.join(dir, `${this.chunkSlug(chunkIdx)}.response.json`), JSON.stringify(response, null, 2), "utf8");
  }

  async writeStageTwoParseErrors(ruleId: string, chunkIdx: number, errors: unknown[]): Promise<void> {
    if (!this.enabled || errors.length === 0) return;
    const dir = await this.ensureDir(path.join("stage-2-rubric", ruleId));
    await fs.writeFile(path.join(dir, `${this.chunkSlug(chunkIdx)}.parse-errors.json`), JSON.stringify(errors, null, 2), "utf8");
  }

  async writeStageThreeSynthPrompt(prompt: string): Promise<void> {
    if (!this.enabled) return;
    const dir = await this.ensureDir("stage-3-synth");
    await fs.writeFile(path.join(dir, "prompt.md"), prompt, "utf8");
  }

  async writeStageThreeSynthResponse(response: unknown): Promise<void> {
    if (!this.enabled) return;
    const dir = await this.ensureDir("stage-3-synth");
    await fs.writeFile(path.join(dir, "response.json"), JSON.stringify(response, null, 2), "utf8");
  }

  async writeStageFourInputs(aggregates: unknown, samples: unknown): Promise<void> {
    if (!this.enabled) return;
    const dir = await this.ensureDir("stage-4-cross-trace-synth");
    await fs.writeFile(path.join(dir, "aggregates.json"), JSON.stringify(aggregates, null, 2), "utf8");
    await fs.writeFile(path.join(dir, "samples.json"), JSON.stringify(samples, null, 2), "utf8");
  }

  async writeStageFourPrompt(prompt: string): Promise<void> {
    if (!this.enabled) return;
    const dir = await this.ensureDir("stage-4-cross-trace-synth");
    await fs.writeFile(path.join(dir, "prompt.md"), prompt, "utf8");
  }

  async writeStageFourResponse(response: unknown): Promise<void> {
    if (!this.enabled) return;
    const dir = await this.ensureDir("stage-4-cross-trace-synth");
    await fs.writeFile(path.join(dir, "response.json"), JSON.stringify(response, null, 2), "utf8");
  }

  async writeStageFourParseErrors(errors: unknown[]): Promise<void> {
    if (!this.enabled || errors.length === 0) return;
    const dir = await this.ensureDir("stage-4-cross-trace-synth");
    await fs.writeFile(path.join(dir, "parse-errors.json"), JSON.stringify(errors, null, 2), "utf8");
  }

  async writeRunMetadata(meta: RunMetadata): Promise<void> {
    if (!this.enabled) return;
    await fs.mkdir(this.base, { recursive: true });
    await fs.writeFile(path.join(this.base, "run-metadata.json"), JSON.stringify(meta, null, 2), "utf8");
  }
}
```

- [ ] **Step 4: Run test to verify pass**

```bash
cd packages/typescript && node --import tsx --test test/artifacts-writer.test.ts
```

Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/typescript/src/trace-ai/scan/artifacts/writer.ts \
        packages/typescript/test/artifacts-writer.test.ts
git commit -m "feat(trace-ai/scan): ArtifactWriter shared module (stage-2/3/4 + run-metadata)"
```

---

### Task 5: Hook ArtifactWriter into single-trace diagnose

**Files:**
- Modify: `packages/typescript/src/trace-ai/diagnose/index.ts`
- Modify: `packages/typescript/src/trace-ai/diagnose/types.ts` (DiagnoseOpts gains noArtifacts)
- Modify: `packages/typescript/src/trace-ai/diagnose/agent-binding.ts` (callsite for stage-2 artifact)
- Modify: `packages/typescript/src/trace-ai/diagnose/synthesizer-agent.ts` (callsite for stage-3 artifact)
- Test: `packages/typescript/test/diagnose-single-trace-artifacts.test.ts`

- [ ] **Step 1: Write failing test**

Create `packages/typescript/test/diagnose-single-trace-artifacts.test.ts`:

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { diagnose } from "../src/trace-ai/diagnose/index.js";
import { AgentRegistry } from "../src/agent-providers/registry.js";
import { StubAgentProvider } from "../src/agent-providers/providers/stub.js";
import { PromptTemplateRegistry } from "../src/agent-providers/prompt-template.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(__dirname, "fixtures/trace-diagnose");

function mockFetch(data: unknown) {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(data), { status: 200 });
  return { restore: () => { globalThis.fetch = orig; } };
}

test("single-trace diagnose: artifacts dir created next to --out, stage-2/stage-3 written", async () => {
  const fixture = JSON.parse(await fs.readFile(path.join(FIX, "synthetic/tool-loop-no-state-change.json"), "utf8"));
  const m = mockFetch(fixture);
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "single-art-"));
  const outFile = path.join(outDir, "refund.yaml");

  const stub = new StubAgentProvider({
    name: "claude-code",
    capabilities: ["structured_output"],
    responseFn: async (prompt) => {
      if (/FINDINGS:|Within-Trace Synthesizer/i.test(prompt)) {
        return {
          headline: "h",
          primary_root_cause: { finding_ids: [0], description: "d", target_for_fix: "t" },
          fix_priority: [{ finding_id: 0, reason: "r" }],
          cross_finding_links: [],
        };
      }
      return {
        category: "stale_results",
        reasoning: "rr",
        severity: "high",
        confidence: "high",
        first_violating_step_id: "t3",
        evidence_span_ids: ["t1", "t2", "t3"],
      };
    },
  });
  const registry = new AgentRegistry();
  registry.register(stub, { setAsDefault: true });

  try {
    await diagnose("tr_x", {
      out: outFile,
      rulesDir: null,
      noBuiltin: false,
      noLlm: false,
      noArtifacts: false,
      agentProvider: null,
      timeoutMs: 60000,
      baseUrl: "https://mock.kweaver.test",
      token: "tk",
      businessDomain: "bd_public",
      format: "yaml",
    }, { registry, promptRegistry: new PromptTemplateRegistry() });

    const artifactsBase = path.join(outDir, "refund.artifacts");
    const stage2 = path.join(artifactsBase, "stage-2-rubric", "tool_retry_intent_mismatch");
    const stage3 = path.join(artifactsBase, "stage-3-synth");
    assert.ok(await fs.stat(path.join(stage2, "chunk-000.prompt.md")).then(() => true).catch(() => false), "stage-2 chunk-000 prompt missing");
    assert.ok(await fs.stat(path.join(stage2, "chunk-000.response.json")).then(() => true).catch(() => false), "stage-2 chunk-000 response missing");
    assert.ok(await fs.stat(path.join(stage3, "prompt.md")).then(() => true).catch(() => false), "stage-3-synth prompt missing");
    assert.ok(await fs.stat(path.join(stage3, "response.json")).then(() => true).catch(() => false), "stage-3-synth response missing");
    assert.ok(await fs.stat(path.join(artifactsBase, "run-metadata.json")).then(() => true).catch(() => false), "run-metadata missing");
  } finally {
    m.restore();
    await fs.rm(outDir, { recursive: true, force: true });
  }
});

test("single-trace diagnose: --no-artifacts (noArtifacts=true) → no artifacts dir created", async () => {
  const fixture = JSON.parse(await fs.readFile(path.join(FIX, "synthetic/tool-loop-no-state-change.json"), "utf8"));
  const m = mockFetch(fixture);
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "single-noart-"));
  const outFile = path.join(outDir, "refund.yaml");

  try {
    await diagnose("tr_x", {
      out: outFile,
      rulesDir: null,
      noBuiltin: false,
      noLlm: true,
      noArtifacts: true,
      agentProvider: null,
      timeoutMs: 60000,
      baseUrl: "https://mock.kweaver.test",
      token: "tk",
      businessDomain: "bd_public",
      format: "yaml",
    });
    const exists = await fs.stat(path.join(outDir, "refund.artifacts")).then(() => true).catch(() => false);
    assert.equal(exists, false, "artifacts dir must not exist under --no-artifacts");
  } finally {
    m.restore();
    await fs.rm(outDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Add noArtifacts to DiagnoseOpts**

In `packages/typescript/src/trace-ai/diagnose/types.ts`, find `DiagnoseOpts` and add:

```typescript
export interface DiagnoseOpts {
  // ...existing fields
  /** Skip artifact persistence. Default false (artifacts ARE written). */
  noArtifacts?: boolean;
}
```

- [ ] **Step 3: Construct ArtifactWriter in diagnose()**

In `packages/typescript/src/trace-ai/diagnose/index.ts`, near the top of `diagnose()` (after the opts destructuring but before stage execution):

```typescript
import { ArtifactWriter } from "../scan/artifacts/writer.js";
import { resolveArtifactsBase } from "../scan/artifacts/paths.js";

// ...inside diagnose():
const artifactsEnabled = !(opts.noArtifacts ?? false) && opts.out !== null;
const artifactsBase = artifactsEnabled
  ? resolveArtifactsBase({ mode: "single", out: opts.out! })
  : "";
const artifacts = new ArtifactWriter({ base: artifactsBase, enabled: artifactsEnabled });
```

When `out === null` (stdout), artifacts are off — there's no parent directory to live under.

- [ ] **Step 4: Wire artifacts into agent-binding (Stage-2) and synthesizer-agent (Stage-3)**

In `packages/typescript/src/trace-ai/diagnose/agent-binding.ts`, extend `RubricEvaluateOpts` to accept an `artifacts?: ArtifactWriter` and an `onCallStart?: (ruleId, chunkIdx, prompt) => Promise<void>` / `onCallEnd?: (ruleId, chunkIdx, response) => Promise<void>` callback pair. Simplest path:

```typescript
import type { ArtifactWriter } from "../scan/artifacts/writer.js";

export interface RubricEvaluateOpts {
  // ...existing
  artifacts?: ArtifactWriter;
}

// Inside evaluateOne(rule, tree, provider, promptRegistry, timeoutMs, lang, artifacts?):
const prompt = renderPrompt(tpl, buildPromptVars(rule, tree, resolvedInputs, lang));
if (artifacts) {
  await artifacts.writeStageTwoPrompt(rule.id, 0, prompt);  // chunk-000 (single-trace mode K=1)
}
const resp = await provider.invoke({
  prompt,
  outputSchema: rubric.outputZodSchema,
  timeoutMs,
  correlationId: `${tree.traceId}/${rule.id}`,
});
if (artifacts) {
  await artifacts.writeStageTwoResponse(rule.id, 0, resp.output);
}
```

Pass `opts.artifacts` from `evaluateRubricRules` to `evaluateOne`. Inside `evaluateRubricRules`, also call `await artifacts?.writeStageTwoWorkQueue(rule.id, [tree.traceId])` once before evaluating (single-trace mode has a 1-element work queue).

In `packages/typescript/src/trace-ai/diagnose/synthesizer-agent.ts`, similarly extend `AgentSynthesizeOpts` with `artifacts?: ArtifactWriter` and write at the LLM call site:

```typescript
if (opts.artifacts) {
  await opts.artifacts.writeStageThreeSynthPrompt(prompt);
}
const resp = await opts.provider.invoke({ ... });
if (opts.artifacts) {
  await opts.artifacts.writeStageThreeSynthResponse(resp.output);
}
```

- [ ] **Step 5: Pass artifacts through diagnose() to both stages**

In `packages/typescript/src/trace-ai/diagnose/index.ts`:

```typescript
// Stage-2 rubric eval — pass artifacts:
const r = await evaluateRubricRules({
  rules,
  tree,
  registry,
  promptRegistry,
  noLlm: opts.noLlm,
  timeoutMs: opts.timeoutMs,
  lang: opts.lang,
  artifacts,
});

// Stage-3 synth — pass artifacts:
const synth = await agentSynthesize({
  findings: allFindings,
  traceId: primaryTraceId,
  agentId: extractAgentId(tree),
  provider: synthProvider,
  promptRegistry,
  timeoutMs: opts.timeoutMs,
  lang: opts.lang,
  artifacts,
});
```

After Stage-3, write run-metadata (single-trace shape — totals are simple):

```typescript
const t_total = Date.now() - t_start;
await artifacts.writeRunMetadata({
  cli_args: { conv_id: conversationId, out: opts.out, lang: opts.lang ?? "en" },
  agent_id: extractAgentId(tree) ?? "",
  rule_load_summary: {
    rules_applied: rules.map((r) => r.id),
    rules_skipped_at_load: [],
    rules_dir: opts.rulesDir ?? "builtin",
  },
  single_agent_validation: { checked_conv_ids: 1, agent_id_resolved: extractAgentId(tree) ?? "" },
  timing: { stage_1_ms: 0, stage_2_ms: 0, stage_3_ms: 0, stage_4_ms: 0, total_ms: t_total },
  llm_calls: {
    stage_2_chunks: rubricFindings.length > 0 ? 1 : 0,
    stage_3: synth.mode === "agent" ? 1 : 0,
    stage_4: 0,
    total: (rubricFindings.length > 0 ? 1 : 0) + (synth.mode === "agent" ? 1 : 0),
  },
  cost_estimate_usd: { stage_2: 0, stage_4: 0, total: 0, model_price_table_version: "2026-05" },
});
```

(Per-stage `_ms` timing requires `Date.now()` snapshots around each stage; for single-trace MVP a single `total_ms` suffices. Batch mode populates each stage individually.)

- [ ] **Step 6: Run tests to verify pass**

```bash
cd packages/typescript && node --import tsx --test test/diagnose-single-trace-artifacts.test.ts test/agent-binding.test.ts test/synthesizer-agent.test.ts
```

Expected: PASS. Existing PR-B tests unaffected (artifacts default off via env or noArtifacts when not specified — confirm with one untouched PR-B e2e too).

- [ ] **Step 7: Run a wider regression sweep**

```bash
cd packages/typescript && node --import tsx --test test/*.test.ts test/e2e/*.test.ts
```

Expected: all PASS + 11 live-skipped. No regression on PR-B.

- [ ] **Step 8: Commit**

```bash
git add packages/typescript/src/trace-ai/diagnose/types.ts \
        packages/typescript/src/trace-ai/diagnose/index.ts \
        packages/typescript/src/trace-ai/diagnose/agent-binding.ts \
        packages/typescript/src/trace-ai/diagnose/synthesizer-agent.ts \
        packages/typescript/test/diagnose-single-trace-artifacts.test.ts
git commit -m "feat(trace-ai/diagnose): ArtifactWriter hook in single-trace mode (stage-2 + stage-3 + run-metadata)"
```

---

## Phase 2: Batch input layer (Tasks 6-7)

### Task 6: traces-list-parser

**Files:**
- Create: `packages/typescript/src/trace-ai/scan/traces-list-parser.ts`
- Test: `packages/typescript/test/traces-list-parser.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { parseTracesList, TracesListError } from "../src/trace-ai/scan/traces-list-parser.js";

test("parseTracesList: comma-separated parses to trimmed array", async () => {
  const ids = await parseTracesList("conv1,conv2,conv3");
  assert.deepEqual(ids, ["conv1", "conv2", "conv3"]);
});

test("parseTracesList: whitespace around commas is trimmed", async () => {
  const ids = await parseTracesList("conv1 , conv2 ,conv3");
  assert.deepEqual(ids, ["conv1", "conv2", "conv3"]);
});

test("parseTracesList: empty entries are filtered out", async () => {
  const ids = await parseTracesList("conv1,,conv2,");
  assert.deepEqual(ids, ["conv1", "conv2"]);
});

test("parseTracesList: @file reads one id per line", async () => {
  const f = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "tlp-")), "ids.txt");
  await fs.writeFile(f, "conv_a\nconv_b\nconv_c\n", "utf8");
  const ids = await parseTracesList(`@${f}`);
  assert.deepEqual(ids, ["conv_a", "conv_b", "conv_c"]);
});

test("parseTracesList: @file ignores blank lines and # comments", async () => {
  const f = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "tlp-")), "ids.txt");
  await fs.writeFile(f, "# header\nconv_a\n\n# inline\nconv_b\n", "utf8");
  const ids = await parseTracesList(`@${f}`);
  assert.deepEqual(ids, ["conv_a", "conv_b"]);
});

test("parseTracesList: @file missing → TracesListError code=file-not-found", async () => {
  await assert.rejects(
    () => parseTracesList("@/no/such/file.txt"),
    (e: unknown) => e instanceof TracesListError && (e as TracesListError).code === "file-not-found",
  );
});

test("parseTracesList: @file empty/all-blank → TracesListError code=empty", async () => {
  const f = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "tlp-")), "empty.txt");
  await fs.writeFile(f, "\n\n   \n", "utf8");
  await assert.rejects(
    () => parseTracesList(`@${f}`),
    (e: unknown) => e instanceof TracesListError && (e as TracesListError).code === "empty",
  );
});

test("parseTracesList: empty string → TracesListError code=empty", async () => {
  await assert.rejects(
    () => parseTracesList(""),
    (e: unknown) => e instanceof TracesListError && (e as TracesListError).code === "empty",
  );
});

test("parseTracesList: only commas → TracesListError code=empty", async () => {
  await assert.rejects(
    () => parseTracesList(",,,"),
    (e: unknown) => e instanceof TracesListError && (e as TracesListError).code === "empty",
  );
});
```

- [ ] **Step 2: Run to verify failures**

```bash
cd packages/typescript && node --import tsx --test test/traces-list-parser.test.ts
```

Expected: FAIL — module missing.

- [ ] **Step 3: Implement parser**

```typescript
// packages/typescript/src/trace-ai/scan/traces-list-parser.ts
import fs from "node:fs/promises";

export type TracesListErrorCode = "empty" | "file-not-found";

export class TracesListError extends Error {
  constructor(public readonly code: TracesListErrorCode, message: string) {
    super(message);
    this.name = "TracesListError";
  }
}

/**
 * Parse the `--traces` argument value into an array of conversation_ids.
 * Two forms:
 *   - comma-separated:  "conv1,conv2,conv3"
 *   - @file path:       "@/path/to/ids.txt" (one id per line; # comments and blanks ignored)
 *
 * Throws TracesListError with code='empty' for empty result, 'file-not-found'
 * when @file path does not exist.
 */
export async function parseTracesList(arg: string): Promise<string[]> {
  if (arg.startsWith("@")) {
    const filePath = arg.slice(1);
    let raw: string;
    try {
      raw = await fs.readFile(filePath, "utf8");
    } catch {
      throw new TracesListError("file-not-found", `--traces file not found: ${filePath}`);
    }
    const ids = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));
    if (ids.length === 0) {
      throw new TracesListError("empty", `no conversation_ids found in ${filePath}`);
    }
    return ids;
  }
  const ids = arg
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (ids.length === 0) {
    throw new TracesListError("empty", "empty --traces value");
  }
  return ids;
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
cd packages/typescript && node --import tsx --test test/traces-list-parser.test.ts
```

Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/typescript/src/trace-ai/scan/traces-list-parser.ts \
        packages/typescript/test/traces-list-parser.test.ts
git commit -m "feat(trace-ai/scan): traces-list-parser — comma + @file syntax"
```

---

### Task 7: single-agent-validator

**Files:**
- Create: `packages/typescript/src/trace-ai/scan/single-agent-validator.ts`
- Test: `packages/typescript/test/single-agent-validator.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import test from "node:test";
import assert from "node:assert/strict";

import { validateSingleAgent, SingleAgentValidationError } from "../src/trace-ai/scan/single-agent-validator.js";

test("validateSingleAgent: all conv_ids share one agent → returns that agent_id", async () => {
  const fetchSpansById = async (conv: string) => {
    return { spans: [{ attributes: { "gen_ai.agent.id": "agent_A" } }], conversation_id: conv };
  };
  const r = await validateSingleAgent(["conv1", "conv2", "conv3"], fetchSpansById);
  assert.equal(r.agentId, "agent_A");
  assert.equal(r.checkedConvIds, 3);
});

test("validateSingleAgent: mixed agents → throws SingleAgentValidationError with discrepancy map", async () => {
  const fetchSpansById = async (conv: string) => {
    const agentId = conv === "conv1" ? "agent_A" : "agent_B";
    return { spans: [{ attributes: { "gen_ai.agent.id": agentId } }], conversation_id: conv };
  };
  await assert.rejects(
    () => validateSingleAgent(["conv1", "conv2"], fetchSpansById),
    (e: unknown) => {
      assert.ok(e instanceof SingleAgentValidationError);
      const err = e as SingleAgentValidationError;
      assert.deepEqual(err.byConvId.get("conv1"), "agent_A");
      assert.deepEqual(err.byConvId.get("conv2"), "agent_B");
      return true;
    },
  );
});

test("validateSingleAgent: one conv_id returns zero spans → throws SingleAgentValidationError code=no-spans", async () => {
  const fetchSpansById = async (conv: string) => ({ spans: [], conversation_id: conv });
  await assert.rejects(
    () => validateSingleAgent(["conv_x"], fetchSpansById),
    (e: unknown) => e instanceof SingleAgentValidationError && (e as SingleAgentValidationError).code === "no-spans",
  );
});

test("validateSingleAgent: empty input list → throws SingleAgentValidationError code=empty", async () => {
  const fetchSpansById = async () => ({ spans: [], conversation_id: "" });
  await assert.rejects(
    () => validateSingleAgent([], fetchSpansById),
    (e: unknown) => e instanceof SingleAgentValidationError && (e as SingleAgentValidationError).code === "empty",
  );
});

test("validateSingleAgent: span lacks agent.id attribute → falls back to undefined; mismatch detection still works", async () => {
  const fetchSpansById = async (conv: string) => {
    if (conv === "conv1") return { spans: [{ attributes: { "gen_ai.agent.id": "agent_A" } }], conversation_id: conv };
    return { spans: [{ attributes: {} }], conversation_id: conv };
  };
  await assert.rejects(
    () => validateSingleAgent(["conv1", "conv2"], fetchSpansById),
    (e: unknown) => e instanceof SingleAgentValidationError && (e as SingleAgentValidationError).code === "mixed",
  );
});
```

- [ ] **Step 2: Run to verify failures**

```bash
cd packages/typescript && node --import tsx --test test/single-agent-validator.test.ts
```

Expected: FAIL — module missing.

- [ ] **Step 3: Implement validator**

```typescript
// packages/typescript/src/trace-ai/scan/single-agent-validator.ts

export type SingleAgentValidationErrorCode = "empty" | "no-spans" | "mixed";

export class SingleAgentValidationError extends Error {
  constructor(
    public readonly code: SingleAgentValidationErrorCode,
    message: string,
    public readonly byConvId: ReadonlyMap<string, string | undefined> = new Map(),
  ) {
    super(message);
    this.name = "SingleAgentValidationError";
  }
}

export interface SingleAgentValidationResult {
  agentId: string;
  checkedConvIds: number;
}

export interface FetchSpansResult {
  spans: Array<{ attributes: Record<string, unknown> }>;
  conversation_id: string;
}

export type FetchSpansByConvId = (convId: string) => Promise<FetchSpansResult>;

function extractAgentId(spans: FetchSpansResult["spans"]): string | undefined {
  for (const s of spans) {
    const v = s.attributes["gen_ai.agent.id"];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}

/**
 * Verify every conv_id in the batch resolves to spans owned by the same
 * agent_id. Throws SingleAgentValidationError on mismatch with a discrepancy
 * map for the CLI to print.
 */
export async function validateSingleAgent(
  convIds: string[],
  fetchSpansById: FetchSpansByConvId,
): Promise<SingleAgentValidationResult> {
  if (convIds.length === 0) {
    throw new SingleAgentValidationError("empty", "no conversation_ids supplied");
  }
  const byConvId = new Map<string, string | undefined>();
  for (const convId of convIds) {
    const fetched = await fetchSpansById(convId);
    if (fetched.spans.length === 0) {
      throw new SingleAgentValidationError("no-spans", `conversation_id has no spans: ${convId}`);
    }
    byConvId.set(convId, extractAgentId(fetched.spans));
  }
  const agentIds = new Set(byConvId.values());
  if (agentIds.size > 1 || (agentIds.size === 1 && agentIds.has(undefined))) {
    const lines = [...byConvId.entries()].map(([c, a]) => `  ${c} → ${a ?? "(no agent.id)"}`).join("\n");
    throw new SingleAgentValidationError(
      "mixed",
      `--traces conversation_ids span multiple agents:\n${lines}`,
      byConvId,
    );
  }
  return { agentId: [...agentIds][0]!, checkedConvIds: convIds.length };
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
cd packages/typescript && node --import tsx --test test/single-agent-validator.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/typescript/src/trace-ai/scan/single-agent-validator.ts \
        packages/typescript/test/single-agent-validator.test.ts
git commit -m "feat(trace-ai/scan): single-agent-validator — enforce all conv_ids share one agent_id"
```

---

## Phase 3: Scan-summary contracts + aggregation (Tasks 8-10)

### Task 8: scan-summary/v1 zod schema

**Files:**
- Create: `packages/typescript/src/trace-ai/scan/scan-summary-schema.ts`
- Test: `packages/typescript/test/scan-summary-schema.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import test from "node:test";
import assert from "node:assert/strict";

import { ScanSummarySchema, ScanSummaryShape } from "../src/trace-ai/scan/scan-summary-schema.js";

const minimal = {
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
    headline: "h",
    primary_root_cause: {
      rule_ids: ["tool_loop_no_state_change"],
      description: "d",
      target_for_fix: "decision_agent.prompt",
    },
    fix_priority: [{ rule_id: "tool_loop_no_state_change", affected_trace_count: 4, reason: "r" }],
    cross_rule_links: [],
  },
  aggregates: {
    rule_frequency: [
      { rule_id: "tool_loop_no_state_change", count: 4, severity_breakdown: { high: 3, medium: 1, low: 0 } },
    ],
  },
  per_trace_index: [
    { trace_id: "tr_a", conversation_id: "conv_a", report_path: "diagnosis/conv_a.yaml", finding_count: 1 },
  ],
};

test("ScanSummarySchema: minimal valid object parses", () => {
  const r = ScanSummarySchema.parse(minimal);
  assert.equal(r.scan.agent_id, "01KR_x");
});

test("ScanSummarySchema: summary nullable (Stage-4 failure)", () => {
  const withNull = { ...minimal, summary: null };
  const r = ScanSummarySchema.parse(withNull);
  assert.equal(r.summary, null);
});

test("ScanSummarySchema: agent_id required (cannot be empty string)", () => {
  const bad = { ...minimal, scan: { ...minimal.scan, agent_id: "" } };
  const r = ScanSummarySchema.safeParse(bad);
  assert.equal(r.success, false);
});

test("ScanSummarySchema: synthesizer_mode must be 'agent' (no template in batch)", () => {
  const bad = { ...minimal, scan: { ...minimal.scan, synthesizer_mode: "template" } };
  const r = ScanSummarySchema.safeParse(bad);
  assert.equal(r.success, false);
});

test("ScanSummarySchema: traces_reused + traces_freshly_diagnosed = trace_count invariant NOT enforced (informational fields)", () => {
  const inconsistent = { ...minimal, scan: { ...minimal.scan, traces_reused: 5, traces_freshly_diagnosed: 2 } };
  const r = ScanSummarySchema.safeParse(inconsistent);
  assert.equal(r.success, true);
});

test("ScanSummaryShape (Stage-4 LLM output) parses without scan/aggregates/per_trace_index (those are filled by orchestrator)", () => {
  const llmOutput = {
    headline: "x",
    primary_root_cause: null,
    fix_priority: [],
    cross_rule_links: [],
  };
  const r = ScanSummaryShape.parse(llmOutput);
  assert.equal(r.headline, "x");
});
```

- [ ] **Step 2: Run to verify failures**

```bash
cd packages/typescript && node --import tsx --test test/scan-summary-schema.test.ts
```

Expected: FAIL — module missing.

- [ ] **Step 3: Implement schema**

```typescript
// packages/typescript/src/trace-ai/scan/scan-summary-schema.ts
import { z } from "zod";

const PrimaryRootCauseShape = z.object({
  rule_ids: z.array(z.string()).min(1),
  description: z.string(),
  target_for_fix: z.string(),
});

const FixPriorityItemShape = z.object({
  rule_id: z.string(),
  affected_trace_count: z.number().int().nonnegative(),
  reason: z.string(),
});

const CrossRuleLinkShape = z.object({
  rule_ids: z.array(z.string()).min(2),
  relation: z.string(),
});

/**
 * The `summary` block shape — used both as the embedded field of the full
 * scan-summary report AND as the output schema the Stage-4 cross-trace
 * synthesizer LLM must satisfy.
 */
export const ScanSummaryShape = z.object({
  headline: z.string().max(160),
  primary_root_cause: PrimaryRootCauseShape.nullable(),
  fix_priority: z.array(FixPriorityItemShape),
  cross_rule_links: z.array(CrossRuleLinkShape),
});

export type ScanSummaryShape = z.infer<typeof ScanSummaryShape>;

const RuleFrequencyItemShape = z.object({
  rule_id: z.string(),
  count: z.number().int().nonnegative(),
  severity_breakdown: z.object({
    high: z.number().int().nonnegative(),
    medium: z.number().int().nonnegative(),
    low: z.number().int().nonnegative(),
  }),
});

const PerTraceIndexItemShape = z.object({
  trace_id: z.string(),
  conversation_id: z.string(),
  report_path: z.string(),
  finding_count: z.number().int().nonnegative(),
});

export const ScanSummarySchema = z.object({
  schema_version: z.literal("scan-summary/v1"),
  scan: z.object({
    agent_id: z.string().min(1),
    trace_count: z.number().int().nonnegative(),
    traces_with_findings: z.number().int().nonnegative(),
    traces_reused: z.number().int().nonnegative(),
    traces_freshly_diagnosed: z.number().int().nonnegative(),
    resumed_from_partial: z.boolean(),
    diagnosed_at: z.string(),
    cli_version: z.string(),
    synthesizer_mode: z.literal("agent"),
  }),
  summary: ScanSummaryShape.nullable(),
  aggregates: z.object({
    rule_frequency: z.array(RuleFrequencyItemShape),
  }),
  per_trace_index: z.array(PerTraceIndexItemShape),
});

export type ScanSummary = z.infer<typeof ScanSummarySchema>;
```

- [ ] **Step 4: Run tests to verify pass**

```bash
cd packages/typescript && node --import tsx --test test/scan-summary-schema.test.ts
```

Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/typescript/src/trace-ai/scan/scan-summary-schema.ts \
        packages/typescript/test/scan-summary-schema.test.ts
git commit -m "feat(trace-ai/scan): scan-summary/v1 zod schema + ScanSummaryShape for Stage-4 LLM output"
```

---

### Task 9: aggregator

**Files:**
- Create: `packages/typescript/src/trace-ai/scan/aggregator.ts`
- Test: `packages/typescript/test/aggregator.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import test from "node:test";
import assert from "node:assert/strict";

import { aggregate } from "../src/trace-ai/scan/aggregator.js";
import type { Report } from "../src/trace-ai/diagnose/types.js";

function fakeReport(traceId: string, findings: Array<{ ruleId: string; severity: "low" | "medium" | "high" }>): Report {
  return {
    schemaVersion: "trace-diagnose-report/v1",
    trace: { traceId, agentId: "01KR_x", tenant: null },
    run: { diagnosedAt: "x", cliVersion: "0.7.4", mode: "hybrid", rulesApplied: [], rulesSkipped: [], synthesizerMode: "template" },
    summary: { headline: "h", primaryRootCause: null, fixPriority: [], crossFindingLinks: [] },
    findings: findings.map((f, i) => ({
      ruleId: f.ruleId,
      judgmentKind: "symbolic",
      severity: f.severity,
      symptom: "s",
      likelyCause: "l",
      evidence: { spans: [`sp_${traceId}_${i}`], excerpt: "e" },
      suggestedFix: { target: "t", change: "c" },
      confidence: "low",
      verifyWith: { suggestedEvalCase: { queryId: null, query: null, assertions: [] } },
    })),
  };
}

test("aggregate: rule_frequency counts each rule across reports", () => {
  const reports = [
    fakeReport("tr_1", [{ ruleId: "rule_a", severity: "high" }, { ruleId: "rule_b", severity: "medium" }]),
    fakeReport("tr_2", [{ ruleId: "rule_a", severity: "high" }]),
    fakeReport("tr_3", [{ ruleId: "rule_b", severity: "low" }]),
  ];
  const agg = aggregate(reports);
  const a = agg.rule_frequency.find((r) => r.rule_id === "rule_a")!;
  const b = agg.rule_frequency.find((r) => r.rule_id === "rule_b")!;
  assert.equal(a.count, 2);
  assert.deepEqual(a.severity_breakdown, { high: 2, medium: 0, low: 0 });
  assert.equal(b.count, 2);
  assert.deepEqual(b.severity_breakdown, { high: 0, medium: 1, low: 1 });
});

test("aggregate: rule_frequency sorted by count descending", () => {
  const reports = [
    fakeReport("tr_1", [{ ruleId: "rule_a", severity: "high" }]),
    fakeReport("tr_2", [{ ruleId: "rule_b", severity: "high" }, { ruleId: "rule_b", severity: "high" }]),
    fakeReport("tr_3", [{ ruleId: "rule_b", severity: "high" }]),
  ];
  const agg = aggregate(reports);
  assert.equal(agg.rule_frequency[0].rule_id, "rule_b");
  assert.equal(agg.rule_frequency[1].rule_id, "rule_a");
});

test("aggregate: deterministic — same input → identical output (rule_id tie-break alphabetical)", () => {
  const r1 = fakeReport("tr_1", [{ ruleId: "z_rule", severity: "high" }, { ruleId: "a_rule", severity: "high" }]);
  const a = aggregate([r1]);
  const b = aggregate([r1]);
  assert.deepEqual(a, b);
  // Same count both → alphabetical
  assert.equal(a.rule_frequency[0].rule_id, "a_rule");
  assert.equal(a.rule_frequency[1].rule_id, "z_rule");
});

test("aggregate: empty reports → empty rule_frequency", () => {
  const agg = aggregate([]);
  assert.deepEqual(agg.rule_frequency, []);
});

test("aggregate: severity_breakdown sum equals count", () => {
  const reports = [
    fakeReport("tr_1", [{ ruleId: "r", severity: "high" }, { ruleId: "r", severity: "medium" }, { ruleId: "r", severity: "low" }]),
  ];
  const agg = aggregate(reports);
  const item = agg.rule_frequency[0];
  assert.equal(item.severity_breakdown.high + item.severity_breakdown.medium + item.severity_breakdown.low, item.count);
});
```

- [ ] **Step 2: Run to verify failures**

```bash
cd packages/typescript && node --import tsx --test test/aggregator.test.ts
```

Expected: FAIL — module missing.

- [ ] **Step 3: Implement aggregator**

```typescript
// packages/typescript/src/trace-ai/scan/aggregator.ts
import type { Report } from "../diagnose/types.js";

export interface RuleFrequencyItem {
  rule_id: string;
  count: number;
  severity_breakdown: { high: number; medium: number; low: number };
}

export interface AggregatesBlock {
  rule_frequency: RuleFrequencyItem[];
}

/**
 * Deterministic aggregation over a list of per-trace reports.
 * - rule_frequency: counts each rule_id across all findings; severity_breakdown
 *   gives high/medium/low counts. Sorted by count descending, then rule_id
 *   ascending for stable ordering.
 */
export function aggregate(reports: Report[]): AggregatesBlock {
  const byRule = new Map<string, RuleFrequencyItem>();
  for (const r of reports) {
    for (const f of r.findings) {
      let item = byRule.get(f.ruleId);
      if (!item) {
        item = { rule_id: f.ruleId, count: 0, severity_breakdown: { high: 0, medium: 0, low: 0 } };
        byRule.set(f.ruleId, item);
      }
      item.count += 1;
      item.severity_breakdown[f.severity] += 1;
    }
  }
  const rule_frequency = [...byRule.values()].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.rule_id.localeCompare(b.rule_id);
  });
  return { rule_frequency };
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
cd packages/typescript && node --import tsx --test test/aggregator.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/typescript/src/trace-ai/scan/aggregator.ts \
        packages/typescript/test/aggregator.test.ts
git commit -m "feat(trace-ai/scan): aggregator — deterministic rule_frequency over N reports"
```

---

### Task 10: sampler

**Files:**
- Create: `packages/typescript/src/trace-ai/scan/sampler.ts`
- Test: `packages/typescript/test/sampler.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import test from "node:test";
import assert from "node:assert/strict";

import { sample } from "../src/trace-ai/scan/sampler.js";
import type { Report } from "../src/trace-ai/diagnose/types.js";

function rep(traceId: string, findings: Array<{ ruleId: string; severity: "low" | "medium" | "high"; judgmentKind?: "symbolic" | "rubric"; likelyCause?: string }>): Report {
  return {
    schemaVersion: "trace-diagnose-report/v1",
    trace: { traceId, agentId: "01KR_x", tenant: null },
    run: { diagnosedAt: "x", cliVersion: "0.7.4", mode: "hybrid", rulesApplied: [], rulesSkipped: [], synthesizerMode: "template" },
    summary: { headline: `h-${traceId}`, primaryRootCause: null, fixPriority: [], crossFindingLinks: [] },
    findings: findings.map((f, i) => ({
      ruleId: f.ruleId,
      judgmentKind: f.judgmentKind ?? "symbolic",
      severity: f.severity,
      symptom: "s",
      likelyCause: f.likelyCause ?? f.ruleId,
      evidence: { spans: [`sp_${traceId}_${i}`], excerpt: `e-${traceId}` },
      suggestedFix: { target: "t", change: "c" },
      confidence: "low",
      verifyWith: { suggestedEvalCase: { queryId: null, query: null, assertions: [] } },
    })),
  };
}

test("sample: dominant rule threshold max(3, 5% of N) — N=10 uses 3", () => {
  const reports = [
    ...[1, 2, 3].map((i) => rep(`tr_${i}`, [{ ruleId: "dominant", severity: "high" }])),
    ...[4, 5, 6, 7, 8, 9, 10].map((i) => rep(`tr_${i}`, [{ ruleId: "rare", severity: "low" }])),
  ];
  const out = sample(reports);
  // dominant fired 3 → meets max(3, 5%*10=1) threshold → included
  assert.ok(out.samples.some((s) => s.selected_as.includes("dominant")));
});

test("sample: dominant rule threshold max(3, 5% of N) — N=100 uses 5", () => {
  const reports = [
    ...Array.from({ length: 4 }, (_, i) => rep(`tr_${i}`, [{ ruleId: "borderline", severity: "high" }])),
    ...Array.from({ length: 96 }, (_, i) => rep(`tr_pad_${i}`, [])),
  ];
  const out = sample(reports);
  // 4 occurrences < max(3, 5%*100=5) → NOT included
  assert.ok(!out.samples.some((s) => s.selected_as.includes("borderline")));
});

test("sample: top-1 per dominant rule by severity", () => {
  const reports = [
    rep("tr_lo", [{ ruleId: "r_dom", severity: "low" }]),
    rep("tr_hi", [{ ruleId: "r_dom", severity: "high" }]),
    rep("tr_md", [{ ruleId: "r_dom", severity: "medium" }]),
  ];
  const out = sample(reports);
  const picked = out.samples.find((s) => s.selected_as.includes("r_dom"));
  assert.ok(picked);
  assert.equal(picked!.trace_id, "tr_hi");
});

test("sample: K=5 hard cap — even with 10 dominant rules, output capped at 5", () => {
  const reports = Array.from({ length: 30 }, (_, i) => {
    const ruleIdx = i % 10;
    return rep(`tr_${i}`, [{ ruleId: `rule_${ruleIdx}`, severity: "high" }]);
  });
  const out = sample(reports);
  assert.ok(out.samples.length <= 5);
});

test("sample: outliers — rubric finding with likelyCause='other' is selected as outlier when no dominant samples saturate K", () => {
  const reports = [
    rep("tr_dom", [{ ruleId: "r_dom", severity: "high" }, { ruleId: "r_dom", severity: "high" }, { ruleId: "r_dom", severity: "high" }]),
    rep("tr_fp1", [{ ruleId: "r_rare", severity: "low", judgmentKind: "rubric", likelyCause: "other" }]),
    rep("tr_dup1", [{ ruleId: "r_dom", severity: "high" }]),
    rep("tr_dup2", [{ ruleId: "r_dom", severity: "high" }]),
  ];
  const out = sample(reports);
  const outlier = out.samples.find((s) => s.selected_as.includes("outlier"));
  assert.ok(outlier, "expected one outlier sample");
});

test("sample: deterministic — same input → identical output", () => {
  const reports = [
    rep("tr_a", [{ ruleId: "r_dom", severity: "high" }]),
    rep("tr_b", [{ ruleId: "r_dom", severity: "high" }]),
    rep("tr_c", [{ ruleId: "r_dom", severity: "high" }]),
  ];
  const a = sample(reports);
  const b = sample(reports);
  assert.deepEqual(a, b);
});
```

- [ ] **Step 2: Run to verify failures**

```bash
cd packages/typescript && node --import tsx --test test/sampler.test.ts
```

Expected: FAIL — module missing.

- [ ] **Step 3: Implement sampler**

```typescript
// packages/typescript/src/trace-ai/scan/sampler.ts
import type { Report, Finding } from "../diagnose/types.js";

export interface Sample {
  trace_id: string;
  conversation_id: string | null;
  headline: string;
  rule_ids: string[];
  selected_as: string;     // human-readable reason ("top-1 high-severity for tool_loop_no_state_change", "outlier (rubric self-labeled FP)")
}

export interface SamplerOutput {
  samples: Sample[];
}

const SEVERITY_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };
const K_MAX = 5;

function dominantThreshold(N: number): number {
  return Math.max(3, Math.ceil(0.05 * N));
}

function pickTopByseverityForRule(reports: Report[], ruleId: string): Report | null {
  let best: { report: Report; rank: number } | null = null;
  for (const r of reports) {
    for (const f of r.findings) {
      if (f.ruleId !== ruleId) continue;
      const rank = SEVERITY_RANK[f.severity] ?? 0;
      if (!best || rank > best.rank || (rank === best.rank && r.trace.traceId < best.report.trace.traceId)) {
        best = { report: r, rank };
      }
    }
  }
  return best?.report ?? null;
}

function isOutlierFinding(f: Finding): boolean {
  return f.judgmentKind === "rubric" && (f.likelyCause === "other" || f.severity === "low");
}

function toSample(r: Report, selectedAs: string): Sample {
  const rule_ids = [...new Set(r.findings.map((f) => f.ruleId))].sort();
  return {
    trace_id: r.trace.traceId,
    conversation_id: null,
    headline: r.summary.headline,
    rule_ids,
    selected_as: selectedAs,
  };
}

/**
 * Deterministic K=5 sampler: top-1 by severity per dominant rule (count ≥
 * max(3, 5% of N)) + up to one outlier (rubric self-labeled FP, e.g.
 * likely_cause='other' or severity='low'). Sorted by selected_as / trace_id
 * for stability.
 */
export function sample(reports: Report[]): SamplerOutput {
  const N = reports.length;
  if (N === 0) return { samples: [] };

  // Count rule frequency, identify dominant.
  const counts = new Map<string, number>();
  for (const r of reports) {
    for (const f of r.findings) {
      counts.set(f.ruleId, (counts.get(f.ruleId) ?? 0) + 1);
    }
  }
  const threshold = dominantThreshold(N);
  const dominantRules = [...counts.entries()]
    .filter(([, c]) => c >= threshold)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([id]) => id);

  const picked: Sample[] = [];
  const usedTraceIds = new Set<string>();

  // Top-1 by severity per dominant rule.
  for (const ruleId of dominantRules) {
    if (picked.length >= K_MAX) break;
    const r = pickTopByseverityForRule(reports, ruleId);
    if (r && !usedTraceIds.has(r.trace.traceId)) {
      picked.push(toSample(r, `top-1 high-severity for ${ruleId}`));
      usedTraceIds.add(r.trace.traceId);
    }
  }

  // One outlier (rubric self-labeled FP) if there's slack.
  if (picked.length < K_MAX) {
    for (const r of reports) {
      if (usedTraceIds.has(r.trace.traceId)) continue;
      const fpFinding = r.findings.find(isOutlierFinding);
      if (fpFinding) {
        picked.push(toSample(r, `outlier (rubric self-labeled FP for ${fpFinding.ruleId})`));
        usedTraceIds.add(r.trace.traceId);
        break;
      }
    }
  }

  return { samples: picked.slice(0, K_MAX) };
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
cd packages/typescript && node --import tsx --test test/sampler.test.ts
```

Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/typescript/src/trace-ai/scan/sampler.ts \
        packages/typescript/test/sampler.test.ts
git commit -m "feat(trace-ai/scan): sampler — K=5 representatives per dominant rule + outlier"
```

---

## Phase 4: LLM-driven stages (Tasks 11-12)

### Task 11: batched rubric prompt template + runner

**Files:**
- Create: `packages/typescript/src/trace-ai/scan/prompts/builtin/rubric-judge-batch-v1.prompt.md`
- Create: `packages/typescript/src/trace-ai/scan/batched-rubric.ts`
- Modify: `packages/typescript/package.json` (build script copies new prompt to dist)
- Test: `packages/typescript/test/batched-rubric.test.ts`

- [ ] **Step 1: Create the prompt template**

Create `packages/typescript/src/trace-ai/scan/prompts/builtin/rubric-judge-batch-v1.prompt.md`:

```markdown
# Trace-Diagnose Rubric Judge (Batched)

You are evaluating one rubric rule across multiple agent traces from the
same agent (agent_id: {{agent_id}}). Read the rule's judge question, the
supplied traces, and reply with a single JSON object containing one verdict
per trace.

## Rule
- **rule_id**: `{{rule_id}}`
- **batch_size**: {{batch_size}}

## Judge Question
{{judge_question}}

## Traces
Each trace below is identified by `trace_id`. Each trace's inputs follow the
rule's `inputs` schema (resolved from the trace's spans).

{{traces_yaml}}

## Output Schema
Reply with a single JSON object. Each entry in `trace_results` corresponds to
one trace in the supplied batch, in any order. The `trace_id` field MUST echo
back the trace_id from the input.

```json
{{output_schema}}
```

{{language_instruction}}

## Output Rules
1. ONE entry per input trace_id, no duplicates, no extra entries.
2. `first_violating_step_id` MUST be a real span id from THAT trace's spans —
   the diagnose pipeline cross-checks; mis-attributed IDs cause the entry to
   be discarded with `agent-error:schema_violation`.
3. `reasoning` should cite span ids in the affected trace. When multiple traces
   share a pattern, you may cite that in one trace's reasoning ("same retry
   pattern as trace tr_xxx").
4. Pick the closest category even if imperfect; do not fall through to `other`
   unless evidence actively rules out every named category.
5. If you cannot evaluate a trace (missing spans, malformed input), emit an
   entry with `category: other`, `reasoning` explaining the gap, `severity: low`,
   `first_violating_step_id` = any real span_id from that trace.
```

- [ ] **Step 2: Update build script to copy the new prompt to dist**

In `packages/typescript/package.json`, find the `build` script and extend the cp chain:

```json
"build": "node node_modules/typescript/bin/tsc -p tsconfig.json && rm -rf dist/templates && cp -R src/templates dist/templates && cp src/trace-ai/diagnose/builtin-rules/*.yaml dist/trace-ai/diagnose/builtin-rules/ && mkdir -p dist/agent-providers/prompts && cp src/agent-providers/prompts/*.prompt.md dist/agent-providers/prompts/ && cp src/trace-ai/diagnose/builtin-rules/*.prompt.md dist/trace-ai/diagnose/builtin-rules/ 2>/dev/null || true && mkdir -p dist/trace-ai/scan/prompts/builtin && cp src/trace-ai/scan/prompts/builtin/*.prompt.md dist/trace-ai/scan/prompts/builtin/"
```

(Append the last two clauses: `mkdir -p dist/trace-ai/scan/prompts/builtin` and `cp src/trace-ai/scan/prompts/builtin/*.prompt.md dist/trace-ai/scan/prompts/builtin/`.)

- [ ] **Step 3: Write failing test for batched rubric**

```typescript
// packages/typescript/test/batched-rubric.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import { runBatchedRubric, type BatchTraceItem } from "../src/trace-ai/scan/batched-rubric.js";
import { StubAgentProvider } from "../src/agent-providers/providers/stub.js";
import { PromptTemplateRegistry } from "../src/agent-providers/prompt-template.js";
import { ArtifactWriter } from "../src/trace-ai/scan/artifacts/writer.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function buildPromptRegistry(): PromptTemplateRegistry {
  const r = new PromptTemplateRegistry();
  r.registerInline(
    "builtin:rubric-judge-batch-v1",
    "rule={{rule_id}} batch={{batch_size}} agent={{agent_id}} traces={{traces_yaml}} schema={{output_schema}} {{language_instruction}}",
  );
  return r;
}

const OutputSchema = z.object({
  trace_results: z.array(z.object({
    trace_id: z.string(),
    category: z.enum(["a", "b", "other"]),
    reasoning: z.string(),
    severity: z.enum(["low", "medium", "high"]),
    first_violating_step_id: z.string(),
    evidence_span_ids: z.array(z.string()).optional(),
  })),
});

function rubric() {
  return {
    ruleId: "r_batch",
    judgeQuestion: "is this A or B?",
    outputSchema: OutputSchema,
    outputSchemaRaw: { type: "object" },                  // simplified for prompt render
    promptTemplateRef: "builtin:rubric-judge-batch-v1",
  };
}

function traceItem(id: string, spans = ["sp1", "sp2"]): BatchTraceItem {
  return { traceId: id, spans, inputs: { user_intent: `intent-${id}` } };
}

test("runBatchedRubric: chunk K=10 splits 25 traces into 3 chunks", async () => {
  const stub = new StubAgentProvider({
    name: "stub",
    responseFn: async (_p) => ({
      trace_results: [],   // empty for simplicity; real impl will populate per-trace
    }),
  });
  const traces = Array.from({ length: 25 }, (_, i) => traceItem(`tr_${i}`, [`sp_${i}_a`]));
  await runBatchedRubric({
    rule: rubric(),
    traces,
    agentId: "agent_A",
    provider: stub,
    promptRegistry: buildPromptRegistry(),
    chunkSize: 10,
  });
  assert.equal(stub.calls.length, 3);  // 25/10 = 2 full + 1 partial
});

test("runBatchedRubric: per-item schema_violation isolates to that trace only", async () => {
  const stub = new StubAgentProvider({
    name: "stub",
    responseFn: async (_p) => ({
      trace_results: [
        { trace_id: "tr_0", category: "a", reasoning: "ok", severity: "high", first_violating_step_id: "sp_0_a" },
        { trace_id: "tr_1", category: "a", reasoning: "ok", severity: "high", first_violating_step_id: "NOT_IN_SPANS" },
      ],
    }),
  });
  const traces = [traceItem("tr_0", ["sp_0_a"]), traceItem("tr_1", ["sp_1_a"])];
  const out = await runBatchedRubric({
    rule: rubric(),
    traces,
    agentId: "agent_A",
    provider: stub,
    promptRegistry: buildPromptRegistry(),
    chunkSize: 10,
  });
  assert.equal(out.verdicts.length, 1);
  assert.equal(out.verdicts[0].traceId, "tr_0");
  assert.equal(out.skipped.length, 1);
  assert.equal(out.skipped[0].traceId, "tr_1");
  assert.match(out.skipped[0].reason, /schema_violation/);
});

test("runBatchedRubric: whole-chunk provider failure → all chunk traces skipped with agent-error:transport", async () => {
  const stub = new StubAgentProvider({
    name: "stub",
    responseFn: async () => { throw new Error("boom"); },
  });
  const traces = [traceItem("tr_a"), traceItem("tr_b")];
  const out = await runBatchedRubric({
    rule: rubric(),
    traces,
    agentId: "agent_A",
    provider: stub,
    promptRegistry: buildPromptRegistry(),
    chunkSize: 10,
  });
  assert.equal(out.verdicts.length, 0);
  assert.equal(out.skipped.length, 2);
  assert.ok(out.skipped.every((s) => s.reason.startsWith("agent-error:")));
});

test("runBatchedRubric: trace_id echo-back missing → that entry is dropped with reason schema_violation", async () => {
  const stub = new StubAgentProvider({
    name: "stub",
    responseFn: async () => ({
      trace_results: [
        { trace_id: "tr_unknown", category: "a", reasoning: "ok", severity: "high", first_violating_step_id: "sp_0_a" },
      ],
    }),
  });
  const out = await runBatchedRubric({
    rule: rubric(),
    traces: [traceItem("tr_0", ["sp_0_a"])],
    agentId: "agent_A",
    provider: stub,
    promptRegistry: buildPromptRegistry(),
    chunkSize: 10,
  });
  assert.equal(out.verdicts.length, 0);
  assert.equal(out.skipped.length, 1);
  assert.match(out.skipped[0].reason, /schema_violation/);
});

test("runBatchedRubric: with ArtifactWriter, writes work-queue + prompt + response per chunk", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "br-art-"));
  const artifacts = new ArtifactWriter({ base, enabled: true });
  const stub = new StubAgentProvider({
    name: "stub",
    responseFn: async () => ({ trace_results: [] }),
  });
  await runBatchedRubric({
    rule: rubric(),
    traces: [traceItem("tr_0", ["sp_0_a"])],
    agentId: "agent_A",
    provider: stub,
    promptRegistry: buildPromptRegistry(),
    chunkSize: 10,
    artifacts,
  });
  const ruleDir = path.join(base, "stage-2-rubric", "r_batch");
  assert.ok(await fs.stat(path.join(ruleDir, "work-queue.json")).then(() => true).catch(() => false));
  assert.ok(await fs.stat(path.join(ruleDir, "chunk-000.prompt.md")).then(() => true).catch(() => false));
  assert.ok(await fs.stat(path.join(ruleDir, "chunk-000.response.json")).then(() => true).catch(() => false));
  await fs.rm(base, { recursive: true, force: true });
});
```

- [ ] **Step 4: Implement runBatchedRubric**

```typescript
// packages/typescript/src/trace-ai/scan/batched-rubric.ts
import yaml from "js-yaml";
import { z } from "zod";

import type { AgentProvider } from "../../agent-providers/types.js";
import { AgentProviderError } from "../../agent-providers/types.js";
import { PromptTemplateRegistry, render as renderPrompt, languageInstructionFor, type AgentOutputLang } from "../../agent-providers/prompt-template.js";
import { ArtifactWriter } from "./artifacts/writer.js";

export interface BatchTraceItem {
  traceId: string;
  /** Real span_ids present in this trace; used to validate `first_violating_step_id`. */
  spans: string[];
  /** Inputs resolved per the rule's `inputs` schema. */
  inputs: Record<string, unknown>;
}

export interface BatchedRubricRule {
  ruleId: string;
  judgeQuestion: string;
  outputSchema: z.ZodTypeAny;
  outputSchemaRaw: Record<string, unknown>;
  promptTemplateRef: string;
}

export interface BatchedRubricVerdict {
  traceId: string;
  category: string;
  reasoning: string;
  severity: "low" | "medium" | "high";
  firstViolatingStepId: string;
  evidenceSpanIds: string[];
}

export interface BatchedRubricSkipped {
  traceId: string;
  reason: string;
}

export interface BatchedRubricResult {
  verdicts: BatchedRubricVerdict[];
  skipped: BatchedRubricSkipped[];
}

export interface RunBatchedRubricOpts {
  rule: BatchedRubricRule;
  traces: BatchTraceItem[];
  agentId: string;
  provider: AgentProvider;
  promptRegistry: PromptTemplateRegistry;
  chunkSize: number;
  lang?: AgentOutputLang;
  artifacts?: ArtifactWriter;
  timeoutMs?: number;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function buildTracesYaml(chunk: BatchTraceItem[]): string {
  return yaml.dump(
    chunk.map((t) => ({ trace_id: t.traceId, spans: t.spans, inputs: t.inputs })),
    { lineWidth: 120 },
  );
}

/**
 * Stage-2 batched rubric evaluator. Splits flagged traces into chunks of K
 * (default 10), one LLM call per chunk, then validates each per-trace verdict
 * against the rule's output schema PLUS two ground-truth checks:
 *   - trace_id must echo back one of this chunk's input trace_ids
 *   - first_violating_step_id must be a real span_id in THAT trace's spans
 * Failures isolate to the affected trace; chunk-wide LLM failures skip the
 * whole chunk with agent-error:<kind>.
 */
export async function runBatchedRubric(opts: RunBatchedRubricOpts): Promise<BatchedRubricResult> {
  const { rule, traces, agentId, provider, promptRegistry, chunkSize, artifacts } = opts;
  const verdicts: BatchedRubricVerdict[] = [];
  const skipped: BatchedRubricSkipped[] = [];

  if (artifacts) {
    await artifacts.writeStageTwoWorkQueue(rule.ruleId, traces.map((t) => t.traceId));
  }

  const tpl = promptRegistry.get(rule.promptTemplateRef);
  const chunks = chunkArray(traces, chunkSize);

  for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
    const chunk = chunks[chunkIdx];
    const traceIdSet = new Set(chunk.map((t) => t.traceId));
    const spansByTraceId = new Map(chunk.map((t) => [t.traceId, new Set(t.spans)]));

    const prompt = renderPrompt(tpl, {
      rule_id: rule.ruleId,
      batch_size: chunk.length,
      agent_id: agentId,
      judge_question: rule.judgeQuestion,
      traces_yaml: buildTracesYaml(chunk),
      output_schema: rule.outputSchemaRaw,
      language_instruction: languageInstructionFor(opts.lang ?? "en"),
    });

    if (artifacts) await artifacts.writeStageTwoPrompt(rule.ruleId, chunkIdx, prompt);

    let response: unknown;
    try {
      const resp = await provider.invoke({
        prompt,
        outputSchema: rule.outputSchema,
        tier: "fast",
        timeoutMs: opts.timeoutMs,
        correlationId: `stage-2/${rule.ruleId}/chunk-${chunkIdx}`,
      });
      response = resp.output;
    } catch (e) {
      const kind = e instanceof AgentProviderError ? e.kind : "transport";
      for (const t of chunk) skipped.push({ traceId: t.traceId, reason: `agent-error:${kind}` });
      if (artifacts) await artifacts.writeStageTwoResponse(rule.ruleId, chunkIdx, { error: String(e) });
      continue;
    }

    if (artifacts) await artifacts.writeStageTwoResponse(rule.ruleId, chunkIdx, response);

    const parseErrors: { traceId: string; reason: string }[] = [];
    const items = (response as { trace_results?: unknown[] }).trace_results ?? [];
    for (const item of items) {
      const itm = item as Record<string, unknown>;
      const traceId = typeof itm.trace_id === "string" ? itm.trace_id : undefined;
      if (!traceId || !traceIdSet.has(traceId)) {
        parseErrors.push({ traceId: traceId ?? "<unknown>", reason: "schema_violation: trace_id missing or not in input batch" });
        continue;
      }
      const first = typeof itm.first_violating_step_id === "string" ? itm.first_violating_step_id : undefined;
      if (!first || !spansByTraceId.get(traceId)!.has(first)) {
        parseErrors.push({ traceId, reason: `schema_violation: first_violating_step_id '${first}' not in trace's spans` });
        continue;
      }
      verdicts.push({
        traceId,
        category: String(itm.category ?? "other"),
        reasoning: String(itm.reasoning ?? ""),
        severity: (itm.severity as "low" | "medium" | "high") ?? "low",
        firstViolatingStepId: first,
        evidenceSpanIds: Array.isArray(itm.evidence_span_ids) ? itm.evidence_span_ids.map(String) : [first],
      });
    }

    // Any trace_id in this chunk's input that didn't appear in trace_results → schema_violation.
    const verdictTraceIds = new Set(items.map((i) => (i as Record<string, unknown>).trace_id));
    for (const t of chunk) {
      if (!verdictTraceIds.has(t.traceId)) {
        parseErrors.push({ traceId: t.traceId, reason: "schema_violation: missing in trace_results" });
      }
    }

    for (const pe of parseErrors) skipped.push({ traceId: pe.traceId, reason: `agent-error:${pe.reason}` });
    if (parseErrors.length > 0 && artifacts) {
      await artifacts.writeStageTwoParseErrors(rule.ruleId, chunkIdx, parseErrors);
    }
  }

  return { verdicts, skipped };
}
```

- [ ] **Step 5: Run tests to verify pass**

```bash
cd packages/typescript && node --import tsx --test test/batched-rubric.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/typescript/src/trace-ai/scan/prompts/builtin/rubric-judge-batch-v1.prompt.md \
        packages/typescript/src/trace-ai/scan/batched-rubric.ts \
        packages/typescript/package.json \
        packages/typescript/test/batched-rubric.test.ts
git commit -m "feat(trace-ai/scan): batched-rubric runner — chunked Stage-2 LLM evaluation with per-item validation"
```

---

### Task 12: cross-trace synthesizer prompt + runner

**Files:**
- Create: `packages/typescript/src/trace-ai/scan/prompts/builtin/cross-trace-synthesizer-v1.prompt.md`
- Create: `packages/typescript/src/trace-ai/scan/cross-trace-synthesizer.ts`
- Test: `packages/typescript/test/cross-trace-synthesizer.test.ts`

- [ ] **Step 1: Create prompt template**

Create `packages/typescript/src/trace-ai/scan/prompts/builtin/cross-trace-synthesizer-v1.prompt.md`:

```markdown
# Cross-Trace Synthesizer

You are summarizing a batch of {{n_total}} agent trace diagnoses for agent
{{agent_id}}. All traces belong to this single agent. Aggregate statistics
have been computed deterministically. You see {{sample_count}} representative
trace summaries selected as samples ({{sample_ratio}} of total). Your job:
compose a short narrative explaining the dominant failure patterns,
prioritized rule-level fixes, and cross-rule relationships **specific to
this agent's program**.

## Aggregated Stats (deterministic)

```yaml
{{aggregates}}
```

## Representative Samples ({{sample_count}} of {{n_total}})

{{samples_yaml}}

## Output Schema
Reply with a single JSON object satisfying this schema. No prose outside the
JSON.

```json
{{output_schema}}
```

{{language_instruction}}

## Composition Rules
1. `headline` ≤ 160 chars; lead with the dominant rule pattern named in
   aggregates.rule_frequency. Frame as "this agent does X" since all traces
   share the same agent.
2. `primary_root_cause.rule_ids` lists rules that, if fixed in THIS agent's
   program, would resolve the most traces. Cite aggregate counts; do not
   invent rule_ids not in aggregates.
3. `fix_priority` MUST order ALL rules in aggregates.rule_frequency from
   highest to lowest impact. `affected_trace_count` must match aggregates.
4. `cross_rule_links` only when ≥ 2 rules fire on the same trace (sampler
   shows co-fire cases; aggregator surfaces counts indirectly).
5. Aggregate-grounded only: every claim in `primary_root_cause.description`
   and `fix_priority[].reason` must be backed by aggregates or samples; the
   LLM does not invent new rule_ids or trace counts.
```

- [ ] **Step 2: Write failing test for synthesizer**

```typescript
// packages/typescript/test/cross-trace-synthesizer.test.ts
import test from "node:test";
import assert from "node:assert/strict";

import { runCrossTraceSynthesizer } from "../src/trace-ai/scan/cross-trace-synthesizer.js";
import { StubAgentProvider } from "../src/agent-providers/providers/stub.js";
import { PromptTemplateRegistry } from "../src/agent-providers/prompt-template.js";
import { ArtifactWriter } from "../src/trace-ai/scan/artifacts/writer.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function buildPromptRegistry(): PromptTemplateRegistry {
  const r = new PromptTemplateRegistry();
  r.registerInline(
    "builtin:cross-trace-synthesizer-v1",
    "n={{n_total}} k={{sample_count}} ratio={{sample_ratio}} agent={{agent_id}} agg={{aggregates}} samples={{samples_yaml}} schema={{output_schema}} {{language_instruction}}",
  );
  return r;
}

const okResponse = {
  headline: "agent X mostly fails with tool_loop",
  primary_root_cause: { rule_ids: ["tool_loop_no_state_change"], description: "d", target_for_fix: "agent.prompt" },
  fix_priority: [{ rule_id: "tool_loop_no_state_change", affected_trace_count: 5, reason: "dominant" }],
  cross_rule_links: [],
};

test("runCrossTraceSynthesizer: tier=std, prompt contains agent_id", async () => {
  const stub = new StubAgentProvider({ name: "stub", responses: [okResponse] });
  const out = await runCrossTraceSynthesizer({
    agentId: "01KR_test",
    aggregates: { rule_frequency: [{ rule_id: "tool_loop_no_state_change", count: 5, severity_breakdown: { high: 5, medium: 0, low: 0 } }] },
    samples: { samples: [] },
    nTotal: 10,
    provider: stub,
    promptRegistry: buildPromptRegistry(),
  });
  assert.equal(out.summary?.headline, "agent X mostly fails with tool_loop");
  assert.equal(stub.calls.length, 1);
  assert.equal(stub.calls[0].tier, "std");
  assert.match(stub.calls[0].prompt, /agent=01KR_test/);
});

test("runCrossTraceSynthesizer: schema_violation → summary=null + error recorded", async () => {
  const stub = new StubAgentProvider({
    name: "stub",
    responses: [{ headline: "h" }],   // missing required fields
  });
  const out = await runCrossTraceSynthesizer({
    agentId: "01KR_test",
    aggregates: { rule_frequency: [] },
    samples: { samples: [] },
    nTotal: 0,
    provider: stub,
    promptRegistry: buildPromptRegistry(),
  });
  assert.equal(out.summary, null);
  assert.ok(out.fallbackReason);
  assert.match(out.fallbackReason!, /schema_violation|agent-error/);
});

test("runCrossTraceSynthesizer: artifacts written when ArtifactWriter passed", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "cts-"));
  const artifacts = new ArtifactWriter({ base, enabled: true });
  const stub = new StubAgentProvider({ name: "stub", responses: [okResponse] });
  await runCrossTraceSynthesizer({
    agentId: "01KR_test",
    aggregates: { rule_frequency: [] },
    samples: { samples: [] },
    nTotal: 1,
    provider: stub,
    promptRegistry: buildPromptRegistry(),
    artifacts,
  });
  const dir = path.join(base, "stage-4-cross-trace-synth");
  for (const f of ["aggregates.json", "samples.json", "prompt.md", "response.json"]) {
    assert.ok(await fs.stat(path.join(dir, f)).then(() => true).catch(() => false), `${f} missing`);
  }
  await fs.rm(base, { recursive: true, force: true });
});

test("runCrossTraceSynthesizer: sample_ratio computed correctly (K/N as percent)", async () => {
  const stub = new StubAgentProvider({ name: "stub", responses: [okResponse] });
  await runCrossTraceSynthesizer({
    agentId: "a",
    aggregates: { rule_frequency: [] },
    samples: { samples: [{ trace_id: "x", conversation_id: null, headline: "h", rule_ids: [], selected_as: "outlier" }] },
    nTotal: 100,
    provider: stub,
    promptRegistry: buildPromptRegistry(),
  });
  assert.match(stub.calls[0].prompt, /ratio=1%|ratio=0.01/);
});

test("runCrossTraceSynthesizer: nTotal=0 → still runs, prompt reflects k=0/n=0/ratio=0%", async () => {
  const stub = new StubAgentProvider({ name: "stub", responses: [okResponse] });
  await runCrossTraceSynthesizer({
    agentId: "a",
    aggregates: { rule_frequency: [] },
    samples: { samples: [] },
    nTotal: 0,
    provider: stub,
    promptRegistry: buildPromptRegistry(),
  });
  assert.match(stub.calls[0].prompt, /n=0/);
  assert.match(stub.calls[0].prompt, /k=0/);
  assert.match(stub.calls[0].prompt, /ratio=0%/);
});
```

- [ ] **Step 3: Implement synthesizer runner**

```typescript
// packages/typescript/src/trace-ai/scan/cross-trace-synthesizer.ts
import yaml from "js-yaml";

import type { AgentProvider } from "../../agent-providers/types.js";
import { AgentProviderError } from "../../agent-providers/types.js";
import { PromptTemplateRegistry, render as renderPrompt, languageInstructionFor, type AgentOutputLang } from "../../agent-providers/prompt-template.js";
import { ScanSummaryShape } from "./scan-summary-schema.js";
import type { AggregatesBlock } from "./aggregator.js";
import type { SamplerOutput } from "./sampler.js";
import { ArtifactWriter } from "./artifacts/writer.js";

export interface CrossTraceSynthesizerResult {
  summary: import("zod").infer<typeof ScanSummaryShape> | null;
  /** Non-null when summary is null (schema_violation / transport / etc.). */
  fallbackReason?: string;
}

export interface RunCrossTraceSynthesizerOpts {
  agentId: string;
  aggregates: AggregatesBlock;
  samples: SamplerOutput;
  nTotal: number;
  provider: AgentProvider;
  promptRegistry: PromptTemplateRegistry;
  promptRef?: string;
  lang?: AgentOutputLang;
  artifacts?: ArtifactWriter;
  timeoutMs?: number;
}

const SUMMARY_OUTPUT_SCHEMA_DESCRIPTION = {
  type: "object",
  required: ["headline", "primary_root_cause", "fix_priority", "cross_rule_links"],
  properties: {
    headline: { type: "string", maxLength: 160 },
    primary_root_cause: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          required: ["rule_ids", "description", "target_for_fix"],
          properties: {
            rule_ids: { type: "array", items: { type: "string" }, minItems: 1 },
            description: { type: "string" },
            target_for_fix: { type: "string" },
          },
        },
      ],
    },
    fix_priority: {
      type: "array",
      items: {
        type: "object",
        required: ["rule_id", "affected_trace_count", "reason"],
        properties: {
          rule_id: { type: "string" },
          affected_trace_count: { type: "integer", minimum: 0 },
          reason: { type: "string" },
        },
      },
    },
    cross_rule_links: {
      type: "array",
      items: {
        type: "object",
        required: ["rule_ids", "relation"],
        properties: {
          rule_ids: { type: "array", items: { type: "string" }, minItems: 2 },
          relation: { type: "string" },
        },
      },
    },
  },
};

function formatRatio(k: number, n: number): string {
  if (n === 0) return "0%";
  return `${Math.round((k / n) * 100)}%`;
}

export async function runCrossTraceSynthesizer(opts: RunCrossTraceSynthesizerOpts): Promise<CrossTraceSynthesizerResult> {
  const { agentId, aggregates, samples, nTotal, provider, promptRegistry, artifacts } = opts;
  const ref = opts.promptRef ?? "builtin:cross-trace-synthesizer-v1";
  const sampleCount = samples.samples.length;

  if (artifacts) await artifacts.writeStageFourInputs(aggregates, samples);

  const tpl = promptRegistry.get(ref);
  const prompt = renderPrompt(tpl, {
    n_total: nTotal,
    sample_count: sampleCount,
    sample_ratio: formatRatio(sampleCount, nTotal),
    agent_id: agentId,
    aggregates: yaml.dump(aggregates, { lineWidth: 120 }),
    samples_yaml: yaml.dump(samples, { lineWidth: 120 }),
    output_schema: SUMMARY_OUTPUT_SCHEMA_DESCRIPTION,
    language_instruction: languageInstructionFor(opts.lang ?? "en"),
  });

  if (artifacts) await artifacts.writeStageFourPrompt(prompt);

  try {
    const resp = await provider.invoke({
      prompt,
      outputSchema: ScanSummaryShape,
      tier: "std",
      timeoutMs: opts.timeoutMs,
      correlationId: `stage-4/${agentId}`,
    });
    if (artifacts) await artifacts.writeStageFourResponse(resp.output);
    return { summary: resp.output };
  } catch (e) {
    const kind = e instanceof AgentProviderError ? e.kind : "transport";
    if (artifacts) {
      await artifacts.writeStageFourResponse({ error: String(e) });
      await artifacts.writeStageFourParseErrors([{ reason: `agent-error:${kind}`, detail: String(e) }]);
    }
    return { summary: null, fallbackReason: `agent-error:${kind}` };
  }
}
```

- [ ] **Step 4: Update build script to copy the prompt to dist** (already added in Task 11 step 2 — verify the cross-trace-synthesizer-v1.prompt.md is picked up by the same `cp src/trace-ai/scan/prompts/builtin/*.prompt.md` clause).

- [ ] **Step 5: Run tests to verify pass**

```bash
cd packages/typescript && node --import tsx --test test/cross-trace-synthesizer.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/typescript/src/trace-ai/scan/prompts/builtin/cross-trace-synthesizer-v1.prompt.md \
        packages/typescript/src/trace-ai/scan/cross-trace-synthesizer.ts \
        packages/typescript/test/cross-trace-synthesizer.test.ts
git commit -m "feat(trace-ai/scan): cross-trace synthesizer — Stage-4 single LLM call with std tier"
```

---

## Phase 5: Output + orchestration (Tasks 13-15)

### Task 13: scan-summary markdown renderer

**Files:**
- Create: `packages/typescript/src/trace-ai/scan/scan-summary-markdown.ts`
- Test: `packages/typescript/test/scan-summary-markdown.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
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
  assert.match(md, /\| `conv_a` \| .* \| 1 \| \[yaml\]\(conv_a\.yaml\) \|/);
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
```

- [ ] **Step 2: Run to verify failures**

```bash
cd packages/typescript && node --import tsx --test test/scan-summary-markdown.test.ts
```

Expected: FAIL — module missing.

- [ ] **Step 3: Implement markdown renderer**

```typescript
// packages/typescript/src/trace-ai/scan/scan-summary-markdown.ts
import type { ScanSummary } from "./scan-summary-schema.js";

function rel(p: string): string { return p; }

export function renderScanSummaryMarkdown(s: ScanSummary): string {
  const lines: string[] = [];
  const scan = s.scan;
  lines.push(`# Trace Diagnose Batch Summary — agent \`${scan.agent_id}\``);
  lines.push("");
  const resumeBanner = scan.resumed_from_partial
    ? ` · resumed — ${scan.traces_reused} reused, ${scan.traces_freshly_diagnosed} freshly diagnosed`
    : "";
  lines.push(`> ${scan.trace_count} traces · ${scan.traces_with_findings} with findings · diagnosed ${scan.diagnosed_at} · cli \`${scan.cli_version}\`${resumeBanner}`);
  lines.push("");

  // ── Summary ────────────────────────────────────────────────────────────
  lines.push("## Summary");
  lines.push("");
  if (s.summary === null) {
    lines.push("_Stage-4 synthesizer did not complete; aggregates and per-trace reports are still emitted below._");
    lines.push("");
  } else {
    lines.push(`**${s.summary.headline}**`);
    lines.push("");
    if (s.summary.primary_root_cause) {
      const rc = s.summary.primary_root_cause;
      lines.push(`Primary root cause — rules ${rc.rule_ids.map((id) => `\`${id}\``).join(", ")}; target for fix: \`${rc.target_for_fix}\`.`);
      lines.push("");
      lines.push(`> ${rc.description.replace(/\r?\n+/g, " ")}`);
      lines.push("");
    }
  }

  // ── Fix priority ───────────────────────────────────────────────────────
  if (s.summary && s.summary.fix_priority.length > 0) {
    lines.push("## Fix priority");
    lines.push("");
    lines.push("| Order | Rule | Affected | Reason |");
    lines.push("|---|---|---|---|");
    s.summary.fix_priority.forEach((p, idx) => {
      lines.push(`| ${idx + 1} | \`${p.rule_id}\` | ${p.affected_trace_count} | ${p.reason.replace(/\|/g, "\\|").replace(/\r?\n/g, " ")} |`);
    });
    lines.push("");
  }

  // ── Cross-rule links ───────────────────────────────────────────────────
  if (s.summary && s.summary.cross_rule_links.length > 0) {
    lines.push("## Cross-rule links");
    lines.push("");
    for (const link of s.summary.cross_rule_links) {
      const ids = link.rule_ids.map((r) => `\`${r}\``).join(" ↔ ");
      lines.push(`- ${ids} — ${link.relation}`);
    }
    lines.push("");
  }

  // ── Aggregates ─────────────────────────────────────────────────────────
  lines.push("## Aggregates");
  lines.push("");
  lines.push("| Rule | Count | high | medium | low |");
  lines.push("|---|---|---|---|---|");
  for (const item of s.aggregates.rule_frequency) {
    lines.push(`| \`${item.rule_id}\` | ${item.count} | ${item.severity_breakdown.high} | ${item.severity_breakdown.medium} | ${item.severity_breakdown.low} |`);
  }
  lines.push("");

  // ── Per-trace index ────────────────────────────────────────────────────
  lines.push("## Per-Trace Reports");
  lines.push("");
  lines.push("| conv_id | trace_id | findings | report |");
  lines.push("|---|---|---|---|");
  for (const item of s.per_trace_index) {
    const mdPath = item.report_path.replace(/\.yaml$/, ".md");
    lines.push(`| \`${item.conversation_id}\` | \`${item.trace_id.slice(0, 16)}…\` | ${item.finding_count} | [yaml](${rel(item.report_path)}) / [md](${rel(mdPath)}) |`);
  }
  lines.push("");

  return lines.join("\n");
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
cd packages/typescript && node --import tsx --test test/scan-summary-markdown.test.ts
```

Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/typescript/src/trace-ai/scan/scan-summary-markdown.ts \
        packages/typescript/test/scan-summary-markdown.test.ts
git commit -m "feat(trace-ai/scan): scan-summary markdown renderer"
```

---

### Task 14: per-trace runner (Stage-1 + Stage-3-template + resume + atomic write)

**Files:**
- Create: `packages/typescript/src/trace-ai/scan/runner.ts`
- Test: `packages/typescript/test/scan-runner.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// packages/typescript/test/scan-runner.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runPerTracePipeline } from "../src/trace-ai/scan/runner.js";

async function tmpDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "scan-runner-"));
}

test("runPerTracePipeline: existing <conv_id>.yaml → skipped, returns reused=true", async () => {
  const out = await tmpDir();
  // Pre-write a valid yaml.
  await fs.writeFile(path.join(out, "conv_a.yaml"),
    "schema_version: trace-diagnose-report/v1\n" +
    "trace: { trace_id: tr_a, agent_id: 01KR_x, tenant: null }\n" +
    "run: { diagnosed_at: x, cli_version: 0.7.4, mode: hybrid, rules_applied: [], rules_skipped: [], synthesizer_mode: template }\n" +
    "summary: { headline: h, primary_root_cause: null, fix_priority: [], cross_finding_links: [] }\n" +
    "findings: []\n", "utf8");
  let pipelineCalled = false;
  const r = await runPerTracePipeline({
    convId: "conv_a",
    outDir: out,
    runDiagnose: async () => { pipelineCalled = true; return null as never; },
  });
  assert.equal(r.reused, true);
  assert.equal(pipelineCalled, false);
  await fs.rm(out, { recursive: true, force: true });
});

test("runPerTracePipeline: no existing yaml → calls runDiagnose, returns reused=false", async () => {
  const out = await tmpDir();
  let calls = 0;
  const r = await runPerTracePipeline({
    convId: "conv_a",
    outDir: out,
    runDiagnose: async (convId, partialPath) => {
      calls++;
      await fs.writeFile(partialPath, "yaml content here", "utf8");
      return { traceId: "tr_a", agentId: "01KR_x" };
    },
  });
  assert.equal(calls, 1);
  assert.equal(r.reused, false);
  // The .partial should have been atomic-renamed to the final path.
  const finalContents = await fs.readFile(path.join(out, "conv_a.yaml"), "utf8");
  assert.equal(finalContents, "yaml content here");
  const partialExists = await fs.stat(path.join(out, "conv_a.yaml.partial")).then(() => true).catch(() => false);
  assert.equal(partialExists, false);
  await fs.rm(out, { recursive: true, force: true });
});

test("runPerTracePipeline: corrupt existing yaml → log warning, treat as fresh, recompute", async () => {
  const out = await tmpDir();
  await fs.writeFile(path.join(out, "conv_a.yaml"), "{{not valid yaml or schema", "utf8");
  let calls = 0;
  const r = await runPerTracePipeline({
    convId: "conv_a",
    outDir: out,
    runDiagnose: async (_convId, partial) => {
      calls++;
      await fs.writeFile(partial, "fresh yaml content", "utf8");
      return { traceId: "tr_a", agentId: "01KR_x" };
    },
  });
  assert.equal(calls, 1);
  assert.equal(r.reused, false);
  await fs.rm(out, { recursive: true, force: true });
});

test("runPerTracePipeline: parallel invocations with --max-parallel respected (proxy: counts concurrent)", async () => {
  const out = await tmpDir();
  let concurrent = 0;
  let max = 0;
  const runOne = async (i: number) => runPerTracePipeline({
    convId: `conv_${i}`,
    outDir: out,
    runDiagnose: async (_id, partial) => {
      concurrent++;
      max = Math.max(max, concurrent);
      await new Promise((r) => setTimeout(r, 20));
      concurrent--;
      await fs.writeFile(partial, `y_${i}`, "utf8");
      return { traceId: `tr_${i}`, agentId: "01KR_x" };
    },
  });
  // Note: runPerTracePipeline itself doesn't enforce parallelism — caller does
  // (via Promise.all with chunking). This test just exercises the function in
  // parallel and confirms it doesn't serialize internally.
  await Promise.all([0, 1, 2, 3, 4].map(runOne));
  assert.ok(max >= 2);   // some concurrency observed
  await fs.rm(out, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run to verify failures**

```bash
cd packages/typescript && node --import tsx --test test/scan-runner.test.ts
```

Expected: FAIL — module missing.

- [ ] **Step 3: Implement runner**

```typescript
// packages/typescript/src/trace-ai/scan/runner.ts
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";

import { ReportSchema } from "../diagnose/schemas.js";

export interface DiagnoseInvocation {
  /** Invoked by runPerTracePipeline. MUST write the per-trace yaml to `partialPath`;
   *  the runner then atomic-renames to `<conv_id>.yaml`. */
  (convId: string, partialPath: string): Promise<{ traceId: string; agentId: string | null }>;
}

export interface RunPerTracePipelineOpts {
  convId: string;
  outDir: string;
  runDiagnose: DiagnoseInvocation;
}

export interface RunPerTracePipelineResult {
  reused: boolean;
  traceId?: string;
  agentId?: string | null;
}

async function safeReadYaml(filePath: string): Promise<unknown | null> {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return yaml.load(text);
  } catch {
    return null;
  }
}

async function isValidExistingReport(filePath: string): Promise<boolean> {
  const obj = await safeReadYaml(filePath);
  if (obj === null) return false;
  return ReportSchema.safeParse(obj).success;
}

/**
 * Process one conv_id: skip if the per-trace yaml already exists and parses;
 * otherwise invoke runDiagnose (which writes to a .partial path), then
 * atomic-rename to the final path on success. Corrupt existing yaml is
 * logged + overwritten.
 */
export async function runPerTracePipeline(opts: RunPerTracePipelineOpts): Promise<RunPerTracePipelineResult> {
  const finalPath = path.join(opts.outDir, `${opts.convId}.yaml`);
  const partialPath = `${finalPath}.partial`;

  const existed = await fs.stat(finalPath).then(() => true).catch(() => false);
  if (existed) {
    if (await isValidExistingReport(finalPath)) {
      return { reused: true };
    }
    process.stderr.write(`warning: existing ${finalPath} is corrupt or schema-incompatible; re-diagnosing\n`);
    await fs.rm(finalPath, { force: true });
  }

  await fs.mkdir(opts.outDir, { recursive: true });
  const result = await opts.runDiagnose(opts.convId, partialPath);
  // Atomic rename .partial → final
  await fs.rename(partialPath, finalPath);
  return { reused: false, traceId: result.traceId, agentId: result.agentId };
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
cd packages/typescript && node --import tsx --test test/scan-runner.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/typescript/src/trace-ai/scan/runner.ts \
        packages/typescript/test/scan-runner.test.ts
git commit -m "feat(trace-ai/scan): runner — per-trace pipeline with resume + atomic .partial rename"
```

---

### Task 15: runBatch orchestrator

**Files:**
- Create: `packages/typescript/src/trace-ai/scan/index.ts`
- Test (light unit only — full e2e in Task 17): `packages/typescript/test/scan-orchestrator-unit.test.ts`

- [ ] **Step 1: Write failing unit test**

The orchestrator is heavy in glue code; we cover the public shape lightly here and lean on e2e in Task 17 for behavior.

```typescript
// packages/typescript/test/scan-orchestrator-unit.test.ts
import test from "node:test";
import assert from "node:assert/strict";

import { type RunBatchOpts, type RunBatchResult } from "../src/trace-ai/scan/index.js";

test("runBatch types: RunBatchOpts exposes traces[], out, ...PR-B opts", () => {
  // Compile-time test — if module exports don't exist or types diverge, this fails to load.
  const fakeOpts: RunBatchOpts = {
    traces: ["conv1", "conv2"],
    out: "/tmp/whatever",
    rulesDir: null,
    noBuiltin: false,
    noArtifacts: false,
    lang: "en",
    timeoutMs: 60000,
    maxParallel: 4,
    baseUrl: "http://x",
    token: "tk",
    businessDomain: "bd_public",
  };
  // Type-level check; no runtime assertion needed beyond this allocation.
  assert.equal(fakeOpts.traces.length, 2);
});

test("runBatch types: RunBatchResult has scanSummaryPath + perTraceReportPaths", () => {
  const fakeResult: RunBatchResult = {
    scanSummaryPath: "/tmp/whatever/scan-summary.yaml",
    perTraceReportPaths: ["/tmp/whatever/conv1.yaml", "/tmp/whatever/conv2.yaml"],
    tracesDiagnosed: 2,
    tracesReused: 0,
  };
  assert.equal(fakeResult.tracesDiagnosed, 2);
});
```

- [ ] **Step 2: Implement orchestrator**

```typescript
// packages/typescript/src/trace-ai/scan/index.ts
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { fileURLToPath } from "node:url";

import { getSpansByConversationId, type RawSpan } from "../../api/trace.js";
import { assembleTraceTree } from "../diagnose/trace-shaper.js";
import { loadRules } from "../diagnose/rule-loader.js";
import { runRules, rubricRules } from "../diagnose/signal-probe.js";
import { templateSynthesize } from "../diagnose/synthesizer-template.js";
import { assembleReport, reportToYamlObject, symbolicHitsToFindings } from "../diagnose/report-assembler.js";
import { renderReportMarkdown } from "../diagnose/report-markdown.js";
import { ReportSchema } from "../diagnose/schemas.js";
import type { Report } from "../diagnose/types.js";

import { defaultRegistry } from "../../agent-providers/registry.js";
import { defaultPromptRegistry, PromptTemplateRegistry } from "../../agent-providers/prompt-template.js";

import { parseTracesList } from "./traces-list-parser.js";
import { validateSingleAgent } from "./single-agent-validator.js";
import { runPerTracePipeline } from "./runner.js";
import { runBatchedRubric, type BatchTraceItem, type BatchedRubricRule } from "./batched-rubric.js";
import { aggregate } from "./aggregator.js";
import { sample } from "./sampler.js";
import { runCrossTraceSynthesizer } from "./cross-trace-synthesizer.js";
import { renderScanSummaryMarkdown } from "./scan-summary-markdown.js";
import { ScanSummarySchema, type ScanSummary } from "./scan-summary-schema.js";
import { ArtifactWriter } from "./artifacts/writer.js";
import { resolveArtifactsBase } from "./artifacts/paths.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUILTIN_RULES_DIR = path.join(__dirname, "..", "diagnose", "builtin-rules");
const SHARED_PROMPT_DIR = path.join(__dirname, "..", "..", "agent-providers", "prompts");
const SCAN_PROMPT_DIR = path.join(__dirname, "prompts", "builtin");

export interface RunBatchOpts {
  traces: string[];                    // conversation_ids (already parsed)
  out: string;                         // directory
  rulesDir: string | null;
  noBuiltin: boolean;
  noArtifacts: boolean;
  lang?: "en" | "zh";
  timeoutMs: number;
  maxParallel: number;
  baseUrl: string;
  token: string;
  businessDomain: string;
}

export interface RunBatchResult {
  scanSummaryPath: string;
  perTraceReportPaths: string[];
  tracesDiagnosed: number;
  tracesReused: number;
}

async function ensurePromptsLoaded(reg: PromptTemplateRegistry): Promise<void> {
  await reg.loadBuiltinDir(SHARED_PROMPT_DIR).catch(() => undefined);
  await reg.loadBuiltinDir(SCAN_PROMPT_DIR).catch(() => undefined);
}

async function readReportFromDisk(yamlPath: string): Promise<Report> {
  const text = await fs.readFile(yamlPath, "utf8");
  const obj = yaml.load(text);
  const parsed = ReportSchema.parse(obj);
  // Convert yaml snake_case shape back to internal Report. Reuse PR-B's reverse logic
  // via direct shape mapping (yaml shape mirrors Report 1:1 except snake_case keys).
  return {
    schemaVersion: parsed.schema_version,
    trace: { traceId: parsed.trace.trace_id, agentId: parsed.trace.agent_id, tenant: parsed.trace.tenant },
    run: {
      diagnosedAt: parsed.run.diagnosed_at,
      cliVersion: parsed.run.cli_version,
      mode: parsed.run.mode,
      rulesApplied: parsed.run.rules_applied,
      rulesSkipped: parsed.run.rules_skipped.map((s) => ({ ruleId: s.rule_id, reason: s.reason })),
      synthesizerMode: parsed.run.synthesizer_mode,
    },
    summary: {
      headline: parsed.summary.headline,
      primaryRootCause: parsed.summary.primary_root_cause === null ? null : {
        findingIds: parsed.summary.primary_root_cause.finding_ids,
        description: parsed.summary.primary_root_cause.description,
        targetForFix: parsed.summary.primary_root_cause.target_for_fix,
      },
      fixPriority: parsed.summary.fix_priority.map((p) => ({ findingId: p.finding_id, reason: p.reason })),
      crossFindingLinks: parsed.summary.cross_finding_links.map((l) => ({ findingIds: l.finding_ids, relation: l.relation })),
    },
    findings: parsed.findings.map((f) => ({
      ruleId: f.rule_id,
      judgmentKind: f.judgment_kind,
      severity: f.severity,
      symptom: f.symptom,
      likelyCause: f.likely_cause,
      evidence: { spans: f.evidence.spans, excerpt: f.evidence.excerpt },
      suggestedFix: { target: f.suggested_fix.target, change: f.suggested_fix.change },
      confidence: f.confidence,
      verifyWith: {
        suggestedEvalCase: {
          queryId: f.verify_with.suggested_eval_case.query_id,
          query: f.verify_with.suggested_eval_case.query,
          assertions: f.verify_with.suggested_eval_case.assertions,
        },
      },
    })),
  };
}

/**
 * Orchestrator: walks N conv_ids through the batch pipeline.
 * Single-agent enforced; --no-llm rejected by CLI (not here).
 */
export async function runBatch(opts: RunBatchOpts): Promise<RunBatchResult> {
  const t_start = Date.now();
  const registry = defaultRegistry;
  const promptRegistry = defaultPromptRegistry;
  await ensurePromptsLoaded(promptRegistry);

  // 1. Single-agent validation (also caches first batch of getSpansByConversationId results)
  const cachedSpans = new Map<string, RawSpan[]>();
  const validation = await validateSingleAgent(opts.traces, async (convId) => {
    const fetched = await getSpansByConversationId({
      baseUrl: opts.baseUrl, token: opts.token, businessDomain: opts.businessDomain, conversationId: convId,
    });
    cachedSpans.set(convId, fetched.spans);
    return {
      spans: fetched.spans.map((s) => ({ attributes: s.attributes ?? {} })),
      conversation_id: convId,
    };
  });
  const agentId = validation.agentId;

  // 2. Artifacts writer
  const artifactsBase = resolveArtifactsBase({ mode: "batch", out: opts.out });
  const artifacts = new ArtifactWriter({ base: artifactsBase, enabled: !opts.noArtifacts });

  // 3. Load rules (gates_on metadata available after this)
  const rules = await loadRules({
    builtinDir: opts.noBuiltin ? null : BUILTIN_RULES_DIR,
    cwdRulesDir: opts.rulesDir,
  });

  // 4. Per-trace Stage-1 + Stage-3-template + initial yaml write (parallel-bounded)
  type PerTraceResult = { convId: string; report: Report; reused: boolean };
  const allRubricWork: { rule: typeof rules[0]; trace: BatchTraceItem }[] = [];

  const t_stage1 = Date.now();
  const perTrace: PerTraceResult[] = [];
  let cursor = 0;
  while (cursor < opts.traces.length) {
    const chunk = opts.traces.slice(cursor, cursor + opts.maxParallel);
    const results = await Promise.all(chunk.map(async (convId) => {
      const r = await runPerTracePipeline({
        convId,
        outDir: opts.out,
        runDiagnose: async (id, partial) => {
          const raw = cachedSpans.get(id) ?? (await getSpansByConversationId({
            baseUrl: opts.baseUrl, token: opts.token, businessDomain: opts.businessDomain, conversationId: id,
          })).spans;
          const tree = assembleTraceTree(raw[0]?.traceId ?? id, raw);
          const symbolicHits = runRules(rules.filter((r) => r.predicateRef !== null), tree);
          const symbolicFindings = symbolicHitsToFindings(rules, symbolicHits);
          // Find symbolic rule ids that fired for paired-gate logic
          const firedRuleIds = new Set(symbolicFindings.map((f) => f.ruleId));
          for (const rule of rubricRules(rules)) {
            const gates = rule.rubric?.gatesOn;
            if (gates && gates.length > 0 && !gates.some((g) => firedRuleIds.has(g))) continue;
            allRubricWork.push({
              rule,
              trace: {
                traceId: tree.traceId,
                spans: tree.spans.map((s) => s.spanId),
                inputs: {},  // input resolution happens per-rule via existing PR-B helpers in implementation
              },
            });
          }
          const summary = templateSynthesize(symbolicFindings);
          const report = assembleReport({
            traceId: tree.traceId,
            agentId,
            tenant: null,
            cliVersion: "0.7.4",
            rules,
            hits: symbolicHits,
            extraFindings: [],
            summary,
            mode: "hybrid",
            synthesizerMode: "template",
          });
          await fs.writeFile(partial, yaml.dump(reportToYamlObject(report)), "utf8");
          await fs.writeFile(path.join(path.dirname(partial), `${id}.md`), renderReportMarkdown(report, { conversationId: id, businessDomain: opts.businessDomain }), "utf8");
          return { traceId: tree.traceId, agentId };
        },
      });
      // Re-read the (possibly-just-written, possibly-reused) report from disk to feed aggregator/sampler
      const report = await readReportFromDisk(path.join(opts.out, `${convId}.yaml`));
      return { convId, report, reused: r.reused };
    }));
    perTrace.push(...results);
    cursor += opts.maxParallel;
  }
  const t_stage1_end = Date.now();

  // 5. Stage-2 batched rubric (per rule, chunks of 10)
  const t_stage2_start = Date.now();
  let stage2Chunks = 0;
  // Group rubric work by rule_id
  const workByRule = new Map<string, typeof allRubricWork>();
  for (const w of allRubricWork) {
    const arr = workByRule.get(w.rule.id) ?? [];
    arr.push(w);
    workByRule.set(w.rule.id, arr);
  }
  for (const [ruleId, items] of workByRule.entries()) {
    const rule = items[0].rule;
    const traces = items.map((i) => i.trace);
    stage2Chunks += Math.ceil(traces.length / 10);
    const provider = registry.resolve({ preferred: rule.rubric!.agentBinding.provider });
    if (!provider) continue;
    const batchedRule: BatchedRubricRule = {
      ruleId,
      judgeQuestion: rule.rubric!.judgeQuestion,
      outputSchema: rule.rubric!.outputZodSchema,
      outputSchemaRaw: rule.rubric!.outputSchemaRaw,
      promptTemplateRef: "builtin:rubric-judge-batch-v1",
    };
    const result = await runBatchedRubric({
      rule: batchedRule,
      traces,
      agentId,
      provider,
      promptRegistry,
      chunkSize: 10,
      lang: opts.lang,
      artifacts,
      timeoutMs: opts.timeoutMs,
    });
    // Fold verdicts back into per-trace yaml + md (re-write)
    for (const v of result.verdicts) {
      const pt = perTrace.find((p) => p.report.trace.traceId === v.traceId);
      if (!pt) continue;
      pt.report.findings.push({
        ruleId,
        judgmentKind: "rubric",
        severity: v.severity,
        symptom: rule.symptom,
        likelyCause: v.category,
        evidence: { spans: v.evidenceSpanIds, excerpt: v.reasoning },
        suggestedFix: { target: rule.suggestedFix.target, change: rule.suggestedFix.changeTemplate },
        confidence: "medium",
        verifyWith: { suggestedEvalCase: { queryId: null, query: null, assertions: rule.verifyWith.assertionTemplates } },
      });
      await fs.writeFile(path.join(opts.out, `${pt.convId}.yaml`), yaml.dump(reportToYamlObject(pt.report)), "utf8");
      await fs.writeFile(path.join(opts.out, `${pt.convId}.md`), renderReportMarkdown(pt.report, { conversationId: pt.convId, businessDomain: opts.businessDomain }), "utf8");
    }
    for (const s of result.skipped) {
      const pt = perTrace.find((p) => p.report.trace.traceId === s.traceId);
      if (!pt) continue;
      pt.report.run.rulesSkipped.push({ ruleId, reason: s.reason });
      await fs.writeFile(path.join(opts.out, `${pt.convId}.yaml`), yaml.dump(reportToYamlObject(pt.report)), "utf8");
    }
  }
  const t_stage2_end = Date.now();

  // 6. Aggregator + sampler
  const allReports = perTrace.map((p) => p.report);
  const aggregates = aggregate(allReports);
  const samples = sample(allReports);

  // 7. Cross-trace synth
  const t_stage4_start = Date.now();
  const synthProvider = registry.resolve({ preferred: "claude-code" });
  let synthSummary: ScanSummary["summary"] = null;
  if (synthProvider) {
    const result = await runCrossTraceSynthesizer({
      agentId,
      aggregates,
      samples,
      nTotal: allReports.length,
      provider: synthProvider,
      promptRegistry,
      lang: opts.lang,
      artifacts,
      timeoutMs: opts.timeoutMs,
    });
    synthSummary = result.summary;
  }
  const t_stage4_end = Date.now();

  // 8. Assemble + write scan-summary
  const tracesReused = perTrace.filter((p) => p.reused).length;
  const scanSummary: ScanSummary = {
    schema_version: "scan-summary/v1",
    scan: {
      agent_id: agentId,
      trace_count: allReports.length,
      traces_with_findings: allReports.filter((r) => r.findings.length > 0).length,
      traces_reused: tracesReused,
      traces_freshly_diagnosed: allReports.length - tracesReused,
      resumed_from_partial: tracesReused > 0,
      diagnosed_at: new Date().toISOString(),
      cli_version: "0.7.4",
      synthesizer_mode: "agent",
    },
    summary: synthSummary,
    aggregates,
    per_trace_index: perTrace.map((p) => ({
      trace_id: p.report.trace.traceId,
      conversation_id: p.convId,
      report_path: `${p.convId}.yaml`,
      finding_count: p.report.findings.length,
    })),
  };
  const scanSummaryYamlPath = path.join(opts.out, "scan-summary.yaml");
  const scanSummaryMdPath = path.join(opts.out, "scan-summary.md");
  await fs.writeFile(scanSummaryYamlPath, yaml.dump(scanSummary), "utf8");
  await fs.writeFile(scanSummaryMdPath, renderScanSummaryMarkdown(scanSummary), "utf8");

  // 9. Run metadata
  const t_total = Date.now() - t_start;
  await artifacts.writeRunMetadata({
    cli_args: { traces: opts.traces, out: opts.out, lang: opts.lang ?? "en" },
    agent_id: agentId,
    rule_load_summary: {
      rules_applied: rules.map((r) => r.id),
      rules_skipped_at_load: [],
      rules_dir: opts.rulesDir ?? "builtin",
    },
    single_agent_validation: { checked_conv_ids: validation.checkedConvIds, agent_id_resolved: agentId },
    timing: {
      stage_1_ms: t_stage1_end - t_stage1,
      stage_2_ms: t_stage2_end - t_stage2_start,
      stage_3_ms: 0,
      stage_4_ms: t_stage4_end - t_stage4_start,
      total_ms: t_total,
    },
    llm_calls: {
      stage_2_chunks: stage2Chunks,
      stage_3: 0,
      stage_4: synthSummary ? 1 : 0,
      total: stage2Chunks + (synthSummary ? 1 : 0),
    },
    cost_estimate_usd: {
      stage_2: stage2Chunks * 0.005,        // haiku approx
      stage_4: (synthSummary ? 1 : 0) * 0.05, // sonnet approx
      total: stage2Chunks * 0.005 + (synthSummary ? 1 : 0) * 0.05,
      model_price_table_version: "2026-05",
    },
  });

  return {
    scanSummaryPath: scanSummaryYamlPath,
    perTraceReportPaths: perTrace.map((p) => path.join(opts.out, `${p.convId}.yaml`)),
    tracesDiagnosed: allReports.length,
    tracesReused,
  };
}
```

Note: This is a sizable file. The TDD discipline here is "make the e2e test in Task 17 drive the corrections"; the unit test in Task 15 only pins the type contract. Subsequent tasks may find specific implementation gaps that need patches.

- [ ] **Step 3: Run unit test to verify pass**

```bash
cd packages/typescript && npm run build && node --import tsx --test test/scan-orchestrator-unit.test.ts
```

Expected: PASS (type-level test).

- [ ] **Step 4: Commit**

```bash
git add packages/typescript/src/trace-ai/scan/index.ts \
        packages/typescript/test/scan-orchestrator-unit.test.ts
git commit -m "feat(trace-ai/scan): runBatch orchestrator — single-agent validation + Stage-1..4 pipeline"
```

---

## Phase 6: CLI wiring (Task 16)

### Task 16: CLI --traces / --no-artifacts / --out=<dir> required

**Files:**
- Modify: `packages/typescript/src/commands/trace.ts`
- Test: `packages/typescript/test/trace-cli-batch.test.ts`

- [ ] **Step 1: Write failing CLI parse tests**

```typescript
// packages/typescript/test/trace-cli-batch.test.ts
import test from "node:test";
import assert from "node:assert/strict";

import { parseTraceArgs } from "../src/commands/trace.js";

test("parseTraceArgs: --traces=conv1,conv2 sets mode='batch' + traces array", () => {
  const r = parseTraceArgs(["diagnose", "--traces=conv1,conv2", "--out=diagnosis/x"]);
  assert.equal(r.subcommand, "diagnose");
  assert.equal(r.mode, "batch");
  assert.deepEqual(r.traces, ["conv1", "conv2"]);
  assert.equal(r.out, "diagnosis/x");
});

test("parseTraceArgs: --traces=@/path/to/file sets traces='@/path/to/file' (resolved later)", () => {
  const r = parseTraceArgs(["diagnose", "--traces=@/tmp/ids.txt", "--out=diagnosis/x"]);
  assert.equal(r.mode, "batch");
  assert.deepEqual(r.traces, "@/tmp/ids.txt");
});

test("parseTraceArgs: --traces with --no-llm flagged for fail-fast (validated later)", () => {
  const r = parseTraceArgs(["diagnose", "--traces=conv1", "--no-llm", "--out=diagnosis/x"]);
  assert.equal(r.mode, "batch");
  assert.equal(r.noLlm, true);
});

test("parseTraceArgs: --traces without --out flagged for fail-fast", () => {
  const r = parseTraceArgs(["diagnose", "--traces=conv1"]);
  assert.equal(r.mode, "batch");
  assert.equal(r.out, null);
});

test("parseTraceArgs: --no-artifacts plumbs through (both modes)", () => {
  const r = parseTraceArgs(["diagnose", "conv_x", "--no-artifacts"]);
  assert.equal(r.mode, "single");
  assert.equal(r.noArtifacts, true);
});

test("parseTraceArgs: --max-parallel default 4", () => {
  const r = parseTraceArgs(["diagnose", "--traces=a,b", "--out=x"]);
  assert.equal(r.maxParallel, 4);
});

test("parseTraceArgs: --max-parallel override parsed as number", () => {
  const r = parseTraceArgs(["diagnose", "--traces=a,b", "--out=x", "--max-parallel=8"]);
  assert.equal(r.maxParallel, 8);
});

test("parseTraceArgs: positional <conv_id> sets mode='single'", () => {
  const r = parseTraceArgs(["diagnose", "01KCONV_x"]);
  assert.equal(r.mode, "single");
  assert.equal(r.conversationId, "01KCONV_x");
});
```

- [ ] **Step 2: Run to verify failures**

```bash
cd packages/typescript && node --import tsx --test test/trace-cli-batch.test.ts
```

Expected: FAIL — `mode`, `traces`, `noArtifacts`, `maxParallel` not on ParsedTraceArgs.

- [ ] **Step 3: Extend parseTraceArgs / ParsedTraceArgs**

In `packages/typescript/src/commands/trace.ts`, update `ParsedTraceArgs` and the parser:

```typescript
export interface ParsedTraceArgs {
  subcommand: "diagnose" | "rules-validate" | "help";
  mode?: "single" | "batch";
  conversationId?: string;       // single mode
  traces?: string;               // batch mode raw value (string or "@path") — resolved at runtime
  rulePath?: string;
  out: string | null;
  rulesDir: string | null;
  noBuiltin: boolean;
  noLlm: boolean;
  noArtifacts: boolean;
  maxParallel: number;
  format: 'yaml' | 'markdown' | 'both' | null;
  lang: 'en' | 'zh' | null;
  baseUrl: string | null;
  token: string | null;
  businessDomain: string | null;
}

// Inside parseTraceArgs:
const parsed = yargs(argv.slice(1))
  .option("out", { type: "string", default: undefined })
  .option("rules", { type: "string", default: undefined })
  .option("builtin", { type: "boolean", default: true })
  .option("llm", { type: "boolean", default: true })
  .option("artifacts", { type: "boolean", default: true })   // NEW; --no-artifacts toggles to false
  .option("traces", { type: "string", default: undefined })  // NEW
  .option("max-parallel", { type: "number", default: 4 })    // NEW
  .option("format", { type: "string", choices: ["yaml", "markdown", "both"], default: undefined })
  .option("lang", { type: "string", choices: ["en", "zh"], default: undefined })
  .option("token", { type: "string" })
  .option("base-url", { type: "string" })
  .option("business-domain", { alias: "bd", type: "string" })
  .help(false)
  .parseSync();

const positional = String(parsed._[0] ?? "");
const tracesArg = parsed.traces as string | undefined;
const mode: "single" | "batch" | undefined = tracesArg !== undefined ? "batch" : (positional ? "single" : undefined);

return {
  subcommand: "diagnose",
  mode,
  conversationId: mode === "single" ? positional : undefined,
  traces: tracesArg,
  out: parsed.out ?? null,
  rulesDir: parsed.rules ?? null,
  noBuiltin: !(parsed.builtin as boolean),
  noLlm: !(parsed.llm as boolean),
  noArtifacts: !(parsed.artifacts as boolean),
  maxParallel: parsed["max-parallel"] as number,
  format: (parsed.format as 'yaml' | 'markdown' | 'both' | undefined) ?? null,
  lang: (parsed.lang as 'en' | 'zh' | undefined) ?? null,
  baseUrl: (parsed.baseUrl as string | undefined) ?? null,
  token: (parsed.token as string | undefined) ?? null,
  businessDomain: (parsed.businessDomain as string | undefined) ?? null,
};

// Also update defaults() to set new fields to safe values.
function defaults(sub: ParsedTraceArgs["subcommand"]): ParsedTraceArgs {
  return {
    subcommand: sub,
    out: null,
    rulesDir: null,
    noBuiltin: false,
    noLlm: false,
    noArtifacts: false,
    maxParallel: 4,
    format: null,
    lang: null,
    baseUrl: null,
    token: null,
    businessDomain: null,
  };
}
```

- [ ] **Step 4: Add batch-mode dispatch logic with fail-fast checks**

In the `runTraceCommand()` function in `packages/typescript/src/commands/trace.ts`:

```typescript
import { runBatch } from "../trace-ai/scan/index.js";
import { parseTracesList, TracesListError } from "../trace-ai/scan/traces-list-parser.js";
import { SingleAgentValidationError } from "../trace-ai/scan/single-agent-validator.js";

// Inside runTraceCommand, after auth resolution and before existing single-trace dispatch:

if (args.mode === "batch") {
  // Fail-fast checks (decisions #2, #8-#10)
  if (args.noLlm) {
    process.stderr.write("error: --traces (batch mode) does not support --no-llm; the cross-trace synthesizer requires LLM. Use --traces with a fresh run or fall back to single-trace `diagnose <conv_id>` for offline cases.\n");
    return 2;
  }
  if (args.out === null) {
    process.stderr.write("error: --traces requires --out=<dir> to avoid writing N yaml files into the current working directory\n");
    return 2;
  }
  let convIds: string[];
  try {
    convIds = await parseTracesList(args.traces!);
  } catch (e) {
    if (e instanceof TracesListError) {
      process.stderr.write(`error: ${e.message}\n`);
      return 2;
    }
    throw e;
  }
  try {
    const result = await runBatch({
      traces: convIds,
      out: args.out,
      rulesDir: args.rulesDir,
      noBuiltin: args.noBuiltin,
      noArtifacts: args.noArtifacts,
      lang: args.lang ?? undefined,
      timeoutMs: 60000,
      maxParallel: args.maxParallel,
      baseUrl, token, businessDomain: bd,
    });
    process.stderr.write(`wrote ${result.perTraceReportPaths.length} per-trace reports + ${result.scanSummaryPath} (${result.tracesReused} reused)\n`);
    return 0;
  } catch (e) {
    if (e instanceof SingleAgentValidationError) {
      process.stderr.write(`error: ${e.message}\n`);
      return 2;
    }
    process.stderr.write(`error: ${(e as Error).message}\n`);
    return 1;
  }
}

// existing single-trace dispatch follows ↓
```

- [ ] **Step 5: Update help text**

In the `printHelp()` function in `packages/typescript/src/commands/trace.ts`, add a batch-mode subsection right after the single-trace subcommand description:

```typescript
process.stdout.write(`kweaver trace — trace diagnosis commands

Subcommands:
  trace diagnose <conversation_id>            (single trace mode; PR-B)
    --out <file>                              ...
    [...existing flags...]
    --no-artifacts                            disable per-stage artifact persistence (default: artifacts ARE written next to <out> as <stem>.artifacts/)

  trace diagnose --traces=<list> --out=<dir>  (batch mode; single agent)
    --traces=conv1,conv2,...                  comma-separated conversation_ids
    --traces=@/path/to/ids.txt                or @file with one id per line
    --out=<dir>                               required; fail-fast if missing
    --no-artifacts                            disable artifact persistence
    --max-parallel <n>                        default 4 (Sonnet rate-limit friendly)
    --rules <dir>                             override <cwd>/diagnosis-rules/
    --no-builtin                              disable the 5+1 builtin baseline rules
    --format yaml|markdown|both               default 'both'
    --lang en|zh                              default 'en'

  trace diagnose rules validate <rule.yaml>   Validate a rule yaml file (exit 0 ok, 6 fail)

Auth flags (any subcommand): --token, --base-url, --business-domain (-bd).

Batch mode constraints:
  - All --traces conv_ids must resolve to the same agent_id; mismatch → exit 2
  - --no-llm not supported in batch mode → exit 2 (use single-trace for offline)
  - Per-trace yaml on disk is the resume ground truth; rerunning a scan with
    the same --out reuses existing per-trace reports (atomic .partial → rename)
`);
```

- [ ] **Step 6: Run all tests to verify pass + no regression**

```bash
cd packages/typescript && node --import tsx --test test/trace-cli-batch.test.ts test/trace-diagnose-cli.test.ts
```

Expected: PASS for both files.

- [ ] **Step 7: Commit**

```bash
git add packages/typescript/src/commands/trace.ts \
        packages/typescript/test/trace-cli-batch.test.ts
git commit -m "feat(commands/trace): --traces batch mode dispatch + --no-artifacts + --max-parallel"
```

---

## Phase 7: E2E tests + docs (Tasks 17-18)

### Task 17: E2E suite for batch mode (10 cases from spec)

**Files:**
- Create: `packages/typescript/test/e2e/batch-happy-path.test.ts`
- Create: `packages/typescript/test/e2e/batch-single-agent-enforced.test.ts`
- Create: `packages/typescript/test/e2e/batch-resume.test.ts`
- Create: `packages/typescript/test/e2e/batch-gates-on.test.ts`
- Create: `packages/typescript/test/e2e/batch-rubric-failure.test.ts`
- Create: `packages/typescript/test/e2e/batch-no-llm-fail-fast.test.ts`
- Create: `packages/typescript/test/e2e/batch-no-out-fail-fast.test.ts`
- Create: `packages/typescript/test/e2e/batch-artifacts-emission.test.ts`
- Create: `packages/typescript/test/e2e/single-trace-artifacts-emission.test.ts`
- Create: `packages/typescript/test/e2e/artifacts-disabled.test.ts`

This task is large because spec §Testing lists 10 e2e cases. We break each into its own file for failure-isolation during dev. All ten share a small helper.

- [ ] **Step 1: Create a shared test helper**

Create `packages/typescript/test/e2e/_scan-helpers.ts`:

```typescript
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { StubAgentProvider } from "../../src/agent-providers/providers/stub.js";

export async function tmpOutDir(prefix: string): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const FIX = path.join(__dirname, "..", "fixtures/trace-diagnose");

export function mockTraceFetcher(fixtureByConvId: Map<string, unknown>): { restore: () => void; calls: string[] } {
  const orig = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const body = init?.body && typeof init.body === "string" ? JSON.parse(init.body) : {};
    // Detect conversation_id from agent-observability query shape; fixture maps by conv_id
    const convId = body?.query?.term?.["attributes.gen_ai.conversation.id.keyword"] ?? "_";
    calls.push(url);
    const fix = fixtureByConvId.get(convId) ?? { hits: { hits: [] } };
    return new Response(JSON.stringify(fix), { status: 200 });
  };
  return { restore: () => { globalThis.fetch = orig; }, calls };
}

export function stubProviderForBatch(): StubAgentProvider {
  return new StubAgentProvider({
    name: "claude-code",
    capabilities: ["structured_output"],
    responseFn: async (prompt) => {
      // Branch: cross-trace synth prompt mentions "Cross-Trace Synthesizer"
      if (/Cross-Trace Synthesizer/i.test(prompt)) {
        return {
          headline: "agent X dominated by tool_loop",
          primary_root_cause: { rule_ids: ["tool_loop_no_state_change"], description: "loop pattern", target_for_fix: "agent.prompt" },
          fix_priority: [{ rule_id: "tool_loop_no_state_change", affected_trace_count: 3, reason: "dominant" }],
          cross_rule_links: [],
        };
      }
      // Else: batched rubric. Parse the YAML traces list out of the prompt and
      // emit a verdict per traceId. (Simple regex matches "trace_id: <id>".)
      const ids = [...prompt.matchAll(/trace_id:\s+(\S+)/g)].map((m) => m[1]);
      return {
        trace_results: ids.map((id) => ({
          trace_id: id,
          category: "stale_results",
          reasoning: `rubric verdict for ${id}`,
          severity: "high",
          first_violating_step_id: "<<TO-OVERRIDE>>",   // tests should override per-fixture
          evidence_span_ids: [],
        })),
      };
    },
  });
}
```

(The "<<TO-OVERRIDE>>" placeholder is intentional — most e2e tests will replace `responseFn` with one that returns valid span_ids for their fixture. The helper provides the base shape.)

- [ ] **Step 2: batch-happy-path.test.ts**

```typescript
// packages/typescript/test/e2e/batch-happy-path.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";

import { runBatch } from "../../src/trace-ai/scan/index.js";
import { defaultRegistry } from "../../src/agent-providers/registry.js";
import { tmpOutDir, mockTraceFetcher, FIX, stubProviderForBatch } from "./_scan-helpers.js";

test("e2e batch happy-path: 3 conv_ids, single agent → 3 per-trace yaml + scan-summary.yaml + .md", async () => {
  const fixture = JSON.parse(await fs.readFile(path.join(FIX, "synthetic/tool-loop-no-state-change.json"), "utf8"));
  // All 3 conv_ids return the same fixture (same agent_id).
  const fetcher = mockTraceFetcher(new Map([
    ["conv_a", fixture],
    ["conv_b", fixture],
    ["conv_c", fixture],
  ]));
  const stub = stubProviderForBatch();
  defaultRegistry.register(stub, { setAsDefault: true });
  const out = await tmpOutDir("batch-happy");

  try {
    const result = await runBatch({
      traces: ["conv_a", "conv_b", "conv_c"],
      out,
      rulesDir: null,
      noBuiltin: false,
      noArtifacts: false,
      timeoutMs: 60000,
      maxParallel: 4,
      baseUrl: "http://mock.kweaver.test",
      token: "tk",
      businessDomain: "bd_public",
    });
    assert.equal(result.tracesDiagnosed, 3);
    assert.equal(result.tracesReused, 0);
    for (const conv of ["conv_a", "conv_b", "conv_c"]) {
      const yamlPath = path.join(out, `${conv}.yaml`);
      const exists = await fs.stat(yamlPath).then(() => true).catch(() => false);
      assert.ok(exists, `expected ${conv}.yaml`);
    }
    const summary = yaml.load(await fs.readFile(path.join(out, "scan-summary.yaml"), "utf8")) as Record<string, unknown>;
    assert.equal((summary as { schema_version: string }).schema_version, "scan-summary/v1");
  } finally {
    fetcher.restore();
    defaultRegistry.unregister?.("claude-code");
    await fs.rm(out, { recursive: true, force: true });
  }
});
```

- [ ] **Step 3: batch-single-agent-enforced.test.ts**

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { runBatch } from "../../src/trace-ai/scan/index.js";
import { SingleAgentValidationError } from "../../src/trace-ai/scan/single-agent-validator.js";
import { tmpOutDir, mockTraceFetcher } from "./_scan-helpers.js";

test("e2e batch enforces single agent: conv_a→agent_A, conv_b→agent_B → throws SingleAgentValidationError", async () => {
  const fxA = { hits: { hits: [{ _source: { spanId: "r", parentSpanId: null, attributes: { "gen_ai.agent.id": "agent_A" }, status: { code: "OK" }, name: "x", startTimeUnixNano: "0", endTimeUnixNano: "1" } }] } };
  const fxB = { hits: { hits: [{ _source: { spanId: "r", parentSpanId: null, attributes: { "gen_ai.agent.id": "agent_B" }, status: { code: "OK" }, name: "x", startTimeUnixNano: "0", endTimeUnixNano: "1" } }] } };
  const fetcher = mockTraceFetcher(new Map([["conv_a", fxA], ["conv_b", fxB]]));
  const out = await tmpOutDir("batch-mixed");

  try {
    await assert.rejects(
      () => runBatch({
        traces: ["conv_a", "conv_b"],
        out, rulesDir: null, noBuiltin: false, noArtifacts: true,
        timeoutMs: 60000, maxParallel: 4,
        baseUrl: "http://mock.kweaver.test", token: "tk", businessDomain: "bd_public",
      }),
      (e: unknown) => e instanceof SingleAgentValidationError && (e as SingleAgentValidationError).code === "mixed",
    );
    const partialExists = await fs.stat(`${out}/conv_a.yaml`).then(() => true).catch(() => false);
    assert.equal(partialExists, false, "must not write any per-trace yaml when single-agent validation fails");
  } finally {
    fetcher.restore();
    await fs.rm(out, { recursive: true, force: true });
  }
});
```

- [ ] **Step 4: batch-resume.test.ts, batch-gates-on.test.ts, batch-rubric-failure.test.ts**

(Each follows the same pattern: mock fetch, register stub provider, call runBatch, assert specific behavior. Code blocks are mechanical — pattern identical to the two above.)

**batch-resume**: pre-write 2 of 5 conv_id yaml files. After runBatch, assert tracesReused=2, tracesFreshlyDiagnosed=3, scan-summary.scan.resumed_from_partial=true.

**batch-gates-on**: load rules from a temp dir that contains a rubric with `gates_on: [tool_loop_no_state_change]`. Half the fixture traces fire that symbolic rule; half don't. Assert the rubric stub provider receives only the gated-in trace_ids in its prompt; ungated traces have no rubric Finding in their final yaml.

**batch-rubric-failure**: stub provider throws on the Stage-2 LLM call for one chunk. Assert affected trace_ids show `run.rules_skipped[].reason = agent-error:transport`; scan-summary still emits; aggregates only counts non-skipped findings.

- [ ] **Step 5: batch-no-llm-fail-fast.test.ts + batch-no-out-fail-fast.test.ts**

These exercise the CLI path (`runTraceCommand`) rather than `runBatch` directly:

```typescript
import test from "node:test";
import assert from "node:assert/strict";

import { runTraceCommand } from "../../src/commands/trace.js";

test("e2e CLI: --traces with --no-llm → exit 2 + stderr message", async () => {
  const origWrite = process.stderr.write.bind(process.stderr);
  let captured = "";
  process.stderr.write = (s: unknown) => { captured += String(s); return true; };
  try {
    const code = await runTraceCommand(["diagnose", "--traces=conv_a", "--no-llm", "--out=/tmp/x"]);
    assert.equal(code, 2);
    assert.match(captured, /does not support --no-llm/);
  } finally {
    process.stderr.write = origWrite;
  }
});

test("e2e CLI: --traces without --out → exit 2 + stderr message", async () => {
  const origWrite = process.stderr.write.bind(process.stderr);
  let captured = "";
  process.stderr.write = (s: unknown) => { captured += String(s); return true; };
  try {
    const code = await runTraceCommand(["diagnose", "--traces=conv_a"]);
    assert.equal(code, 2);
    assert.match(captured, /requires --out/);
  } finally {
    process.stderr.write = origWrite;
  }
});
```

- [ ] **Step 6: batch-artifacts-emission.test.ts**

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { runBatch } from "../../src/trace-ai/scan/index.js";
import { defaultRegistry } from "../../src/agent-providers/registry.js";
import { tmpOutDir, mockTraceFetcher, FIX, stubProviderForBatch } from "./_scan-helpers.js";

test("e2e batch artifacts: all 5 categories of artifact files emitted under <out>/artifacts/", async () => {
  const fixture = JSON.parse(await fs.readFile(path.join(FIX, "synthetic/tool-loop-no-state-change.json"), "utf8"));
  const fetcher = mockTraceFetcher(new Map([["conv_a", fixture]]));
  const stub = stubProviderForBatch();
  defaultRegistry.register(stub, { setAsDefault: true });
  const out = await tmpOutDir("batch-art");
  try {
    await runBatch({ traces: ["conv_a"], out, rulesDir: null, noBuiltin: false, noArtifacts: false, timeoutMs: 60000, maxParallel: 4, baseUrl: "http://x", token: "tk", businessDomain: "bd_public" });
    const aBase = path.join(out, "artifacts");
    assert.ok(await fs.stat(path.join(aBase, "run-metadata.json")).then(() => true).catch(() => false), "run-metadata.json");
    // stage-2-rubric/<rule_id>/chunk-000.* if rubric ran (depends on gates_on / sample fixture)
    // stage-4-cross-trace-synth/aggregates.json + samples.json + prompt.md + response.json
    for (const f of ["aggregates.json", "samples.json", "prompt.md", "response.json"]) {
      assert.ok(await fs.stat(path.join(aBase, "stage-4-cross-trace-synth", f)).then(() => true).catch(() => false), `stage-4 ${f}`);
    }
  } finally {
    fetcher.restore();
    defaultRegistry.unregister?.("claude-code");
    await fs.rm(out, { recursive: true, force: true });
  }
});
```

- [ ] **Step 7: single-trace-artifacts-emission.test.ts**

(Already drafted in Task 5 step 1 — promote that test from `test/diagnose-single-trace-artifacts.test.ts` into `test/e2e/single-trace-artifacts-emission.test.ts` and ensure it remains green.)

- [ ] **Step 8: artifacts-disabled.test.ts**

```typescript
test("e2e artifacts disabled: --no-artifacts (noArtifacts=true) → no artifacts/ dir in either mode", async () => {
  // Tests both batch and single-trace with noArtifacts=true; asserts no
  // artifacts directory is created. Reports still written.
  /* implementation mirrors batch-artifacts-emission.test.ts above but flips
     noArtifacts to true and asserts NEGATIVE existence */
});
```

- [ ] **Step 9: Run full e2e suite to verify pass**

```bash
cd packages/typescript && npm run build && node --import tsx --test test/e2e/batch-*.test.ts test/e2e/single-trace-artifacts-emission.test.ts test/e2e/artifacts-disabled.test.ts
```

Expected: PASS for all 10 e2e tests.

- [ ] **Step 10: Commit**

```bash
git add packages/typescript/test/e2e/_scan-helpers.ts \
        packages/typescript/test/e2e/batch-*.test.ts \
        packages/typescript/test/e2e/single-trace-artifacts-emission.test.ts \
        packages/typescript/test/e2e/artifacts-disabled.test.ts
git commit -m "test(scan): 10 e2e cases — happy path / single-agent / resume / gates_on / failure / fail-fast / artifacts"
```

---

### Task 18: Documentation sync

**Files:**
- Modify: `packages/typescript/skills/kweaver-core/references/trace.md` (or wherever the existing trace skill ref lives)
- Modify: `README.md` and `README.zh.md` (command summary table)

- [ ] **Step 1: Update trace.md skill reference**

In `skills/kweaver-core/references/trace.md`, add a new section after the single-trace synopsis:

```markdown
## Batch mode (single agent)

```bash
kweaver trace diagnose --traces=<list> --out=<dir> [flags]
  --traces=conv1,conv2,...   # comma-separated conversation_ids
  --traces=@file.txt          # or @file with one id per line
  --out=<dir>                 # REQUIRED in batch mode
```

Walks N traces (must all belong to one agent_id; mismatch → exit 2)
through Stage-1 symbolic + batched Stage-2 rubric + Stage-3 template +
Stage-4 cross-trace synthesizer. Emits per-trace yaml/md + scan-summary
yaml/md.

LLM budget: 100-trace batch with B-mode gating → ~5 LLM calls (4 fast +
1 std). `--no-llm` not supported (cross-trace synth requires LLM).

### Artifacts

Default-on (`--no-artifacts` to opt out). Layout:
- `<out>/artifacts/run-metadata.json` — CLI args, timing, LLM call counts, cost estimate
- `<out>/artifacts/stage-2-rubric/<rule_id>/chunk-NNN.{prompt.md,response.json,parse-errors.json}` — Stage-2 LLM I/O per chunk
- `<out>/artifacts/stage-4-cross-trace-synth/{aggregates.json, samples.json, prompt.md, response.json}` — Stage-4 inputs + LLM I/O

Single-trace mode mirrors: `<stem>.artifacts/` sibling to the report file.

### Resume

Per-trace yaml on disk = ground truth. Rerunning with the same `--out`
skips conv_ids whose `<conv_id>.yaml` is already valid; recomputes the
rest plus Stage-4 + scan-summary.
```

- [ ] **Step 2: Update README command summary**

In `README.md` (English), find the existing `kweaver trace diagnose ...` line and amend / append:

```markdown
kweaver trace diagnose <conversation_id> [flags]      # single trace
kweaver trace diagnose --traces=<list> --out=<dir>    # batch (single agent)
kweaver trace diagnose rules validate <rule.yaml>     # validate a rule
```

Mirror in `README.zh.md`.

- [ ] **Step 3: Commit**

```bash
git add skills/kweaver-core/references/trace.md README.md README.zh.md
git commit -m "docs: trace batch mode + artifacts in skill ref + README"
```

---

## Self-Review Checklist (engineer runs before opening PR)

- [ ] All 18 tasks committed; `git log --oneline feature/120-trace-diagnose-prb-rubric..HEAD` shows 18+ commits
- [ ] Full suite: `cd packages/typescript && npm run build && node --import tsx --test test/*.test.ts test/e2e/*.test.ts` → 0 fail
- [ ] On 62 environment: `kweaver trace diagnose --traces=01KRCW...,01KR5DS... --out=/tmp/batch-62 -bd http://192.168.40.62` writes per-trace + scan-summary + artifacts; single-agent enforced on real data
- [ ] On 62 environment: `kweaver trace diagnose --traces=conv_a_from_agent_X,conv_b_from_agent_Y --out=/tmp/bad -bd http://192.168.40.62` exits 2 with mismatch report
- [ ] On 62 environment: `kweaver trace diagnose 01KRCW... --out=/tmp/single.yaml -bd http://192.168.40.62` writes `/tmp/single.artifacts/` with stage-2 + stage-3-synth artifacts
- [ ] `gh pr create --base main` against feature/120 not main (so PR-C stacks on PR-B until #122 merges)

## Plan Self-Review (writing-plans skill check)

- **Spec coverage**: All 17 spec decisions (1-17) covered by Tasks 1-18. Decision-to-task mapping:
  - #1 (single trace source) → Task 6 + 15 (no time-scan adapter created)
  - #2 (single-agent invariant) → Task 7 + 15
  - #3 (Stage-2 batched) → Task 11
  - #4 (Stage-3 template in batch) → Task 15 (uses PR-B's templateSynthesize)
  - #5 (gates_on field) → Task 2 + 15
  - #6 (single-trace ignores gates_on) → Task 5 (PR-B's evaluateRubricRules unchanged in single mode)
  - #7 (tier abstraction) → Task 1
  - #8 (scan-summary schema) → Task 8 + 13
  - #9 (--no-llm fail-fast in batch) → Task 16
  - #10 (--out required in batch) → Task 16
  - #11 (cross-trace synth input) → Task 9 + 10 + 12
  - #12 (sampler discipline) → Task 10
  - #13 (resume semantics) → Task 14
  - #14 (LLM I/O formats) → Task 11 + 12 (YAML in, JSON out)
  - #15 (failure granularity) → Task 11 (per-item schema validation in batched-rubric)
  - #16 (artifacts default-on) → Task 3 + 4 + 5 + 11 + 12 + 15
  - #17 (single-trace artifact alignment) → Task 5
- **Placeholders**: scan complete. The plan contains 2 deliberate omissions documented inline:
  - Task 17 step 4 (batch-resume / batch-gates-on / batch-rubric-failure) — pattern is repetitive; full code blocks would 5× this plan's size. Each test follows the same scaffold as batch-happy-path / batch-single-agent-enforced.
  - Task 17 step 8 (artifacts-disabled) — symmetric to step 6, just flipping noArtifacts.
  If an engineer needs verbatim code, Task 17 step 2-3 give the template.
- **Type consistency**: `tier` / `gates_on` / `noArtifacts` / `maxParallel` / `RunBatchOpts` / `ScanSummary` / `ArtifactWriter` consistent across Tasks 1-17.

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-12-m4-diagnose-issue2-scan.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
