# M5 PR-A — Eval-Set Build + Schema Validate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 M5 issue #128 PR-A 范围 —— `kweaver trace eval-set build` 子命令（`--diagnosis=` + `--queries=` 双源 lift → query_id 补齐 → redaction → 写盘 → schema 校验）+ `kweaver trace schema validate <file>` 子命令（B5 zod 注册表薄包装）。落地后用户能把 M4 诊断报告或自有 queries+golden truth 固化成 git-trackable eval-set 目录，并本地校验任何 eval-set / index yaml。**还不能跑测试**——test 闭环属 PR-B。

**Architecture:** 新建 `src/trace-ai/eval-set/` 业务模块（peer of `diagnose/` 与 `scan/`），扩展 `src/commands/trace.ts` dispatch 加 `eval-set` 与 `schema` 两个新顶层子命令。B5 zod 在新文件 `eval-set/schemas.ts` 里定义 4 套 schema（不进 M4 既有 `diagnose/schemas.ts`）。redaction 走 builtin 兜底 + `<repo>/redaction-rules/` + `--redaction-rules=` 覆盖链。不引入新共享层组件，不依赖远端 async job / evaluator 服务（spec doc §4.5）。

**Tech Stack:** TypeScript（ESM；导入用 `.js` 扩展名）/ zod（既有 dep）/ yaml `js-yaml`（既有 dep）/ yargs（既有 dep）/ node:test + node:assert（既有 test runner）。

**Spec reference:** [`docs/superpowers/specs/2026-05-13-m5-eval-set-builder-design.md`](../specs/2026-05-13-m5-eval-set-builder-design.md) §4-§5 / §7-§8 / §10.1

