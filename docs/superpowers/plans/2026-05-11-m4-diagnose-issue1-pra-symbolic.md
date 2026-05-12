# M4 Trace Diagnose — Issue #1 PR-A (Symbolic) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the symbolic-only path of `kweaver trace diagnose <trace_id>` — 5 builtin rules detect mechanical antipatterns over a single trace; output is a `trace-diagnose-report/v1` YAML; `--no-llm` deterministic-only path. Rubric / agent / synthesizer (LLM-driven) are PR-B.

**Architecture:** New top-level subtree `packages/typescript/src/trace-ai/diagnose/`. CLI command `commands/trace.ts` dispatches `diagnose <trace_id>` and `diagnose rules validate <path>`. B1 minimal API client (`api/trace.ts`) reuses `POST /api/trace-ai/_search` with a `traceId` term query. Rule loader merges `builtin/` (ships with CLI) and `<cwd>/diagnosis-rules/` (team-supplied), conflict = fail-fast. Signal-probe runs predicates on an in-memory `TraceTree`. Report-assembler renders templates and emits YAML. Synthesizer for PR-A is the deterministic template fallback only (`run.synthesizer_mode: 'template'`).

**Tech Stack:** TypeScript (strict), Node native test runner (`node:test` + `node:assert/strict`), `zod` for schemas, `js-yaml` for YAML parsing, `yargs` (already present) for subcommand args. No LLM SDKs in PR-A.

