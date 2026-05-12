# M4 Trace Diagnose — Issue #2 设计（Batch / Cross-Trace Synthesizer，单 agent）

最后更新：2026-05-12
语言：中文。英文原版（含 time-scan 形态）见 git history `61d0bd5`；2026-05-12 用户 challenge 后做了两条减法：(1) batch 强制单 agent，(2) 砍掉 time-scan，本版本反映减法后的最终设计。

跟踪 issue: [kweaver-ai/kweaver-sdk#123](https://github.com/kweaver-ai/kweaver-sdk/issues/123)
前置 issue: [#120](https://github.com/kweaver-ai/kweaver-sdk/issues/120)（PR-A symbolic + PR-B rubric，单 trace）
Vision 引用：`plan-traceai/vision/trace-cli-detailed-design.md` §3.1 / §3.3.4
Issue plan: `plan-traceai/plan/2026-05-11-m4-diagnose-issue-plan.md` §2 #2

## Summary

把 `kweaver trace diagnose` 从单 trace 模式（#120, PR-A + PR-B）扩展到 **batch 模式 —— 接受显式 conversation_id 列表，强制所有 trace 属于同一个 agent**：

```
kweaver trace diagnose --traces=conv1,conv2,conv3 --out=diagnosis/ticket-42/
kweaver trace diagnose --traces=@/path/to/ids.txt   --out=diagnosis/ticket-42/
```

使用场景：用户从 ticket / 日志 / 人工 review 摘出来一组某个 agent 的 conv_id，想批量诊断 + 看跨 trace 失败模式。

Batch 走一条新 pipeline：**N 条 trace 过 Stage-1（symbolic）+ 批量化 Stage-2（rubric）+ deterministic Stage-3 per-trace synth + 1 次 LLM 调用的 Stage-4 cross-trace synthesizer**（输入是 deterministic aggregates + K 个采样 summary）。

成本 / 时长画像跟 PR-B 单 trace 模式**有本质区别**。PR-B 每条 trace 1 次 rubric LLM + 1 次 synthesizer LLM——单条够用，100 条要烧 ~140 次 LLM 调用。本 issue 把 rubric 批量化（每次 LLM call 评 K=10 条），Stage-3 降级到 template 模式（0 次 LLM），Stage-4 单次 LLM 出 cross-trace 叙事。**100 trace / 38 flagged 场景：总共 5 次 LLM 调用**（4 fast-tier Stage-2 batches + 1 std-tier Stage-4 synth）。

这个成本削减是**结构性的，不只是优化**。它带来：

- 同等 trace 规模下 LLM 调用数减 ~30×
- Stage-2 批量化的 rubric prompt 让 LLM 一次看到所有 flagged trace —— **它能识别 per-trace 调用看不到的跨 trace 模式**（"30/38 都是 `stale_results`"）
- `AgentProvider` 加 `tier: 'fast' | 'std'` 抽象，**调用方传任务难度 intent**（分类 vs 综合）而不是 hardcode 模型名（`haiku` vs `sonnet`）
- **单 agent 不变性**让所有 aggregate 数据语义清晰 —— "agent X 的 dominant 失败模式是 Y" 是可解读的；混 agent 等价于把不同程序的失败模式平均，给出无意义结论

本 issue 落地：新增 `trace-ai/scan/` 子树（peer of `trace-ai/diagnose/`）+ `agent-providers/` 小幅扩展 + `trace-ai/diagnose/schemas.ts` 加一个字段。**PR-B 的 `agent-providers/`、单 trace `diagnose()`、report markdown renderer 全部复用，不重构**。

## Goals

- Ship `kweaver trace diagnose --traces=<list>` batch 入口，**强制所有 conv_id 属于同一个 agent_id**（不一致 fail-fast）
- 新增 **Stage-4 cross-trace synthesizer**，产出 `scan-summary/v1` 报告（yaml 和 markdown 两种格式）
- 通过 rule YAML 的 `rubric.gates_on` 实现 **Stage-1 → Stage-2 配对 gate**（解决 PR-B 已知的"rubric 在 benign trace 上误触发"问题，且不破坏单 trace 模式行为）
- 实现 **batched rubric evaluation**：一次 LLM 调用评估一组 flagged traces。LLM 调用数从 O(N) 降到 O(N/K)
- 在 `JudgmentRequest` 引入 **`tier: 'fast' | 'std'` 抽象**。调用方不 hardcode 模型名；provider 通过 constructor opts 映射 tier → 具体模型
- 建立 **partial-output 续传语义**：磁盘上的 per-trace yaml = ground truth；batch 重跑按 trace_id 跳过已诊断的
- 复用 PR-B 的 `AgentProvider` / prompt-template / claude-code subprocess provider / within-trace template synthesizer —— 不需要任何重构

## Non-goals

- **不支持 time-scan**：`scan` 子命令、`--time-range`、`--tenant` flag 都不实现。"过去 24h agent X 哪里出错" 这种场景用户用 `kweaver agent sessions <agent_id>` 拉列表 + `--traces=@file` 两步完成。time-scan 入口 + B1 `searchTracesStream` 流式拉取留 post-MVP，先观察 batch 真用户反馈再决定
- **不支持跨 agent batch**。`--traces` 里的 conv_id 必须解析到同一个 agent_id；不一致直接 fail-fast 列出分歧。理由：cross-trace synthesizer 叙事在跨 agent 时混乱无信号，aggregate 数据语义不清。要跨 agent 比较是另一个产品形态（比较 agent_id A vs B），不在 batch 范围
- **不支持 scan / batch 模式下的 `--no-llm`**。Cross-trace synthesizer 是 batch 的价值核心；没 LLM 时用户只能拿到 deterministic `aggregates`（已在 scan-summary 里）+ per-trace 报告（单 trace 模式本来就能给）。直接 fail-fast + 清晰错误信息，不静默降级
- **不支持 stdin (`--traces=-`)** 形式输入 trace 列表。MVP 阶段 `<list>` 只接受 comma-separated 和 `@<file>`（每行一个 id）。stdin 留 post-MVP
- **不支持 batch 模式 `--out` 缺省**。强制必须显式传 `--out=<dir>`；缺省时报错。避免在 cwd 乱写一堆 yaml
- **不实现 `--max-parallel` 在 rate-limit 触发时的自适应 backoff**。flag 设上限即可；rate-limit 触发表现为 `agent-error:transport` 跳过该 batch。自调节是 post-MVP
- **不引入显式的 `{shared_context, per_trace_overlay}` 数据结构**。批量化的 prompt 模板天然把共享部分抽出来了。不需要额外的 dedup 机制
- **不实现 `pattern_clusters`**（基于相似度的聚类，超越 rule_id 维度）。Issue #2 ship rule_frequency；clustering 留 post-MVP
- **不扩展 `tier` enum 超出 `'fast' | 'std'`**。`'premium'`（opus 级别）保留给未来 enum 增量
- **不重构 PR-B 的单 trace `diagnose()`**。CLI 按 flag 分发；带 `--traces` 调新入口

## 关键设计决策

| # | 决策 | 选择 | 理由 |
|---|---|---|---|
| 1 | Trace 来源 | 仅 `--traces=<list>` 一条入口（comma-separated 或 `@file`）。**不做 time-scan / tenant filter** | Pipeline 真复杂度在 Stage-2/3/4；time-scan 是大头工作量但不是核心价值。先 ship `--traces` 验证 pipeline，time-scan 等真用户反馈再决定 |
| 2 | 单 agent 不变性 | 所有 conv_id 解析后必须 agent_id 一致；不一致 fail-fast exit 2 并列出分歧 conv_id + agent_id 对照 | Cross-trace 叙事在跨 agent 时混乱无信号；aggregate 数据语义不清。强制单 agent 让所有下游分析自然 |
| 3 | Stage-2 评估模型 | Batched-by-rule：每条 rubric rule 每 K=10 条 flagged trace 一次 LLM 调用 | Per-trace LLM 调用成本是 O(N)；批量化是 O(N/K)。LLM 看到整块还能识别跨 trace 模式，per-trace 调用看不到 |
| 4 | Stage-3 评估模型 | batch 模式下 template-only（deterministic）；PR-B 的 agent 路径保留给单 trace 模式 | Per-trace LLM synth 是 PR-B 的成本主角（100 trace 例子里 100/139 调用）。Template 模式以零 LLM 成本产出合格 Summary 块；要深度叙事的用户对嫌疑 trace 重跑 `diagnose <conv_id>` 即可 |
| 5 | Stage-2 rubric gate | 配对 gate：rule YAML 的 `rubric.gates_on: [<symbolic_rule_id>...]`。只在 trace 已经命中 `gates_on` 里的某条 symbolic rule 时，Stage-2 才触发 | 解决 PR-B "rubric 在 benign trace 上误触发" 问题。配对关系在 YAML 里显式化 |
| 6 | 单 trace 模式 + `gates_on` | 单 trace 模式忽略 `gates_on`，rubric 跟 PR-B 一样无条件跑 | 单 trace 模式 UX 已经是"完整诊断这条 trace"，应用 gate 会让显式 diagnose 一条的用户困惑 |
| 7 | 模型选择 | `JudgmentRequest.tier?: 'fast' \| 'std'`；provider 通过 `modelByTier` constructor opt 映射 tier → 具体模型。Stage-2 = fast，Stage-4 = std，PR-B 模式 = 不传（CLI 默认） | 在 diagnose 代码里 hardcode `'haiku'` / `'sonnet'` 是把 claude 特定模型名泄漏进 trace-ai 逻辑。tier 抽象跨模型升级 / 跨 provider 都稳 |
| 8 | scan-summary schema | `scan-summary/v1` 独立 schema，`summary{}` 字段形状逐字段镜像 within-trace `Summary`（同概念字段同名），ID 空间不同的字段用不同名（`rule_id` vs `finding_id`） | "不允许歧义；不歧义则尽可能复用"。同名字段（headline / description / reason / relation）跨级别复用 → md renderer 共用模板。不同 ID 字段名（finding_id vs rule_id）保持跨级别阅读不歧义 |
| 9 | batch 模式 `--no-llm` | fail-fast exit 2 + 错误信息 | Cross-trace synthesizer 叙事是 batch 的价值核心；没 LLM 时用户只能拿到 deterministic aggregates（在 scan-summary 里有）+ per-trace 报告（单 trace 模式本来就有）。静默降级只会出半成品 |
| 10 | batch 模式 `--out` 缺省 | fail-fast exit 2，强制要求显式传 `--out=<dir>` | 避免在 cwd 乱写一堆 yaml 文件污染用户工作目录 |
| 11 | Cross-trace synth 输入 | Pre-aggregated 统计 + K=5 个采样 trace summary；LLM 在 deterministic 数据上写叙事 | 把全部 N 份原始 summary 送给 LLM 会在 ~50 trace 之后撑爆 token budget。Pre-aggregation 做 deterministic 计数；sampler 给具体例子兜底 |
| 12 | 采样器纪律 | 每个 dominant rule（频次 ≥ `max(3, 5% of N)`）选 top-1 by severity。加 2-3 个 cross-rule co-fire。加 1-2 个 outlier（rubric 自标 false positive）。K=5 硬上限 | Deterministic 采样让 cross-trace synth 可复现。Outlier 样本教 LLM 噪音长什么样，避免 over-fit 在 dominant 模式 |
| 13 | 续传语义 | Partial-output trust：`<out>/<trace_id>.yaml` 存在 → 跳过。原子写入：先写 `.partial` → rename。损坏 yaml = 重诊。MVP 不提供 `--force`；要全量重跑用户手动 `rm` | 文件系统就是 ground truth；不需要额外 state 文件 |
| 14 | LLM I/O 格式 | INPUT = YAML 紧凑形态；OUTPUT = JSON + zod 强校验 | INPUT 读一次；OUTPUT 要 parse + 校验下游 —— 按方向翻转 format-quality trade-off |
| 15 | 失败粒度 | per-chunk LLM 调用失败 → chunk 内全 K 条 trace 记 `rules_skipped[].reason = agent-error:<kind>`。chunk 内单条 schema_violation → 只跳那一条，其他 9 条不受影响 | 隔离 blast radius |

## Industry Alignment（相对 PR-B 的增量）

PR-B spec §Industry Alignment 已经建立了两段式（deterministic triage + LLM judge）的纪律。本 issue 把这条纪律放到它**原本被设计的工作负载**（批量评估）里去用。

相对 PR-B 的两个 refinement：

1. **Stage-1 gate 正式生效**（决策 #5）—— 用**配对 symbolic rule** gate 而不是 "any Stage-1 hit"
2. **批量化 LLM 判定** —— Agent-as-Judge 学术工作（NeurIPS'24, arXiv 2410.10934）报告 per-trace judging 只能 scale 到 ~50 trace（成本原因）。批量化是工业界回应

## 架构

### Module 布局

```
packages/typescript/src/
├── commands/trace.ts                                # +--traces 解析与分发
├── api/trace.ts                                     # 不动 — 复用 PR-A 的 getSpansByConversationId（逐 conv_id 查）
├── agent-providers/                                 # PR-B; tier 抽象增量
│   ├── types.ts                                     # JudgmentRequest.tier?: 'fast' | 'std' (新字段)
│   └── providers/claude-code-subprocess.ts          # modelByTier opt; 条件性 --model flag
└── trace-ai/
    ├── diagnose/                                    # PR-B; 本 issue 内除 schemas.ts 外不动
    │   └── schemas.ts                               # RuleSchema 加 rubric.gates_on
    └── scan/                                        # 新 peer 子树
        ├── index.ts                                 # runBatch(opts) -> ScanSummary; orchestrator
        ├── traces-list-parser.ts                    # --traces=<list> | --traces=@file → string[]
        ├── single-agent-validator.ts                # 拉 N 条 trace 的 agent_id，校验一致性
        ├── runner.ts                                # parallel per-trace Stage-1 + Stage-3-template；收集待办 rubric work
        ├── batched-rubric.ts                        # Stage-2: 按 rule chunk flagged traces，render 多 trace prompt，parse JSON，fan out verdicts 到 per-trace 报告
        ├── aggregator.ts                            # deterministic aggregates: rule_frequency
        ├── sampler.ts                               # K=5 采样器（给 cross-trace synth 输入用）
        ├── cross-trace-synthesizer.ts               # Stage-4: 一次 LLM 调用 (tier: 'std')，产出 scan-summary.summary{} 块
        ├── scan-summary-schema.ts                   # scan-summary/v1 的 zod schema
        ├── scan-summary-markdown.ts                 # md renderer（镜像 trace-ai/diagnose/report-markdown.ts）
        └── prompts/
            ├── builtin/rubric-judge-batch-v1.prompt.md     # 多 trace rubric 模板
            └── builtin/cross-trace-synthesizer-v1.prompt.md # cross-trace 叙事模板
```

### 数据流

```
$ kweaver trace diagnose --traces=@/tmp/ticket-42.txt --out=diagnosis/ticket-42/
       │
       ▼
[commands/trace.ts]
  解析 --traces; --out 存在性校验 → 调 runBatch(opts)
       │
       ▼
[trace-ai/scan/index.ts: runBatch]
  1. traces-list-parser → string[] conv_ids
  2. single-agent-validator:
       for each conv_id (parallel):
         spans = api/trace.getSpansByConversationId(conv_id)
         agent_id = extractAgentId(spans)
       if not all agent_ids match: fail-fast exit 2 with mismatch report
       agent_id = the unique agent_id
  3. per-trace 循环（并行，受 --max-parallel 限制）：
       - 续传 check：若 `<out>/<conv_id>.yaml` 存在且能 parse → 跳过，traces_reused++
       - assembleTraceTree → 跑 Stage-1 symbolic（复用 trace-ai/diagnose）
       - 若任何 rubric rule 的 `gates_on` 命中，进 rubric_work_queue
       - 跑 Stage-3 template synth（复用 trace-ai/diagnose/synthesizer-template）
       - assemble per-trace 报告（复用 trace-ai/diagnose/report-assembler）
       - 写 `<conv_id>.yaml.partial` → fsync → atomic rename 到 `<conv_id>.yaml`
       - 写 `<conv_id>.md`（复用 trace-ai/diagnose/report-markdown）
  4. Stage-2 batched rubric（按 rule 串行，rule 内 chunks 并行）：
       for each rubric_rule:
         flagged = rubric_work_queue[rubric_rule]
         for chunk in chunks(flagged, K=10):
           prompt = render(builtin:rubric-judge-batch-v1, {rubric_rule, traces: chunk.toYamlCompact()})
           response = provider.invoke({prompt, outputSchema: BatchedRubricSchema, tier: 'fast'})
           for verdict in response.trace_results:
             更新 per-trace `<conv_id>.yaml` 加入新 rubric Finding（原子重写）
             更新 per-trace `<conv_id>.md`
  5. aggregator 在所有最终 per-trace 报告上算 → AggregatesBlock (rule_frequency)
  6. sampler 选 K=5 个代表性 trace summary → SamplerOutput
  7. cross-trace-synthesizer:
       prompt = render(builtin:cross-trace-synthesizer-v1, {agent_id, aggregates, samples, n_total, sample_ratio})
       response = provider.invoke({prompt, outputSchema: ScanSummaryShape, tier: 'std'})
  8. 拼装 scan-summary.yaml + scan-summary.md
       - 写出 aggregates / per_trace_index / summary / scan{agent_id, traces_diagnosed, traces_reused, ...}
```

## Contracts

### `scan-summary/v1` schema

```yaml
schema_version: scan-summary/v1

scan:
  agent_id: 01KR0327YK6...                        # 强制有值；所有 trace 共享的 agent_id
  trace_count: 142
  traces_with_findings: 38
  traces_reused: 78                               # 续传：磁盘上多少条复用
  traces_freshly_diagnosed: 64
  resumed_from_partial: true | false              # iff traces_reused > 0
  diagnosed_at: 2026-05-12T...
  cli_version: 0.7.4
  synthesizer_mode: agent                         # batch 模式恒为 'agent'（无 template fallback）

summary:                                          # Stage-4 cross-trace synthesizer 输出 — 字段形状镜像 within-trace Summary
  headline: "tool_loop_no_state_change is the dominant failure mode (29% of flagged traces)"
  primary_root_cause:
    rule_ids: [tool_loop_no_state_change]         # ★ scan 级用 rule_ids（cf. within-trace 用 finding_ids — 同概念不同 ID 空间）
    description: "..."
    target_for_fix: decision_agent.prompt
  fix_priority:
    - rule_id: tool_loop_no_state_change          # ★ scan 级用 rule_id（cf. within-trace 用 finding_id）
      affected_trace_count: 41
      reason: "highest-frequency failure mode; fixing the loop prevention prompt would reduce the dominant pattern"
  cross_rule_links:                               # ★ scan 级是 cross-rule（rule 跨触发）
    - rule_ids: [tool_loop_no_state_change, tool_retry_intent_mismatch]
      relation: "fires on same span sequence in 38/41 cases — semantic and mechanical aspects of one incident class"

aggregates:                                       # deterministic，不走 LLM
  rule_frequency:
    - rule_id: tool_loop_no_state_change
      count: 41
      severity_breakdown: { high: 30, medium: 8, low: 3 }

per_trace_index:                                  # per-trace 报告指针
  - trace_id: ...
    conversation_id: ...
    report_path: diagnosis/ticket-42/<conv_id>.yaml
    finding_count: N
```

注：`agent_failure_rate` 在单 agent 不变性下退化成 `traces_with_findings / trace_count`（`scan{}` 块里已有），故从 aggregates 删除。

### `diagnosis-rule/v1` 增量（向后兼容）

```yaml
rubric:
  judge_question: ...
  inputs: [...]
  output_schema: { ... }
  agent_binding: { ... }
  gates_on:                                       # 新增；可选
    - tool_loop_no_state_change                   # symbolic rule_id 数组；OR 关系
```

语义：

- **batch 模式**：rubric rule 只在 trace 上至少有一条 `gates_on` 列出的 symbolic rule 命中时才评估。空 / 缺省 `gates_on` → rubric 在**所有** trace 上评估
- **单 trace 模式**：`gates_on` **被忽略**；rubric 无条件跑（保留 PR-B 行为）

### `JudgmentRequest.tier`（向后兼容）

```typescript
export interface JudgmentRequest<T> {
  prompt: string;
  outputSchema: ZodType<T>;
  timeoutMs?: number;
  correlationId?: string;
  tier?: 'fast' | 'std';                          // 新增；undefined = provider 默认（不传 --model flag）
}
```

### `ClaudeCodeSubprocessProvider` tier 映射

```typescript
export interface ClaudeCodeSubprocessProviderOpts {
  // ...existing
  modelByTier?: { fast?: string; std?: string };  // 默认: fast='haiku', std='sonnet'
}
```

`invoke()` 在 `req.tier` 有值时给 spawn args 追加 `--model {modelByTier[req.tier]}`；否则不传 `--model`

### 批量化 rubric LLM 输出 schema

```yaml
type: object
required: [trace_results]
properties:
  trace_results:
    type: array
    items:
      type: object
      required: [trace_id, category, reasoning, severity, first_violating_step_id]
      properties:
        trace_id: { type: string }                # 必须回填输入 chunk 里的某个 trace_id
        category: { type: string, enum: [...rule-specific...] }
        reasoning: { type: string }
        severity: { type: string, enum: [low, medium, high] }
        first_violating_step_id: { type: string } # 必须是**该 trace 自己** spans 里的真实 span_id
        evidence_span_ids: { type: array, items: { type: string } }
```

Parse 之后强校验：

- 每条 `trace_id` 唯一映射到一条 input trace（1:1）
- `first_violating_step_id` 是该 trace 输入 spans 里的真实 span_id
- 任一条 fail → 记 `rules_skipped[].reason = agent-error:schema_violation`，**只影响那一条 trace**

## Stage-2 批量化 Rubric — Prompt 结构

`builtin:rubric-judge-batch-v1`:

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

## Stage-4 Cross-Trace Synthesizer — Prompt 结构

`builtin:cross-trace-synthesizer-v1`:

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
4. `cross_rule_links` only when ≥ X traces fire both rules together
   (sampler shows co-fire cases; aggregator surfaces counts).
5. Aggregate-grounded only: every claim in `primary_root_cause.description`
   and `fix_priority[].reason` must be backed by aggregates or samples; the
   LLM does not invent new rule_ids or trace counts.
```

## CLI Surface

```shell
# 单 trace 模式（PR-B 已 ship，不动）
kweaver trace diagnose <conv_id> [--out=file.yaml] [...]

# Batch 模式（issue #2 唯一新入口）
kweaver trace diagnose --traces=<list> --out=<dir> [...]

  --traces=conv1,conv2,...                        # comma-separated conversation_ids
  --traces=@/path/to/ids.txt                      # 或者 @file，每行一个 id
  --out=<dir>                                     # 必填；batch 模式 fail-fast 若缺
  [--rules <dir>]                                 # 覆盖 <cwd>/diagnosis-rules/
  [--no-builtin]                                  # 禁用 5+1 条 builtin baseline 规则
  [--max-parallel <n>]                            # 默认 4
  [--format yaml|markdown|both]                   # 默认 'both'
  [--lang en|zh]                                  # 默认 'en'
  [--token <token>] [--base-url <url>] [-bd <bd>] # 与现有约定一致
```

错误 / exit codes：

| Exit | 条件 |
|---|---|
| 2 | `--traces` 带 `--no-llm`（fail-fast；见决策 #9） |
| 2 | `--traces` 未带 `--out=<dir>`（决策 #10） |
| 2 | `--traces=@file` 文件不存在 / 文件为空 |
| 2 | `--traces` 解析后的 conv_id 跨多个 agent（决策 #2），错误信息列出 conv_id → agent_id 分歧 |
| 4 | 某条 conv_id 在 agent-observability 返回 0 spans |
| 5 | Auth 缺失 / 不可达 |
| 6 | Rule load / schema 校验失败 |
| 1 | Stage-2 batch chunk 准备时 token 预算超限；消息含 `--max-traces-per-batch` 建议 |

## Checkpoint / Resume

文件系统作 ground truth，不另开 state 文件。

**写入路径**：每条 per-trace 报告先写 `<conv_id>.yaml.partial`，`fsync`，atomic rename 到 `<conv_id>.yaml`。`<conv_id>.md` 同理。partial 文件永远不被使用。

**续传路径**：runBatch 启动时，对每条 traces-list-parser 给出的 conv_id 检查 `<out>/<conv_id>.yaml` 是否存在：

- 在且能 parse 为 `trace-diagnose-report/v1`：计入 `traces_reused`，**跳过 Stage-1/2/3**，把该报告纳入 aggregator + sampler 输入
- 在但 yaml 损坏 / schema 不匹配：log warning 到 stderr，删除，重诊
- 不在：走全 pipeline

**注意**：续传时单 agent 校验仍然进行——已存在的 per-trace yaml 的 `trace.agent_id` 字段也参与一致性校验。

**scan-summary 失败路径**：若 Stage-4 报错，per-trace 报告写出成功，用户可以重跑相同命令 —— 所有 per-trace yaml 复用，**只重跑 Stage-4 + scan-summary 写入**

**`--force` flag** 不在 MVP scope。

## Error Handling

| 失败 | 行为 | 对 scan-summary 影响 |
|---|---|---|
| 单 agent 校验失败 | exit 2，错误信息列出 conv_id → agent_id 分歧表，不写任何输出 | scan-summary 不产生 |
| 某 conv_id 在 agent-observability 返回 0 spans | exit 4，错误信息指明哪条 conv_id；其他 conv_id 不诊断 | scan-summary 不产生 |
| Stage-2 chunk LLM 调用 timeout / transport / 4xx | chunk 内 K 条 trace 全部记 `rules_skipped[].reason = agent-error:<kind>` | aggregates 在 per-trace 计入 `rules_skipped` |
| Stage-2 单条 schema_violation（在其他成功的 chunk 内） | 仅该 trace 记 `rules_skipped[].reason = agent-error:schema_violation`；chunk 内其他 9 条不受影响 | 同上，单 trace 粒度 |
| Stage-4 cross-trace synth 失败 | scan-summary.yaml 写出但 `summary: null`；aggregates + per_trace_index 仍填充。用户重跑；per-trace 报告在续传时跳过 | scan-summary 缺 `summary` 块 |
| Provider 返回 malformed JSON envelope（Stage-2 或 Stage-4） | 同 transport error；触发 PR-B 现有 claude-code-subprocess 重试路径，重试一次 | n/a |

## Testing

测试框架：Node native `node:test` + `node:assert/strict`。HTTP mock 复用 PR-B 测试里既有的 `mockFetchSequence()` 模式。

### Unit tests

- `traces-list-parser.test.ts`: comma-separated；`@file` 语法；文件不存在；空文件；空白处理
- `single-agent-validator.test.ts`: 所有 conv_id 同 agent → pass；混合 agent → throw 列出分歧表；单 conv_id 0 spans → throw
- `aggregator.test.ts`: N 条 synthetic per-trace 报告上的 rule_frequency；severity_breakdown 加和不变；deterministic 排序
- `sampler.test.ts`: dominant rule 阈值边界（`max(3, 5% of N)`）；每 rule top-1 by severity；cross-rule co-fire 检测；outlier（rubric 自标 FP）选择；K=5 硬上限
- `batched-rubric.test.ts`: chunk K=10 切分；per-chunk prompt 拼装；per-item schema 校验（trace_id 回填、first_violating_step_id 在 spans 内）；单条 failure 隔离；整 chunk failure 记录
- `cross-trace-synthesizer.test.ts`: aggregator + sampler 输出拼到 prompt；prompt 含 agent_id；输出 schema 校验
- `scan-summary-schema.test.ts`: zod round-trip；字段名跟 within-trace Summary 的镜像关系；Stage-4 失败时 `summary` 可空；agent_id 必填
- `scan-summary-markdown.test.ts`: aggregates 渲染；per_trace_index 相对路径；summary 块在 success 和 `summary: null` 两种路径
- `agent-providers/tier.test.ts`: `JudgmentRequest.tier` 串通；ClaudeCodeSubprocessProvider 的 model arg 注入；modelByTier override

### End-to-end tests

- `batch-happy-path.test.ts`: `runBatch({ traceIds: [...] })` 配 mock agent-observability + stub agent provider；断言 per-trace yaml + scan-summary.yaml + .md 全部写出；aggregates 正确；sample 选择正确
- `batch-single-agent-enforced.test.ts`: 故意配 2 个 agent 的 conv_id，断言 exit 2 + 分歧表打到 stderr
- `batch-resume.test.ts`: 在 `--out` 目录预写 5 条 fake per-trace yaml（含 agent_id），invoke 10 条 trace 的 batch，断言 5 复用 + 5 新诊断；单 agent 校验跨续传仍生效
- `batch-gates-on.test.ts`: `gates_on: [tool_loop_no_state_change]` 的 rubric 只在 symbolic 命中的 trace 上跑；验证 rubric_work_queue dedup
- `batch-rubric-failure.test.ts`: stub provider 给一个 chunk 返 malformed JSON；断言受影响 trace 记 `rules_skipped[].reason = agent-error:schema_violation`；其他 chunk 成功；scan-summary 仍写出
- `batch-no-llm-fail-fast.test.ts`: `--traces=... --no-llm` exit 2 + 信息
- `batch-no-out-fail-fast.test.ts`: `--traces=...` 不带 `--out` exit 2 + 信息

### Coverage

无 coverage 阈值变更。`trace-ai/scan/` 新模块 unit + e2e 覆盖率应与 PR-B 水平相当。

## 估算

**3-4d**（plan 原 5-7d 估算减去 time-scan / streaming search / tenant filter / per-agent aggregate 工作量）。

主要新增工作：
- `--traces=<list>` parser + `@file` 解析
- single-agent validator（拉 spans 校验 agent_id 一致性）
- Stage-2 batched rubric runner + 新 prompt 模板
- Stage-4 cross-trace synthesizer + 新 prompt 模板
- `scan-summary/v1` zod schema + markdown renderer
- 模型 tier 抽象（`agent-providers/types.ts` + `claude-code-subprocess.ts` 扩展）
- `rubric.gates_on` 字段 + scan 模式 gate 逻辑
- aggregator + sampler
- partial-output 续传逻辑（atomic write + 续传校验）
- 8 unit + 7 e2e 测试

## Open Questions Deferred to Implementation

1. **single-agent-validator 调用时机** —— 是在 runBatch 启动时先逐 conv_id getSpans 拉一遍校验、再进 per-trace pipeline；还是边走 pipeline 边校验，第一个不一致的 conv_id 触发 abort。前者多一次 query，后者写入了部分 per-trace yaml 才发现要 abort，会留下 orphan 文件。倾向前者
2. **Aggregator 的 per-rule severity_breakdown 排序** —— high/medium/low 字典序还是数字序。默认 high → low 降序
3. **Cross-trace synth `cross_rule_links` 阈值** —— "≥ X traces fire both rules together"。X TBD；aggregator 应该把 co-fire counts 暴露出来，让 cross-trace synth 根据数据决定
4. **`--max-traces-per-batch` 与 token 预算交互** —— LLM 侧上限是 K=10 per batch 且固定。是否需要 `--max-traces-per-batch` 软上限暴露给 batch 模式做 UX cap。MVP 不加，让用户自己控 `--traces` 列表长度；上线后真有用户拉超长列表再加
5. **续传语义对 `--rules` 变化的处理** —— 如果用户改了 rules 目录重跑 batch，已复用的 per-trace yaml 是否仍应用？MVP 说 yes（文件系统优先）；spec 注释 "rules 混跑 batch 的 aggregates 行为未定义"

## References

- 跟踪 issue: [kweaver-ai/kweaver-sdk#123](https://github.com/kweaver-ai/kweaver-sdk/issues/123)
- 前置: [#120 (PR-A + PR-B)](https://github.com/kweaver-ai/kweaver-sdk/pull/122)
- PR-B 设计: `docs/superpowers/specs/2026-05-11-m4-diagnose-issue1-design.md`
- Issue plan: `plan-traceai/plan/2026-05-11-m4-diagnose-issue-plan.md` §2 #2
- Vision: `plan-traceai/vision/trace-cli-detailed-design.md` §3.1 L382-384（原本的两入口形态；本 spec 只 ship 其中 `--traces` 一条）、§3.3.4（provider wrapper 抽象）
- Reference provider 实现（model tier 模式）: `~/dev/github/petri/src/providers/claude-code.ts`