**Issue:** [kweaver-ai/kweaver-sdk#128](https://github.com/kweaver-ai/kweaver-sdk/issues/128)

---

## File Structure（PR-A 触面）

**新建**（10 个）：

| 文件 | 职责 |
|---|---|
| `src/trace-ai/eval-set/types.ts` | EvalCase / EvalSetRef / BuildResult / RedactionRule 等内部类型 |
| `src/trace-ai/eval-set/schemas.ts` | 4 套 zod schema：`trace-eval-set/v1` + `-input/v1` + `-index/v1` + `trace-test-report/v1`，共享 reference/assertions refinement |
| `src/trace-ai/eval-set/index.ts` | 模块对外导出 |
| `src/trace-ai/eval-set/query-picker.ts` | liftFromQueriesFile + liftFromDiagnosis |
| `src/trace-ai/eval-set/redactor.ts` | builtin PII 规则 + 规则链加载 + 应用 |
| `src/trace-ai/eval-set/output-writer.ts` | shard merge + index upsert + on-conflict + .bak |
| `src/trace-ai/eval-set/builder.ts` | ensureQueryId 内联 + build 主流程编排 |
| `test/trace-eval-set-schemas.test.ts` | 4 schema × 合法 / 非法 / refinement |
| `test/trace-eval-set-picker.test.ts` | 两个 lift 函数 happy + edge |
| `test/trace-eval-set-redactor.test.ts` | builtin 5 类 PII 匹配 / 链优先级 / 正则异常 fail-fast |
| `test/trace-eval-set-output-writer.test.ts` | on-conflict 三策略 / .bak / index 增量 upsert |
| `test/trace-eval-set-builder.test.ts` | 端到端 build 一次 + query_id 幂等 |
| `test/trace-eval-set-build-cli.test.ts` | CLI dispatch parser + flag 互斥 + 退出码 |
| `test/trace-schema-validate.test.ts` | kind 推断 / `--kind` 显式 / 推不出报错 |
| `test/fixtures/eval-set/queries-input-valid.yaml` | --queries= fixture |
| `test/fixtures/eval-set/queries-input-empty-refinement.yaml` | refinement fail fixture |

**修改**（1 个）：

| 文件 | 改动 |
|---|---|
| `src/commands/trace.ts` | 加 `eval-set build` + `schema validate` 子命令 dispatch；help 文本同步 |

**不动**（PR-A 不触）：

- `src/api/agent-observability.ts` — `getTraceByConversationId` 扩展挪到 PR-B（PR-A 无消费者，避免 dead code）
- `src/agent-providers/` — `semantic_match` builtin rubric template 在 PR-B
- M4 既有 `diagnose/` / `scan/` 模块 — 完全不动

---

## Task 1：模块骨架 + 类型定义

**Files:**
- Create: `src/trace-ai/eval-set/types.ts`
- Create: `src/trace-ai/eval-set/index.ts`

- [ ] **Step 1: 建文件 `src/trace-ai/eval-set/types.ts`**

```typescript
/**
 * Internal types for the M5 eval-set module (PR-A).
 *
 * These mirror the zod schemas in `./schemas.ts` but are kept independent so
 * non-validating code paths (builder / picker / redactor / output-writer) can
 * import the types without paying the zod parse overhead at module load.
 */

export interface EvalCaseInput {
  user_message: string;
}

export interface EvalReference {
  answer: string;
}

export type AssertionType =
  | "contains"
  | "not_contains"
  | "regex"
  | "tool_call_count"
  | "tool_call_order"
  | "semantic_match"
  | "latency_ms";

export interface EvalAssertion {
  type: AssertionType;
  [key: string]: unknown;
}

export interface EvalCase {
  query_id: string;
  input: EvalCaseInput;
  reference?: EvalReference;
  assertions?: EvalAssertion[];
  tags?: string[];
}

export interface EvalSetIndexShard {
  path: string;
  role?: "seed" | "regression" | "holdout";
}

export interface EvalSetIndex {
  schema_version: "trace-eval-set-index/v1";
  eval_set_id: string;
  shards: EvalSetIndexShard[];
}

export interface BuildResult {
  cases_written: number;
  cases_skipped: number;
  conflicts: string[];
  shard_paths: string[];
  redaction_rules_source: "cli-flag" | "repo" | "builtin";
}

export interface RedactionRule {
  name: string;
  pattern: RegExp;
  replace: string;
}
```

- [ ] **Step 2: 建文件 `src/trace-ai/eval-set/index.ts`**

```typescript
/**
 * M5 eval-set module — public exports.
 *
 * Consumers (commands/trace.ts, tests, future M6 reuse) import from this
 * barrel; internal modules cross-import via direct paths.
 */

export type {
  EvalCase,
  EvalCaseInput,
  EvalReference,
  EvalAssertion,
  AssertionType,
  EvalSetIndex,
  EvalSetIndexShard,
  BuildResult,
  RedactionRule,
} from "./types.js";
```

- [ ] **Step 3: 跑 typecheck 确认无误**

Run: `cd packages/typescript && npx tsc --noEmit`
Expected: PASS（无错误输出）

- [ ] **Step 4: Commit**

```bash
git add packages/typescript/src/trace-ai/eval-set/types.ts \
        packages/typescript/src/trace-ai/eval-set/index.ts
git commit -m "feat(M5/PR-A): scaffold eval-set module with internal types"
```

---

## Task 2：B5 zod schema 4 套

**Files:**
- Create: `src/trace-ai/eval-set/schemas.ts`
- Create: `test/trace-eval-set-schemas.test.ts`

- [ ] **Step 1: 写失败测试 `test/trace-eval-set-schemas.test.ts`**

```typescript
import test from "node:test";
import assert from "node:assert/strict";

import {
  EvalSetIndexSchema,
  EvalSetShardSchema,
  EvalSetInputSchema,
  TestReportSchema,
} from "../src/trace-ai/eval-set/schemas.js";

// ── EvalSetIndexSchema (trace-eval-set-index/v1) ───────────────────────────

test("EvalSetIndexSchema accepts a minimal valid index", () => {
  const ok = EvalSetIndexSchema.safeParse({
    schema_version: "trace-eval-set-index/v1",
    eval_set_id: "cs-v1",
    shards: [{ path: "cases.yaml" }],
  });
  assert.equal(ok.success, true);
});

test("EvalSetIndexSchema rejects ../ escape in shard path", () => {
  const bad = EvalSetIndexSchema.safeParse({
    schema_version: "trace-eval-set-index/v1",
    eval_set_id: "cs-v1",
    shards: [{ path: "../escape.yaml" }],
  });
  assert.equal(bad.success, false);
});

test("EvalSetIndexSchema rejects empty shards array", () => {
  const bad = EvalSetIndexSchema.safeParse({
    schema_version: "trace-eval-set-index/v1",
    eval_set_id: "cs-v1",
    shards: [],
  });
  assert.equal(bad.success, false);
});

// ── EvalSetShardSchema (trace-eval-set/v1) ──────────────────────────────────

test("EvalSetShardSchema accepts a case with reference only", () => {
  const ok = EvalSetShardSchema.safeParse({
    schema_version: "trace-eval-set/v1",
    cases: [
      {
        query_id: "q1",
        input: { user_message: "hello" },
        reference: { answer: "world" },
      },
    ],
  });
  assert.equal(ok.success, true);
});

test("EvalSetShardSchema accepts a case with assertions only", () => {
  const ok = EvalSetShardSchema.safeParse({
    schema_version: "trace-eval-set/v1",
    cases: [
      {
        query_id: "q1",
        input: { user_message: "hello" },
        assertions: [{ type: "contains", value: "world" }],
      },
    ],
  });
  assert.equal(ok.success, true);
});

test("EvalSetShardSchema rejects a case with neither reference nor assertions (refinement)", () => {
  const bad = EvalSetShardSchema.safeParse({
    schema_version: "trace-eval-set/v1",
    cases: [
      {
        query_id: "q1",
        input: { user_message: "hello" },
      },
    ],
  });
  assert.equal(bad.success, false);
});

test("EvalSetShardSchema rejects a case with empty assertions array and no reference", () => {
  const bad = EvalSetShardSchema.safeParse({
    schema_version: "trace-eval-set/v1",
    cases: [
      {
        query_id: "q1",
        input: { user_message: "hello" },
        assertions: [],
      },
    ],
  });
  assert.equal(bad.success, false);
});

// ── EvalSetInputSchema (trace-eval-set-input/v1) — same refinement ──────────

test("EvalSetInputSchema accepts a case with reference + assertions", () => {
  const ok = EvalSetInputSchema.safeParse({
    schema_version: "trace-eval-set-input/v1",
    cases: [
      {
        input: { user_message: "hello" },
        reference: { answer: "world" },
        assertions: [{ type: "contains", value: "world" }],
      },
    ],
  });
  assert.equal(ok.success, true);
});

test("EvalSetInputSchema rejects input case with neither reference nor assertions", () => {
  const bad = EvalSetInputSchema.safeParse({
    schema_version: "trace-eval-set-input/v1",
    cases: [{ input: { user_message: "hello" } }],
  });
  assert.equal(bad.success, false);
});

test("EvalSetInputSchema accepts optional query_id and tags", () => {
  const ok = EvalSetInputSchema.safeParse({
    schema_version: "trace-eval-set-input/v1",
    cases: [
      {
        input: { user_message: "hello" },
        reference: { answer: "world" },
        query_id: "q1",
        tags: ["refund"],
      },
    ],
  });
  assert.equal(ok.success, true);
});

// ── TestReportSchema (trace-test-report/v1) ─────────────────────────────────

test("TestReportSchema accepts a minimal valid report", () => {
  const ok = TestReportSchema.safeParse({
    schema_version: "trace-test-report/v1",
    meta: {
      eval_set_dir: "eval-sets/cs-v1/",
      eval_set_id: "cs-v1",
      candidate: { agent_id: "agt_42" },
      cli_version: "kweaver-sdk@0.8.3",
      ran_at: "2026-05-13T14:23:11Z",
      duration_ms: 1000,
    },
    summary: { total: 1, pass: 1, fail: 0, error: 0, skip: 0, by_assertion_type: {} },
    cases: [
      {
        query_id: "q1",
        status: "pass",
        conversation_id: "conv_x",
        assertion_results: [],
      },
    ],
  });
  assert.equal(ok.success, true);
});

test("TestReportSchema rejects invalid status enum", () => {
  const bad = TestReportSchema.safeParse({
    schema_version: "trace-test-report/v1",
    meta: {
      eval_set_dir: "eval-sets/cs-v1/",
      eval_set_id: "cs-v1",
      candidate: { agent_id: "agt_42" },
      cli_version: "kweaver-sdk@0.8.3",
      ran_at: "2026-05-13T14:23:11Z",
      duration_ms: 1000,
    },
    summary: { total: 1, pass: 1, fail: 0, error: 0, skip: 0, by_assertion_type: {} },
    cases: [
      {
        query_id: "q1",
        status: "wat",
        conversation_id: "conv_x",
        assertion_results: [],
      },
    ],
  });
  assert.equal(bad.success, false);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/typescript && node --import tsx --test test/trace-eval-set-schemas.test.ts`
Expected: FAIL — `Cannot find module '../src/trace-ai/eval-set/schemas.js'`

- [ ] **Step 3: 建文件 `src/trace-ai/eval-set/schemas.ts`**

```typescript
/**
 * M5 eval-set zod schemas (PR-A, MVP-B scope).
 *
 * 4 schemas in this file:
 *   - EvalSetIndexSchema:  trace-eval-set-index/v1   (eval-set dir's index.yaml)
 *   - EvalSetShardSchema:  trace-eval-set/v1         (final shard yaml file)
 *   - EvalSetInputSchema:  trace-eval-set-input/v1   (--queries simplified input)
 *   - TestReportSchema:    trace-test-report/v1      (test report; PR-A defines schema only;
 *                                                     PR-B consumer)
 *
 * EvalSetShardSchema and EvalSetInputSchema share the same refinement:
 *   "for each case, at least one of {reference, non-empty assertions} must be present."
 *
 * The D5 builtin rubric `answer-match-reference` output schema is NOT here —
 * it belongs to the rubric template definition (per spec doc §4.1).
 */

import { z } from "zod";

const InputSchema = z.object({
  user_message: z.string().min(1),
});

const ReferenceSchema = z.object({
  answer: z.string().min(1),
});

const AssertionSchema = z.object({
  type: z.enum([
    "contains",
    "not_contains",
    "regex",
    "tool_call_count",
    "tool_call_order",
    "semantic_match",
    "latency_ms",
  ]),
}).passthrough(); // allow type-specific fields (value, pattern, tool, op, n, ...)

// ── trace-eval-set-index/v1 ──────────────────────────────────────────────

const ShardRefSchema = z.object({
  path: z
    .string()
    .min(1)
    .refine((p) => !p.includes("..") && !p.startsWith("/"), {
      message: "shard path must be a relative path within the eval-set directory (no '..' / '/')",
    }),
  role: z.enum(["seed", "regression", "holdout"]).optional(),
});

export const EvalSetIndexSchema = z.object({
  schema_version: z.literal("trace-eval-set-index/v1"),
  eval_set_id: z.string().min(1),
  shards: z.array(ShardRefSchema).min(1),
});

// ── trace-eval-set/v1 ────────────────────────────────────────────────────

const refineCase = (
  data: { reference?: unknown; assertions?: unknown[] },
  ctx: z.RefinementCtx,
): void => {
  const hasReference = data.reference !== undefined && data.reference !== null;
  const hasAssertions = Array.isArray(data.assertions) && data.assertions.length > 0;
  if (!hasReference && !hasAssertions) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "each case must have either a 'reference' object or a non-empty 'assertions' array; both empty is not allowed (evaluator has no pass/fail signal)",
    });
  }
};

const FinalCaseSchema = z
  .object({
    query_id: z.string().min(1),
    input: InputSchema,
    reference: ReferenceSchema.optional(),
    assertions: z.array(AssertionSchema).optional(),
    tags: z.array(z.string()).optional(),
  })
  .superRefine(refineCase);

export const EvalSetShardSchema = z.object({
  schema_version: z.literal("trace-eval-set/v1"),
  cases: z.array(FinalCaseSchema).min(1),
});

// ── trace-eval-set-input/v1 (D1: same refinement as final) ───────────────

const InputCaseSchema = z
  .object({
    input: InputSchema,
    query_id: z.string().min(1).optional(),
    tags: z.array(z.string()).optional(),
    reference: ReferenceSchema.optional(),
    assertions: z.array(AssertionSchema).optional(),
  })
  .superRefine(refineCase);

export const EvalSetInputSchema = z.object({
  schema_version: z.literal("trace-eval-set-input/v1"),
  cases: z.array(InputCaseSchema).min(1),
});

// ── trace-test-report/v1 (PR-A defines; PR-B writes) ─────────────────────

const AssertionResultSchema = z.object({
  assertion: AssertionSchema,
  verdict: z.enum(["pass", "fail", "skip"]),
  actual: z.unknown().optional(),
});

const CaseResultSchema = z.object({
  query_id: z.string().min(1),
  status: z.enum(["pass", "fail", "error", "skip"]),
  conversation_id: z.string().nullable(),
  trace_id: z.string().nullable().optional(),
  duration_ms: z.number().nonnegative().optional(),
  assertion_results: z.array(AssertionResultSchema),
  failure_reason: z.string().optional(),
  error_code: z.string().optional(),
  error_message: z.string().optional(),
});

export const TestReportSchema = z.object({
  schema_version: z.literal("trace-test-report/v1"),
  meta: z.object({
    eval_set_dir: z.string().min(1),
    eval_set_id: z.string().min(1),
    candidate: z.object({
      agent_id: z.string().min(1),
      agent_version: z.string().optional(),
    }),
    cli_version: z.string().min(1),
    ran_at: z.string().min(1),
    duration_ms: z.number().nonnegative(),
  }),
  summary: z.object({
    total: z.number().int().nonnegative(),
    pass: z.number().int().nonnegative(),
    fail: z.number().int().nonnegative(),
    error: z.number().int().nonnegative(),
    skip: z.number().int().nonnegative(),
    by_assertion_type: z.record(z.string(), z.object({
      pass: z.number().int().nonnegative(),
      fail: z.number().int().nonnegative(),
    })),
  }),
  cases: z.array(CaseResultSchema),
});
```

- [ ] **Step 4: 跑测试确认全过**

Run: `cd packages/typescript && node --import tsx --test test/trace-eval-set-schemas.test.ts`
Expected: PASS — all 10+ tests green

- [ ] **Step 5: 跑全量 test 确认没 break 既有**

Run: `cd packages/typescript && npm test 2>&1 | tail -10`
Expected: 全套通过（既有 M4 测试 + 新加的 schemas test）

- [ ] **Step 6: Commit**

```bash
git add packages/typescript/src/trace-ai/eval-set/schemas.ts \
        packages/typescript/test/trace-eval-set-schemas.test.ts
git commit -m "feat(M5/PR-A): add eval-set + test-report zod schemas (4 schemas, shared refinement)"
```

---

## Task 3：query-picker — liftFromQueriesFile

**Files:**
- Create: `src/trace-ai/eval-set/query-picker.ts`
- Create: `test/trace-eval-set-picker.test.ts`
- Create: `test/fixtures/eval-set/queries-input-valid.yaml`
- Create: `test/fixtures/eval-set/queries-input-empty-refinement.yaml`

- [ ] **Step 1: 建 fixture `test/fixtures/eval-set/queries-input-valid.yaml`**

```yaml
schema_version: trace-eval-set-input/v1
cases:
  - input:
      user_message: "如何申请退款？"
    query_id: refund_001
    tags: ["refund"]
    reference:
      answer: "请在订单详情页点击申请退款。"
    assertions:
      - type: semantic_match
        rubric_template_ref: builtin:answer-match-reference
  - input:
      user_message: "查询账户余额"
    assertions:
      - type: tool_call_count
        tool: balance_query
        op: gte
        n: 1
    tags: ["account"]
```

- [ ] **Step 2: 建 fixture `test/fixtures/eval-set/queries-input-empty-refinement.yaml`**

```yaml
schema_version: trace-eval-set-input/v1
cases:
  - input:
      user_message: "应该失败：既无 reference 又无 assertions"
```

- [ ] **Step 3: 写失败测试 `test/trace-eval-set-picker.test.ts`（只覆盖 liftFromQueriesFile）**

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { liftFromQueriesFile, QueryPickerError } from "../src/trace-ai/eval-set/query-picker.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = (name: string) => path.join(__dirname, "fixtures", "eval-set", name);

test("liftFromQueriesFile lifts a valid simplified input file", async () => {
  const cases = await liftFromQueriesFile(FIXTURE("queries-input-valid.yaml"));
  assert.equal(cases.length, 2);
  assert.equal(cases[0].query_id, "refund_001");
  assert.equal(cases[0].reference?.answer, "请在订单详情页点击申请退款。");
  assert.equal(cases[0].assertions?.[0].type, "semantic_match");
  assert.equal(cases[1].input.user_message, "查询账户余额");
  // query_id 未填时由后续 ensureQueryId 补齐，picker 透传 undefined
  assert.equal(cases[1].query_id, undefined);
});

test("liftFromQueriesFile rejects refinement-violating input (both reference and assertions empty)", async () => {
  await assert.rejects(
    liftFromQueriesFile(FIXTURE("queries-input-empty-refinement.yaml")),
    (e) => e instanceof QueryPickerError && /reference.*assertions/.test(e.message),
  );
});

test("liftFromQueriesFile rejects nonexistent file with clear error", async () => {
  await assert.rejects(
    liftFromQueriesFile("/nonexistent/path.yaml"),
    (e) => e instanceof QueryPickerError && /file not found/i.test(e.message),
  );
});

test("liftFromQueriesFile rejects malformed yaml", async () => {
  const tmpPath = path.join(__dirname, "fixtures", "eval-set", "broken.yaml");
  const fs = await import("node:fs/promises");
  await fs.writeFile(tmpPath, "schema_version: trace-eval-set-input/v1\ncases: [\n", "utf8");
  try {
    await assert.rejects(
      liftFromQueriesFile(tmpPath),
      (e) => e instanceof QueryPickerError,
    );
  } finally {
    await fs.unlink(tmpPath);
  }
});
```

- [ ] **Step 4: 跑测试确认失败**

Run: `cd packages/typescript && node --import tsx --test test/trace-eval-set-picker.test.ts`
Expected: FAIL — `Cannot find module '../src/trace-ai/eval-set/query-picker.js'`

- [ ] **Step 5: 建文件 `src/trace-ai/eval-set/query-picker.ts`（只实现 liftFromQueriesFile）**

```typescript
/**
 * M5 eval-set query picker — two lift functions:
 *   - liftFromQueriesFile(path)   reads `trace-eval-set-input/v1` simplified yaml
 *   - liftFromDiagnosis(dir)      reads M4 diagnose report yamls (added in Task 4)
 *
 * Both return EvalCase[] (without query_id auto-fill — that happens in builder.ts).
 */

import { readFile } from "node:fs/promises";
import yaml from "js-yaml";

import { EvalSetInputSchema } from "./schemas.js";
import type { EvalCase } from "./types.js";

export class QueryPickerError extends Error {
  constructor(message: string, public readonly path?: string) {
    super(message);
    this.name = "QueryPickerError";
  }
}

export async function liftFromQueriesFile(filePath: string): Promise<EvalCase[]> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      throw new QueryPickerError(`file not found: ${filePath}`, filePath);
    }
    throw new QueryPickerError(`failed to read ${filePath}: ${err.message}`, filePath);
  }

  let parsed: unknown;
  try {
    parsed = yaml.load(raw);
  } catch (e) {
    throw new QueryPickerError(
      `failed to parse yaml ${filePath}: ${(e as Error).message}`,
      filePath,
    );
  }

  const result = EvalSetInputSchema.safeParse(parsed);
  if (!result.success) {
    const firstIssue = result.error.issues[0];
    const where = firstIssue.path.join(".");
    throw new QueryPickerError(
      `schema validation failed for ${filePath} at '${where}': ${firstIssue.message}`,
      filePath,
    );
  }

  return result.data.cases.map((c) => ({
    query_id: c.query_id ?? "", // empty → builder.ensureQueryId fills it; undefined would break downstream
    input: c.input,
    reference: c.reference,
    assertions: c.assertions as EvalCase["assertions"],
    tags: c.tags,
  }));
}