**Spec reference:** `docs/superpowers/specs/2026-05-11-m4-diagnose-issue1-design.md`
**Tracking issue:** [kweaver-ai/kweaver-sdk#120](https://github.com/kweaver-ai/kweaver-sdk/issues/120)

---

## File Structure

| Path | Action | Responsibility |
|------|--------|----------------|
| `packages/typescript/package.json` | MODIFY | Add `zod` + `js-yaml` deps; add `@types/js-yaml` devDep |
| `packages/typescript/src/trace-ai/diagnose/types.ts` | CREATE | `Span`, `TraceTree`, `Hit`, `Predicate`, `Rule`, `Finding`, `Summary`, `Report` |
| `packages/typescript/src/trace-ai/diagnose/schemas.ts` | CREATE | zod schemas: `RuleSchema` (`diagnosis-rule/v1`), `ReportSchema` (`trace-diagnose-report/v1`), helpers |
| `packages/typescript/src/trace-ai/diagnose/trace-shaper.ts` | CREATE | `assembleTraceTree(spans)` → `TraceTree` with `byId`, `parentToChildren`, `byKind` indexes |
| `packages/typescript/src/api/trace.ts` | CREATE | `getTraceById(opts)` — POST `_search` with `traceId` term; returns spans[] |
| `packages/typescript/src/trace-ai/diagnose/predicate-registry.ts` | CREATE | `registerPredicate`, `resolvePredicate` for `builtin:<name>` references |
| `packages/typescript/src/trace-ai/diagnose/rule-loader.ts` | CREATE | Load builtin yamls + `<dir>/diagnosis-rules/*.yaml`, validate via `RuleSchema`, resolve predicate refs, detect name conflicts |
| `packages/typescript/src/trace-ai/diagnose/signal-probe.ts` | CREATE | `runRules(rules, tree)` — iterate rules, call predicates, collect `Hit[]` per rule |
| `packages/typescript/src/trace-ai/diagnose/synthesizer-template.ts` | CREATE | Deterministic `templateSynthesize(findings)` → `Summary`. PR-A only emits this mode. |
| `packages/typescript/src/trace-ai/diagnose/report-assembler.ts` | CREATE | `assembleReport({trace, run, summary, findings, hits, rules})` — render templates, build `Finding[]`, validate, return `Report` |
| `packages/typescript/src/trace-ai/diagnose/index.ts` | CREATE | `diagnose(traceId, opts)` — wire B1 → shaper → loader → probe → synthesizer → assembler → write YAML |
| `packages/typescript/src/trace-ai/diagnose/builtin-rules/tool-loop-no-state-change.{yaml,ts}` | CREATE | Rule #1: same tool, same args, no state change ≥ 3× |
| `packages/typescript/src/trace-ai/diagnose/builtin-rules/tool-error-swallowed.{yaml,ts}` | CREATE | Rule #2: tool status=error, next LLM prompt lacks error |
| `packages/typescript/src/trace-ai/diagnose/builtin-rules/retrieval-empty-no-fallback.{yaml,ts}` | CREATE | Rule #3: retrieval result_count=0, no retry/rewrite/fallback |
| `packages/typescript/src/trace-ai/diagnose/builtin-rules/llm-response-truncated-no-continue.{yaml,ts}` | CREATE | Rule #4: LLM finish_reason=length, no continuation span |
| `packages/typescript/src/trace-ai/diagnose/builtin-rules/excessive-tool-calls-per-turn.{yaml,ts}` | CREATE | Rule #5: tool count per user turn > threshold |
| `packages/typescript/src/commands/trace.ts` | CREATE | `runTraceCommand(rest)` — yargs dispatch: `diagnose <id>` / `diagnose rules validate <path>` |
| `packages/typescript/src/cli.ts` | MODIFY | Add `if (command === "trace") return runTraceCommand(rest)`; update `printHelp()` |
| `packages/typescript/test/trace-shaper.test.ts` | CREATE | Unit tests for tree assembly + indexes |
| `packages/typescript/test/trace-api.test.ts` | CREATE | B1 unit tests via `mockFetchSequence` |
| `packages/typescript/test/predicate-registry.test.ts` | CREATE | Register/resolve/missing-name tests |
| `packages/typescript/test/rule-loader.test.ts` | CREATE | Loader merge / conflict / unknown predicate / schema fail tests |
| `packages/typescript/test/signal-probe.test.ts` | CREATE | Predicate orchestration tests |
| `packages/typescript/test/synthesizer-template.test.ts` | CREATE | Empty / single / multi-finding template summary tests |
| `packages/typescript/test/report-assembler.test.ts` | CREATE | Finding rendering + summary assembly + schema validate tests |
| `packages/typescript/test/builtin-rule-tool-loop-no-state-change.test.ts` | CREATE | Predicate unit test for rule #1 |
| `packages/typescript/test/builtin-rule-tool-error-swallowed.test.ts` | CREATE | Predicate unit test for rule #2 |
| `packages/typescript/test/builtin-rule-retrieval-empty-no-fallback.test.ts` | CREATE | Predicate unit test for rule #3 |
| `packages/typescript/test/builtin-rule-llm-response-truncated.test.ts` | CREATE | Predicate unit test for rule #4 |
| `packages/typescript/test/builtin-rule-excessive-tool-calls.test.ts` | CREATE | Predicate unit test for rule #5 |
| `packages/typescript/test/trace-diagnose-cli.test.ts` | CREATE | `commands/trace.ts` argv parsing + dispatch |
| `packages/typescript/test/trace-diagnose-rules-validate.test.ts` | CREATE | `rules validate` exit-code + error message tests |
| `packages/typescript/test/e2e/trace-diagnose.test.ts` | CREATE | E2E: 5 synthetic fixtures + 1 real fixture, full pipe via `mockFetchSequence` |
| `packages/typescript/test/fixtures/trace-diagnose/synthetic/<rule_id>.json` | CREATE × 5 | Hand-built minimal `_search` responses, one per rule |
| `packages/typescript/test/fixtures/trace-diagnose/real/de39cbe9.json` | CREATE | Snapshot from `plan-traceai/status_quo/附录-完整trace样本/01_raw_opensearch_response.json` |
| `packages/typescript/skills/kweaver-core/references/trace.md` | CREATE | Reference doc per AGENTS.md sync requirement |
| `packages/typescript/README.md` | MODIFY | Add `trace diagnose` to command summary |

**Builtin rules note (deviation from spec wording):** spec shows `<rule_id>.yaml + .ts` for each builtin rule and "yaml is the user-facing contract." We follow spec literally — yaml ships in `builtin-rules/` and is loaded by the same `rule-loader` path that handles team yaml under `<cwd>/diagnosis-rules/`. The TS file exports only the predicate function, registered into `predicate-registry` by name. This keeps builtin and team rules symmetric.

---

## Task 1: Add `zod` and `js-yaml` Dependencies

**Files:**
- Modify: `packages/typescript/package.json`

- [ ] **Step 1: Inspect current dependencies**

Run: `cat packages/typescript/package.json | grep -A 20 '"dependencies"'`
Expected: see existing deps (yargs, react, ink, etc.); no `zod`, no `js-yaml`.

- [ ] **Step 2: Add deps via npm**

Run from repo root:
```bash
cd packages/typescript && npm install zod js-yaml && npm install --save-dev @types/js-yaml
```

Expected: `zod` and `js-yaml` appear in `dependencies`; `@types/js-yaml` in `devDependencies`. `package-lock.json` updated.

- [ ] **Step 3: Verify pin and run lint**

Run:
```bash
cd packages/typescript && npm run lint
```

Expected: no TypeScript errors. (Lint touches the whole project; the new deps don't break anything yet because nothing imports them.)

- [ ] **Step 4: Verify existing tests still pass**

Run:
```bash
cd packages/typescript && npm test
```

Expected: existing tests pass unchanged.

- [ ] **Step 5: Commit**

```bash
git add packages/typescript/package.json packages/typescript/package-lock.json
git commit -m "chore(deps): add zod + js-yaml for trace diagnose"
```

---

## Task 2: Define Core Types

**Files:**
- Create: `packages/typescript/src/trace-ai/diagnose/types.ts`

This file defines all shared types. No tests yet — types are exercised by every later test.

- [ ] **Step 1: Create the types file**

Create `packages/typescript/src/trace-ai/diagnose/types.ts`:

```typescript
// Trace-shape types (built from the OpenSearch _search response).
export interface SpanAttributes {
  [key: string]: unknown;
}

export interface Span {
  spanId: string;
  parentSpanId: string | null;
  name: string;
  kind: SpanKind;                    // derived from agent.trace.type or attributes
  startTimeUnixNano: string;         // string per OTel spec
  endTimeUnixNano: string;
  durationMs: number;                // computed from start/end
  status: 'ok' | 'error' | 'unset';
  attributes: SpanAttributes;
}

export type SpanKind = 'tool' | 'llm' | 'retrieval' | 'reasoning' | 'unknown';

export interface TraceTree {
  traceId: string;
  spans: Span[];
  byId: Map<string, Span>;
  parentToChildren: Map<string | null, Span[]>;  // null key = roots
  byKind: Map<SpanKind, Span[]>;
  root: Span | null;
}

// Rule + predicate types (rules loaded from yaml; predicates from TS modules).
export interface RuleTaxonomy {
  signalsAxis: 'interaction' | 'execution' | 'environment';
  msClass:
    | 'retry_loop'
    | 'tool_misuse'
    | 'context_loss'
    | 'goal_drift'
    | 'cascading_error'
    | 'silent_quality_degradation';
}

export interface Rule {
  schemaVersion: 'diagnosis-rule/v1';
  id: string;
  severity: 'low' | 'medium' | 'high';
  symptom: string;
  taxonomy: RuleTaxonomy;
  suggestedFix: { target: string; changeTemplate: string };
  verifyWith: { assertionTemplates: string[] };
  predicateRef: string;              // e.g. 'builtin:tool_loop_no_state_change' (PR-A: predicate only; rubric in PR-B)
  params: Record<string, unknown>;
  sourcePath: string;                // for conflict reporting
}

export interface Hit {
  evidenceSpans: string[];
  excerpt: string;
  bindings: Record<string, unknown>; // template vars for changeTemplate / assertionTemplates
}

export type Predicate = (trace: TraceTree, params: Record<string, unknown>) => Hit[];

// Report types (output schema 'trace-diagnose-report/v1' — PR-A subset).
export interface Finding {
  ruleId: string;
  judgmentKind: 'symbolic';          // PR-A is symbolic-only; PR-B adds 'rubric'
  severity: 'low' | 'medium' | 'high';
  symptom: string;
  likelyCause: string;               // PR-A: copied from rule.symptom (no LLM); PR-B: agent-supplied
  evidence: { spans: string[]; excerpt: string };
  suggestedFix: { target: string; change: string };
  confidence: 'low';                 // symbolic always low
  verifyWith: {
    suggestedEvalCase: {
      queryId: string | null;
      query: string | null;
      assertions: string[];
    };
  };
}

export interface SummaryRootCause {
  findingIds: number[];
  description: string;
  targetForFix: string;
}

export interface SummaryFixPriority { findingId: number; reason: string; }
export interface SummaryCrossLink { findingIds: number[]; relation: string; }

export interface Summary {
  headline: string;
  primaryRootCause: SummaryRootCause | null;
  fixPriority: SummaryFixPriority[];
  crossFindingLinks: SummaryCrossLink[];
}

export interface Report {
  schemaVersion: 'trace-diagnose-report/v1';
  trace: { traceId: string; agentId: string | null; tenant: string | null };
  run: {
    diagnosedAt: string;             // ISO8601
    cliVersion: string;
    mode: 'symbolic-only';           // PR-A only ships this mode; PR-B adds 'rubric-only' | 'hybrid'
    rulesApplied: string[];
    rulesSkipped: { ruleId: string; reason: string }[];
    synthesizerMode: 'template';     // PR-A only ships template; PR-B adds 'agent'
  };
  summary: Summary;
  findings: Finding[];
}

// Diagnose CLI options (consumed by index.ts entrypoint).
export interface DiagnoseOpts {
  out: string | null;                // null = stdout
  rulesDir: string | null;           // override <cwd>/diagnosis-rules/
  noBuiltin: boolean;
  noLlm: true;                       // PR-A: forced true (no LLM at all)
  agentProvider: string | null;
  timeoutMs: number;
  baseUrl: string;
  token: string;
  businessDomain: string;
}
```

- [ ] **Step 2: Verify it compiles**

Run:
```bash
cd packages/typescript && npm run lint
```

Expected: clean compile (file is exports-only; no usage yet, so no errors expected).

- [ ] **Step 3: Commit**

```bash
git add packages/typescript/src/trace-ai/diagnose/types.ts
git commit -m "feat(trace-diagnose): define core types"
```

---

## Task 3: Define zod Schemas

**Files:**
- Create: `packages/typescript/src/trace-ai/diagnose/schemas.ts`
- Test: `packages/typescript/test/trace-diagnose-schemas.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/typescript/test/trace-diagnose-schemas.test.ts`:

```typescript
import test from "node:test";
import assert from "node:assert/strict";

import { RuleSchema, ReportSchema } from "../src/trace-ai/diagnose/schemas.js";

test("RuleSchema accepts a minimal valid symbolic rule", () => {
  const ok = RuleSchema.safeParse({
    schema_version: "diagnosis-rule/v1",
    id: "tool_loop_no_state_change",
    severity: "high",
    symptom: "repeated_tool_call_without_state_change",
    taxonomy: { signals_axis: "execution", ms_class: "retry_loop" },
    suggested_fix: { target: "decision_agent.prompt", change_template: "add stop condition" },
    verify_with: { assertion_templates: ["tool_call_count(retrieval) <= 2"] },
    predicate: "builtin:tool_loop_no_state_change",
    params: { min_consecutive: 3 },
  });
  assert.equal(ok.success, true);
});

test("RuleSchema rejects a rule missing taxonomy", () => {
  const bad = RuleSchema.safeParse({
    schema_version: "diagnosis-rule/v1",
    id: "rule_x",
    severity: "high",
    symptom: "s",
    suggested_fix: { target: "t", change_template: "c" },
    verify_with: { assertion_templates: [] },
    predicate: "builtin:x",
  });
  assert.equal(bad.success, false);
});

test("RuleSchema rejects a rule with neither predicate nor rubric", () => {
  const bad = RuleSchema.safeParse({
    schema_version: "diagnosis-rule/v1",
    id: "rule_x",
    severity: "high",
    symptom: "s",
    taxonomy: { signals_axis: "execution", ms_class: "retry_loop" },
    suggested_fix: { target: "t", change_template: "c" },
    verify_with: { assertion_templates: [] },
  });
  assert.equal(bad.success, false);
});

test("ReportSchema accepts a minimal symbolic-only report", () => {
  const ok = ReportSchema.safeParse({
    schema_version: "trace-diagnose-report/v1",
    trace: { trace_id: "tr_x", agent_id: null, tenant: null },
    run: {
      diagnosed_at: "2026-05-11T10:00:00Z",
      cli_version: "0.7.4",
      mode: "symbolic-only",
      rules_applied: ["tool_loop_no_state_change"],
      rules_skipped: [],
      synthesizer_mode: "template",
    },
    summary: {
      headline: "see findings[0]",
      primary_root_cause: null,
      fix_priority: [],
      cross_finding_links: [],
    },
    findings: [],
  });
  assert.equal(ok.success, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/typescript && node --import tsx --test test/trace-diagnose-schemas.test.ts`
Expected: FAIL with import error (`schemas.js` does not exist).

- [ ] **Step 3: Implement the schemas**

Create `packages/typescript/src/trace-ai/diagnose/schemas.ts`:

```typescript
import { z } from "zod";

const TaxonomySchema = z.object({
  signals_axis: z.enum(["interaction", "execution", "environment"]),
  ms_class: z.enum([
    "retry_loop",
    "tool_misuse",
    "context_loss",
    "goal_drift",
    "cascading_error",
    "silent_quality_degradation",
  ]),
});

const SuggestedFixSchema = z.object({
  target: z.string().min(1),
  change_template: z.string().min(1),
});

const VerifyWithSchema = z.object({
  assertion_templates: z.array(z.string()).default([]),
});

// PR-A: only `predicate` branch (rubric XOR enforced in PR-B).
// We still encode the XOR shape so PR-B can enable rubric without breaking parsers.
export const RuleSchema = z
  .object({
    schema_version: z.literal("diagnosis-rule/v1"),
    id: z.string().regex(/^[a-z][a-z0-9_]*$/),
    severity: z.enum(["low", "medium", "high"]),
    symptom: z.string().min(1),
    taxonomy: TaxonomySchema,
    suggested_fix: SuggestedFixSchema,
    verify_with: VerifyWithSchema,
    predicate: z.string().regex(/^builtin:[a-z][a-z0-9_]*$/).optional(),
    rubric: z.unknown().optional(),  // PR-B will define a real schema
    params: z.record(z.string(), z.unknown()).default({}),
  })
  .refine(
    (r) => Boolean(r.predicate) !== Boolean(r.rubric),
    { message: "exactly one of `predicate` or `rubric` must be present" },
  );

export type RuleYaml = z.infer<typeof RuleSchema>;

const FindingSchema = z.object({
  rule_id: z.string(),
  judgment_kind: z.enum(["symbolic"]),  // PR-B will add "rubric"
  severity: z.enum(["low", "medium", "high"]),
  symptom: z.string(),
  likely_cause: z.string(),
  evidence: z.object({
    spans: z.array(z.string()),
    excerpt: z.string(),
  }),
  suggested_fix: z.object({
    target: z.string(),
    change: z.string(),
  }),
  confidence: z.literal("low"),
  verify_with: z.object({
    suggested_eval_case: z.object({
      query_id: z.string().nullable(),
      query: z.string().nullable(),
      assertions: z.array(z.string()),
    }),
  }),
});

const SummarySchema = z.object({
  headline: z.string().max(160),
  primary_root_cause: z
    .object({
      finding_ids: z.array(z.number().int().nonnegative()).min(1),
      description: z.string(),
      target_for_fix: z.string(),
    })
    .nullable(),
  fix_priority: z.array(
    z.object({
      finding_id: z.number().int().nonnegative(),
      reason: z.string(),
    }),
  ),
  cross_finding_links: z.array(
    z.object({
      finding_ids: z.array(z.number().int().nonnegative()).min(2),
      relation: z.string(),
    }),
  ),
});

export const ReportSchema = z.object({
  schema_version: z.literal("trace-diagnose-report/v1"),
  trace: z.object({
    trace_id: z.string(),
    agent_id: z.string().nullable(),
    tenant: z.string().nullable(),
  }),
  run: z.object({
    diagnosed_at: z.string(),
    cli_version: z.string(),
    mode: z.enum(["symbolic-only", "rubric-only", "hybrid"]),
    rules_applied: z.array(z.string()),
    rules_skipped: z.array(
      z.object({ rule_id: z.string(), reason: z.string() }),
    ),
    synthesizer_mode: z.enum(["template", "agent"]),
  }),
  summary: SummarySchema,
  findings: z.array(FindingSchema),
});

export type ReportYaml = z.infer<typeof ReportSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/typescript && node --import tsx --test test/trace-diagnose-schemas.test.ts`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/typescript/src/trace-ai/diagnose/schemas.ts packages/typescript/test/trace-diagnose-schemas.test.ts
git commit -m "feat(trace-diagnose): zod schemas for rule and report v1"
```

---

## Task 4: Trace Shaper (spans → tree)

**Files:**
- Create: `packages/typescript/src/trace-ai/diagnose/trace-shaper.ts`
- Test: `packages/typescript/test/trace-shaper.test.ts`

The shaper takes the raw `_source` array from a `_search` response and produces a `TraceTree` with indexes. The OTel attribute `agent.trace.type` (one of `model | tool | retrieval | reasoning`) is mapped to our `SpanKind`.

- [ ] **Step 1: Write the failing test**

Create `packages/typescript/test/trace-shaper.test.ts`:

```typescript
import test from "node:test";
import assert from "node:assert/strict";

import { assembleTraceTree } from "../src/trace-ai/diagnose/trace-shaper.js";

const baseSpan = (id: string, parent: string | null, attrs: Record<string, unknown> = {}) => ({
  spanId: id,
  parentSpanId: parent,
  name: `span-${id}`,
  startTimeUnixNano: "1700000000000000000",
  endTimeUnixNano: "1700000000010000000",
  status: { code: "OK" },
  attributes: attrs,
});

test("assembleTraceTree builds parent/child index from flat spans", () => {
  const spans = [
    baseSpan("a", null),
    baseSpan("b", "a"),
    baseSpan("c", "a"),
    baseSpan("d", "b"),
  ];
  const tree = assembleTraceTree("tr_1", spans);
  assert.equal(tree.spans.length, 4);
  assert.equal(tree.root?.spanId, "a");
  assert.equal(tree.parentToChildren.get("a")?.length, 2);
  assert.equal(tree.parentToChildren.get("b")?.length, 1);
});

test("assembleTraceTree maps agent.trace.type to SpanKind", () => {
  const spans = [
    baseSpan("a", null, { "agent.trace.type": "model" }),
    baseSpan("b", "a", { "agent.trace.type": "tool" }),
    baseSpan("c", "a", { "agent.trace.type": "retrieval" }),
    baseSpan("d", "a", {}),  // unknown
  ];
  const tree = assembleTraceTree("tr_1", spans);
  assert.equal(tree.byKind.get("llm")?.length, 1);
  assert.equal(tree.byKind.get("tool")?.length, 1);
  assert.equal(tree.byKind.get("retrieval")?.length, 1);
  assert.equal(tree.byKind.get("unknown")?.length, 1);
});

test("assembleTraceTree computes durationMs from start/end nano", () => {
  const tree = assembleTraceTree("tr_1", [baseSpan("a", null)]);
  assert.equal(tree.byId.get("a")?.durationMs, 10);
});

test("assembleTraceTree handles empty span list", () => {
  const tree = assembleTraceTree("tr_1", []);
  assert.equal(tree.spans.length, 0);
  assert.equal(tree.root, null);
});

test("assembleTraceTree maps OTel status code to status field", () => {
  const ok = baseSpan("a", null);
  ok.status = { code: "OK" };
  const err = baseSpan("b", "a");
  err.status = { code: "ERROR" };
  const unset = baseSpan("c", "a");
  unset.status = { code: "UNSET" };
  const tree = assembleTraceTree("tr_1", [ok, err, unset]);
  assert.equal(tree.byId.get("a")?.status, "ok");
  assert.equal(tree.byId.get("b")?.status, "error");
  assert.equal(tree.byId.get("c")?.status, "unset");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/typescript && node --import tsx --test test/trace-shaper.test.ts`
Expected: FAIL — `trace-shaper.js` does not exist.

- [ ] **Step 3: Implement the shaper**

Create `packages/typescript/src/trace-ai/diagnose/trace-shaper.ts`:

```typescript
import type { Span, SpanKind, TraceTree } from "./types.js";

interface RawSpan {
  spanId: string;
  parentSpanId: string | null | undefined;
  name?: string;
  startTimeUnixNano?: string;
  endTimeUnixNano?: string;
  status?: { code?: string };
  attributes?: Record<string, unknown>;
}

const KIND_MAP: Record<string, SpanKind> = {
  model: "llm",
  llm: "llm",
  tool: "tool",
  retrieval: "retrieval",
  reasoning: "reasoning",
};

function deriveKind(attrs: Record<string, unknown>): SpanKind {
  const t = attrs["agent.trace.type"];
  if (typeof t === "string" && t in KIND_MAP) return KIND_MAP[t];
  return "unknown";
}

function deriveStatus(raw: RawSpan["status"]): "ok" | "error" | "unset" {
  const code = raw?.code?.toUpperCase();
  if (code === "OK") return "ok";
  if (code === "ERROR") return "error";
  return "unset";
}

function durationMs(start?: string, end?: string): number {
  if (!start || !end) return 0;
  // string nanos → BigInt to avoid precision loss, then convert to ms.
  const s = BigInt(start);
  const e = BigInt(end);
  return Number((e - s) / 1_000_000n);
}

export function assembleTraceTree(traceId: string, raw: RawSpan[]): TraceTree {
  const spans: Span[] = raw.map((r) => {
    const attrs = r.attributes ?? {};
    return {
      spanId: r.spanId,
      parentSpanId: r.parentSpanId ?? null,
      name: r.name ?? "",
      kind: deriveKind(attrs),
      startTimeUnixNano: r.startTimeUnixNano ?? "0",
      endTimeUnixNano: r.endTimeUnixNano ?? "0",
      durationMs: durationMs(r.startTimeUnixNano, r.endTimeUnixNano),
      status: deriveStatus(r.status),
      attributes: attrs,
    };
  });

  const byId = new Map<string, Span>();
  const parentToChildren = new Map<string | null, Span[]>();
  const byKind = new Map<SpanKind, Span[]>();

  for (const s of spans) {
    byId.set(s.spanId, s);
    const arr = parentToChildren.get(s.parentSpanId) ?? [];
    arr.push(s);
    parentToChildren.set(s.parentSpanId, arr);
    const kindArr = byKind.get(s.kind) ?? [];
    kindArr.push(s);
    byKind.set(s.kind, kindArr);
  }

  const roots = parentToChildren.get(null) ?? [];
  const root = roots.length > 0 ? roots[0] : null;

  return { traceId, spans, byId, parentToChildren, byKind, root };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/typescript && node --import tsx --test test/trace-shaper.test.ts`
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/typescript/src/trace-ai/diagnose/trace-shaper.ts packages/typescript/test/trace-shaper.test.ts
git commit -m "feat(trace-diagnose): trace-shaper builds in-memory tree + indexes"
```

---

## Task 5: B1 — `getTraceById` API Client

**Files:**
- Create: `packages/typescript/src/api/trace.ts`
- Test: `packages/typescript/test/trace-api.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/typescript/test/trace-api.test.ts`:

```typescript
import test from "node:test";
import assert from "node:assert/strict";

import { getTraceById } from "../src/api/trace.js";

interface MockCall { url: string; method: string; body: unknown; }

function mockFetchSequence(responses: unknown[]) {
  const orig = globalThis.fetch;
  const calls: MockCall[] = [];
  let i = 0;
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? "GET";
    let body: unknown;
    if (init?.body && typeof init.body === "string") {
      try { body = JSON.parse(init.body); } catch { body = init.body; }
    }
    calls.push({ url, method, body });
    const r = responses[i++] ?? {};
    return new Response(typeof r === "string" ? r : JSON.stringify(r), { status: 200 });
  };
  return { calls, restore: () => { globalThis.fetch = orig; } };
}

test("getTraceById POSTs _search with a traceId term query", async () => {
  const m = mockFetchSequence([
    { hits: { hits: [
      { _source: { spanId: "a", parentSpanId: null, name: "root", startTimeUnixNano: "0", endTimeUnixNano: "1000000", attributes: {} } },
      { _source: { spanId: "b", parentSpanId: "a", name: "child", startTimeUnixNano: "0", endTimeUnixNano: "500000", attributes: {} } },
    ] } },
  ]);
  try {
    const spans = await getTraceById({
      baseUrl: "https://mock.kweaver.test",
      token: "tk",
      businessDomain: "bd_public",
      traceId: "tr_de39",
    });
    assert.equal(spans.length, 2);
    assert.equal(m.calls.length, 1);
    assert.match(m.calls[0].url, /\/api\/trace-ai\/_search$/);
    assert.equal(m.calls[0].method, "POST");
    const body = m.calls[0].body as { query?: { term?: { traceId?: string } } };
    assert.equal(body.query?.term?.traceId, "tr_de39");
  } finally {
    m.restore();
  }
});

test("getTraceById returns empty array when hits is empty", async () => {
  const m = mockFetchSequence([{ hits: { hits: [] } }]);
  try {
    const spans = await getTraceById({
      baseUrl: "https://mock.kweaver.test",
      token: "tk",
      businessDomain: "bd_public",
      traceId: "tr_missing",
    });
    assert.equal(spans.length, 0);
  } finally {
    m.restore();
  }
});

test("getTraceById sets Authorization header from token", async () => {
  const m = mockFetchSequence([{ hits: { hits: [] } }]);
  const origFetch = globalThis.fetch;
  let seenHeaders: Headers | undefined;
  globalThis.fetch = async (input, init) => {
    seenHeaders = new Headers(init?.headers);
    return origFetch(input, init);
  };
  try {
    await getTraceById({
      baseUrl: "https://mock.kweaver.test",
      token: "abc-token",
      businessDomain: "bd_public",
      traceId: "tr_x",
    });
    assert.equal(seenHeaders?.get("Authorization"), "Bearer abc-token");
  } finally {
    m.restore();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/typescript && node --import tsx --test test/trace-api.test.ts`
Expected: FAIL — `api/trace.js` does not exist.

- [ ] **Step 3: Implement the client**

Inspect existing pattern first:
```bash
head -40 packages/typescript/src/api/conversations.ts
```
Note the existing `headers.ts` module convention.

Create `packages/typescript/src/api/trace.ts`:

```typescript
export interface GetTraceByIdOpts {
  baseUrl: string;
  token: string;
  businessDomain: string;
  traceId: string;
  pageSize?: number;
}

export interface RawSpan {
  spanId: string;
  parentSpanId: string | null;
  name?: string;
  startTimeUnixNano?: string;
  endTimeUnixNano?: string;
  status?: { code?: string };
  attributes?: Record<string, unknown>;
}

export async function getTraceById(opts: GetTraceByIdOpts): Promise<RawSpan[]> {
  const url = `${opts.baseUrl.replace(/\/$/, "")}/api/trace-ai/_search`;
  const body = {
    size: opts.pageSize ?? 1000,
    query: { term: { traceId: opts.traceId } },
  };
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.token}`,
      "X-Business-Domain": opts.businessDomain,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`getTraceById: HTTP ${res.status} from ${url}`);
  }
  const json = (await res.json()) as { hits?: { hits?: { _source?: RawSpan }[] } };
  const hits = json.hits?.hits ?? [];
  return hits.map((h) => h._source).filter((s): s is RawSpan => Boolean(s));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/typescript && node --import tsx --test test/trace-api.test.ts`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/typescript/src/api/trace.ts packages/typescript/test/trace-api.test.ts
git commit -m "feat(api): B1 getTraceById via _search term query"
```

---

## Task 6: Predicate Registry

**Files:**
- Create: `packages/typescript/src/trace-ai/diagnose/predicate-registry.ts`
- Test: `packages/typescript/test/predicate-registry.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/typescript/test/predicate-registry.test.ts`:

```typescript
import test from "node:test";
import assert from "node:assert/strict";

import {
  registerPredicate,
  resolvePredicate,
  clearRegistry,
  PredicateNotFoundError,
} from "../src/trace-ai/diagnose/predicate-registry.js";
import type { Hit, Predicate, TraceTree } from "../src/trace-ai/diagnose/types.js";

test("registerPredicate + resolvePredicate round-trip", () => {
  clearRegistry();
  const fn: Predicate = () => [];
  registerPredicate("dummy", fn);
  assert.strictEqual(resolvePredicate("builtin:dummy"), fn);
});

test("resolvePredicate throws PredicateNotFoundError for unknown name", () => {
  clearRegistry();
  assert.throws(
    () => resolvePredicate("builtin:no_such"),
    (e: unknown) => e instanceof PredicateNotFoundError,
  );
});

test("resolvePredicate rejects non-builtin: prefix", () => {
  clearRegistry();
  assert.throws(
    () => resolvePredicate("custom-ts:./foo.ts"),
    /unsupported predicate scheme/,
  );
});

test("registerPredicate twice throws (no silent override)", () => {
  clearRegistry();
  registerPredicate("dup", (() => []) as Predicate);
  assert.throws(
    () => registerPredicate("dup", (() => []) as Predicate),
    /already registered/,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/typescript && node --import tsx --test test/predicate-registry.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the registry**

Create `packages/typescript/src/trace-ai/diagnose/predicate-registry.ts`:

```typescript
import type { Predicate } from "./types.js";

export class PredicateNotFoundError extends Error {
  constructor(name: string) {
    super(`predicate not registered: ${name}`);
    this.name = "PredicateNotFoundError";
  }
}

const REGISTRY = new Map<string, Predicate>();

export function registerPredicate(name: string, fn: Predicate): void {
  if (REGISTRY.has(name)) {
    throw new Error(`predicate already registered: ${name}`);
  }
  REGISTRY.set(name, fn);
}

export function resolvePredicate(ref: string): Predicate {
  const m = ref.match(/^([a-z-]+):(.+)$/);
  if (!m) throw new Error(`malformed predicate ref: ${ref}`);
  const [, scheme, name] = m;
  if (scheme !== "builtin") {
    throw new Error(`unsupported predicate scheme: ${scheme} (only 'builtin:' is allowed in PR-A)`);
  }
  const fn = REGISTRY.get(name);
  if (!fn) throw new PredicateNotFoundError(name);
  return fn;
}

// Test-only escape hatch.
export function clearRegistry(): void {
  REGISTRY.clear();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/typescript && node --import tsx --test test/predicate-registry.test.ts`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/typescript/src/trace-ai/diagnose/predicate-registry.ts packages/typescript/test/predicate-registry.test.ts
git commit -m "feat(trace-diagnose): predicate registry with builtin: scheme"
```

---

## Task 7: Rule Loader

**Files:**
- Create: `packages/typescript/src/trace-ai/diagnose/rule-loader.ts`
- Test: `packages/typescript/test/rule-loader.test.ts`
- Test fixture: `packages/typescript/test/fixtures/trace-diagnose/rules-good/r1.yaml`
- Test fixture: `packages/typescript/test/fixtures/trace-diagnose/rules-bad/missing-taxonomy.yaml`

- [ ] **Step 1: Create the test fixture YAMLs**

Create `packages/typescript/test/fixtures/trace-diagnose/rules-good/r1.yaml`:

```yaml
schema_version: diagnosis-rule/v1
id: r_one
severity: medium
symptom: test_symptom
taxonomy:
  signals_axis: execution
  ms_class: retry_loop
suggested_fix:
  target: "decision_agent.prompt"
  change_template: "fix {{thing}}"
verify_with:
  assertion_templates: ["assert(x)"]
predicate: builtin:r_one
params:
  k: 1
```

Create `packages/typescript/test/fixtures/trace-diagnose/rules-bad/missing-taxonomy.yaml`:

```yaml
schema_version: diagnosis-rule/v1
id: r_bad
severity: high
symptom: s
suggested_fix: { target: "t", change_template: "c" }
verify_with: { assertion_templates: [] }
predicate: builtin:r_bad
```

- [ ] **Step 2: Write the failing test**

Create `packages/typescript/test/rule-loader.test.ts`:

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadRules, RuleLoadError } from "../src/trace-ai/diagnose/rule-loader.js";
import {
  registerPredicate,
  clearRegistry,
} from "../src/trace-ai/diagnose/predicate-registry.js";
import type { Predicate } from "../src/trace-ai/diagnose/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(__dirname, "fixtures/trace-diagnose");

test("loadRules: loads a single valid rule yaml and resolves its predicate", async () => {
  clearRegistry();
  const fn: Predicate = () => [];
  registerPredicate("r_one", fn);
  const rules = await loadRules({
    builtinDir: null,
    cwdRulesDir: path.join(FIX, "rules-good"),
    extraRulesDir: null,
    noBuiltin: true,
  });
  assert.equal(rules.length, 1);
  assert.equal(rules[0].id, "r_one");
  assert.equal(rules[0].predicateRef, "builtin:r_one");
});

test("loadRules: rejects yaml with missing taxonomy", async () => {
  clearRegistry();
  registerPredicate("r_bad", (() => []) as Predicate);
  await assert.rejects(
    () => loadRules({
      builtinDir: null,
      cwdRulesDir: path.join(FIX, "rules-bad"),
      extraRulesDir: null,
      noBuiltin: true,
    }),
    (e: unknown) => e instanceof RuleLoadError && /taxonomy/.test((e as Error).message),
  );
});

test("loadRules: name conflict between two dirs fails fast", async () => {
  clearRegistry();
  registerPredicate("r_one", (() => []) as Predicate);
  await assert.rejects(
    () => loadRules({
      builtinDir: path.join(FIX, "rules-good"),
      cwdRulesDir: path.join(FIX, "rules-good"),  // same dir → forces conflict
      extraRulesDir: null,
      noBuiltin: false,
    }),
    (e: unknown) => e instanceof RuleLoadError && /conflict/.test((e as Error).message),
  );
});

test("loadRules: unknown predicate ref fails at load time", async () => {
  clearRegistry();
  // do NOT register r_one
  await assert.rejects(
    () => loadRules({
      builtinDir: null,
      cwdRulesDir: path.join(FIX, "rules-good"),
      extraRulesDir: null,
      noBuiltin: true,
    }),
    (e: unknown) => e instanceof RuleLoadError && /predicate not registered/.test((e as Error).message),
  );
});

test("loadRules: noBuiltin=true skips builtinDir entirely", async () => {
  clearRegistry();
  const rules = await loadRules({
    builtinDir: path.join(FIX, "rules-good"),
    cwdRulesDir: null,
    extraRulesDir: null,
    noBuiltin: true,
  });
  assert.equal(rules.length, 0);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd packages/typescript && node --import tsx --test test/rule-loader.test.ts`
Expected: FAIL — `rule-loader.js` does not exist.

- [ ] **Step 4: Implement the loader**

Create `packages/typescript/src/trace-ai/diagnose/rule-loader.ts`:

```typescript
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";

import { RuleSchema } from "./schemas.js";
import { resolvePredicate } from "./predicate-registry.js";
import type { Rule } from "./types.js";

export class RuleLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuleLoadError";
  }
}

export interface LoadRulesOpts {
  builtinDir: string | null;
  cwdRulesDir: string | null;
  extraRulesDir: string | null;
  noBuiltin: boolean;
}

async function listYamls(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && (e.name.endsWith(".yaml") || e.name.endsWith(".yml")))
      .map((e) => path.join(dir, e.name));
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

async function parseOne(filePath: string): Promise<Rule> {
  const raw = await fs.readFile(filePath, "utf8");
  let parsed: unknown;
  try {
    parsed = yaml.load(raw);
  } catch (e) {
    throw new RuleLoadError(`yaml parse error in ${filePath}: ${(e as Error).message}`);
  }
  const result = RuleSchema.safeParse(parsed);
  if (!result.success) {
    throw new RuleLoadError(`schema validation failed for ${filePath}: ${result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  const r = result.data;
  if (!r.predicate) {
    throw new RuleLoadError(`PR-A only supports symbolic rules; ${filePath} has no predicate`);
  }
  // resolvePredicate throws PredicateNotFoundError; rewrap for uniform caller experience.
  try {
    resolvePredicate(r.predicate);
  } catch (e) {
    throw new RuleLoadError(`${filePath}: ${(e as Error).message}`);
  }
  return {
    schemaVersion: r.schema_version,
    id: r.id,
    severity: r.severity,
    symptom: r.symptom,
    taxonomy: { signalsAxis: r.taxonomy.signals_axis, msClass: r.taxonomy.ms_class },
    suggestedFix: { target: r.suggested_fix.target, changeTemplate: r.suggested_fix.change_template },
    verifyWith: { assertionTemplates: r.verify_with.assertion_templates },
    predicateRef: r.predicate,
    params: r.params,
    sourcePath: filePath,
  };
}

export async function loadRules(opts: LoadRulesOpts): Promise<Rule[]> {
  const dirs: string[] = [];
  if (opts.builtinDir && !opts.noBuiltin) dirs.push(opts.builtinDir);
  if (opts.cwdRulesDir) dirs.push(opts.cwdRulesDir);
  if (opts.extraRulesDir) dirs.push(opts.extraRulesDir);

  const seenIds = new Map<string, string>();   // id → first path
  const rules: Rule[] = [];

  for (const dir of dirs) {
    const yamls = await listYamls(dir);
    for (const f of yamls) {
      const r = await parseOne(f);
      const prev = seenIds.get(r.id);
      if (prev) {
        throw new RuleLoadError(
          `rule id conflict for '${r.id}': defined in both ${prev} and ${f}`,
        );
      }
      seenIds.set(r.id, f);
      rules.push(r);
    }
  }
  return rules;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/typescript && node --import tsx --test test/rule-loader.test.ts`
Expected: 5 tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/typescript/src/trace-ai/diagnose/rule-loader.ts packages/typescript/test/rule-loader.test.ts packages/typescript/test/fixtures/trace-diagnose/
git commit -m "feat(trace-diagnose): rule-loader with builtin+cwd merge and conflict detection"
```

---

## Task 8: Signal Probe

**Files:**
- Create: `packages/typescript/src/trace-ai/diagnose/signal-probe.ts`
- Test: `packages/typescript/test/signal-probe.test.ts`

`signal-probe` runs all rules against the tree, collects `Hit[]` per rule. It does not yet build `Finding[]` — that's report-assembler's job.

- [ ] **Step 1: Write the failing test**

Create `packages/typescript/test/signal-probe.test.ts`:

```typescript
import test from "node:test";
import assert from "node:assert/strict";

import { runRules } from "../src/trace-ai/diagnose/signal-probe.js";
import {
  registerPredicate,
  clearRegistry,
} from "../src/trace-ai/diagnose/predicate-registry.js";
import type { Hit, Predicate, Rule, TraceTree } from "../src/trace-ai/diagnose/types.js";

const tree: TraceTree = {
  traceId: "tr_x",
  spans: [],
  byId: new Map(),
  parentToChildren: new Map(),
  byKind: new Map(),
  root: null,
};

const ruleFor = (id: string, predicateRef: string): Rule => ({
  schemaVersion: "diagnosis-rule/v1",
  id,
  severity: "high",
  symptom: "s",
  taxonomy: { signalsAxis: "execution", msClass: "retry_loop" },
  suggestedFix: { target: "t", changeTemplate: "c" },
  verifyWith: { assertionTemplates: [] },
  predicateRef,
  params: {},
  sourcePath: `mem:${id}`,
});

test("runRules: invokes each rule's predicate and groups hits by rule_id", async () => {
  clearRegistry();
  registerPredicate("a", (() => [{ evidenceSpans: ["s1"], excerpt: "x", bindings: {} }]) as Predicate);
  registerPredicate("b", (() => []) as Predicate);

  const ruleA = ruleFor("a", "builtin:a");
  const ruleB = ruleFor("b", "builtin:b");
  const out = await runRules([ruleA, ruleB], tree);

  assert.equal(out.size, 2);
  assert.equal(out.get("a")?.length, 1);
  assert.equal(out.get("b")?.length, 0);
});

test("runRules: passes rule.params through to the predicate", async () => {
  clearRegistry();
  let seenParams: Record<string, unknown> | undefined;
  registerPredicate("p", ((_t, params) => {
    seenParams = params;
    return [];
  }) as Predicate);
  const r = ruleFor("p", "builtin:p");
  r.params = { threshold: 5 };
  await runRules([r], tree);
  assert.deepEqual(seenParams, { threshold: 5 });
});

test("runRules: predicate throws → wraps into RuleProbeError naming the rule_id", async () => {
  clearRegistry();
  registerPredicate("x", (() => { throw new Error("boom"); }) as Predicate);
  const r = ruleFor("x", "builtin:x");
  await assert.rejects(
    () => runRules([r], tree),
    /predicate failed for rule 'x': boom/,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/typescript && node --import tsx --test test/signal-probe.test.ts`
Expected: FAIL — `signal-probe.js` does not exist.

- [ ] **Step 3: Implement the probe**

Create `packages/typescript/src/trace-ai/diagnose/signal-probe.ts`:

```typescript
import { resolvePredicate } from "./predicate-registry.js";
import type { Hit, Rule, TraceTree } from "./types.js";

export class RuleProbeError extends Error {
  constructor(ruleId: string, cause: Error) {
    super(`predicate failed for rule '${ruleId}': ${cause.message}`);
    this.name = "RuleProbeError";
  }
}

export async function runRules(rules: Rule[], tree: TraceTree): Promise<Map<string, Hit[]>> {
  const out = new Map<string, Hit[]>();
  for (const rule of rules) {
    const fn = resolvePredicate(rule.predicateRef);
    try {
      const hits = fn(tree, rule.params);
      out.set(rule.id, hits);
    } catch (e) {
      throw new RuleProbeError(rule.id, e as Error);
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/typescript && node --import tsx --test test/signal-probe.test.ts`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/typescript/src/trace-ai/diagnose/signal-probe.ts packages/typescript/test/signal-probe.test.ts
git commit -m "feat(trace-diagnose): signal-probe runs predicates and groups hits"
```

---

## Task 9: Synthesizer Template (PR-A deterministic fallback)

**Files:**
- Create: `packages/typescript/src/trace-ai/diagnose/synthesizer-template.ts`
- Test: `packages/typescript/test/synthesizer-template.test.ts`

PR-A only ships the template path; PR-B adds the agent path. Determinism is essential — the same `Finding[]` always produces the same `Summary`.

- [ ] **Step 1: Write the failing test**

Create `packages/typescript/test/synthesizer-template.test.ts`:

```typescript
import test from "node:test";
import assert from "node:assert/strict";

import { templateSynthesize } from "../src/trace-ai/diagnose/synthesizer-template.js";
import type { Finding } from "../src/trace-ai/diagnose/types.js";

const finding = (overrides: Partial<Finding> = {}): Finding => ({
  ruleId: "r1",
  judgmentKind: "symbolic",
  severity: "medium",
  symptom: "sym1",
  likelyCause: "lc1",
  evidence: { spans: ["s1"], excerpt: "ex" },
  suggestedFix: { target: "t", change: "c" },
  confidence: "low",
  verifyWith: { suggestedEvalCase: { queryId: null, query: null, assertions: [] } },
  ...overrides,
});

test("templateSynthesize: empty findings → 'No findings' headline, null root cause", () => {
  const s = templateSynthesize([]);
  assert.equal(s.headline, "No findings");
  assert.equal(s.primaryRootCause, null);
  assert.deepEqual(s.fixPriority, []);
  assert.deepEqual(s.crossFindingLinks, []);
});

test("templateSynthesize: single finding → headline references it; root cause = [0]", () => {
  const s = templateSynthesize([finding({ ruleId: "tool_loop", symptom: "tool_loop_sym" })]);
  assert.match(s.headline, /tool_loop_sym/);
  assert.deepEqual(s.primaryRootCause?.findingIds, [0]);
  assert.equal(s.fixPriority.length, 1);
});

test("templateSynthesize: multiple findings → sorted by severity (high > medium > low), highest is root cause", () => {
  const findings = [
    finding({ ruleId: "low_one", severity: "low" }),
    finding({ ruleId: "high_one", severity: "high" }),
    finding({ ruleId: "med_one", severity: "medium" }),
  ];
  const s = templateSynthesize(findings);
  // root cause should reference the high-severity finding's index in the original array
  assert.deepEqual(s.primaryRootCause?.findingIds, [1]);
  assert.equal(s.fixPriority[0].findingId, 1);
  assert.equal(s.fixPriority[1].findingId, 2);
  assert.equal(s.fixPriority[2].findingId, 0);
});

test("templateSynthesize: cross-finding links populate when ≥50% span overlap", () => {
  const findings = [
    finding({ ruleId: "ra", evidence: { spans: ["s1", "s2", "s3"], excerpt: "" } }),
    finding({ ruleId: "rb", evidence: { spans: ["s2", "s3"], excerpt: "" } }),
  ];
  const s = templateSynthesize(findings);
  assert.equal(s.crossFindingLinks.length, 1);
  assert.deepEqual(s.crossFindingLinks[0].findingIds, [0, 1]);
});

test("templateSynthesize: cross-finding links empty when no span overlap", () => {
  const findings = [
    finding({ ruleId: "ra", evidence: { spans: ["s1"], excerpt: "" } }),
    finding({ ruleId: "rb", evidence: { spans: ["s9"], excerpt: "" } }),
  ];
  const s = templateSynthesize(findings);
  assert.deepEqual(s.crossFindingLinks, []);
});

test("templateSynthesize: deterministic — same input → identical output", () => {
  const findings = [finding(), finding({ ruleId: "r2" })];
  const a = templateSynthesize(findings);
  const b = templateSynthesize(findings);
  assert.deepEqual(a, b);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/typescript && node --import tsx --test test/synthesizer-template.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the template synthesizer**

Create `packages/typescript/src/trace-ai/diagnose/synthesizer-template.ts`:

```typescript
import type { Finding, Summary, SummaryFixPriority, SummaryCrossLink } from "./types.js";

const SEVERITY_RANK: Record<Finding["severity"], number> = { high: 3, medium: 2, low: 1 };

function overlapRatio(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const intersect = b.filter((x) => setA.has(x)).length;
  const smaller = Math.min(a.length, b.length);
  return intersect / smaller;
}

export function templateSynthesize(findings: Finding[]): Summary {
  if (findings.length === 0) {
    return {
      headline: "No findings",
      primaryRootCause: null,
      fixPriority: [],
      crossFindingLinks: [],
    };
  }

  // Sort indices by severity desc, stable on original index (so same input → same output).
  const indices = findings.map((_, i) => i);
  indices.sort((i, j) => {
    const r = SEVERITY_RANK[findings[j].severity] - SEVERITY_RANK[findings[i].severity];
    return r !== 0 ? r : i - j;
  });

  const topIdx = indices[0];
  const top = findings[topIdx];
  const headline = `see findings[${topIdx}]: ${top.symptom}`;

  const primaryRootCause = {
    findingIds: [topIdx],
    description: `Top-severity finding from rule '${top.ruleId}': ${top.symptom}`,
    targetForFix: top.suggestedFix.target,
  };

  const fixPriority: SummaryFixPriority[] = indices.map((i) => ({
    findingId: i,
    reason: `severity=${findings[i].severity}`,
  }));

  const crossFindingLinks: SummaryCrossLink[] = [];
  for (let i = 0; i < findings.length; i++) {
    for (let j = i + 1; j < findings.length; j++) {
      if (overlapRatio(findings[i].evidence.spans, findings[j].evidence.spans) >= 0.5) {
        crossFindingLinks.push({
          findingIds: [i, j],
          relation: "overlapping_evidence_spans",
        });
      }
    }
  }

  return { headline, primaryRootCause, fixPriority, crossFindingLinks };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/typescript && node --import tsx --test test/synthesizer-template.test.ts`
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/typescript/src/trace-ai/diagnose/synthesizer-template.ts packages/typescript/test/synthesizer-template.test.ts
git commit -m "feat(trace-diagnose): deterministic template synthesizer (PR-A)"
```

---

## Task 10: Report Assembler

**Files:**
- Create: `packages/typescript/src/trace-ai/diagnose/report-assembler.ts`
- Test: `packages/typescript/test/report-assembler.test.ts`

The assembler turns `Hit[]` per rule into `Finding[]` (rendering templates), takes the `Summary` from the synthesizer, and emits a `Report` validated against `ReportSchema`.

- [ ] **Step 1: Write the failing test**

Create `packages/typescript/test/report-assembler.test.ts`:

```typescript
import test from "node:test";
import assert from "node:assert/strict";

import { assembleReport } from "../src/trace-ai/diagnose/report-assembler.js";
import type { Hit, Rule, Summary } from "../src/trace-ai/diagnose/types.js";

const ruleA: Rule = {
  schemaVersion: "diagnosis-rule/v1",
  id: "rule_a",
  severity: "high",
  symptom: "sym_a",
  taxonomy: { signalsAxis: "execution", msClass: "retry_loop" },
  suggestedFix: { target: "agent.prompt", changeTemplate: "stop after {{count}} retries" },
  verifyWith: { assertionTemplates: ["count({{tool}}) <= 2"] },
  predicateRef: "builtin:rule_a",
  params: {},
  sourcePath: "mem:rule_a",
};

const summary: Summary = {
  headline: "h",
  primaryRootCause: null,
  fixPriority: [],
  crossFindingLinks: [],
};

test("assembleReport: renders changeTemplate with hit bindings", () => {
  const hits = new Map<string, Hit[]>([
    ["rule_a", [{
      evidenceSpans: ["s1", "s2"],
      excerpt: "x",
      bindings: { count: 3, tool: "retrieval" },
    }]],
  ]);
  const r = assembleReport({
    traceId: "tr_x",
    agentId: null,
    tenant: null,
    cliVersion: "0.7.4",
    rules: [ruleA],
    hits,
    summary,
  });
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].suggestedFix.change, "stop after 3 retries");
  assert.deepEqual(r.findings[0].verifyWith.suggestedEvalCase.assertions, ["count(retrieval) <= 2"]);
});

test("assembleReport: zero hits → empty findings, summary preserved", () => {
  const r = assembleReport({
    traceId: "tr_x",
    agentId: null,
    tenant: null,
    cliVersion: "0.7.4",
    rules: [ruleA],
    hits: new Map([["rule_a", []]]),
    summary: { headline: "No findings", primaryRootCause: null, fixPriority: [], crossFindingLinks: [] },
  });
  assert.equal(r.findings.length, 0);
  assert.equal(r.summary.headline, "No findings");
});

test("assembleReport: writes rules_applied and rules_skipped correctly", () => {
  const r = assembleReport({
    traceId: "tr_x",
    agentId: null,
    tenant: null,
    cliVersion: "0.7.4",
    rules: [ruleA],
    hits: new Map([["rule_a", []]]),
    summary,
  });
  assert.deepEqual(r.run.rulesApplied, ["rule_a"]);
  assert.deepEqual(r.run.rulesSkipped, []);
  assert.equal(r.run.mode, "symbolic-only");
  assert.equal(r.run.synthesizerMode, "template");
});

test("assembleReport: output passes ReportSchema (raw form)", async () => {
  const { ReportSchema } = await import("../src/trace-ai/diagnose/schemas.js");
  const { reportToYamlObject } = await import("../src/trace-ai/diagnose/report-assembler.js");
  const r = assembleReport({
    traceId: "tr_x",
    agentId: null,
    tenant: null,
    cliVersion: "0.7.4",
    rules: [ruleA],
    hits: new Map([["rule_a", []]]),
    summary,
  });
  const raw = reportToYamlObject(r);
  const result = ReportSchema.safeParse(raw);
  assert.equal(result.success, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/typescript && node --import tsx --test test/report-assembler.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the assembler**

Create `packages/typescript/src/trace-ai/diagnose/report-assembler.ts`:

```typescript
import type { Finding, Hit, Report, Rule, Summary } from "./types.js";

function renderTemplate(tpl: string, bindings: Record<string, unknown>): string {
  return tpl.replace(/{{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*}}/g, (_, key) => {
    const v = bindings[key];
    return v === undefined ? `{{${key}}}` : String(v);
  });
}

export interface AssembleReportOpts {
  traceId: string;
  agentId: string | null;
  tenant: string | null;
  cliVersion: string;
  rules: Rule[];
  hits: Map<string, Hit[]>;        // rule_id → hits
  summary: Summary;
}

export function assembleReport(opts: AssembleReportOpts): Report {
  const findings: Finding[] = [];
  for (const rule of opts.rules) {
    const ruleHits = opts.hits.get(rule.id) ?? [];
    for (const hit of ruleHits) {
      findings.push({
        ruleId: rule.id,
        judgmentKind: "symbolic",
        severity: rule.severity,
        symptom: rule.symptom,
        likelyCause: rule.symptom,    // PR-A: no LLM, so we mirror symptom; PR-B agent overrides this
        evidence: { spans: hit.evidenceSpans, excerpt: hit.excerpt },
        suggestedFix: {
          target: rule.suggestedFix.target,
          change: renderTemplate(rule.suggestedFix.changeTemplate, hit.bindings),
        },
        confidence: "low",
        verifyWith: {
          suggestedEvalCase: {
            queryId: null,            // PR-A: no query extraction yet (deferred per spec)
            query: null,
            assertions: rule.verifyWith.assertionTemplates.map((t) => renderTemplate(t, hit.bindings)),
          },
        },
      });
    }
  }
  return {
    schemaVersion: "trace-diagnose-report/v1",
    trace: { traceId: opts.traceId, agentId: opts.agentId, tenant: opts.tenant },
    run: {
      diagnosedAt: new Date().toISOString(),
      cliVersion: opts.cliVersion,
      mode: "symbolic-only",
      rulesApplied: opts.rules.map((r) => r.id),
      rulesSkipped: [],
      synthesizerMode: "template",
    },
    summary: opts.summary,
    findings,
  };
}

// Convert internal camelCase Report to the snake_case shape used by ReportSchema (and by yaml output).
export function reportToYamlObject(r: Report): unknown {
  return {
    schema_version: r.schemaVersion,
    trace: { trace_id: r.trace.traceId, agent_id: r.trace.agentId, tenant: r.trace.tenant },
    run: {
      diagnosed_at: r.run.diagnosedAt,
      cli_version: r.run.cliVersion,
      mode: r.run.mode,
      rules_applied: r.run.rulesApplied,
      rules_skipped: r.run.rulesSkipped.map((s) => ({ rule_id: s.ruleId, reason: s.reason })),
      synthesizer_mode: r.run.synthesizerMode,
    },
    summary: {
      headline: r.summary.headline,
      primary_root_cause: r.summary.primaryRootCause === null ? null : {
        finding_ids: r.summary.primaryRootCause.findingIds,
        description: r.summary.primaryRootCause.description,
        target_for_fix: r.summary.primaryRootCause.targetForFix,
      },
      fix_priority: r.summary.fixPriority.map((p) => ({ finding_id: p.findingId, reason: p.reason })),
      cross_finding_links: r.summary.crossFindingLinks.map((l) => ({ finding_ids: l.findingIds, relation: l.relation })),
    },
    findings: r.findings.map((f) => ({
      rule_id: f.ruleId,
      judgment_kind: f.judgmentKind,
      severity: f.severity,
      symptom: f.symptom,
      likely_cause: f.likelyCause,
      evidence: { spans: f.evidence.spans, excerpt: f.evidence.excerpt },
      suggested_fix: { target: f.suggestedFix.target, change: f.suggestedFix.change },
      confidence: f.confidence,
      verify_with: {
        suggested_eval_case: {
          query_id: f.verifyWith.suggestedEvalCase.queryId,
          query: f.verifyWith.suggestedEvalCase.query,
          assertions: f.verifyWith.suggestedEvalCase.assertions,
        },
      },
    })),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/typescript && node --import tsx --test test/report-assembler.test.ts`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/typescript/src/trace-ai/diagnose/report-assembler.ts packages/typescript/test/report-assembler.test.ts
git commit -m "feat(trace-diagnose): report-assembler renders templates and validates"
```

---

## Task 11: Diagnose Entrypoint (`index.ts`)

**Files:**
- Create: `packages/typescript/src/trace-ai/diagnose/index.ts`

Wires the pipeline: B1 → shaper → loader → probe → synthesizer → assembler → write YAML.

- [ ] **Step 1: Write the entrypoint** (no test yet — entrypoint is exercised by the e2e test in Task 21)

Create `packages/typescript/src/trace-ai/diagnose/index.ts`:

```typescript
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { fileURLToPath } from "node:url";

import { getTraceById } from "../../api/trace.js";
import { assembleTraceTree } from "./trace-shaper.js";
import { loadRules, RuleLoadError } from "./rule-loader.js";
import { runRules, RuleProbeError } from "./signal-probe.js";
import { templateSynthesize } from "./synthesizer-template.js";
import { assembleReport, reportToYamlObject } from "./report-assembler.js";
import type { DiagnoseOpts, Report } from "./types.js";

import "./builtin-rules/register.js";  // side effect: registers all builtin predicates

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUILTIN_DIR = path.join(__dirname, "builtin-rules");

export class TraceNotFoundError extends Error {
  constructor(traceId: string) {
    super(`trace not found: ${traceId}`);
    this.name = "TraceNotFoundError";
  }
}

export async function diagnose(traceId: string, opts: DiagnoseOpts): Promise<Report> {
  const cwdRulesDir = opts.rulesDir ?? path.join(process.cwd(), "diagnosis-rules");

  const rawSpans = await getTraceById({
    baseUrl: opts.baseUrl,
    token: opts.token,
    businessDomain: opts.businessDomain,
    traceId,
  });
  if (rawSpans.length === 0) throw new TraceNotFoundError(traceId);

  const tree = assembleTraceTree(traceId, rawSpans);

  const rules = await loadRules({
    builtinDir: BUILTIN_DIR,
    cwdRulesDir,
    extraRulesDir: null,
    noBuiltin: opts.noBuiltin,
  });

  const hits = await runRules(rules, tree);

  // Build provisional findings list to feed the synthesizer.
  const provisionalReport = assembleReport({
    traceId,
    agentId: extractAgentId(tree),
    tenant: extractTenant(tree),
    cliVersion: cliVersion(),
    rules,
    hits,
    summary: { headline: "", primaryRootCause: null, fixPriority: [], crossFindingLinks: [] },
  });

  const summary = templateSynthesize(provisionalReport.findings);
  const report: Report = { ...provisionalReport, summary };

  if (opts.out !== null) {
    const outPath = opts.out === "default"
      ? path.join(process.cwd(), "diagnosis", `${traceId}.yaml`)
      : opts.out;
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, yaml.dump(reportToYamlObject(report)), "utf8");
  } else {
    process.stdout.write(yaml.dump(reportToYamlObject(report)));
  }

  if (report.findings.length === 0) {
    process.stderr.write("no findings\n");
  }

  return report;
}

function extractAgentId(tree: ReturnType<typeof assembleTraceTree>): string | null {
  for (const s of tree.spans) {
    const v = s.attributes["gen_ai.agent.id"];
    if (typeof v === "string") return v;
  }
  return null;
}

function extractTenant(tree: ReturnType<typeof assembleTraceTree>): string | null {
  for (const s of tree.spans) {
    const v = s.attributes["tenant"];
    if (typeof v === "string") return v;
  }
  return null;
}

function cliVersion(): string {
  // Read from the package.json sibling to the bin entry.
  // Fallback to "0.0.0" if the file is unreachable (test contexts).
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require(path.join(__dirname, "..", "..", "..", "package.json"));
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export { TraceNotFoundError as DiagnoseTraceNotFound, RuleLoadError, RuleProbeError };
```

- [ ] **Step 2: Create a placeholder `register.ts` so the import resolves now**

Create `packages/typescript/src/trace-ai/diagnose/builtin-rules/register.ts`:

```typescript
// Register builtin predicates here. Each rule task (12–16) appends its line.
// Empty for now; predicates are added as their tasks land.
export {};
```

- [ ] **Step 3: Verify it compiles**

Run: `cd packages/typescript && npm run lint`
Expected: clean (or fail only on the `require()` for cliVersion — if so, replace with the dynamic-import fallback below).

If lint complains about `require`:
```typescript
async function cliVersion(): Promise<string> {
  try {
    const pkgPath = path.join(__dirname, "..", "..", "..", "package.json");
    const txt = await fs.readFile(pkgPath, "utf8");
    return JSON.parse(txt).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}
```
And make `diagnose()` `await cliVersion()` accordingly.

- [ ] **Step 4: Commit**

```bash
git add packages/typescript/src/trace-ai/diagnose/index.ts packages/typescript/src/trace-ai/diagnose/builtin-rules/register.ts
git commit -m "feat(trace-diagnose): diagnose() entrypoint wires the pipeline"
```

---

## Task 12: Builtin Rule #1 — `tool_loop_no_state_change`

**Files:**
- Create: `packages/typescript/src/trace-ai/diagnose/builtin-rules/tool-loop-no-state-change.yaml`
- Create: `packages/typescript/src/trace-ai/diagnose/builtin-rules/tool-loop-no-state-change.ts`
- Modify: `packages/typescript/src/trace-ai/diagnose/builtin-rules/register.ts`
- Test: `packages/typescript/test/builtin-rule-tool-loop-no-state-change.test.ts`
- Fixture: `packages/typescript/test/fixtures/trace-diagnose/synthetic/tool-loop-no-state-change.json`

**Predicate spec**: walk `tree.byKind.get('tool')`, find consecutive runs of same `attributes['gen_ai.tool.name']` (or fallback `name`) with deep-equal `attributes['gen_ai.tool.args']`. If a run length ≥ `params.min_consecutive` (default 3), and no span between the first and last carries a state change (we approximate this in PR-A as: no span in the tool subtree mutated `gen_ai.conversation.state` — we just check whether any span in the surrounding window has a different `attributes['gen_ai.conversation.state']` value than the first), emit a hit. The "succession" semantics open question (spec §Open Questions #4) is resolved here as: contiguous in tool-span time order, ignoring intervening non-tool spans.

- [ ] **Step 1: Write the rule yaml**

Create `packages/typescript/src/trace-ai/diagnose/builtin-rules/tool-loop-no-state-change.yaml`:

```yaml
schema_version: diagnosis-rule/v1
id: tool_loop_no_state_change
severity: high
symptom: repeated_tool_call_without_state_change
taxonomy:
  signals_axis: execution
  ms_class: retry_loop
suggested_fix:
  target: decision_agent.prompt
  change_template: "add stop condition after {{loop_count}} equivalent failed retrievals of '{{tool_name}}'"
verify_with:
  assertion_templates:
    - "tool_call_count({{tool_name}}) <= {{max_count}}"
predicate: builtin:tool_loop_no_state_change
params:
  min_consecutive: 3
```

- [ ] **Step 2: Write the synthetic fixture** (must trigger the rule)

Create `packages/typescript/test/fixtures/trace-diagnose/synthetic/tool-loop-no-state-change.json`:

```json
{
  "hits": {
    "hits": [
      { "_source": { "spanId": "root", "parentSpanId": null, "name": "chat", "startTimeUnixNano": "1700000000000000000", "endTimeUnixNano": "1700000000100000000", "status": { "code": "OK" }, "attributes": { "agent.trace.type": "model", "gen_ai.conversation.state": "v1" } } },
      { "_source": { "spanId": "t1", "parentSpanId": "root", "name": "retrieval", "startTimeUnixNano": "1700000000010000000", "endTimeUnixNano": "1700000000020000000", "status": { "code": "OK" }, "attributes": { "agent.trace.type": "tool", "gen_ai.tool.name": "retrieval", "gen_ai.tool.args": { "q": "refund 2024" }, "gen_ai.conversation.state": "v1" } } },
      { "_source": { "spanId": "t2", "parentSpanId": "root", "name": "retrieval", "startTimeUnixNano": "1700000000030000000", "endTimeUnixNano": "1700000000040000000", "status": { "code": "OK" }, "attributes": { "agent.trace.type": "tool", "gen_ai.tool.name": "retrieval", "gen_ai.tool.args": { "q": "refund 2024" }, "gen_ai.conversation.state": "v1" } } },
      { "_source": { "spanId": "t3", "parentSpanId": "root", "name": "retrieval", "startTimeUnixNano": "1700000000050000000", "endTimeUnixNano": "1700000000060000000", "status": { "code": "OK" }, "attributes": { "agent.trace.type": "tool", "gen_ai.tool.name": "retrieval", "gen_ai.tool.args": { "q": "refund 2024" }, "gen_ai.conversation.state": "v1" } } }
    ]
  }
}
```

- [ ] **Step 3: Write the failing predicate test**

Create `packages/typescript/test/builtin-rule-tool-loop-no-state-change.test.ts`:

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assembleTraceTree } from "../src/trace-ai/diagnose/trace-shaper.js";
import { predicate } from "../src/trace-ai/diagnose/builtin-rules/tool-loop-no-state-change.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function loadTree(fixturePath: string) {
  const raw = JSON.parse(await fs.readFile(fixturePath, "utf8")) as { hits: { hits: { _source: any }[] } };
  return assembleTraceTree("tr_x", raw.hits.hits.map((h) => h._source));
}

test("tool_loop_no_state_change: fires on synthetic fixture", async () => {
  const tree = await loadTree(path.join(__dirname, "fixtures/trace-diagnose/synthetic/tool-loop-no-state-change.json"));
  const hits = predicate(tree, { min_consecutive: 3 });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].evidenceSpans.length, 3);
  assert.deepEqual(hits[0].evidenceSpans, ["t1", "t2", "t3"]);
  assert.equal(hits[0].bindings.tool_name, "retrieval");
  assert.equal(hits[0].bindings.loop_count, 3);
  assert.equal(hits[0].bindings.max_count, 2);
});

test("tool_loop_no_state_change: does NOT fire when args differ", async () => {
  const spans = [
    { spanId: "t1", parentSpanId: null, name: "tool", startTimeUnixNano: "0", endTimeUnixNano: "1", attributes: { "agent.trace.type": "tool", "gen_ai.tool.name": "retrieval", "gen_ai.tool.args": { q: "a" } } },
    { spanId: "t2", parentSpanId: "t1", name: "tool", startTimeUnixNano: "1", endTimeUnixNano: "2", attributes: { "agent.trace.type": "tool", "gen_ai.tool.name": "retrieval", "gen_ai.tool.args": { q: "b" } } },
    { spanId: "t3", parentSpanId: "t1", name: "tool", startTimeUnixNano: "2", endTimeUnixNano: "3", attributes: { "agent.trace.type": "tool", "gen_ai.tool.name": "retrieval", "gen_ai.tool.args": { q: "c" } } },
  ];
  const tree = assembleTraceTree("tr_x", spans);
  const hits = predicate(tree, { min_consecutive: 3 });
  assert.equal(hits.length, 0);
});

test("tool_loop_no_state_change: does NOT fire when state changes between calls", async () => {
  const spans = [
    { spanId: "t1", parentSpanId: null, name: "tool", startTimeUnixNano: "0", endTimeUnixNano: "1", attributes: { "agent.trace.type": "tool", "gen_ai.tool.name": "x", "gen_ai.tool.args": {}, "gen_ai.conversation.state": "v1" } },
    { spanId: "t2", parentSpanId: "t1", name: "tool", startTimeUnixNano: "1", endTimeUnixNano: "2", attributes: { "agent.trace.type": "tool", "gen_ai.tool.name": "x", "gen_ai.tool.args": {}, "gen_ai.conversation.state": "v2" } },
    { spanId: "t3", parentSpanId: "t1", name: "tool", startTimeUnixNano: "2", endTimeUnixNano: "3", attributes: { "agent.trace.type": "tool", "gen_ai.tool.name": "x", "gen_ai.tool.args": {}, "gen_ai.conversation.state": "v3" } },
  ];
  const tree = assembleTraceTree("tr_x", spans);
  const hits = predicate(tree, { min_consecutive: 3 });
  assert.equal(hits.length, 0);
});

test("tool_loop_no_state_change: respects min_consecutive param", async () => {
  // 2 same calls — should NOT fire with default 3
  const spans = [
    { spanId: "t1", parentSpanId: null, name: "tool", startTimeUnixNano: "0", endTimeUnixNano: "1", attributes: { "agent.trace.type": "tool", "gen_ai.tool.name": "x", "gen_ai.tool.args": {} } },
    { spanId: "t2", parentSpanId: "t1", name: "tool", startTimeUnixNano: "1", endTimeUnixNano: "2", attributes: { "agent.trace.type": "tool", "gen_ai.tool.name": "x", "gen_ai.tool.args": {} } },
  ];
  const tree = assembleTraceTree("tr_x", spans);
  assert.equal(predicate(tree, { min_consecutive: 3 }).length, 0);
  // But should fire with min_consecutive=2
  assert.equal(predicate(tree, { min_consecutive: 2 }).length, 1);
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd packages/typescript && node --import tsx --test test/builtin-rule-tool-loop-no-state-change.test.ts`
Expected: FAIL — predicate module does not exist.

- [ ] **Step 5: Implement the predicate**

Create `packages/typescript/src/trace-ai/diagnose/builtin-rules/tool-loop-no-state-change.ts`:

```typescript
import type { Hit, Predicate, Span, TraceTree } from "../types.js";

const STATE_KEY = "gen_ai.conversation.state";

function toolName(s: Span): string {
  const v = s.attributes["gen_ai.tool.name"];
  return typeof v === "string" ? v : s.name;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);  // PR-A: simple JSON compare; sufficient for tool args
}

export const predicate: Predicate = (trace: TraceTree, params: Record<string, unknown>): Hit[] => {
  const minConsecutive = (params.min_consecutive as number | undefined) ?? 3;
  const tools = (trace.byKind.get("tool") ?? []).slice().sort(
    (a, b) => Number(BigInt(a.startTimeUnixNano) - BigInt(b.startTimeUnixNano)),
  );
  const hits: Hit[] = [];
  let i = 0;
  while (i < tools.length) {
    const start = tools[i];
    const startName = toolName(start);
    const startArgs = start.attributes["gen_ai.tool.args"];
    const startState = start.attributes[STATE_KEY];
    let j = i + 1;
    while (
      j < tools.length &&
      toolName(tools[j]) === startName &&
      deepEqual(tools[j].attributes["gen_ai.tool.args"], startArgs) &&
      // state unchanged across the run (or both undefined)
      (tools[j].attributes[STATE_KEY] === startState || (startState === undefined && tools[j].attributes[STATE_KEY] === undefined))
    ) j++;
    const runLen = j - i;
    if (runLen >= minConsecutive) {
      const evidenceSpans = tools.slice(i, j).map((s) => s.spanId);
      hits.push({
        evidenceSpans,
        excerpt: `tool '${startName}' called ${runLen} times consecutively with identical args; conversation state unchanged`,
        bindings: { tool_name: startName, loop_count: runLen, max_count: minConsecutive - 1 },
      });
    }
    i = j;
  }
  return hits;
};
```

- [ ] **Step 6: Register the predicate**

Modify `packages/typescript/src/trace-ai/diagnose/builtin-rules/register.ts`:

```typescript
import { registerPredicate } from "../predicate-registry.js";

import { predicate as toolLoopNoStateChange } from "./tool-loop-no-state-change.js";

registerPredicate("tool_loop_no_state_change", toolLoopNoStateChange);

export {};
```

- [ ] **Step 7: Run test to verify it passes**

Run: `cd packages/typescript && node --import tsx --test test/builtin-rule-tool-loop-no-state-change.test.ts`
Expected: 4 tests pass.

- [ ] **Step 8: Commit**

```bash
git add packages/typescript/src/trace-ai/diagnose/builtin-rules/tool-loop-no-state-change.* packages/typescript/src/trace-ai/diagnose/builtin-rules/register.ts packages/typescript/test/builtin-rule-tool-loop-no-state-change.test.ts packages/typescript/test/fixtures/trace-diagnose/synthetic/tool-loop-no-state-change.json
git commit -m "feat(trace-diagnose): builtin rule #1 tool_loop_no_state_change"
```

---

## Task 13: Builtin Rule #2 — `tool_error_swallowed`

**Files:**
- Create: `packages/typescript/src/trace-ai/diagnose/builtin-rules/tool-error-swallowed.{yaml,ts}`
- Modify: `packages/typescript/src/trace-ai/diagnose/builtin-rules/register.ts`
- Test: `packages/typescript/test/builtin-rule-tool-error-swallowed.test.ts`
- Fixture: `packages/typescript/test/fixtures/trace-diagnose/synthetic/tool-error-swallowed.json`

**Predicate spec**: scan tool spans in time order. For each tool span with `status === 'error'`, find the next-in-time LLM span (`kind === 'llm'`). If its `attributes['gen_ai.prompt']` (or fallback `attributes['llm.prompt']`) does not contain the tool span's `attributes['error.message']` substring (case-insensitive) and the tool span's `name`, emit a hit.

- [ ] **Step 1: Write the rule yaml**

Create `packages/typescript/src/trace-ai/diagnose/builtin-rules/tool-error-swallowed.yaml`:

```yaml
schema_version: diagnosis-rule/v1
id: tool_error_swallowed
severity: high
symptom: tool_error_not_propagated_to_next_prompt
taxonomy:
  signals_axis: execution
  ms_class: cascading_error
suggested_fix:
  target: decision_agent.prompt
  change_template: "after tool '{{tool_name}}' errors, include error.message in the next LLM prompt or take a recovery branch"
verify_with:
  assertion_templates:
    - "next_llm_prompt_after({{tool_name}}_error).contains(error.message)"
predicate: builtin:tool_error_swallowed
params: {}
```

- [ ] **Step 2: Write the synthetic fixture**

Create `packages/typescript/test/fixtures/trace-diagnose/synthetic/tool-error-swallowed.json`:

```json
{
  "hits": {
    "hits": [
      { "_source": { "spanId": "root", "parentSpanId": null, "name": "chat", "startTimeUnixNano": "1700000000000000000", "endTimeUnixNano": "1700000000100000000", "status": { "code": "OK" }, "attributes": { "agent.trace.type": "model" } } },
      { "_source": { "spanId": "t1", "parentSpanId": "root", "name": "retrieval", "startTimeUnixNano": "1700000000010000000", "endTimeUnixNano": "1700000000020000000", "status": { "code": "ERROR" }, "attributes": { "agent.trace.type": "tool", "gen_ai.tool.name": "retrieval", "error.message": "connection refused" } } },
      { "_source": { "spanId": "l1", "parentSpanId": "root", "name": "chat", "startTimeUnixNano": "1700000000030000000", "endTimeUnixNano": "1700000000040000000", "status": { "code": "OK" }, "attributes": { "agent.trace.type": "model", "gen_ai.prompt": "User: what is the refund policy?\\n\\n(continuing as if no tool error occurred)" } } }
    ]
  }
}
```

- [ ] **Step 3: Write the failing predicate test**

Create `packages/typescript/test/builtin-rule-tool-error-swallowed.test.ts`:

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assembleTraceTree } from "../src/trace-ai/diagnose/trace-shaper.js";
import { predicate } from "../src/trace-ai/diagnose/builtin-rules/tool-error-swallowed.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function loadTree(p: string) {
  const raw = JSON.parse(await fs.readFile(p, "utf8")) as { hits: { hits: { _source: any }[] } };
  return assembleTraceTree("tr_x", raw.hits.hits.map((h) => h._source));
}

test("tool_error_swallowed: fires when next LLM prompt lacks error", async () => {
  const tree = await loadTree(path.join(__dirname, "fixtures/trace-diagnose/synthetic/tool-error-swallowed.json"));
  const hits = predicate(tree, {});
  assert.equal(hits.length, 1);
  assert.deepEqual(hits[0].evidenceSpans, ["t1", "l1"]);
  assert.equal(hits[0].bindings.tool_name, "retrieval");
});

test("tool_error_swallowed: does NOT fire when next prompt mentions the error", async () => {
  const spans = [
    { spanId: "t1", parentSpanId: null, name: "tool", startTimeUnixNano: "0", endTimeUnixNano: "1", status: { code: "ERROR" }, attributes: { "agent.trace.type": "tool", "gen_ai.tool.name": "retrieval", "error.message": "timeout" } },
    { spanId: "l1", parentSpanId: "t1", name: "chat", startTimeUnixNano: "1", endTimeUnixNano: "2", status: { code: "OK" }, attributes: { "agent.trace.type": "model", "gen_ai.prompt": "User: please retry; previous attempt timeout" } },
  ];
  const tree = assembleTraceTree("tr_x", spans);
  assert.equal(predicate(tree, {}).length, 0);
});

test("tool_error_swallowed: does NOT fire when no LLM span follows", async () => {
  const spans = [
    { spanId: "t1", parentSpanId: null, name: "tool", startTimeUnixNano: "0", endTimeUnixNano: "1", status: { code: "ERROR" }, attributes: { "agent.trace.type": "tool", "gen_ai.tool.name": "x", "error.message": "e" } },
  ];
  const tree = assembleTraceTree("tr_x", spans);
  assert.equal(predicate(tree, {}).length, 0);
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd packages/typescript && node --import tsx --test test/builtin-rule-tool-error-swallowed.test.ts`
Expected: FAIL.

- [ ] **Step 5: Implement the predicate**

Create `packages/typescript/src/trace-ai/diagnose/builtin-rules/tool-error-swallowed.ts`:

```typescript
import type { Hit, Predicate, Span, TraceTree } from "../types.js";

function getPrompt(s: Span): string {
  const v = s.attributes["gen_ai.prompt"] ?? s.attributes["llm.prompt"];
  return typeof v === "string" ? v : "";
}

function getErrorMessage(s: Span): string {
  const v = s.attributes["error.message"];
  return typeof v === "string" ? v : "";
}

function getToolName(s: Span): string {
  const v = s.attributes["gen_ai.tool.name"];
  return typeof v === "string" ? v : s.name;
}

export const predicate: Predicate = (trace: TraceTree): Hit[] => {
  const allSpans = trace.spans
    .slice()
    .sort((a, b) => Number(BigInt(a.startTimeUnixNano) - BigInt(b.startTimeUnixNano)));
  const hits: Hit[] = [];
  for (let i = 0; i < allSpans.length; i++) {
    const s = allSpans[i];
    if (s.kind !== "tool" || s.status !== "error") continue;
    const errMsg = getErrorMessage(s);
    const toolName = getToolName(s);
    // find next LLM span
    let next: Span | undefined;
    for (let j = i + 1; j < allSpans.length; j++) {
      if (allSpans[j].kind === "llm") { next = allSpans[j]; break; }
    }
    if (!next) continue;
    const prompt = getPrompt(next).toLowerCase();
    const errInPrompt = errMsg.length > 0 && prompt.includes(errMsg.toLowerCase());
    if (!errInPrompt) {
      hits.push({
        evidenceSpans: [s.spanId, next.spanId],
        excerpt: `tool '${toolName}' errored ('${errMsg}') but next LLM prompt did not propagate the error`,
        bindings: { tool_name: toolName, error_message: errMsg },
      });
    }
  }
  return hits;
};
```

- [ ] **Step 6: Register the predicate**

Modify `packages/typescript/src/trace-ai/diagnose/builtin-rules/register.ts`:

```typescript
import { registerPredicate } from "../predicate-registry.js";

import { predicate as toolLoopNoStateChange } from "./tool-loop-no-state-change.js";
import { predicate as toolErrorSwallowed } from "./tool-error-swallowed.js";

registerPredicate("tool_loop_no_state_change", toolLoopNoStateChange);
registerPredicate("tool_error_swallowed", toolErrorSwallowed);

export {};
```

- [ ] **Step 7: Run test to verify it passes**

Run: `cd packages/typescript && node --import tsx --test test/builtin-rule-tool-error-swallowed.test.ts`
Expected: 3 tests pass.

- [ ] **Step 8: Commit**

```bash
git add packages/typescript/src/trace-ai/diagnose/builtin-rules/tool-error-swallowed.* packages/typescript/src/trace-ai/diagnose/builtin-rules/register.ts packages/typescript/test/builtin-rule-tool-error-swallowed.test.ts packages/typescript/test/fixtures/trace-diagnose/synthetic/tool-error-swallowed.json
git commit -m "feat(trace-diagnose): builtin rule #2 tool_error_swallowed"
```

---

## Task 14: Builtin Rule #3 — `retrieval_empty_no_fallback`

**Files:**
- Create: `packages/typescript/src/trace-ai/diagnose/builtin-rules/retrieval-empty-no-fallback.{yaml,ts}`
- Modify: `register.ts`
- Test: `packages/typescript/test/builtin-rule-retrieval-empty-no-fallback.test.ts`
- Fixture: `packages/typescript/test/fixtures/trace-diagnose/synthetic/retrieval-empty-no-fallback.json`

**Predicate spec**: for each retrieval span (`kind === 'retrieval'`) where `attributes['gen_ai.retrieval.result_count'] === 0`, look at the very next time-ordered span:
- If it is an LLM span, fire (no fallback observed).
- If it is another retrieval span (interpreted as retry / rewrite), do NOT fire.
- If it is a tool span (interpreted as alternative source), do NOT fire.

- [ ] **Step 1: Write the rule yaml**

Create `packages/typescript/src/trace-ai/diagnose/builtin-rules/retrieval-empty-no-fallback.yaml`:

```yaml
schema_version: diagnosis-rule/v1
id: retrieval_empty_no_fallback
severity: medium
symptom: empty_retrieval_result_no_fallback_path
taxonomy:
  signals_axis: execution
  ms_class: cascading_error
suggested_fix:
  target: decision_agent.prompt
  change_template: "when retrieval returns 0 results, branch to query rewrite, alternate source, or explicit 'no answer' before generating"
verify_with:
  assertion_templates:
    - "if(retrieval.result_count == 0): next_step in [retry, rewrite, alt_source, no_answer]"
predicate: builtin:retrieval_empty_no_fallback
params: {}
```

- [ ] **Step 2: Write the synthetic fixture**

Create `packages/typescript/test/fixtures/trace-diagnose/synthetic/retrieval-empty-no-fallback.json`:

```json
{
  "hits": {
    "hits": [
      { "_source": { "spanId": "root", "parentSpanId": null, "name": "chat", "startTimeUnixNano": "1700000000000000000", "endTimeUnixNano": "1700000000100000000", "status": { "code": "OK" }, "attributes": { "agent.trace.type": "model" } } },
      { "_source": { "spanId": "r1", "parentSpanId": "root", "name": "retrieval", "startTimeUnixNano": "1700000000010000000", "endTimeUnixNano": "1700000000020000000", "status": { "code": "OK" }, "attributes": { "agent.trace.type": "retrieval", "gen_ai.retrieval.result_count": 0 } } },
      { "_source": { "spanId": "l1", "parentSpanId": "root", "name": "chat", "startTimeUnixNano": "1700000000030000000", "endTimeUnixNano": "1700000000040000000", "status": { "code": "OK" }, "attributes": { "agent.trace.type": "model", "gen_ai.prompt": "Answer based on retrieved docs (which were empty)" } } }
    ]
  }
}
```

- [ ] **Step 3: Write the failing test**

Create `packages/typescript/test/builtin-rule-retrieval-empty-no-fallback.test.ts`:

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assembleTraceTree } from "../src/trace-ai/diagnose/trace-shaper.js";
import { predicate } from "../src/trace-ai/diagnose/builtin-rules/retrieval-empty-no-fallback.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function loadTree(p: string) {
  const raw = JSON.parse(await fs.readFile(p, "utf8")) as { hits: { hits: { _source: any }[] } };
  return assembleTraceTree("tr_x", raw.hits.hits.map((h) => h._source));
}

test("retrieval_empty_no_fallback: fires when next span is LLM after empty retrieval", async () => {
  const tree = await loadTree(path.join(__dirname, "fixtures/trace-diagnose/synthetic/retrieval-empty-no-fallback.json"));
  const hits = predicate(tree, {});
  assert.equal(hits.length, 1);
  assert.deepEqual(hits[0].evidenceSpans, ["r1", "l1"]);
});

test("retrieval_empty_no_fallback: does NOT fire when next span is another retrieval", async () => {
  const spans = [
    { spanId: "r1", parentSpanId: null, name: "retrieval", startTimeUnixNano: "0", endTimeUnixNano: "1", attributes: { "agent.trace.type": "retrieval", "gen_ai.retrieval.result_count": 0 } },
    { spanId: "r2", parentSpanId: "r1", name: "retrieval", startTimeUnixNano: "1", endTimeUnixNano: "2", attributes: { "agent.trace.type": "retrieval", "gen_ai.retrieval.result_count": 5 } },
  ];
  const tree = assembleTraceTree("tr_x", spans);
  assert.equal(predicate(tree, {}).length, 0);
});

test("retrieval_empty_no_fallback: does NOT fire when retrieval has results", async () => {
  const spans = [
    { spanId: "r1", parentSpanId: null, name: "retrieval", startTimeUnixNano: "0", endTimeUnixNano: "1", attributes: { "agent.trace.type": "retrieval", "gen_ai.retrieval.result_count": 3 } },
    { spanId: "l1", parentSpanId: "r1", name: "chat", startTimeUnixNano: "1", endTimeUnixNano: "2", attributes: { "agent.trace.type": "model" } },
  ];
  const tree = assembleTraceTree("tr_x", spans);
  assert.equal(predicate(tree, {}).length, 0);
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd packages/typescript && node --import tsx --test test/builtin-rule-retrieval-empty-no-fallback.test.ts`
Expected: FAIL.

- [ ] **Step 5: Implement the predicate**

Create `packages/typescript/src/trace-ai/diagnose/builtin-rules/retrieval-empty-no-fallback.ts`:

```typescript
import type { Hit, Predicate, Span, TraceTree } from "../types.js";

function resultCount(s: Span): number | null {
  const v = s.attributes["gen_ai.retrieval.result_count"];
  return typeof v === "number" ? v : null;
}

export const predicate: Predicate = (trace: TraceTree): Hit[] => {
  const ordered = trace.spans
    .slice()
    .sort((a, b) => Number(BigInt(a.startTimeUnixNano) - BigInt(b.startTimeUnixNano)));
  const hits: Hit[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const s = ordered[i];
    if (s.kind !== "retrieval") continue;
    if (resultCount(s) !== 0) continue;
    const next = ordered[i + 1];
    if (!next) continue;
    if (next.kind === "llm") {
      hits.push({
        evidenceSpans: [s.spanId, next.spanId],
        excerpt: `retrieval returned 0 results; next step was LLM generation with no fallback path`,
        bindings: {},
      });
    }
    // retrieval (retry/rewrite) or tool (alt source) → no hit
  }
  return hits;
};
```

- [ ] **Step 6: Register the predicate**

Modify `packages/typescript/src/trace-ai/diagnose/builtin-rules/register.ts` (append):

```typescript
import { predicate as retrievalEmptyNoFallback } from "./retrieval-empty-no-fallback.js";
registerPredicate("retrieval_empty_no_fallback", retrievalEmptyNoFallback);
```

- [ ] **Step 7: Run test to verify it passes**

Run: `cd packages/typescript && node --import tsx --test test/builtin-rule-retrieval-empty-no-fallback.test.ts`
Expected: 3 tests pass.

- [ ] **Step 8: Commit**

```bash
git add packages/typescript/src/trace-ai/diagnose/builtin-rules/retrieval-empty-no-fallback.* packages/typescript/src/trace-ai/diagnose/builtin-rules/register.ts packages/typescript/test/builtin-rule-retrieval-empty-no-fallback.test.ts packages/typescript/test/fixtures/trace-diagnose/synthetic/retrieval-empty-no-fallback.json
git commit -m "feat(trace-diagnose): builtin rule #3 retrieval_empty_no_fallback"
```

---

## Task 15: Builtin Rule #4 — `llm_response_truncated_no_continue`

**Files:**
- Create: `packages/typescript/src/trace-ai/diagnose/builtin-rules/llm-response-truncated-no-continue.{yaml,ts}`
- Modify: `register.ts`
- Test: `packages/typescript/test/builtin-rule-llm-response-truncated.test.ts`
- Fixture: `packages/typescript/test/fixtures/trace-diagnose/synthetic/llm-response-truncated-no-continue.json`

**Predicate spec**: for each LLM span where `attributes['gen_ai.response.finish_reason'] === 'length'` (or `attributes['llm.finish_reason'] === 'length'`), check whether any subsequent LLM span (in time order) exists in the same `gen_ai.conversation.id`. If none, fire.

- [ ] **Step 1: Write the rule yaml**

Create `packages/typescript/src/trace-ai/diagnose/builtin-rules/llm-response-truncated-no-continue.yaml`:

```yaml
schema_version: diagnosis-rule/v1
id: llm_response_truncated_no_continue
severity: medium
symptom: llm_output_truncated_with_no_continuation
taxonomy:
  signals_axis: execution
  ms_class: context_loss
suggested_fix:
  target: decision_agent.prompt
  change_template: "after finish_reason=length, send a continuation request or split the task earlier"
verify_with:
  assertion_templates:
    - "if(llm.finish_reason == 'length'): next_step in [continuation, split_task]"
predicate: builtin:llm_response_truncated_no_continue
params: {}
```

- [ ] **Step 2: Write the synthetic fixture**

Create `packages/typescript/test/fixtures/trace-diagnose/synthetic/llm-response-truncated-no-continue.json`:

```json
{
  "hits": {
    "hits": [
      { "_source": { "spanId": "root", "parentSpanId": null, "name": "chat", "startTimeUnixNano": "1700000000000000000", "endTimeUnixNano": "1700000000100000000", "status": { "code": "OK" }, "attributes": { "agent.trace.type": "model" } } },
      { "_source": { "spanId": "l1", "parentSpanId": "root", "name": "chat", "startTimeUnixNano": "1700000000010000000", "endTimeUnixNano": "1700000000020000000", "status": { "code": "OK" }, "attributes": { "agent.trace.type": "model", "gen_ai.response.finish_reason": "length", "gen_ai.conversation.id": "c1" } } }
    ]
  }
}
```

- [ ] **Step 3: Write the failing test**

Create `packages/typescript/test/builtin-rule-llm-response-truncated.test.ts`:

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assembleTraceTree } from "../src/trace-ai/diagnose/trace-shaper.js";
import { predicate } from "../src/trace-ai/diagnose/builtin-rules/llm-response-truncated-no-continue.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function loadTree(p: string) {
  const raw = JSON.parse(await fs.readFile(p, "utf8")) as { hits: { hits: { _source: any }[] } };
  return assembleTraceTree("tr_x", raw.hits.hits.map((h) => h._source));
}

test("llm_response_truncated_no_continue: fires when truncated and no follow-up LLM span", async () => {
  const tree = await loadTree(path.join(__dirname, "fixtures/trace-diagnose/synthetic/llm-response-truncated-no-continue.json"));
  const hits = predicate(tree, {});
  assert.equal(hits.length, 1);
  assert.deepEqual(hits[0].evidenceSpans, ["l1"]);
});

test("llm_response_truncated_no_continue: does NOT fire when a continuation LLM span follows", async () => {
  const spans = [
    { spanId: "l1", parentSpanId: null, name: "chat", startTimeUnixNano: "0", endTimeUnixNano: "1", attributes: { "agent.trace.type": "model", "gen_ai.response.finish_reason": "length", "gen_ai.conversation.id": "c1" } },
    { spanId: "l2", parentSpanId: "l1", name: "chat", startTimeUnixNano: "1", endTimeUnixNano: "2", attributes: { "agent.trace.type": "model", "gen_ai.response.finish_reason": "stop", "gen_ai.conversation.id": "c1" } },
  ];
  const tree = assembleTraceTree("tr_x", spans);
  assert.equal(predicate(tree, {}).length, 0);
});

test("llm_response_truncated_no_continue: does NOT fire when finish_reason != length", async () => {
  const spans = [
    { spanId: "l1", parentSpanId: null, name: "chat", startTimeUnixNano: "0", endTimeUnixNano: "1", attributes: { "agent.trace.type": "model", "gen_ai.response.finish_reason": "stop" } },
  ];
  const tree = assembleTraceTree("tr_x", spans);
  assert.equal(predicate(tree, {}).length, 0);
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd packages/typescript && node --import tsx --test test/builtin-rule-llm-response-truncated.test.ts`
Expected: FAIL.

- [ ] **Step 5: Implement the predicate**

Create `packages/typescript/src/trace-ai/diagnose/builtin-rules/llm-response-truncated-no-continue.ts`:

```typescript
import type { Hit, Predicate, Span, TraceTree } from "../types.js";

function finishReason(s: Span): string {
  const a = s.attributes["gen_ai.response.finish_reason"] ?? s.attributes["llm.finish_reason"];
  return typeof a === "string" ? a : "";
}

function conversationId(s: Span): string {
  const v = s.attributes["gen_ai.conversation.id"];
  return typeof v === "string" ? v : "";
}

export const predicate: Predicate = (trace: TraceTree): Hit[] => {
  const llms = (trace.byKind.get("llm") ?? [])
    .slice()
    .sort((a, b) => Number(BigInt(a.startTimeUnixNano) - BigInt(b.startTimeUnixNano)));
  const hits: Hit[] = [];
  for (let i = 0; i < llms.length; i++) {
    const s = llms[i];
    if (finishReason(s) !== "length") continue;
    const convId = conversationId(s);
    let hasContinuation = false;
    for (let j = i + 1; j < llms.length; j++) {
      if (conversationId(llms[j]) === convId) { hasContinuation = true; break; }
    }
    if (!hasContinuation) {
      hits.push({
        evidenceSpans: [s.spanId],
        excerpt: `LLM response truncated (finish_reason=length) with no continuation span in conversation '${convId}'`,
        bindings: { conversation_id: convId },
      });
    }
  }
  return hits;
};
```

- [ ] **Step 6: Register**

Modify `register.ts` (append):
```typescript
import { predicate as llmResponseTruncatedNoContinue } from "./llm-response-truncated-no-continue.js";
registerPredicate("llm_response_truncated_no_continue", llmResponseTruncatedNoContinue);
```

- [ ] **Step 7: Run test to verify it passes**

Run: `cd packages/typescript && node --import tsx --test test/builtin-rule-llm-response-truncated.test.ts`
Expected: 3 tests pass.

- [ ] **Step 8: Commit**

```bash
git add packages/typescript/src/trace-ai/diagnose/builtin-rules/llm-response-truncated-no-continue.* packages/typescript/src/trace-ai/diagnose/builtin-rules/register.ts packages/typescript/test/builtin-rule-llm-response-truncated.test.ts packages/typescript/test/fixtures/trace-diagnose/synthetic/llm-response-truncated-no-continue.json
git commit -m "feat(trace-diagnose): builtin rule #4 llm_response_truncated_no_continue"
```

---

## Task 16: Builtin Rule #5 — `excessive_tool_calls_per_turn`

**Files:**
- Create: `packages/typescript/src/trace-ai/diagnose/builtin-rules/excessive-tool-calls-per-turn.{yaml,ts}`
- Modify: `register.ts`
- Test: `packages/typescript/test/builtin-rule-excessive-tool-calls.test.ts`
- Fixture: `packages/typescript/test/fixtures/trace-diagnose/synthetic/excessive-tool-calls-per-turn.json`

**Predicate spec**: PR-A approximates "user turn" as "all spans sharing the same `gen_ai.conversation.id`" — for a single trace this is usually one turn. Count `kind === 'tool'` spans; if count > `params.max_tool_calls_per_turn` (default 10), fire one hit listing the excess tool span IDs.

- [ ] **Step 1: Write the rule yaml**

Create `packages/typescript/src/trace-ai/diagnose/builtin-rules/excessive-tool-calls-per-turn.yaml`:

```yaml
schema_version: diagnosis-rule/v1
id: excessive_tool_calls_per_turn
severity: medium
symptom: excessive_tool_calls_per_user_turn
taxonomy:
  signals_axis: execution
  ms_class: tool_misuse
suggested_fix:
  target: decision_agent.prompt
  change_template: "constrain plan to at most {{max_calls}} tool calls per user turn; observed {{count}}"
verify_with:
  assertion_templates:
    - "tool_call_count_per_turn <= {{max_calls}}"
predicate: builtin:excessive_tool_calls_per_turn
params:
  max_tool_calls_per_turn: 10
```

- [ ] **Step 2: Write the synthetic fixture** (12 tool calls — exceeds default 10)

Create `packages/typescript/test/fixtures/trace-diagnose/synthetic/excessive-tool-calls-per-turn.json`:

```json
{
  "hits": {
    "hits": [
      { "_source": { "spanId": "root", "parentSpanId": null, "name": "chat", "startTimeUnixNano": "1700000000000000000", "endTimeUnixNano": "1700000000200000000", "status": { "code": "OK" }, "attributes": { "agent.trace.type": "model", "gen_ai.conversation.id": "c1" } } },
      { "_source": { "spanId": "t1", "parentSpanId": "root", "name": "tool", "startTimeUnixNano": "1700000000010000000", "endTimeUnixNano": "1700000000011000000", "attributes": { "agent.trace.type": "tool", "gen_ai.conversation.id": "c1" } } },
      { "_source": { "spanId": "t2", "parentSpanId": "root", "name": "tool", "startTimeUnixNano": "1700000000020000000", "endTimeUnixNano": "1700000000021000000", "attributes": { "agent.trace.type": "tool", "gen_ai.conversation.id": "c1" } } },
      { "_source": { "spanId": "t3", "parentSpanId": "root", "name": "tool", "startTimeUnixNano": "1700000000030000000", "endTimeUnixNano": "1700000000031000000", "attributes": { "agent.trace.type": "tool", "gen_ai.conversation.id": "c1" } } },
      { "_source": { "spanId": "t4", "parentSpanId": "root", "name": "tool", "startTimeUnixNano": "1700000000040000000", "endTimeUnixNano": "1700000000041000000", "attributes": { "agent.trace.type": "tool", "gen_ai.conversation.id": "c1" } } },
      { "_source": { "spanId": "t5", "parentSpanId": "root", "name": "tool", "startTimeUnixNano": "1700000000050000000", "endTimeUnixNano": "1700000000051000000", "attributes": { "agent.trace.type": "tool", "gen_ai.conversation.id": "c1" } } },
      { "_source": { "spanId": "t6", "parentSpanId": "root", "name": "tool", "startTimeUnixNano": "1700000000060000000", "endTimeUnixNano": "1700000000061000000", "attributes": { "agent.trace.type": "tool", "gen_ai.conversation.id": "c1" } } },
      { "_source": { "spanId": "t7", "parentSpanId": "root", "name": "tool", "startTimeUnixNano": "1700000000070000000", "endTimeUnixNano": "1700000000071000000", "attributes": { "agent.trace.type": "tool", "gen_ai.conversation.id": "c1" } } },
      { "_source": { "spanId": "t8", "parentSpanId": "root", "name": "tool", "startTimeUnixNano": "1700000000080000000", "endTimeUnixNano": "1700000000081000000", "attributes": { "agent.trace.type": "tool", "gen_ai.conversation.id": "c1" } } },
      { "_source": { "spanId": "t9", "parentSpanId": "root", "name": "tool", "startTimeUnixNano": "1700000000090000000", "endTimeUnixNano": "1700000000091000000", "attributes": { "agent.trace.type": "tool", "gen_ai.conversation.id": "c1" } } },
      { "_source": { "spanId": "t10", "parentSpanId": "root", "name": "tool", "startTimeUnixNano": "1700000000100000000", "endTimeUnixNano": "1700000000101000000", "attributes": { "agent.trace.type": "tool", "gen_ai.conversation.id": "c1" } } },
      { "_source": { "spanId": "t11", "parentSpanId": "root", "name": "tool", "startTimeUnixNano": "1700000000110000000", "endTimeUnixNano": "1700000000111000000", "attributes": { "agent.trace.type": "tool", "gen_ai.conversation.id": "c1" } } },
      { "_source": { "spanId": "t12", "parentSpanId": "root", "name": "tool", "startTimeUnixNano": "1700000000120000000", "endTimeUnixNano": "1700000000121000000", "attributes": { "agent.trace.type": "tool", "gen_ai.conversation.id": "c1" } } }
    ]
  }
}
```

- [ ] **Step 3: Write the failing test**

Create `packages/typescript/test/builtin-rule-excessive-tool-calls.test.ts`:

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assembleTraceTree } from "../src/trace-ai/diagnose/trace-shaper.js";
import { predicate } from "../src/trace-ai/diagnose/builtin-rules/excessive-tool-calls-per-turn.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function loadTree(p: string) {
  const raw = JSON.parse(await fs.readFile(p, "utf8")) as { hits: { hits: { _source: any }[] } };
  return assembleTraceTree("tr_x", raw.hits.hits.map((h) => h._source));
}

test("excessive_tool_calls_per_turn: fires when tool count exceeds default 10", async () => {
  const tree = await loadTree(path.join(__dirname, "fixtures/trace-diagnose/synthetic/excessive-tool-calls-per-turn.json"));
  const hits = predicate(tree, { max_tool_calls_per_turn: 10 });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].evidenceSpans.length, 12);
  assert.equal(hits[0].bindings.count, 12);
  assert.equal(hits[0].bindings.max_calls, 10);
});

test("excessive_tool_calls_per_turn: does NOT fire when count == max", async () => {
  const spans = [
    { spanId: "t1", parentSpanId: null, name: "tool", startTimeUnixNano: "0", endTimeUnixNano: "1", attributes: { "agent.trace.type": "tool" } },
    { spanId: "t2", parentSpanId: "t1", name: "tool", startTimeUnixNano: "1", endTimeUnixNano: "2", attributes: { "agent.trace.type": "tool" } },
  ];
  const tree = assembleTraceTree("tr_x", spans);
  assert.equal(predicate(tree, { max_tool_calls_per_turn: 2 }).length, 0);
});

test("excessive_tool_calls_per_turn: respects param override", async () => {
  const spans = [
    { spanId: "t1", parentSpanId: null, name: "tool", startTimeUnixNano: "0", endTimeUnixNano: "1", attributes: { "agent.trace.type": "tool" } },
    { spanId: "t2", parentSpanId: "t1", name: "tool", startTimeUnixNano: "1", endTimeUnixNano: "2", attributes: { "agent.trace.type": "tool" } },
    { spanId: "t3", parentSpanId: "t2", name: "tool", startTimeUnixNano: "2", endTimeUnixNano: "3", attributes: { "agent.trace.type": "tool" } },
  ];
  const tree = assembleTraceTree("tr_x", spans);
  assert.equal(predicate(tree, { max_tool_calls_per_turn: 2 }).length, 1);
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd packages/typescript && node --import tsx --test test/builtin-rule-excessive-tool-calls.test.ts`
Expected: FAIL.

- [ ] **Step 5: Implement the predicate**

Create `packages/typescript/src/trace-ai/diagnose/builtin-rules/excessive-tool-calls-per-turn.ts`:

```typescript
import type { Hit, Predicate, TraceTree } from "../types.js";

export const predicate: Predicate = (trace: TraceTree, params: Record<string, unknown>): Hit[] => {
  const max = (params.max_tool_calls_per_turn as number | undefined) ?? 10;
  const tools = trace.byKind.get("tool") ?? [];
  if (tools.length <= max) return [];
  return [{
    evidenceSpans: tools.map((t) => t.spanId),
    excerpt: `tool calls per turn exceeded threshold: ${tools.length} > ${max}`,
    bindings: { count: tools.length, max_calls: max },
  }];
};
```

- [ ] **Step 6: Register**

Modify `register.ts` (append):
```typescript
import { predicate as excessiveToolCallsPerTurn } from "./excessive-tool-calls-per-turn.js";
registerPredicate("excessive_tool_calls_per_turn", excessiveToolCallsPerTurn);
```

- [ ] **Step 7: Run test to verify it passes**

Run: `cd packages/typescript && node --import tsx --test test/builtin-rule-excessive-tool-calls.test.ts`
Expected: 3 tests pass.

- [ ] **Step 8: Commit**

```bash
git add packages/typescript/src/trace-ai/diagnose/builtin-rules/excessive-tool-calls-per-turn.* packages/typescript/src/trace-ai/diagnose/builtin-rules/register.ts packages/typescript/test/builtin-rule-excessive-tool-calls.test.ts packages/typescript/test/fixtures/trace-diagnose/synthetic/excessive-tool-calls-per-turn.json
git commit -m "feat(trace-diagnose): builtin rule #5 excessive_tool_calls_per_turn"
```

---

## Task 17: CLI command — `commands/trace.ts` (`diagnose` + `rules validate`)

**Files:**
- Create: `packages/typescript/src/commands/trace.ts`
- Test: `packages/typescript/test/trace-diagnose-cli.test.ts`
- Test: `packages/typescript/test/trace-diagnose-rules-validate.test.ts`

This is the CLI entrypoint. It parses argv via `yargs` (already a dep) and dispatches to `diagnose()` or to a `rules validate` action that loads & validates a single yaml.

- [ ] **Step 1: Write the failing CLI dispatch test**

Create `packages/typescript/test/trace-diagnose-cli.test.ts`:

```typescript
import test from "node:test";
import assert from "node:assert/strict";

import { parseTraceArgs } from "../src/commands/trace.js";

test("parseTraceArgs: 'diagnose <id>' parses traceId positional", () => {
  const r = parseTraceArgs(["diagnose", "tr_de39"]);
  assert.equal(r.subcommand, "diagnose");
  assert.equal(r.traceId, "tr_de39");
  assert.equal(r.out, null);  // default → resolved later
  assert.equal(r.noBuiltin, false);
});

test("parseTraceArgs: 'diagnose <id> --out=path' parses out flag", () => {
  const r = parseTraceArgs(["diagnose", "tr_de39", "--out", "diagnosis/x.yaml"]);
  assert.equal(r.out, "diagnosis/x.yaml");
});

test("parseTraceArgs: 'diagnose <id> --no-builtin' sets noBuiltin", () => {
  const r = parseTraceArgs(["diagnose", "tr_de39", "--no-builtin"]);
  assert.equal(r.noBuiltin, true);
});

test("parseTraceArgs: 'diagnose rules validate <path>' parses to rulesValidate subcommand", () => {
  const r = parseTraceArgs(["diagnose", "rules", "validate", "rules/r.yaml"]);
  assert.equal(r.subcommand, "rules-validate");
  assert.equal(r.rulePath, "rules/r.yaml");
});

test("parseTraceArgs: missing subcommand returns help intent", () => {
  const r = parseTraceArgs([]);
  assert.equal(r.subcommand, "help");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/typescript && node --import tsx --test test/trace-diagnose-cli.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `commands/trace.ts`**

Create `packages/typescript/src/commands/trace.ts`:

```typescript
import yargs from "yargs";

import { diagnose, TraceNotFoundError } from "../trace-ai/diagnose/index.js";
import { RuleLoadError } from "../trace-ai/diagnose/rule-loader.js";
import { RuleSchema } from "../trace-ai/diagnose/schemas.js";
import yaml from "js-yaml";
import fs from "node:fs/promises";

export interface ParsedTraceArgs {
  subcommand: "diagnose" | "rules-validate" | "help";
  traceId?: string;
  rulePath?: string;
  out: string | null;
  rulesDir: string | null;
  noBuiltin: boolean;
  noLlm: boolean;
  baseUrl: string | null;
  token: string | null;
  businessDomain: string | null;
}

export function parseTraceArgs(argv: string[]): ParsedTraceArgs {
  if (argv.length === 0) {
    return defaults("help");
  }
  const head = argv[0];
  if (head !== "diagnose") {
    return defaults("help");
  }
  if (argv[1] === "rules" && argv[2] === "validate") {
    return { ...defaults("rules-validate"), rulePath: argv[3] };
  }
  // diagnose <traceId> [flags...]
  const parsed = yargs(argv.slice(1))
    .option("out", { type: "string", default: undefined })
    .option("rules", { type: "string", default: undefined })
    .option("no-builtin", { type: "boolean", default: false })
    .option("no-llm", { type: "boolean", default: true })  // PR-A: forced true
    .option("token", { type: "string" })
    .option("base-url", { type: "string" })
    .option("business-domain", { alias: "bd", type: "string" })
    .help(false)
    .parseSync();

  return {
    subcommand: "diagnose",
    traceId: String(parsed._[0] ?? ""),
    out: parsed.out ?? null,
    rulesDir: parsed.rules ?? null,
    noBuiltin: parsed["no-builtin"] === true,
    noLlm: parsed["no-llm"] === true,
    baseUrl: (parsed["base-url"] as string | undefined) ?? null,
    token: (parsed.token as string | undefined) ?? null,
    businessDomain: (parsed["business-domain"] as string | undefined) ?? null,
  };
}

function defaults(sub: ParsedTraceArgs["subcommand"]): ParsedTraceArgs {
  return {
    subcommand: sub,
    out: null,
    rulesDir: null,
    noBuiltin: false,
    noLlm: true,
    baseUrl: null,
    token: null,
    businessDomain: null,
  };
}

function printHelp(): void {
  process.stdout.write(`kweaver trace — trace diagnosis commands

Subcommands:
  trace diagnose <trace_id>                   Diagnose a single trace; emit YAML report
    --out <file>                              Write report to file (default: ./diagnosis/<trace_id>.yaml)
    --rules <dir>                             Override <cwd>/diagnosis-rules/
    --no-builtin                              Disable the 5 builtin baseline rules
    --no-llm                                  PR-A: always on; PR-B will allow disabling

  trace diagnose rules validate <rule.yaml>   Validate a rule yaml file (exit 0 ok, 6 fail)

Auth flags (any subcommand): --token, --base-url, --business-domain (-bd).
`);
}

export async function runTraceCommand(rest: string[]): Promise<number> {
  const args = parseTraceArgs(rest);
  if (args.subcommand === "help") {
    printHelp();
    return 0;
  }
  if (args.subcommand === "rules-validate") {
    return await runRulesValidate(args.rulePath ?? "");
  }
  // diagnose
  if (!args.traceId) {
    process.stderr.write("error: missing <trace_id>\n");
    return 2;
  }
  const baseUrl = args.baseUrl ?? process.env.KWEAVER_BASE_URL ?? "";
  const token = args.token ?? process.env.KWEAVER_TOKEN ?? "";
  const bd = args.businessDomain ?? "bd_public";
  if (!baseUrl || !token) {
    process.stderr.write("error: missing --base-url / --token (or KWEAVER_BASE_URL / KWEAVER_TOKEN env)\n");
    return 5;
  }
  try {
    await diagnose(args.traceId, {
      out: args.out,
      rulesDir: args.rulesDir,
      noBuiltin: args.noBuiltin,
      noLlm: true,
      agentProvider: null,
      timeoutMs: 60000,
      baseUrl,
      token,
      businessDomain: bd,
    });
    return 0;
  } catch (e) {
    if (e instanceof TraceNotFoundError) {
      process.stderr.write(`error: ${e.message}; check time window / tenant\n`);
      return 4;
    }
    if (e instanceof RuleLoadError) {
      process.stderr.write(`error: ${e.message}\n`);
      return 6;
    }
    process.stderr.write(`error: ${(e as Error).message}\n`);
    return 1;
  }
}

async function runRulesValidate(rulePath: string): Promise<number> {
  if (!rulePath) {
    process.stderr.write("error: missing <rule.yaml> path\n");
    return 2;
  }
  let raw: string;
  try {
    raw = await fs.readFile(rulePath, "utf8");
  } catch (e) {
    process.stderr.write(`error: cannot read ${rulePath}: ${(e as Error).message}\n`);
    return 6;
  }
  let parsed: unknown;
  try {
    parsed = yaml.load(raw);
  } catch (e) {
    process.stderr.write(`error: yaml parse error: ${(e as Error).message}\n`);
    return 6;
  }
  const result = RuleSchema.safeParse(parsed);
  if (!result.success) {
    process.stderr.write(`error: schema validation failed:\n${result.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n")}\n`);
    return 6;
  }
  process.stdout.write(`ok: ${rulePath} validates against diagnosis-rule/v1\n`);
  return 0;
}
```

- [ ] **Step 4: Run dispatch test to verify it passes**

Run: `cd packages/typescript && node --import tsx --test test/trace-diagnose-cli.test.ts`
Expected: 5 tests pass.

- [ ] **Step 5: Write failing `rules validate` integration test**

Create `packages/typescript/test/trace-diagnose-rules-validate.test.ts`:

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runTraceCommand } from "../src/commands/trace.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(__dirname, "fixtures/trace-diagnose");

test("runTraceCommand: 'diagnose rules validate' on good yaml → exit 0", async () => {
  const code = await runTraceCommand(["diagnose", "rules", "validate", path.join(FIX, "rules-good/r1.yaml")]);
  assert.equal(code, 0);
});

test("runTraceCommand: 'diagnose rules validate' on bad yaml → exit 6", async () => {
  const code = await runTraceCommand(["diagnose", "rules", "validate", path.join(FIX, "rules-bad/missing-taxonomy.yaml")]);
  assert.equal(code, 6);
});

test("runTraceCommand: 'diagnose rules validate' on missing path → exit 2", async () => {
  const code = await runTraceCommand(["diagnose", "rules", "validate"]);
  assert.equal(code, 2);
});
```

- [ ] **Step 6: Run rules-validate test to verify it passes**

Run: `cd packages/typescript && node --import tsx --test test/trace-diagnose-rules-validate.test.ts`
Expected: 3 tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/typescript/src/commands/trace.ts packages/typescript/test/trace-diagnose-cli.test.ts packages/typescript/test/trace-diagnose-rules-validate.test.ts
git commit -m "feat(cli): trace command — diagnose <id> + diagnose rules validate"
```

---

## Task 18: Wire `trace` Into `cli.ts` Top-Level Dispatch + Help

**Files:**
- Modify: `packages/typescript/src/cli.ts`

- [ ] **Step 1: Inspect the current dispatch shape**

Run: `grep -n 'command ===' packages/typescript/src/cli.ts | head -20`
Expected: see existing `if (command === "agent")` / `if (command === "dataflow")` style branches.

- [ ] **Step 2: Add the trace dispatch**

In `packages/typescript/src/cli.ts`, after the existing top-level command branches (search for the last `if (command === "..."`), add:

```typescript
if (command === "trace") {
  const { runTraceCommand } = await import("./commands/trace.js");
  process.exit(await runTraceCommand(rest));
}
```

(Use dynamic import to keep cold-start cost off other commands.)

- [ ] **Step 3: Update `printHelp()` to include `trace`**

Locate `printHelp()` and add to the command list:

```
  trace diagnose <trace_id>      Diagnose a single trace
  trace diagnose rules validate  Validate a rule yaml
```

(Match the indentation / formatting of the other entries — inspect the existing block first.)

- [ ] **Step 4: Verify it lints**

Run: `cd packages/typescript && npm run lint`
Expected: clean.

- [ ] **Step 5: Manual smoke (skipped if claude env not present — just verify compile)**

Run: `cd packages/typescript && node --import tsx src/cli.ts --help`
Expected: `trace diagnose ...` appears in the output.

- [ ] **Step 6: Commit**

```bash
git add packages/typescript/src/cli.ts
git commit -m "feat(cli): wire trace command into top-level dispatch + help"
```

---

## Task 19: Snapshot Real Fixture from plan-traceai

**Files:**
- Create: `packages/typescript/test/fixtures/trace-diagnose/real/de39cbe9.json`

- [ ] **Step 1: Verify the source file exists**

Run: `ls /Users/xupeng/lab/plan-traceai/status_quo/附录-完整trace样本/01_raw_opensearch_response.json`
Expected: file present.

- [ ] **Step 2: Copy the fixture**

Run:
```bash
mkdir -p packages/typescript/test/fixtures/trace-diagnose/real
cp /Users/xupeng/lab/plan-traceai/status_quo/附录-完整trace样本/01_raw_opensearch_response.json packages/typescript/test/fixtures/trace-diagnose/real/de39cbe9.json
```

- [ ] **Step 3: Verify the file was copied and is valid JSON**

Run:
```bash
node -e "JSON.parse(require('fs').readFileSync('packages/typescript/test/fixtures/trace-diagnose/real/de39cbe9.json','utf8'))" && echo OK
```
Expected: `OK`.

- [ ] **Step 4: Commit**

```bash
git add packages/typescript/test/fixtures/trace-diagnose/real/de39cbe9.json
git commit -m "test(trace-diagnose): snapshot real fixture from plan-traceai status_quo"
```

---

## Task 20: End-to-End Test (5 synthetic + 1 real)

**Files:**
- Create: `packages/typescript/test/e2e/trace-diagnose.test.ts`

The e2e test wires `mockFetchSequence` to return the synthetic / real fixtures, calls `diagnose()` programmatically, and asserts both the per-rule findings and the synthesizer's `summary` block.

- [ ] **Step 1: Write the failing e2e test**

Create `packages/typescript/test/e2e/trace-diagnose.test.ts`:

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

import { diagnose } from "../../src/trace-ai/diagnose/index.js";

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
      assert.equal(r.summary.headline.includes(ruleHits[0].symptom) || r.summary.headline === "No findings", true);
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
  const { ReportSchema } = await import("../../src/trace-ai/diagnose/schemas.js");
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
```

- [ ] **Step 2: Run e2e to verify it fails initially, then debug as needed**

Run: `cd packages/typescript && npm run test:e2e`
Expected initially: tests run; some may fail if a builtin rule's predicate has a bug. Fix per failure (most likely culprits: time-order sort on the real fixture surfacing nuance, or `gen_ai.tool.args` shape differences).

If a real-fixture finding fires unexpectedly, **first** review the fixture trace tree to confirm the predicate is correct in spirit, **then** tighten the predicate if it really is over-firing. Do **not** weaken the predicate to silence the test if the predicate is doing the right thing — that means you need a different fixture.

- [ ] **Step 3: All e2e tests pass**

Run: `cd packages/typescript && npm run test:e2e`
Expected: 7 tests pass (5 synthetic + 1 real + 1 yaml-shape).

- [ ] **Step 4: Run full test suite (unit + e2e)**

Run: `cd packages/typescript && npm test && npm run test:e2e`
Expected: everything green; lint clean.

- [ ] **Step 5: Commit**

```bash
git add packages/typescript/test/e2e/trace-diagnose.test.ts
git commit -m "test(trace-diagnose): e2e covering 5 synthetic + 1 real fixture + yaml schema"
```

---

## Task 21: Documentation Sync

**Files:**
- Create: `packages/typescript/skills/kweaver-core/references/trace.md`
- Modify: `packages/typescript/README.md`

Per [`AGENTS.md`](../../AGENTS.md), CLI changes must update four places. `cli.ts` printHelp + `commands/trace.ts` help were done in Tasks 17–18. The remaining two are the skill reference doc and the README.

- [ ] **Step 1: Inspect existing skill reference doc shape**

Run: `ls packages/typescript/skills/kweaver-core/references/ && head -40 packages/typescript/skills/kweaver-core/references/agent.md`
Expected: see the convention used for synopsis / examples / exit-codes sections.

- [ ] **Step 2: Write `trace.md` reference doc**

Create `packages/typescript/skills/kweaver-core/references/trace.md`:

```markdown
# `kweaver trace` — trace diagnosis

Symbolic-only diagnosis of a single trace. Produces a YAML report at
`trace-diagnose-report/v1`. Issue #1 PR-A scope; PR-B will add LLM rubric judgments
and a within-trace synthesizer.

## Synopsis

```
kweaver trace diagnose <trace_id> [flags]
kweaver trace diagnose rules validate <rule.yaml>
```

## Flags (`diagnose <trace_id>`)

| Flag | Default | Description |
|------|---------|-------------|
| `--out <file>` | `./diagnosis/<trace_id>.yaml` | Write report to file (`mkdir -p` if needed) |
| `--rules <dir>` | `<cwd>/diagnosis-rules/` | Override the team rules directory |
| `--no-builtin` | off | Disable the 5 builtin baseline rules (debug only) |
| `--no-llm` | always on (PR-A) | Reserved; PR-B will allow disabling |
| `--token <token>` | `$KWEAVER_TOKEN` | Bearer token |
| `--base-url <url>` | `$KWEAVER_BASE_URL` | KWeaver platform base URL |
| `-bd, --business-domain <bd>` | `bd_public` | Business domain |

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | Success (including 0 findings) |
| 2 | Bad arguments |
| 4 | Trace not found |
| 5 | Auth missing / unreachable |
| 6 | Rule load / schema validation failure |

## Examples

```bash
# Diagnose a single trace
kweaver trace diagnose tr_de39 --out=diagnosis/refund-001.yaml

# Validate a team-supplied rule yaml
kweaver trace diagnose rules validate diagnosis-rules/my-rule.yaml
```

## Builtin baseline rules (5)

| rule_id | Signals axis | MS class | Detects |
|---------|--------------|----------|---------|
| tool_loop_no_state_change | execution | retry_loop | Same tool, same args, no state change ≥ 3× |
| tool_error_swallowed | execution | cascading_error | Tool errored; next LLM prompt lacks the error |
| retrieval_empty_no_fallback | execution | cascading_error | Retrieval = 0 results, next is LLM (no fallback) |
| llm_response_truncated_no_continue | execution | context_loss | finish_reason=length, no continuation |
| excessive_tool_calls_per_turn | execution | tool_misuse | Tool count per turn > 10 |

See `docs/superpowers/specs/2026-05-11-m4-diagnose-issue1-design.md` for the full design including the rubric layer and within-trace synthesizer (PR-B).
```

- [ ] **Step 3: Modify README.md**

Inspect: `grep -n 'agent' packages/typescript/README.md | head`
Expected: locate the "command summary" section.

In `packages/typescript/README.md`, in the command summary block, add:

```
- `kweaver trace diagnose <trace_id>` — diagnose a single trace; produces a YAML report (`trace-diagnose-report/v1`)
- `kweaver trace diagnose rules validate <rule.yaml>` — validate a custom diagnosis-rule yaml
```

Match the formatting of adjacent bullets.

- [ ] **Step 4: Commit**

```bash
git add packages/typescript/skills/kweaver-core/references/trace.md packages/typescript/README.md
git commit -m "docs(trace-diagnose): skill reference + README command summary"
```

---

## Task 22: Final Verification

- [ ] **Step 1: Lint**

Run: `cd packages/typescript && npm run lint`
Expected: 0 errors.

- [ ] **Step 2: All unit tests**

Run: `cd packages/typescript && npm test`
Expected: all green.

- [ ] **Step 3: All e2e tests**

Run: `cd packages/typescript && npm run test:e2e`
Expected: all green.

- [ ] **Step 4: Coverage (if `make test-cover` exists at repo root)**

Run from repo root: `make test-cover` (skip if Makefile target missing).
Expected: coverage report generated; new modules have reasonable coverage.

- [ ] **Step 5: Smoke against `--help`**

Run: `cd packages/typescript && node --import tsx src/cli.ts --help | grep trace`
Expected: `trace diagnose` line appears.

Run: `cd packages/typescript && node --import tsx src/cli.ts trace`
Expected: trace subcommand help printed; exit 0.

- [ ] **Step 6: Optional — open PR**

If working on a feature branch:

```bash
gh pr create --title "trace diagnose (PR-A: symbolic) — issue #120" \
  --body "$(cat <<'EOF'
## Summary

PR-A of [#120](https://github.com/kweaver-ai/kweaver-sdk/issues/120). Ships symbolic-only `kweaver trace diagnose <trace_id>` with 5 builtin baseline rules, deterministic within-trace summary template, and `diagnose rules validate` subcommand.

PR-B (LLM rubric + agent abstraction + agent-mode synthesizer) follows in a subsequent PR.

## Test plan

- [x] Unit tests: rule-loader, predicate-registry, signal-probe, synthesizer-template, report-assembler, trace-shaper, trace-api
- [x] Per-rule predicate tests for all 5 baselines
- [x] E2E: 5 synthetic fixtures each fire their respective rule; real status_quo trace fires nothing
- [x] `rules validate` exits 0/6 correctly
- [x] Lint clean
- [x] AGENTS.md sync: cli.ts help, commands/trace.ts help, skills/kweaver-core/references/trace.md, README

## Reference

- Spec: `docs/superpowers/specs/2026-05-11-m4-diagnose-issue1-design.md`
- Plan: `docs/superpowers/plans/2026-05-11-m4-diagnose-issue1-pra-symbolic.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review Notes (auto-generated from spec scan)

| Spec section | Plan task |
|---|---|
| §Architecture / Module layout | Tasks 2–11 |
| §Contracts / `diagnosis-rule/v1` zod | Task 3 |
| §Contracts / `trace-diagnose-report/v1` zod | Task 3 |
| §Contracts / Predicate signature | Task 2 (types) + each rule task |
| §Builtin Rules / 5 symbolic | Tasks 12–16 |
| §Builtin Rules / 1 rubric | **Deferred to PR-B plan** |
| §Synthesizer | Task 9 (template only); agent mode deferred to PR-B |
| §CLI Surface | Tasks 17–18 |
| §Provider Implementation | **Deferred to PR-B plan** |
| §Error Handling | Task 17 (CLI exit codes) + per-component tests |
| §Testing | Each task includes its own tests; Task 20 = e2e |
| §Documentation Synchronization | Task 21 (skill reference + README); Task 18 (cli.ts help); Task 17 (commands/trace.ts help) |

**PR-A intentionally defers:** rubric rule, AgentProvider abstraction, claude-code subprocess provider, agent-mode synthesizer, `--no-llm` reversal, decision-agent stub. These are PR-B and will be planned after PR-A learnings are in.