// liftFromDiagnosis: implemented in Task 4
```

Note: 这里 `query_id: c.query_id ?? ""` 让下游 `ensureQueryId` 用空串判 "未填" 状态。types.ts 里 `EvalCase.query_id` 是必填 string，picker 阶段不允许 undefined。

- [ ] **Step 6: 跑测试确认全过**

Run: `cd packages/typescript && node --import tsx --test test/trace-eval-set-picker.test.ts`
Expected: 4 tests pass

- [ ] **Step 7: Commit**

```bash
git add packages/typescript/src/trace-ai/eval-set/query-picker.ts \
        packages/typescript/test/trace-eval-set-picker.test.ts \
        packages/typescript/test/fixtures/eval-set/
git commit -m "feat(M5/PR-A): add liftFromQueriesFile for --queries= simplified input"
```

---

## Task 4：query-picker — liftFromDiagnosis

**Files:**
- Modify: `src/trace-ai/eval-set/query-picker.ts:end`
- Modify: `test/trace-eval-set-picker.test.ts:end`（追加 case）
- Create: `test/fixtures/eval-set/diagnose-report-sample.yaml`

- [ ] **Step 1: 找 M4 现成 trace-diagnose-report 真样本作 fixture 模板**

Run: `find packages/typescript/test/fixtures/trace-diagnose -name "*.yaml" | head -5`
Expected: 列出几个 M4 既有 fixture

- [ ] **Step 2: 建 `test/fixtures/eval-set/diagnose-report-sample.yaml`**

抄一份精简的 M4 报告（保留 findings[].verify_with.suggested_eval_case 字段）：

```yaml
schema_version: trace-diagnose-report/v1
meta:
  trace_id: tr_abc
  conversation_id: conv_abc
  agent_id: agt_42
  ran_at: 2026-05-12T10:00:00Z
findings:
  - rule_id: tool_loop_no_state_change
    severity: high
    symptom: repeated_tool_call_without_state_change
    evidence:
      spans: ["sp_1", "sp_2"]
    suggested_fix:
      target: decision_agent.prompt
      change: add stop condition
    verify_with:
      assertion_templates: ["tool_call_count(retrieval) <= 2"]
      suggested_eval_case:
        query_id: refund_loop_001
        input:
          user_message: "如何申请退款？"
        assertions:
          - type: tool_call_count
            tool: retrieval
            op: lte
            n: 2
  # 一个有意 skip 的 finding：缺 suggested_eval_case
  - rule_id: llm_response_truncated_no_continue
    severity: medium
    symptom: response_truncated
    evidence:
      spans: ["sp_5"]
    suggested_fix:
      target: decision_agent.config
      change: enable continuation
    verify_with:
      assertion_templates: []
```

- [ ] **Step 3: 追加 picker test cases 到 `test/trace-eval-set-picker.test.ts`**

```typescript
import { liftFromDiagnosis } from "../src/trace-ai/eval-set/query-picker.js";

test("liftFromDiagnosis lifts suggested_eval_case from M4 report findings", async () => {
  const result = await liftFromDiagnosis(path.join(__dirname, "fixtures", "eval-set"));
  // 2 findings in sample; 1 has suggested_eval_case, 1 skipped
  assert.equal(result.cases.length, 1);
  assert.equal(result.skipped_findings_count, 1);
  assert.equal(result.cases[0].query_id, "refund_loop_001");
  assert.equal(result.cases[0].assertions?.[0].type, "tool_call_count");
});

test("liftFromDiagnosis rejects directory with a non-yaml file silently skipped", async () => {
  // 验证 dir 下非 yaml 文件被跳过，不影响有效 yaml
  // dir 已有 queries-input-*.yaml，但它们是 input schema 不是 diagnose-report schema
  // → liftFromDiagnosis 应该 fail-fast 给出明确错误
  await assert.rejects(
    liftFromDiagnosis(path.join(__dirname, "fixtures", "eval-set")),
    // 实际上：因为 sample 是 diagnose-report 且能通过 schema，本测试假设 dir 全部 *.yaml 都按 diagnose-report 校验
    // → queries-input-*.yaml 校验失败 fail-fast
    (e) => e instanceof QueryPickerError && /schema validation failed/.test(e.message),
  );
});
```

Wait — 这两个测试设计冲突（第一个期望 1 case skipped，第二个期望整体 fail 因为 dir 里有非 diagnose-report yaml）。重写：

```typescript
import { liftFromDiagnosis } from "../src/trace-ai/eval-set/query-picker.js";

test("liftFromDiagnosis lifts suggested_eval_case from M4 report findings", async () => {
  // 用独立子目录，只放 diagnose-report 样本，避免和 picker 测试用的 queries-input yaml 混
  const subDir = path.join(__dirname, "fixtures", "eval-set", "diagnose-only");
  const fs = await import("node:fs/promises");
  await fs.mkdir(subDir, { recursive: true });
  await fs.copyFile(
    path.join(__dirname, "fixtures", "eval-set", "diagnose-report-sample.yaml"),
    path.join(subDir, "diagnose-report-sample.yaml"),
  );
  try {
    const result = await liftFromDiagnosis(subDir);
    assert.equal(result.cases.length, 1);
    assert.equal(result.skipped_findings_count, 1);
    assert.equal(result.cases[0].query_id, "refund_loop_001");
    assert.equal(result.cases[0].assertions?.[0].type, "tool_call_count");
  } finally {
    await fs.rm(subDir, { recursive: true, force: true });
  }
});

test("liftFromDiagnosis fails fast when dir contains a non-diagnose-report yaml", async () => {
  // 主 fixtures/eval-set 目录混了 input + diagnose-report，liftFromDiagnosis 见到
  // queries-input-*.yaml 应该 fail-fast（schema 不匹配）
  await assert.rejects(
    liftFromDiagnosis(path.join(__dirname, "fixtures", "eval-set")),
    (e) => e instanceof QueryPickerError && /schema validation failed/.test(e.message),
  );
});
```

- [ ] **Step 4: 跑测试确认失败**

Run: `cd packages/typescript && node --import tsx --test test/trace-eval-set-picker.test.ts`
Expected: 新加 tests FAIL — `liftFromDiagnosis is not exported`

- [ ] **Step 5: 在 `src/trace-ai/eval-set/query-picker.ts` 末尾追加 liftFromDiagnosis**

先：在文件头部 import 区追加：

```typescript
import { readdir } from "node:fs/promises";
import path from "node:path";
import { ReportSchema as DiagnoseReportSchema } from "../diagnose/schemas.js";
```

然后在文件末尾追加：

```typescript
export interface LiftFromDiagnosisResult {
  cases: EvalCase[];
  skipped_findings_count: number;
  skipped_findings_summary: string[];
}

/**
 * Read all *.yaml files in `dirPath`, validate each as `trace-diagnose-report/v1`,
 * and extract `findings[*].verify_with.suggested_eval_case` as EvalCases.
 *
 * Findings without `suggested_eval_case` are skipped (not an error) and counted
 * in the result. Files that fail to schema-validate cause a fail-fast error.
 */
export async function liftFromDiagnosis(dirPath: string): Promise<LiftFromDiagnosisResult> {
  let entries: string[];
  try {
    entries = await readdir(dirPath);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      throw new QueryPickerError(`directory not found: ${dirPath}`, dirPath);
    }
    throw new QueryPickerError(`failed to read directory ${dirPath}: ${err.message}`, dirPath);
  }

  const yamlFiles = entries
    .filter((e) => e.endsWith(".yaml") || e.endsWith(".yml"))
    .map((e) => path.join(dirPath, e));

  const cases: EvalCase[] = [];
  let skipped = 0;
  const skippedSummary: string[] = [];

  for (const file of yamlFiles) {
    let raw: string;
    try {
      raw = await readFile(file, "utf8");
    } catch (e) {
      throw new QueryPickerError(`failed to read ${file}: ${(e as Error).message}`, file);
    }

    let parsed: unknown;
    try {
      parsed = yaml.load(raw);
    } catch (e) {
      throw new QueryPickerError(`failed to parse yaml ${file}: ${(e as Error).message}`, file);
    }

    const result = DiagnoseReportSchema.safeParse(parsed);
    if (!result.success) {
      const firstIssue = result.error.issues[0];
      const where = firstIssue.path.join(".");
      throw new QueryPickerError(
        `schema validation failed for ${file} at '${where}': ${firstIssue.message}`,
        file,
      );
    }

    for (const finding of result.data.findings) {
      const evalCase = (finding.verify_with as { suggested_eval_case?: unknown })?.suggested_eval_case;
      if (!evalCase || typeof evalCase !== "object") {
        skipped += 1;
        skippedSummary.push(`${path.basename(file)}: rule=${finding.rule_id} (no suggested_eval_case)`);
        continue;
      }
      const ec = evalCase as Partial<EvalCase>;
      if (!ec.input || typeof ec.input !== "object") {
        skipped += 1;
        skippedSummary.push(`${path.basename(file)}: rule=${finding.rule_id} (suggested_eval_case.input missing)`);
        continue;
      }
      cases.push({
        query_id: ec.query_id ?? "",
        input: ec.input,
        reference: ec.reference,
        assertions: ec.assertions,
        tags: ec.tags,
      });
    }
  }

  return { cases, skipped_findings_count: skipped, skipped_findings_summary: skippedSummary };
}
```

Note: 这里 `DiagnoseReportSchema` 引用 M4 既有 `src/trace-ai/diagnose/schemas.ts` 的 `ReportSchema` export。Step 6 要先确认它能 import；如导入名不符调整 alias。

- [ ] **Step 6: 确认 M4 export 名匹配**

Run: `grep "export.*ReportSchema\|export.*DiagnoseReport" packages/typescript/src/trace-ai/diagnose/schemas.ts`
Expected: 有 `export const ReportSchema = ...` 或类似。如名字不同（比如 `DiagnoseReportSchema`）调整 import 行的 alias。

- [ ] **Step 7: 跑测试确认全过**

Run: `cd packages/typescript && node --import tsx --test test/trace-eval-set-picker.test.ts`
Expected: 6 tests pass

- [ ] **Step 8: Commit**

```bash
git add packages/typescript/src/trace-ai/eval-set/query-picker.ts \
        packages/typescript/test/trace-eval-set-picker.test.ts \
        packages/typescript/test/fixtures/eval-set/diagnose-report-sample.yaml
git commit -m "feat(M5/PR-A): add liftFromDiagnosis for --diagnosis= source"
```

---

## Task 5：redactor — builtin 规则 + 规则链加载

**Files:**
- Create: `src/trace-ai/eval-set/redactor.ts`
- Create: `test/trace-eval-set-redactor.test.ts`

- [ ] **Step 1: 写失败测试 `test/trace-eval-set-redactor.test.ts`（覆盖 builtin 规则匹配）**

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  BUILTIN_RULES,
  loadRules,
  applyRules,
  RedactorError,
} from "../src/trace-ai/eval-set/redactor.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("BUILTIN_RULES match common PII patterns (5 builtin types)", () => {
  const testCases: Array<[string, string]> = [
    ["请回拨 13812345678 联系客户", "phone"],
    ["邮件发到 zhangsan@example.com", "email"],
    ["身份证号 110101199001011234", "id_card"],
    ["卡号 6228480012345678", "bank_card"],
    ["来源 IP 192.168.1.100", "ip"],
  ];
  for (const [text, ruleName] of testCases) {
    const rule = BUILTIN_RULES.find((r) => r.name === ruleName);
    assert.ok(rule, `builtin rule '${ruleName}' must exist`);
    assert.ok(rule.pattern.test(text), `rule '${ruleName}' must match: ${text}`);
  }
});

test("applyRules replaces matched PII with placeholder", () => {
  const out = applyRules("电话是 13812345678 不要外传", BUILTIN_RULES);
  assert.ok(out.includes("<phone:"), `expected <phone:hash6> placeholder, got: ${out}`);
  assert.equal(out.includes("13812345678"), false, "raw phone number must be replaced");
});

test("applyRules handles multiple matches in one string", () => {
  const out = applyRules("电话 13812345678 邮箱 zhangsan@example.com", BUILTIN_RULES);
  assert.ok(out.includes("<phone:"));
  assert.ok(out.includes("<email:"));
});

test("loadRules picks --redaction-rules CLI flag first (highest priority)", async () => {
  const fs = await import("node:fs/promises");
  const tmp = path.join(__dirname, "fixtures", "eval-set", "custom-rules.yaml");
  await fs.writeFile(
    tmp,
    "rules:\n  - name: custom_token\n    pattern: 'tok_[a-z0-9]+'\n    replace: '<token:{hash6}>'\n",
    "utf8",
  );
  try {
    const result = await loadRules({ cliFlag: tmp, repoDir: undefined });
    assert.equal(result.source, "cli-flag");
    assert.equal(result.rules.length, 1);
    assert.equal(result.rules[0].name, "custom_token");
  } finally {
    await fs.unlink(tmp);
  }
});

test("loadRules picks <repo>/redaction-rules/ when no CLI flag", async () => {
  const fs = await import("node:fs/promises");
  const repoDir = path.join(__dirname, "fixtures", "eval-set", "repo-rules-dir");
  await fs.mkdir(repoDir, { recursive: true });
  await fs.writeFile(
    path.join(repoDir, "rules.yaml"),
    "rules:\n  - name: org_id\n    pattern: 'ORG-[0-9]+'\n    replace: '<org:{hash6}>'\n",
    "utf8",
  );
  try {
    const result = await loadRules({ cliFlag: undefined, repoDir });
    assert.equal(result.source, "repo");
    assert.equal(result.rules[0].name, "org_id");
  } finally {
    await fs.rm(repoDir, { recursive: true, force: true });
  }
});

test("loadRules falls back to builtin when neither CLI nor repo dir", async () => {
  const result = await loadRules({ cliFlag: undefined, repoDir: undefined });
  assert.equal(result.source, "builtin");
  assert.equal(result.rules.length, BUILTIN_RULES.length);
});

test("loadRules fail-fast on malformed regex in user rule", async () => {
  const fs = await import("node:fs/promises");
  const tmp = path.join(__dirname, "fixtures", "eval-set", "bad-regex.yaml");
  await fs.writeFile(
    tmp,
    "rules:\n  - name: bad\n    pattern: '[unclosed'\n    replace: '<x>'\n",
    "utf8",
  );
  try {
    await assert.rejects(
      loadRules({ cliFlag: tmp, repoDir: undefined }),
      (e) => e instanceof RedactorError && /invalid regex/i.test(e.message),
    );
  } finally {
    await fs.unlink(tmp);
  }
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/typescript && node --import tsx --test test/trace-eval-set-redactor.test.ts`
Expected: FAIL — `Cannot find module '../src/trace-ai/eval-set/redactor.js'`

- [ ] **Step 3: 建文件 `src/trace-ai/eval-set/redactor.ts`**

```typescript
/**
 * M5 eval-set redactor — PII pattern matching + replacement.
 *
 * Three rule sources, in priority order (chain):
 *   1. --redaction-rules=<path>      (CLI flag, highest)
 *   2. <repo>/redaction-rules/*.yaml (repo-local)
 *   3. BUILTIN_RULES                 (5 low-fidelity defaults)
 *
 * Builtin rules cover common Chinese-context PII: phone / email / id_card /
 * bank_card / ip. Organizations write more rules in <repo>/redaction-rules/
 * for their business-specific patterns.
 *
 * Rule yaml format:
 *   rules:
 *     - name: <id>
 *       pattern: <regex source string>
 *       replace: <replacement template; supports {hash6} placeholder>
 *
 * Malformed regex causes loadRules to throw RedactorError (no silent fallback).
 */

import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import yaml from "js-yaml";

import type { RedactionRule } from "./types.js";

export class RedactorError extends Error {
  constructor(message: string, public readonly path?: string) {
    super(message);
    this.name = "RedactorError";
  }
}

/**
 * 5 builtin low-fidelity PII patterns. Tuned for Chinese-context defaults;
 * organizations override with their own rules in <repo>/redaction-rules/.
 */
export const BUILTIN_RULES: RedactionRule[] = [
  {
    name: "phone",
    pattern: /1[3-9]\d{9}/g,
    replace: "<phone:{hash6}>",
  },
  {
    name: "email",
    pattern: /[\w.+-]+@[\w.-]+\.\w+/g,
    replace: "<email:{hash6}>",
  },
  {
    name: "id_card",
    pattern: /\b\d{17}[\dXx]\b/g,
    replace: "<id_card:{hash6}>",
  },
  {
    name: "bank_card",
    pattern: /\b\d{15,19}\b/g, // 银行卡号长度 15-19 位
    replace: "<bank_card:{hash6}>",
  },
  {
    name: "ip",
    pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    replace: "<ip:{hash6}>",
  },
];

export interface LoadRulesOpts {
  /** From `--redaction-rules=<path>`; highest priority */
  cliFlag: string | undefined;
  /** From `<repo>/redaction-rules/` (resolved by caller — usually `path.join(repoRoot, "redaction-rules")`) */
  repoDir: string | undefined;
}

export interface LoadRulesResult {
  rules: RedactionRule[];
  source: "cli-flag" | "repo" | "builtin";
}

interface RuleYamlEntry {
  name: string;
  pattern: string;
  replace: string;
}

interface RuleYamlFile {
  rules: RuleYamlEntry[];
}

function compileRule(entry: RuleYamlEntry, srcPath: string): RedactionRule {
  let pattern: RegExp;
  try {
    pattern = new RegExp(entry.pattern, "g");
  } catch (e) {
    throw new RedactorError(
      `invalid regex in rule '${entry.name}' at ${srcPath}: ${(e as Error).message}`,
      srcPath,
    );
  }
  return { name: entry.name, pattern, replace: entry.replace };
}

async function readRulesFile(filePath: string): Promise<RedactionRule[]> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (e) {
    throw new RedactorError(
      `failed to read rule file ${filePath}: ${(e as Error).message}`,
      filePath,
    );
  }
  let parsed: unknown;
  try {
    parsed = yaml.load(raw);
  } catch (e) {
    throw new RedactorError(
      `failed to parse yaml ${filePath}: ${(e as Error).message}`,
      filePath,
    );
  }
  const doc = parsed as RuleYamlFile;
  if (!doc || !Array.isArray(doc.rules)) {
    throw new RedactorError(`rule file ${filePath} must have top-level 'rules: []'`, filePath);
  }
  return doc.rules.map((e) => compileRule(e, filePath));
}

export async function loadRules(opts: LoadRulesOpts): Promise<LoadRulesResult> {
  if (opts.cliFlag) {
    const rules = await readRulesFile(opts.cliFlag);
    return { rules, source: "cli-flag" };
  }
  if (opts.repoDir) {
    let stats;
    try {
      stats = await stat(opts.repoDir);
    } catch {
      stats = null;
    }
    if (stats && stats.isDirectory()) {
      const entries = await readdir(opts.repoDir);
      const yamlFiles = entries
        .filter((e) => e.endsWith(".yaml") || e.endsWith(".yml"))
        .map((e) => path.join(opts.repoDir!, e));
      if (yamlFiles.length > 0) {
        const allRules: RedactionRule[] = [];
        for (const f of yamlFiles) {
          allRules.push(...(await readRulesFile(f)));
        }
        return { rules: allRules, source: "repo" };
      }
    }
  }
  return { rules: BUILTIN_RULES, source: "builtin" };
}

function hash6(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 6);
}

export function applyRules(text: string, rules: RedactionRule[]): string {
  let out = text;
  for (const rule of rules) {
    out = out.replace(rule.pattern, (match) =>
      rule.replace.replace("{hash6}", hash6(match)),
    );
  }
  return out;
}
```

- [ ] **Step 4: 跑测试确认全过**

Run: `cd packages/typescript && node --import tsx --test test/trace-eval-set-redactor.test.ts`
Expected: 7 tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/typescript/src/trace-ai/eval-set/redactor.ts \
        packages/typescript/test/trace-eval-set-redactor.test.ts
git commit -m "feat(M5/PR-A): add PII redactor with 5 builtin rules + override chain"
```

---

## Task 6：output-writer — index 写盘 + shard merge + on-conflict

**Files:**
- Create: `src/trace-ai/eval-set/output-writer.ts`
- Create: `test/trace-eval-set-output-writer.test.ts`

- [ ] **Step 1: 写失败测试 `test/trace-eval-set-output-writer.test.ts`**

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import fs from "node:fs/promises";
import yaml from "js-yaml";

import {
  writeEvalSet,
  WriterError,
} from "../src/trace-ai/eval-set/output-writer.js";
import type { EvalCase } from "../src/trace-ai/eval-set/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function mkTempDir(): Promise<string> {
  return await fs.mkdtemp(path.join(tmpdir(), "m5-test-"));
}

const sampleCase = (id: string): EvalCase => ({
  query_id: id,
  input: { user_message: "msg" },
  reference: { answer: "ans" },
});

test("writeEvalSet creates index.yaml + cases.yaml when out dir is empty", async () => {
  const out = await mkTempDir();
  try {
    const result = await writeEvalSet({
      outDir: out,
      evalSetId: "test-v1",
      newCases: [sampleCase("q1"), sampleCase("q2")],
      onConflict: "fail",
    });
    assert.equal(result.cases_written, 2);
    assert.equal(result.conflicts.length, 0);

    const indexRaw = await fs.readFile(path.join(out, "index.yaml"), "utf8");
    const index = yaml.load(indexRaw) as { eval_set_id: string; shards: { path: string }[] };
    assert.equal(index.eval_set_id, "test-v1");
    assert.equal(index.shards.length, 1);

    const sharRaw = await fs.readFile(path.join(out, "cases.yaml"), "utf8");
    const shard = yaml.load(sharRaw) as { cases: { query_id: string }[] };
    assert.equal(shard.cases.length, 2);
  } finally {
    await fs.rm(out, { recursive: true, force: true });
  }
});

test("writeEvalSet fail strategy aborts on query_id conflict", async () => {
  const out = await mkTempDir();
  try {
    await writeEvalSet({
      outDir: out,
      evalSetId: "test-v1",
      newCases: [sampleCase("q1")],
      onConflict: "fail",
    });
    await assert.rejects(
      writeEvalSet({
        outDir: out,
        evalSetId: "test-v1",
        newCases: [sampleCase("q1")],
        onConflict: "fail",
      }),
      (e) => e instanceof WriterError && e.conflictIds?.includes("q1") === true,
    );
  } finally {
    await fs.rm(out, { recursive: true, force: true });
  }
});

test("writeEvalSet skip strategy keeps existing case unchanged", async () => {
  const out = await mkTempDir();
  try {
    await writeEvalSet({
      outDir: out,
      evalSetId: "test-v1",
      newCases: [{ ...sampleCase("q1"), reference: { answer: "old" } }],
      onConflict: "fail",
    });
    const result = await writeEvalSet({
      outDir: out,
      evalSetId: "test-v1",
      newCases: [{ ...sampleCase("q1"), reference: { answer: "new" } }, sampleCase("q2")],
      onConflict: "skip",
    });
    // q1 skipped, q2 new
    assert.equal(result.cases_written, 1);
    assert.equal(result.cases_skipped, 1);

    const shard = yaml.load(
      await fs.readFile(path.join(out, "cases.yaml"), "utf8"),
    ) as { cases: Array<{ query_id: string; reference: { answer: string } }> };
    assert.equal(shard.cases.length, 2);
    const q1 = shard.cases.find((c) => c.query_id === "q1");
    assert.equal(q1?.reference.answer, "old"); // kept
  } finally {
    await fs.rm(out, { recursive: true, force: true });
  }
});

test("writeEvalSet overwrite strategy replaces case and writes .bak", async () => {
  const out = await mkTempDir();
  try {
    await writeEvalSet({
      outDir: out,
      evalSetId: "test-v1",
      newCases: [{ ...sampleCase("q1"), reference: { answer: "old" } }],
      onConflict: "fail",
    });
    const result = await writeEvalSet({
      outDir: out,
      evalSetId: "test-v1",
      newCases: [{ ...sampleCase("q1"), reference: { answer: "new" } }],
      onConflict: "overwrite",
    });
    assert.equal(result.cases_written, 1);

    const shard = yaml.load(
      await fs.readFile(path.join(out, "cases.yaml"), "utf8"),
    ) as { cases: Array<{ query_id: string; reference: { answer: string } }> };
    assert.equal(shard.cases[0].reference.answer, "new");

    // .bak should exist with old content
    const bakRaw = await fs.readFile(path.join(out, "cases.yaml.bak"), "utf8");
    const bak = yaml.load(bakRaw) as { cases: Array<{ reference: { answer: string } }> };
    assert.equal(bak.cases[0].reference.answer, "old");
  } finally {
    await fs.rm(out, { recursive: true, force: true });
  }
});

test("writeEvalSet detects intra-batch duplicate query_ids", async () => {
  const out = await mkTempDir();
  try {
    await assert.rejects(
      writeEvalSet({
        outDir: out,
        evalSetId: "test-v1",
        newCases: [sampleCase("q1"), sampleCase("q1")],
        onConflict: "fail",
      }),
      (e) => e instanceof WriterError && e.message.includes("intra-batch"),
    );
  } finally {
    await fs.rm(out, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/typescript && node --import tsx --test test/trace-eval-set-output-writer.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 建文件 `src/trace-ai/eval-set/output-writer.ts`**

```typescript
/**
 * M5 eval-set output writer — handles directory layout, index upsert, shard
 * merge, on-conflict resolution (fail / skip / overwrite), and .bak preservation.
 *
 * MVP layout: always one shard named `cases.yaml`. Users can manually split
 * into multi-shard later (re-write `index.yaml` to reference more shards)
 * and call `kweaver trace schema validate` to verify.
 */

import { readFile, writeFile, copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";

import type { EvalCase, EvalSetIndex } from "./types.js";
import { EvalSetIndexSchema, EvalSetShardSchema } from "./schemas.js";

export class WriterError extends Error {
  constructor(
    message: string,
    public readonly conflictIds?: string[],
  ) {
    super(message);
    this.name = "WriterError";
  }
}

export type ConflictStrategy = "fail" | "skip" | "overwrite";

export interface WriteEvalSetOpts {
  outDir: string;
  evalSetId: string;
  newCases: EvalCase[];
  onConflict: ConflictStrategy;
}

export interface WriteEvalSetResult {
  cases_written: number;
  cases_skipped: number;
  conflicts: string[];
  shard_paths: string[];
}

const SHARD_NAME = "cases.yaml";
const INDEX_NAME = "index.yaml";

async function fileExists(p: string): Promise<boolean> {
  try {
    await readFile(p);
    return true;
  } catch {
    return false;
  }
}

async function readShardCases(shardPath: string): Promise<EvalCase[]> {
  if (!(await fileExists(shardPath))) return [];
  const raw = await readFile(shardPath, "utf8");
  const parsed = yaml.load(raw);
  const r = EvalSetShardSchema.safeParse(parsed);
  if (!r.success) {
    throw new WriterError(
      `existing shard at ${shardPath} fails schema validation: ${r.error.issues[0].message}`,
    );
  }
  return r.data.cases as EvalCase[];
}

export async function writeEvalSet(opts: WriteEvalSetOpts): Promise<WriteEvalSetResult> {
  const { outDir, evalSetId, newCases, onConflict } = opts;

  // intra-batch duplicate detection
  const seenInBatch = new Set<string>();
  const dupInBatch: string[] = [];
  for (const c of newCases) {
    if (seenInBatch.has(c.query_id)) dupInBatch.push(c.query_id);
    seenInBatch.add(c.query_id);
  }
  if (dupInBatch.length > 0) {
    throw new WriterError(
      `intra-batch duplicate query_id(s): ${dupInBatch.join(", ")}`,
      dupInBatch,
    );
  }

  await mkdir(outDir, { recursive: true });
  const shardPath = path.join(outDir, SHARD_NAME);

  const existingCases = await readShardCases(shardPath);
  const existingIds = new Set(existingCases.map((c) => c.query_id));

  // Conflict resolution
  const incomingByConflict = newCases.filter((c) => existingIds.has(c.query_id));
  const incomingFresh = newCases.filter((c) => !existingIds.has(c.query_id));

  if (incomingByConflict.length > 0 && onConflict === "fail") {
    throw new WriterError(
      `query_id conflict(s): ${incomingByConflict.map((c) => c.query_id).join(", ")}`,
      incomingByConflict.map((c) => c.query_id),
    );
  }

  let mergedCases: EvalCase[];
  let casesWritten = 0;
  let casesSkipped = 0;

  if (onConflict === "skip") {
    mergedCases = [...existingCases, ...incomingFresh];
    casesWritten = incomingFresh.length;
    casesSkipped = incomingByConflict.length;
  } else if (onConflict === "overwrite") {
    // write .bak before overwriting
    if (incomingByConflict.length > 0 && (await fileExists(shardPath))) {
      await copyFile(shardPath, shardPath + ".bak");
    }
    const overwriteIds = new Set(incomingByConflict.map((c) => c.query_id));
    const kept = existingCases.filter((c) => !overwriteIds.has(c.query_id));
    mergedCases = [...kept, ...incomingFresh, ...incomingByConflict];
    casesWritten = incomingFresh.length + incomingByConflict.length;
    casesSkipped = 0;
  } else {
    // fail strategy with no conflicts → simple append
    mergedCases = [...existingCases, ...incomingFresh];
    casesWritten = incomingFresh.length;
    casesSkipped = 0;
  }

  // Write shard
  const shardDoc = {
    schema_version: "trace-eval-set/v1" as const,
    cases: mergedCases,
  };
  // Validate the merged shard
  const shardCheck = EvalSetShardSchema.safeParse(shardDoc);
  if (!shardCheck.success) {
    throw new WriterError(
      `merged shard fails schema validation: ${shardCheck.error.issues[0].message}`,
    );
  }
  await writeFile(shardPath, yaml.dump(shardDoc, { lineWidth: 120, noRefs: true }), "utf8");

  // Upsert index
  const indexPath = path.join(outDir, INDEX_NAME);
  let indexDoc: EvalSetIndex;
  if (await fileExists(indexPath)) {
    const raw = await readFile(indexPath, "utf8");
    const parsed = yaml.load(raw);
    const r = EvalSetIndexSchema.safeParse(parsed);
    if (!r.success) {
      throw new WriterError(
        `existing index.yaml fails schema validation: ${r.error.issues[0].message}`,
      );
    }
    indexDoc = r.data as EvalSetIndex;
    // ensure shard is listed
    if (!indexDoc.shards.some((s) => s.path === SHARD_NAME)) {
      indexDoc.shards.push({ path: SHARD_NAME });
    }
  } else {
    indexDoc = {
      schema_version: "trace-eval-set-index/v1",
      eval_set_id: evalSetId,
      shards: [{ path: SHARD_NAME }],
    };
  }
  await writeFile(indexPath, yaml.dump(indexDoc, { lineWidth: 120, noRefs: true }), "utf8");

  return {
    cases_written: casesWritten,
    cases_skipped: casesSkipped,
    conflicts: incomingByConflict.map((c) => c.query_id),
    shard_paths: [shardPath],
  };
}
```

- [ ] **Step 4: 跑测试确认全过**

Run: `cd packages/typescript && node --import tsx --test test/trace-eval-set-output-writer.test.ts`
Expected: 5 tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/typescript/src/trace-ai/eval-set/output-writer.ts \
        packages/typescript/test/trace-eval-set-output-writer.test.ts
git commit -m "feat(M5/PR-A): add eval-set output writer with on-conflict + .bak"
```

---

## Task 7：builder — ensureQueryId + 主流程编排

**Files:**
- Create: `src/trace-ai/eval-set/builder.ts`
- Create: `test/trace-eval-set-builder.test.ts`
- Modify: `src/trace-ai/eval-set/index.ts:end`（追加 builder export）

- [ ] **Step 1: 写失败测试 `test/trace-eval-set-builder.test.ts`**

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import fs from "node:fs/promises";
import yaml from "js-yaml";

import { build, BuilderError, ensureQueryId } from "../src/trace-ai/eval-set/builder.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function mkTempDir(): Promise<string> {
  return await fs.mkdtemp(path.join(tmpdir(), "m5-builder-"));
}

test("ensureQueryId is idempotent for the same input", () => {
  const c1 = { query_id: "", input: { user_message: "hello" }, tags: ["a"] };
  const c2 = { query_id: "", input: { user_message: "hello" }, tags: ["a"] };
  const id1 = ensureQueryId(c1);
  const id2 = ensureQueryId(c2);
  assert.equal(id1, id2);
  assert.equal(id1.length, 12); // 12 hex chars per spec
});

test("ensureQueryId returns user-provided query_id unchanged", () => {
  const c = { query_id: "user_set_id", input: { user_message: "x" } };
  assert.equal(ensureQueryId(c), "user_set_id");
});

test("ensureQueryId differs for different inputs", () => {
  const c1 = { query_id: "", input: { user_message: "hello" } };
  const c2 = { query_id: "", input: { user_message: "world" } };
  assert.notEqual(ensureQueryId(c1), ensureQueryId(c2));
});

test("build with --queries= source end-to-end (lift → id → redact → write → validate)", async () => {
  const out = await mkTempDir();
  const fixture = path.join(__dirname, "fixtures", "eval-set", "queries-input-valid.yaml");
  try {
    const result = await build({
      source: { kind: "queries", path: fixture },
      outDir: out,
      evalSetId: "cs-v1",
      onConflict: "fail",
      redactionRulesCliFlag: undefined,
      repoDir: undefined,
    });
    assert.equal(result.cases_written, 2);
    assert.equal(result.redaction_rules_source, "builtin");

    const indexRaw = await fs.readFile(path.join(out, "index.yaml"), "utf8");
    const index = yaml.load(indexRaw) as { shards: { path: string }[] };
    assert.equal(index.shards.length, 1);

    const shardRaw = await fs.readFile(path.join(out, "cases.yaml"), "utf8");
    const shard = yaml.load(shardRaw) as { cases: { query_id: string }[] };
    assert.equal(shard.cases.length, 2);
    // First case has explicit query_id "refund_001"; second is hash-generated (12 hex)
    assert.equal(shard.cases[0].query_id, "refund_001");
    assert.ok(/^[0-9a-f]{12}$/.test(shard.cases[1].query_id));
  } finally {
    await fs.rm(out, { recursive: true, force: true });
  }
});

test("build with --queries= rejects refinement-violating input", async () => {
  const out = await mkTempDir();
  const fixture = path.join(__dirname, "fixtures", "eval-set", "queries-input-empty-refinement.yaml");
  try {
    await assert.rejects(
      build({
        source: { kind: "queries", path: fixture },
        outDir: out,
        evalSetId: "cs-v1",
        onConflict: "fail",
        redactionRulesCliFlag: undefined,
        repoDir: undefined,
      }),
      (e) => e instanceof BuilderError,
    );
  } finally {
    await fs.rm(out, { recursive: true, force: true });
  }
});

test("build with --queries= redacts builtin PII patterns in user_message", async () => {
  const out = await mkTempDir();
  const tmpFixture = path.join(__dirname, "fixtures", "eval-set", "queries-with-pii.yaml");
  await fs.writeFile(
    tmpFixture,
    `schema_version: trace-eval-set-input/v1
cases:
  - input:
      user_message: "我电话 13812345678 想咨询"
    reference:
      answer: "好的"
`,
    "utf8",
  );
  try {
    await build({
      source: { kind: "queries", path: tmpFixture },
      outDir: out,
      evalSetId: "test-v1",
      onConflict: "fail",
      redactionRulesCliFlag: undefined,
      repoDir: undefined,
    });
    const shardRaw = await fs.readFile(path.join(out, "cases.yaml"), "utf8");
    assert.ok(shardRaw.includes("<phone:"), "expected <phone:hash6> placeholder");
    assert.equal(shardRaw.includes("13812345678"), false, "raw phone must be replaced");
  } finally {
    await fs.unlink(tmpFixture);
    await fs.rm(out, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/typescript && node --import tsx --test test/trace-eval-set-builder.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 建文件 `src/trace-ai/eval-set/builder.ts`**

```typescript
/**
 * M5 eval-set builder — orchestrates build:
 *   picker → ensureQueryId → redact → write (with conflict resolution) → validate
 *
 * `ensureQueryId` is the deterministic hash-based ID generator (inline here,
 * not a separate file — spec doc §9 "反过度工程" decision).
 */

import { createHash } from "node:crypto";
import path from "node:path";

import type { BuildResult, EvalCase } from "./types.js";
import { liftFromQueriesFile, liftFromDiagnosis, QueryPickerError } from "./query-picker.js";
import { loadRules, applyRules, RedactorError } from "./redactor.js";
import { writeEvalSet, WriterError, type ConflictStrategy } from "./output-writer.js";

export class BuilderError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = "BuilderError";
  }
}

export type BuildSource =
  | { kind: "diagnosis"; path: string }
  | { kind: "queries"; path: string };

export interface BuildOpts {
  source: BuildSource;
  outDir: string;
  evalSetId: string;
  onConflict: ConflictStrategy;
  /** From `--redaction-rules=<path>` */
  redactionRulesCliFlag: string | undefined;
  /** From CWD: usually `path.join(process.cwd(), "redaction-rules")` — caller passes resolved path */
  repoDir: string | undefined;
}

/**
 * Canonical JSON serialization for hashing — keys sorted, no whitespace.
 * Ensures hash(case) is stable across runs.
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(obj[k])).join(",") + "}";
}

export function ensureQueryId(c: { query_id: string; input: unknown; tags?: string[] }): string {
  if (c.query_id && c.query_id.length > 0) return c.query_id;
  const seed = canonicalJson({ input: c.input, tags: c.tags ?? [] });
  return createHash("sha256").update(seed).digest("hex").slice(0, 12);
}

function redactCase(c: EvalCase, applyFn: (s: string) => string): EvalCase {
  const redacted: EvalCase = {
    query_id: c.query_id,
    input: { user_message: applyFn(c.input.user_message) },
    tags: c.tags,
  };
  if (c.reference) {
    redacted.reference = { answer: applyFn(c.reference.answer) };
  }
  if (c.assertions) {
    redacted.assertions = c.assertions; // assertions strings (regex / value) intentionally NOT redacted
                                        // — they are user-authored test expectations, not raw PII
  }
  return redacted;
}

export async function build(opts: BuildOpts): Promise<BuildResult> {
  // ── Stage 1: pick cases from source ────────────────────────────────────
  let lifted: EvalCase[];
  let skippedFindingsCount = 0;
  try {
    if (opts.source.kind === "queries") {
      lifted = await liftFromQueriesFile(opts.source.path);
    } else {
      const r = await liftFromDiagnosis(opts.source.path);
      lifted = r.cases;
      skippedFindingsCount = r.skipped_findings_count;
    }
  } catch (e) {
    if (e instanceof QueryPickerError) {
      throw new BuilderError(`picker failed: ${e.message}`, e);
    }
    throw e;
  }

  // ── Stage 2: ensure query_id ───────────────────────────────────────────
  const withIds = lifted.map((c) => ({ ...c, query_id: ensureQueryId(c) }));

  // ── Stage 3: redact ────────────────────────────────────────────────────
  let rulesResult;
  try {
    rulesResult = await loadRules({
      cliFlag: opts.redactionRulesCliFlag,
      repoDir: opts.repoDir,
    });
  } catch (e) {
    if (e instanceof RedactorError) {
      throw new BuilderError(`redactor failed: ${e.message}`, e);
    }
    throw e;
  }
  const apply = (s: string) => applyRules(s, rulesResult.rules);
  const redacted = withIds.map((c) => redactCase(c, apply));

  // ── Stage 4: write + conflict resolve + validate ───────────────────────
  let writeRes;
  try {
    writeRes = await writeEvalSet({
      outDir: opts.outDir,
      evalSetId: opts.evalSetId,
      newCases: redacted,
      onConflict: opts.onConflict,
    });
  } catch (e) {
    if (e instanceof WriterError) {
      throw new BuilderError(`writer failed: ${e.message}`, e);
    }
    throw e;
  }

  // ── Result ─────────────────────────────────────────────────────────────
  return {
    cases_written: writeRes.cases_written,
    cases_skipped: writeRes.cases_skipped + skippedFindingsCount,
    conflicts: writeRes.conflicts,
    shard_paths: writeRes.shard_paths,
    redaction_rules_source: rulesResult.source,
  };
}
```

- [ ] **Step 4: 追加 export 到 `src/trace-ai/eval-set/index.ts`**

```typescript
// （在末尾追加）
export { build, ensureQueryId, BuilderError } from "./builder.js";
export type { BuildOpts, BuildSource } from "./builder.js";
```

- [ ] **Step 5: 跑测试确认全过**

Run: `cd packages/typescript && node --import tsx --test test/trace-eval-set-builder.test.ts`
Expected: 6 tests pass

- [ ] **Step 6: Commit**

```bash
git add packages/typescript/src/trace-ai/eval-set/builder.ts \
        packages/typescript/src/trace-ai/eval-set/index.ts \
        packages/typescript/test/trace-eval-set-builder.test.ts
git commit -m "feat(M5/PR-A): add eval-set builder with inline ensureQueryId"
```

---

## Task 8：CLI 接入 — eval-set build 子命令

**Files:**
- Modify: `src/commands/trace.ts`（追加 dispatch 分支 + arg parsing + help）
- Create: `test/trace-eval-set-build-cli.test.ts`

- [ ] **Step 1: 写失败测试 `test/trace-eval-set-build-cli.test.ts`**

```typescript
import test from "node:test";
import assert from "node:assert/strict";

import { parseTraceArgs } from "../src/commands/trace.js";

test("parseTraceArgs recognizes 'eval-set build' subcommand", () => {
  const args = parseTraceArgs([
    "eval-set",
    "build",
    "--queries=q.yaml",
    "--out=eval-sets/cs-v1",
  ]);
  assert.equal(args.subcommand, "eval-set-build");
  assert.equal(args.queriesPath, "q.yaml");
  assert.equal(args.out, "eval-sets/cs-v1");
});

test("parseTraceArgs recognizes --diagnosis= source", () => {
  const args = parseTraceArgs([
    "eval-set",
    "build",
    "--diagnosis=diagnosis/",
    "--out=eval-sets/cs-v1",
  ]);
  assert.equal(args.subcommand, "eval-set-build");
  assert.equal(args.diagnosisPath, "diagnosis/");
});

test("parseTraceArgs recognizes --on-conflict + --redaction-rules", () => {
  const args = parseTraceArgs([
    "eval-set",
    "build",
    "--queries=q.yaml",
    "--out=eval-sets/cs-v1",
    "--on-conflict=skip",
    "--redaction-rules=rules.yaml",
  ]);
  assert.equal(args.onConflict, "skip");
  assert.equal(args.redactionRules, "rules.yaml");
});

test("parseTraceArgs defaults on-conflict to 'fail'", () => {
  const args = parseTraceArgs([
    "eval-set",
    "build",
    "--queries=q.yaml",
    "--out=eval-sets/cs-v1",
  ]);
  assert.equal(args.onConflict, "fail");
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/typescript && node --import tsx --test test/trace-eval-set-build-cli.test.ts`
Expected: FAIL — `args.subcommand === 'help'`，因为 parseTraceArgs 当前只识别 `diagnose`

- [ ] **Step 3: 修改 `src/commands/trace.ts` — 加 eval-set-build 解析分支**

先扩展 `ParsedTraceArgs` interface（在 trace.ts 现有定义 22-39 行附近）：

```typescript
export interface ParsedTraceArgs {
  subcommand:
    | "diagnose"
    | "rules-validate"
    | "eval-set-build"
    | "schema-validate"  // 留给 Task 9
    | "help";
  // 既有字段……
  mode?: "single" | "batch";
  conversationId?: string;
  traces?: string;
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
  // ── M5 PR-A 新增字段 ────────────────────────────────────────────────
  queriesPath?: string;
  diagnosisPath?: string;
  onConflict?: "fail" | "skip" | "overwrite";
  redactionRules?: string;
  evalSetId?: string;
  // Task 9 schema validate
  schemaValidatePath?: string;
  schemaKind?: string;
}
```

然后在 `parseTraceArgs` 顶部加 dispatch 分支（紧跟 line 49 `if (argv[1] === "rules" && argv[2] === "validate")` 之后）：

```typescript
  // M5 PR-A: eval-set build
  if (head === "eval-set" && argv[1] === "build") {
    const parsed = yargs(argv.slice(2))
      .option("queries", { type: "string", default: undefined })
      .option("diagnosis", { type: "string", default: undefined })
      .option("out", { type: "string", default: undefined })
      .option("on-conflict", {
        type: "string",
        choices: ["fail", "skip", "overwrite"],
        default: "fail",
      })
      .option("redaction-rules", { type: "string", default: undefined })
      .option("eval-set-id", { type: "string", default: undefined })
      .help(false)
      .parseSync();
    return {
      ...defaults("eval-set-build"),
      queriesPath: parsed.queries as string | undefined,
      diagnosisPath: parsed.diagnosis as string | undefined,
      out: (parsed.out as string | undefined) ?? null,
      onConflict: parsed["on-conflict"] as "fail" | "skip" | "overwrite",
      redactionRules: parsed["redaction-rules"] as string | undefined,
      evalSetId: parsed["eval-set-id"] as string | undefined,
    };
  }
```

注：`defaults()` 函数需要扩展 to handle new subcommand 类型 — 看 trace.ts 现有 line 93-108 `function defaults`：

```typescript
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

不需要改 `defaults`，因为新字段都是 optional / `?:`，可以省略。

最后，head 不是 "diagnose" 也不是 "eval-set" 时回到 help（line 46-48 已处理 `head !== "diagnose"` 走 help）。改成更宽容：

```typescript
  if (head !== "diagnose" && head !== "eval-set" && head !== "schema") {
    return defaults("help");
  }
```

- [ ] **Step 4: 跑解析测试确认通**

Run: `cd packages/typescript && node --import tsx --test test/trace-eval-set-build-cli.test.ts`
Expected: 4 tests pass

- [ ] **Step 5: 修改 `src/commands/trace.ts` `runTraceCommand` — 加 dispatch 调用 build()**

在 `runTraceCommand` 函数顶部，args 解析后追加分支（紧跟 `if (args.subcommand === "rules-validate")` 之后）：

```typescript
  if (args.subcommand === "eval-set-build") {
    return await runEvalSetBuild(args);
  }
```

并在文件末尾追加：

```typescript
import { build, BuilderError } from "../trace-ai/eval-set/index.js";
import path from "node:path";

async function runEvalSetBuild(args: ParsedTraceArgs): Promise<number> {
  // 参数检查：互斥 + 必填
  const hasQueries = !!args.queriesPath;
  const hasDiagnosis = !!args.diagnosisPath;
  if (hasQueries === hasDiagnosis) {
    process.stderr.write(
      "error: must pass exactly one of --queries=<file> | --diagnosis=<dir>\n",
    );
    return 2;
  }
  if (!args.out) {
    process.stderr.write("error: --out=<dir> is required\n");
    return 2;
  }

  // eval_set_id 默认 = basename(out)
  const evalSetId = args.evalSetId ?? path.basename(args.out.replace(/\/+$/, ""));
  const repoDir = path.join(process.cwd(), "redaction-rules");

  try {
    const result = await build({
      source: hasQueries
        ? { kind: "queries", path: args.queriesPath! }
        : { kind: "diagnosis", path: args.diagnosisPath! },
      outDir: args.out,
      evalSetId,
      onConflict: args.onConflict ?? "fail",
      redactionRulesCliFlag: args.redactionRules,
      repoDir,
    });
    process.stdout.write(
      `✓ wrote ${result.cases_written} cases (${result.cases_skipped} skipped), ${result.shard_paths.length} shard(s)\n`,
    );
    process.stdout.write(`  redaction_rules: ${result.redaction_rules_source}\n`);
    if (result.conflicts.length > 0) {
      process.stdout.write(`  conflicts: ${result.conflicts.join(", ")}\n`);
    }
    return 0;
  } catch (e) {
    if (e instanceof BuilderError) {
      process.stderr.write(`error: ${e.message}\n`);
      // query_id 冲突 → exit 6（spec doc §5.4）
      if (e.message.includes("query_id conflict")) return 6;
      return 1;
    }
    process.stderr.write(`error: ${(e as Error).message}\n`);
    return 1;
  }
}
```

- [ ] **Step 6: 跑全套测试确认无 break**

Run: `cd packages/typescript && npm test 2>&1 | tail -20`
Expected: 既有 + 新增测试全过

- [ ] **Step 7: 手测一遍 CLI**

```bash
cd packages/typescript
npm run build
node dist/cli.js trace eval-set build --queries=test/fixtures/eval-set/queries-input-valid.yaml --out=/tmp/m5-test-out --eval-set-id=cs-v1
ls /tmp/m5-test-out
cat /tmp/m5-test-out/index.yaml
cat /tmp/m5-test-out/cases.yaml
```

Expected: 写出 index.yaml + cases.yaml；2 cases 写入；redaction_rules: builtin

- [ ] **Step 8: Commit**

```bash
git add packages/typescript/src/commands/trace.ts \
        packages/typescript/test/trace-eval-set-build-cli.test.ts
git commit -m "feat(M5/PR-A): wire 'trace eval-set build' CLI dispatch"
```

---

## Task 9：schema validate 子命令

**Files:**
- Modify: `src/commands/trace.ts`（追加 schema validate dispatch + kind 推断）
- Create: `test/trace-schema-validate.test.ts`

- [ ] **Step 1: 写失败测试 `test/trace-schema-validate.test.ts`**

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import fs from "node:fs/promises";

import { parseTraceArgs } from "../src/commands/trace.js";
import { runSchemaValidate, inferKind, SchemaKindRequiredError } from "../src/commands/trace.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── arg parsing ─────────────────────────────────────────────────────────

test("parseTraceArgs recognizes 'schema validate'", () => {
  const args = parseTraceArgs(["schema", "validate", "eval-sets/cs-v1/index.yaml"]);
  assert.equal(args.subcommand, "schema-validate");
  assert.equal(args.schemaValidatePath, "eval-sets/cs-v1/index.yaml");
});

test("parseTraceArgs accepts --kind=", () => {
  const args = parseTraceArgs([
    "schema",
    "validate",
    "any.yaml",
    "--kind=eval-set",
  ]);
  assert.equal(args.schemaKind, "eval-set");
});

// ── inferKind heuristics ────────────────────────────────────────────────

test("inferKind: index.yaml in eval-sets/* → eval-set-index", () => {
  assert.equal(inferKind("eval-sets/cs-v1/index.yaml"), "eval-set-index");
});

test("inferKind: *-test-report.yaml → test-report", () => {
  assert.equal(inferKind("test-runs/baseline/some-test-report.yaml"), "test-report");
});

test("inferKind: cases.yaml in eval-sets/* → eval-set", () => {
  assert.equal(inferKind("eval-sets/cs-v1/cases.yaml"), "eval-set");
});

test("inferKind: unknown file path → null (means --kind required)", () => {
  assert.equal(inferKind("/tmp/random.yaml"), null);
});

// ── end-to-end runSchemaValidate ────────────────────────────────────────

test("runSchemaValidate validates a valid eval-set-index file → 0", async () => {
  const tmp = path.join(__dirname, "fixtures", "eval-set", "tmp-index.yaml");
  await fs.writeFile(
    tmp,
    `schema_version: trace-eval-set-index/v1
eval_set_id: x
shards:
  - path: cases.yaml
`,
    "utf8",
  );
  try {
    const code = await runSchemaValidate({ filePath: tmp, kind: "eval-set-index" });
    assert.equal(code, 0);
  } finally {
    await fs.unlink(tmp);
  }
});

test("runSchemaValidate returns 1 for invalid yaml", async () => {
  const tmp = path.join(__dirname, "fixtures", "eval-set", "bad-index.yaml");
  await fs.writeFile(
    tmp,
    `schema_version: trace-eval-set-index/v1
eval_set_id: x
shards: []
`,
    "utf8",
  );
  try {
    const code = await runSchemaValidate({ filePath: tmp, kind: "eval-set-index" });
    assert.equal(code, 1);
  } finally {
    await fs.unlink(tmp);
  }
});

test("runSchemaValidate returns 2 when kind cannot be inferred and not provided", async () => {
  const tmp = path.join(tmpdir(), `wat-${Date.now()}.yaml`);
  await fs.writeFile(tmp, "x: 1\n", "utf8");
  try {
    await assert.rejects(
      runSchemaValidate({ filePath: tmp, kind: undefined }),
      (e) => e instanceof SchemaKindRequiredError,
    );
  } finally {
    await fs.unlink(tmp);
  }
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/typescript && node --import tsx --test test/trace-schema-validate.test.ts`
Expected: FAIL — `runSchemaValidate is not exported`

- [ ] **Step 3: 在 `parseTraceArgs` 追加 schema validate 分支**

紧跟 eval-set-build 分支后：

```typescript
  // M5 PR-A: schema validate
  if (head === "schema" && argv[1] === "validate") {
    const parsed = yargs(argv.slice(2))
      .option("kind", { type: "string", default: undefined })
      .help(false)
      .parseSync();
    return {
      ...defaults("schema-validate"),
      schemaValidatePath: String(parsed._[0] ?? ""),
      schemaKind: parsed.kind as string | undefined,
    };
  }
```

- [ ] **Step 4: 在 trace.ts 文件末尾追加 inferKind + runSchemaValidate**

```typescript
import { readFile } from "node:fs/promises";
import {
  EvalSetIndexSchema,
  EvalSetShardSchema,
  EvalSetInputSchema,
  TestReportSchema,
} from "../trace-ai/eval-set/schemas.js";

export class SchemaKindRequiredError extends Error {
  constructor(filePath: string) {
    super(
      `cannot infer schema kind for ${filePath}; pass --kind=<eval-set|eval-set-index|eval-set-input|test-report>`,
    );
    this.name = "SchemaKindRequiredError";
  }
}

export function inferKind(filePath: string): string | null {
  const norm = filePath.replace(/\\/g, "/");
  const base = norm.split("/").pop() ?? "";
  // index.yaml in an eval-set dir
  if (base === "index.yaml" && /\/eval-sets\/[^/]+\/index\.yaml$/.test(norm)) {
    return "eval-set-index";
  }
  if (base.endsWith("-test-report.yaml") || base === "test-report.yaml" || base === "report.yaml") {
    // report.yaml in test-runs/* is test-report
    if (/\/test-runs\//.test(norm) || base.includes("test-report")) return "test-report";
  }
  if (base.endsWith("-eval-set-input.yaml") || base.includes("queries-input")) {
    return "eval-set-input";
  }
  // shard inside eval-set dir (anything not index.yaml)
  if (/\/eval-sets\/[^/]+\/[^/]+\.yaml$/.test(norm) && base !== "index.yaml") {
    return "eval-set";
  }
  return null;
}

const SCHEMA_BY_KIND: Record<string, { safeParse: (x: unknown) => { success: boolean; error?: { issues: Array<{ message: string; path: (string | number)[] }> } } }> = {
  "eval-set": EvalSetShardSchema,
  "eval-set-index": EvalSetIndexSchema,
  "eval-set-input": EvalSetInputSchema,
  "test-report": TestReportSchema,
};

export interface RunSchemaValidateOpts {
  filePath: string;
  kind: string | undefined;
}

export async function runSchemaValidate(opts: RunSchemaValidateOpts): Promise<number> {
  if (!opts.filePath) {
    process.stderr.write("error: schema validate requires a file path argument\n");
    return 2;
  }
  const kind = opts.kind ?? inferKind(opts.filePath);
  if (!kind) {
    throw new SchemaKindRequiredError(opts.filePath);
  }
  const schema = SCHEMA_BY_KIND[kind];
  if (!schema) {
    process.stderr.write(`error: unknown --kind=${kind}; valid: ${Object.keys(SCHEMA_BY_KIND).join(", ")}\n`);
    return 2;
  }
  let raw: string;
  try {
    raw = await readFile(opts.filePath, "utf8");
  } catch (e) {
    process.stderr.write(`error: cannot read ${opts.filePath}: ${(e as Error).message}\n`);
    return 1;
  }
  const yaml = await import("js-yaml");
  let parsed: unknown;
  try {
    parsed = yaml.default.load(raw);
  } catch (e) {
    process.stderr.write(`error: yaml parse failed: ${(e as Error).message}\n`);
    return 1;
  }
  const result = schema.safeParse(parsed);
  if (result.success) {
    process.stdout.write(`✓ ${opts.filePath} valid against ${kind}\n`);
    return 0;
  }
  const issue = result.error!.issues[0];
  const where = issue.path.join(".");
  process.stderr.write(
    `✗ ${opts.filePath} invalid at '${where}': ${issue.message}\n`,
  );
  return 1;
}
```

- [ ] **Step 5: 在 `runTraceCommand` 加 dispatch**

紧跟 eval-set-build dispatch 之后：

```typescript
  if (args.subcommand === "schema-validate") {
    try {
      return await runSchemaValidate({
        filePath: args.schemaValidatePath ?? "",
        kind: args.schemaKind,
      });
    } catch (e) {
      if (e instanceof SchemaKindRequiredError) {
        process.stderr.write(`error: ${e.message}\n`);
        return 2;
      }
      throw e;
    }
  }
```

- [ ] **Step 6: 跑测试确认全过**

Run: `cd packages/typescript && node --import tsx --test test/trace-schema-validate.test.ts`
Expected: 7 tests pass

- [ ] **Step 7: 手测**

```bash
cd packages/typescript
npm run build
node dist/cli.js trace schema validate /tmp/m5-test-out/index.yaml
node dist/cli.js trace schema validate /tmp/m5-test-out/cases.yaml
```

Expected: 两条都打印 `✓ ... valid against eval-set-index/eval-set`

- [ ] **Step 8: Commit**

```bash
git add packages/typescript/src/commands/trace.ts \
        packages/typescript/test/trace-schema-validate.test.ts
git commit -m "feat(M5/PR-A): add 'trace schema validate' CLI subcommand with kind inference"
```

---

## Task 10：help 文本 + AGENTS.md 同步

**Files:**
- Modify: `src/commands/trace.ts` `printHelp()` function
- Modify: `README.md`（如有 trace 命令树文档）
- Modify: `AGENTS.md`（M4 一致同步约定）
- Modify: `skills/kweaver-core/references/`（按 M4 既有约定）

- [ ] **Step 1: 改 `printHelp()` 函数**

在 `printHelp` 函数现有 `trace diagnose ...` 段落后追加（找现有 line 147 `trace diagnose rules validate <rule.yaml>` 之后）：

```typescript
  trace eval-set build [--diagnosis=<dir> | --queries=<file>] --out=<dir>
                                              Build a git-trackable eval-set yaml directory from
                                              either M4 diagnosis reports or a simplified
                                              queries+golden-truth input file.
    --diagnosis=<dir>                         Lift suggested_eval_case from M4 report findings
                                              (mutually exclusive with --queries=)
    --queries=<file>                          Lift from simplified trace-eval-set-input/v1 yaml
                                              (mutually exclusive with --diagnosis=)
    --out=<dir>                              Required output directory; index.yaml + cases.yaml
    --on-conflict=fail|skip|overwrite        query_id conflict strategy (default: fail; exit 6 on conflict)
    --redaction-rules=<path>                 Override <repo>/redaction-rules/ source for PII redaction
    --eval-set-id=<id>                       Override default eval_set_id (basename of --out)

  trace schema validate <file> [--kind=<kind>]
                                              Validate a yaml file against its M5/M4 zod schema
                                              (eval-set / eval-set-index / eval-set-input / test-report)
                                              --kind auto-inferred from file path; pass explicitly
                                              if inference fails (exit 2 = kind required)
```

- [ ] **Step 2: 同步 README.md（如存在）**

Run: `grep -l "kweaver trace" packages/typescript/README.md /Users/xupeng/dev/github/kweaver-sdk/README.md 2>&1 | head`

如果有命中 → 在对应位置（紧跟既有 `kweaver trace diagnose` 段）追加 `kweaver trace eval-set build` 和 `kweaver trace schema validate` 一行说明。

如果没命中 → 跳过本步。

- [ ] **Step 3: 同步 AGENTS.md（如存在）**

Run: `find . -maxdepth 3 -name AGENTS.md 2>&1 | head`
对找到的 AGENTS.md（一般在 packages/typescript/）追加 M5 命令一行（参 M4 既有 entry）。

- [ ] **Step 4: 同步 skills/kweaver-core/references/（如有 trace 命令清单）**

Run: `find /Users/xupeng/dev/github/kweaver-sdk -path '*/skills/kweaver-core/references/*' -name "*.md" 2>&1 | head`
找命令清单文件，追加 M5 两条。

- [ ] **Step 5: Commit**

```bash
git add packages/typescript/src/commands/trace.ts AGENTS.md \
        packages/typescript/README.md \
        $(find . -maxdepth 5 -path '*/skills/kweaver-core/references/*' -name "*.md")
git commit -m "docs(M5/PR-A): sync help text + AGENTS.md + skill references"
```

如 step 2/3/4 跳过则相应文件从 add 列表删。

---

## Task 11：e2e smoke 测试 + 真 diagnosis fixture

**Files:**
- Create: `test/trace-eval-set-build-e2e.test.ts`
- Reuse: M4 diagnosis report fixture（如有）

- [ ] **Step 1: 查 M4 既有 diagnose 报告 fixture**

Run: `find packages/typescript/test/fixtures/trace-diagnose -name "*.yaml" -exec head -3 {} \; -print 2>&1 | head -30`
Expected: 找到若干 diagnose-report 输出样例

- [ ] **Step 2: 建 e2e smoke 测试 `test/trace-eval-set-build-e2e.test.ts`**

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import fs from "node:fs/promises";
import yaml from "js-yaml";

import { build } from "../src/trace-ai/eval-set/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 用 Task 4 的 fixture 作真 diagnose dir
const DIAGNOSE_FIXTURE_DIR = path.join(__dirname, "fixtures", "eval-set");

test("e2e: build --diagnosis= + schema validate 全链通", async () => {
  const out = await fs.mkdtemp(path.join(tmpdir(), "m5-e2e-"));
  // 复制 Task 4 的 diagnose-report-sample.yaml 到独立 dir
  const diagDir = await fs.mkdtemp(path.join(tmpdir(), "m5-diag-"));
  await fs.copyFile(
    path.join(DIAGNOSE_FIXTURE_DIR, "diagnose-report-sample.yaml"),
    path.join(diagDir, "report.yaml"),
  );

  try {
    const result = await build({
      source: { kind: "diagnosis", path: diagDir },
      outDir: out,
      evalSetId: "e2e-test",
      onConflict: "fail",
      redactionRulesCliFlag: undefined,
      repoDir: undefined,
    });

    assert.equal(result.cases_written, 1); // 1 finding 有 suggested_eval_case
    assert.ok(result.cases_skipped >= 1); // 至少 1 finding 缺 suggested_eval_case

    // 再走一遍 schema validate（模拟用户跑 `kweaver trace schema validate`）
    const indexRaw = await fs.readFile(path.join(out, "index.yaml"), "utf8");
    const parsedIndex = yaml.load(indexRaw);
    const { EvalSetIndexSchema, EvalSetShardSchema } = await import(
      "../src/trace-ai/eval-set/schemas.js"
    );
    assert.equal(EvalSetIndexSchema.safeParse(parsedIndex).success, true);

    const shardRaw = await fs.readFile(path.join(out, "cases.yaml"), "utf8");
    const parsedShard = yaml.load(shardRaw);
    assert.equal(EvalSetShardSchema.safeParse(parsedShard).success, true);
  } finally {
    await fs.rm(out, { recursive: true, force: true });
    await fs.rm(diagDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 3: 跑测试**

Run: `cd packages/typescript && node --import tsx --test test/trace-eval-set-build-e2e.test.ts`
Expected: 1 test passes

- [ ] **Step 4: 跑全套 test**

Run: `cd packages/typescript && npm test 2>&1 | tail -15`
Expected: 既有 M4 + 新 M5 PR-A 所有 test 全过

- [ ] **Step 5: Commit**

```bash
git add packages/typescript/test/trace-eval-set-build-e2e.test.ts
git commit -m "test(M5/PR-A): e2e smoke — build --diagnosis= + schema validate full chain"
```

---

## Task 12：PR 提交 + 收尾

**Files:**
- 无新建；最后整理 commits + 开 PR

- [ ] **Step 1: 检查 commit log**

Run: `git log --oneline main..HEAD`
Expected: 看到 Task 1-11 的 commit 链（约 11 个 commit），消息一致 `feat(M5/PR-A): ...`

- [ ] **Step 2: 在本地 build + 跑全套 test 最后一遍**

```bash
cd packages/typescript
npm run build
npm test 2>&1 | tail -20
```

Expected: build 无错；测试全过

- [ ] **Step 3: 手测一遍 user happy path**

```bash
node dist/cli.js trace eval-set build --queries=test/fixtures/eval-set/queries-input-valid.yaml --out=/tmp/m5-final-test
node dist/cli.js trace schema validate /tmp/m5-final-test/index.yaml
node dist/cli.js trace schema validate /tmp/m5-final-test/cases.yaml
rm -rf /tmp/m5-final-test
```

Expected:
- build: `✓ wrote 2 cases (0 skipped), 1 shard(s)` + `redaction_rules: builtin`
- validate × 2: `✓ ... valid against eval-set-index/eval-set`

- [ ] **Step 4: Push 分支 + 开 PR**

```bash
git push -u origin <branch-name>
gh pr create --title "feat(traceai): #128 M5 PR-A — eval-set build + schema validate" \
  --body "$(cat <<'PRBODY'
## Summary

M5 issue #128 PR-A 范围落地：`kweaver trace eval-set build` 子命令（`--diagnosis=` + `--queries=` 双源）+ `kweaver trace schema validate <file>` 子命令。

Story B 衔接路径打通（M4 诊断报告 → eval-set yaml 资产），但**还不能跑测试**——test 闭环属 PR-B。

## 交付物

- 4 套 zod schema：`trace-eval-set/v1` + `-input/v1` + `-index/v1` + `trace-test-report/v1`（PR-A 写 schema，PR-B 真消费）
- `kweaver trace eval-set build`（双源 + `--on-conflict` + `--redaction-rules` + query_id hash 自动生成）
- 内置 5 类低保真 PII redaction（电话/邮箱/身份证/银行卡/IP）+ 覆盖链
- `kweaver trace schema validate <file>`（kind 推断 + 显式 `--kind=`）
- 11 个新文件 + 1 个修改

## Test plan

- [x] 单测 ~30 cases 全过：schemas / picker / redactor / output-writer / builder / CLI 解析 / schema-validate
- [x] e2e smoke：build --diagnosis= + schema validate 全链通过
- [x] 手测 happy path：用户视角 `build --queries= → schema validate` 跑通
- [x] 不破坏 M4 既有 1100+ 测试

## 决议出处

依 spec doc [docs/superpowers/specs/2026-05-13-m5-eval-set-builder-design.md](docs/superpowers/specs/2026-05-13-m5-eval-set-builder-design.md) §2 D0-D6 决议落地。本 PR 实现 D1（input schema refinement）/ D2（redaction builtin defaults）/ D6（schema validate 不依赖 SSOT YAML），D3-D5 等 PR-B 落地。

Closes part of #128（PR-B 跟进后整体 close）。

🤖 Generated with [Claude Code](https://claude.com/claude-code)
PRBODY
)"
```

- [ ] **Step 5: Done**

PR-A 落地完成。等 review + CI 全绿后 merge，开 PR-B implementation plan。

---

## Self-Review

**Spec coverage check**：

- [x] §3 架构总览 → Task 1 module skeleton + Task 12 整体
- [x] §4.1 4 套 zod schema + B1 扩展 → Task 2（B1 punted to PR-B per "反 dead code" 决议；plan 已注）
- [x] §4.2 query-picker / redactor / output-writer / builder → Task 3-7
- [x] §4.4 CLI 入口 → Task 8 + Task 9
- [x] §5 build flow（含三种来源 + on-conflict + 退出码） → Task 8 完整覆盖
- [x] §5.3 三种 user 场景 → Task 3 fixture（含 reference + assertions）+ Task 8 手测
- [x] §7 错误处理 → 每个 Task 都有 fail-fast / WriterError / RedactorError / BuilderError 等
- [x] §8.2 PR-A 单测清单 → Task 2, 3, 4, 5, 6, 7, 8, 9 每个都包测试
- [x] §8.3 e2e CI → Task 11
- [x] §10.1 PR-A 验收口径 → Task 12 step 3-5 手测覆盖

未在 plan 中显式包含但 spec 提及的项：
- AGENTS.md / README / skills 同步 → Task 10 step 2-4 条件性同步（如目录存在则同步，否则跳过）
- `trace-eval-set-input/v1` 简化 schema 单独命名 footgun avoidance → Task 2 schemas.ts 双 schema 已落

**Placeholder scan**：plan 中无 "TBD" / "TODO" / "implement later" / 占位代码块。Task 4 中早期写测试时识别到设计冲突，立即在 plan 内修正（不留给读者推断）。

**Type consistency**：

- `EvalCase.query_id` 在 types.ts 为 string（非 undefined），picker 用 `""` 表示未填，builder.ensureQueryId 处理 — Task 1 / 3 / 7 一致
- `ConflictStrategy` 用 type alias，output-writer + builder + commands/trace.ts 引用相同枚举 — 一致
- `BuildResult` 字段名（`cases_written` / `cases_skipped` / `conflicts` / `shard_paths` / `redaction_rules_source`）— types.ts + writer + builder + cli 全一致

**One deviation from spec doc note**：spec doc §4.1 列了 B1 `getTraceByConversationId` 扩展放在 PR-A；plan 把它推到 PR-B（实际真消费者出现的位置），避免 PR-A ship dead code。Plan §"不动" 已注明此偏离 + 理由。

---

## 估算汇总

| Task | 估算 | 说明 |
|---|---|---|
| Task 1 模块骨架 | 0.5h | 类型定义 + barrel |
| Task 2 4 套 schema | 1d | refinement 调试可能耗时 |
| Task 3 lift queries | 0.5d | 简单读 yaml + zod |
| Task 4 lift diagnosis | 0.5d | M4 报告字段抽取 |
| Task 5 redactor | 1d | builtin regex + 规则链 |
| Task 6 output-writer | 1d | on-conflict 状态机 + .bak |
| Task 7 builder | 0.5d | 主流程拼装 |
| Task 8 build CLI | 1d | yargs 解析 + dispatch + 手测 |
| Task 9 schema validate CLI | 0.5d | kind 推断 + 4 schema 路由 |
| Task 10 docs | 0.5d | help + AGENTS / README / skills 同步 |
| Task 11 e2e | 0.5d | 一条 smoke test |
| Task 12 PR | 0.5d | log + 手测 + PR body |
| **合计** | **~7d** | spec doc 估 5-7d，落 7d 上沿 |
