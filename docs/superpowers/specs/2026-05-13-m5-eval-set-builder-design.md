# M5 Eval-Set Builder — Story B 设计（MVP-B）

Last updated: 2026-05-13

Tracking issue: TBD（spec review 通过后开）
Vision references: `plan-traceai/vision/trace-cli-detailed-design.md` §3.2 / §3.6 / 附录 A·B；`plan-traceai/vision/trace-ai-continuous-learning-design.md` §7.M5 / §7.MX1
Plan reference: `plan-traceai/plan/2026-05-11-m4-diagnose-issue-plan.md`（M5 issue plan 待开新文件）
Vision review 前置: commit [`90c9f7e`](https://github.com/xforce-io/plan-traceai/commit/90c9f7e)（M5 落地前 spec 聚焦式 review：删 B2 / `schema validate` 升回 MVP-B / SSOT YAML 推后）

## §1 Summary

把 M5 落地为 `kweaver-sdk` TypeScript CLI 的 `trace` 子命名空间下第二个业务模块，与 M4 `diagnose/` + `scan/` 同级（peer of `bkn / dataflow / vega`），位于 `packages/typescript/src/trace-ai/eval-set/`。

**双工作流（与 PR-A / PR-B 对应）**：

- **Story B-1（PR-A 解锁）**：诊断 / 自有数据 → eval-set 资产沉淀。`kweaver trace eval-set build` 接 3 种来源（手写完整 shard / `--diagnosis=<dir>` / `--queries=<file>`），CLI 跑脱敏 + `query_id` 补齐 + schema 校验后写盘成符合 `trace-eval-set/v1` 的 yaml 目录。同期 ship `kweaver trace schema validate <file>` 子命令（B5 zod 注册表薄包装）。
- **Story B-2（PR-B 解锁）**：eval-set + candidate agent → baseline test report。`kweaver trace eval-set test <eval-set-dir> --candidate=<agent_id>[@<version>]` sync sequential 调既有 `POST /api/agent-factory/v1/app/{agent_id}/chat/completion` 拿 `answer` + `conversation_id`，按 case.assertions 类型按需 `GET /api/agent-observability/v1/traces/by-conversation` 拉 trace，本地评估 6 种 assertion，OR-merge 出 pass/fail，写 `trace-test-report/v1` 报告。

**关键工程立足点**：

1. **不引入新共享层组件**——B5 zod 在 M4 已立的内核里扩展（4 套 eval-set + 1 套 test report schema），B1 `ObservabilityClient` 加一个 `getTraceByConversationId` 方法。
2. **不依赖远端 async job 设施 / 远端 evaluator 服务**——kweaver 平台后端不存在这两件（详见 vision spec 2026-05-13 修订 banner），6 种 assertion 全部本地可算；`semantic_match` 类 assertion 走 M4 已 ship 的 `agent-providers/` 公共抽象。
3. **不复用 M6 single-path executor**——test 是独立 sync sequential pipeline，与 M6（MVP-C 才落地）解耦。
4. **eval-set 是 git-trackable 用户资产**——不写中央 registry，目录布局是用户的 git 资产；test 报告是一次性进程产物（`test-runs/<name>/report.yaml`），不写 journal。

工程分两 PR 落地：PR-A 资产沉淀（5-7d），PR-B 测试闭环（5-7d，依赖 PR-A）。两 PR 都关同一 issue（沿用 M4 节奏）。

## §2 决议清单

brainstorm 期间逐次收敛的决议，按发生顺序：

| ID | 决议 | 出处 | 落点 |
|---|---|---|---|
| **D0** | B2 RemoteJobClient 共享层组件从 spec 删除；`eval-set test` 走 sync sequential 调既有 `chat/completion` + 本地 assertion 评估 | spec review 阶段（commit 90c9f7e）—— platform 后端不存在 async job 系统 + 不存在 evaluator 服务 | §4 / §6 / vision §2.1.2 修订 banner |
| **D1** | `trace-eval-set-input/v1` 简化 schema 加可选 `reference` + `assertions` 字段；与 final shard 同 refinement（reference 空时 assertions 必须非空）；`build --queries=` 直接 lift 用户填的字段，不再"留占位" | 用户 challenge "如果已有 queries + golden truth 怎么用" 时发现 spec 隐 bug——原 `--queries=` 流程留 `reference: null + assertions: []` 占位违反 schema refinement | §4 / §5 |
| **D2** | redaction 默认 = 内置 5-8 条低保真 PII patterns（电话/邮箱/身份证/银行卡/IP）+ 覆盖链 `--redaction-rules > <repo>/redaction-rules/ > builtin` | brainstorm Q3 ——优先 onboard 顺滑 + 兜底安全 | §4 / §5 |
| **D3** | `eval-set test --candidate=<agent_id>[@<version>]` 裸标识，不读 yaml | brainstorm Q1 —— platform 现实只支持 agent_id 寻址，DA 不提供 agent 配置 export | §4 / §6 |
| **D4** | PR-A (build + schema validate) / PR-B (test + 6 assertions) 双 PR 切分，两个 PR 关同一 issue（沿用 M4 节奏） | brainstorm Q2 | §10 / §11 |
| **D5** | PR-B 必 ship 至少 1 条 builtin rubric template `answer-match-reference`（judge "answer 是否与 reference 语义等价"），是 golden truth 路径的核心 assertion | brainstorm D1 衍生 | §4 / §6 |
| **D6** | MX1 SSOT YAML mirror 推到 "首个 polyglot 消费者出现时"；MVP-B 不绑 SSOT YAML（M5 zod 内联自洽）；`kweaver trace schema validate` 子命令 MVP-B 可 ship 为 B5 zod 注册表薄包装 | spec review 阶段（commit 90c9f7e）—— M5 不再是 SSOT YAML 的真消费者 | §4 / vision §7.MX1 修订 |

## §3 架构总览

M5 是 kweaver-sdk **trace** 子命名空间下的第二个业务模块，peer of M4 `diagnose/` 与 M4 `scan/`，落 `src/trace-ai/eval-set/`。

**单向依赖链**：

```
commands/trace.ts (顶层 dispatch；MVP-A 已 ship，M5 加 3 个子命令入口)
  ↓
trace-ai/eval-set/ (业务逻辑)
  ↓
trace-ai/eval-set/schemas.ts (B5 zod 扩展 4+1 套)
  +
api/agent-chat.ts (既有，PR-B 真消费)
  +
api/trace/observability.ts (B1 扩展 +getTraceByConversationId)
  +
agent-providers/ (semantic_match assertion 用 builtin rubric template，复用 M4 已 ship)
```

**与 M4 的关系**：
- 复用 `agent-providers/` 公共抽象（M4 PR-B 已 ship）跑 `semantic_match` 类 assertion 的结构化判定
- 复用 B5 zod 注册表（M4 PR-A 已 ship）作为 schema 内核
- 不依赖 M4 `diagnose/` / `scan/` 模块代码，只依赖其输出格式（`trace-diagnose-report/v1` schema）作为 `--diagnosis=` 输入
- 不引入任何新的共享层组件——B1 / B5 只在既有内核上做最小扩展

**与 M6 / Story C 的关系**：
- test 是独立 sync sequential pipeline，不复用尚未存在的 M6 single-path executor
- test 报告（`trace-test-report/v1`）是 Story C / M6 单路径迭代的 baseline 输入

**与 platform 后端的关系**（spec review 关键发现 D0）：
- DA `agent-factory` 提供 sync streaming `POST /api/agent-factory/v1/app/{agent_id}/chat/completion`——M5 直接用
- trace-ai `agent-observability` 提供 sync `GET /api/agent-observability/v1/traces/by-conversation?conversation_id=...`——M5 直接用
- platform **不存在** async job 系统、**不存在** 独立 evaluator 服务——M5 不引入对这两者的依赖

## §4 组件与边界

按依赖方向，从下层（基础）到上层（业务编排）列出文件清单。

### 4.1 基础层（PR-A 落，无业务编排逻辑）

```
src/trace-ai/eval-set/schemas.ts                 # B5 zod 扩展，4 套 schema：
                                                 #   trace-eval-set/v1                — final shard 完整格式
                                                 #   trace-eval-set-input/v1          — --queries 简化输入（D1：含可选 reference + assertions）
                                                 #   trace-eval-set-index/v1          — index.yaml
                                                 #   trace-test-report/v1             — test 报告（PR-A 写 schema，PR-B 真消费）
                                                 # zod refinement：reference 空时 assertions[] 必须非空
                                                 #   同一 refinement 应用到 trace-eval-set/v1 与 trace-eval-set-input/v1
                                                 # 注：D5 builtin rubric `answer-match-reference` 的输出 schema 归
                                                 #   rubric template 自己（agent-providers/prompts/builtin/ 旁配 schema），
                                                 #   不进 B5 注册表（不是 eval-set 业务 artifact）

src/api/trace/observability.ts                   # B1 扩展（基于 M4 已 ship 的 ObservabilityClient）：
  + getTraceByConversationId(conversationId)     #   包 GET /traces/by-conversation?conversation_id=
                                                 #   PR-A 单测覆盖，PR-B 真消费
```

### 4.2 业务层（PR-A 落，build 流程编排）

```
src/trace-ai/eval-set/
  ├── index.ts                                   # 模块导出
  ├── types.ts                                   # EvalCase / EvalSetRef / BuildResult / CaseResult 等内部类型
  ├── query-picker.ts                            # 两个 lift 函数（独立成文件方便单测）：
  │                                              #   - liftFromDiagnosis(diagDir): EvalCase[]
  │                                              #       读 dir 下所有 *.yaml，按 trace-diagnose-report/v1 校验，
  │                                              #       抽 findings[*].verify_with.suggested_eval_case；
  │                                              #       finding 缺 suggested_eval_case 时 skip + 在 summary 报数
  │                                              #   - liftFromQueriesFile(path): EvalCase[]
  │                                              #       按 trace-eval-set-input/v1 校验（D1：input 必 / reference/assertions 可选）
  ├── redactor.ts                                # PII 脱敏（D2）：
  │                                              #   - 规则源链：--redaction-rules > <repo>/redaction-rules/ > builtin
  │                                              #   - builtin 5-8 条（phone/email/id_card/bank_card/ip）
  │                                              #   - 作用域：case.input.user_message / case.reference.answer / 拉到的 trace span 正文
  │                                              #   - 写盘时标 redaction_rules=<source>
  │                                              #   - 规则正则异常 → fail-fast（不静默 fallback）
  ├── output-writer.ts                           # 目录写盘 + index.yaml 增量更新：
  │                                              #   - on-conflict: fail (default) / skip / overwrite
  │                                              #   - overwrite 时保留 .bak
  │                                              #   - MVP 默认全塞一个 shard `cases.yaml`，不按 tag/agent 自动分
  └── builder.ts                                 # build 主流程编排（含 query_id hash 生成内联在此文件）：
                                                 #   picker → ensureQueryId → redact → conflict → write → validate
```

注：`query-id-gen.ts` 单独文件取消（brainstorm §过度工程审计），`ensureQueryId(case)` 函数内联进 `builder.ts`（一个 ~15 行 hash + slice 的工具函数，单独成文件纯仪式感）。

### 4.3 业务层（PR-B 落，test 流程编排）

```
src/trace-ai/eval-set/
  ├── assertion-evaluator.ts                     # 6 种 assertion 本地评估（合一文件，~150 行 switch）：
  │                                              #   contains / not_contains / regex      — answer-only，不拉 trace
  │                                              #   tool_call_count                      — 解析 trace tool span 计数 + op
  │                                              #   tool_call_order                      — span 序列子序列匹配（允许夹杂）
  │                                              #   semantic_match                       — 走 agent-providers/，builtin rubric (D5)
  │                                              #   latency_ms                           — trace root span end_time - start_time
  │                                              # OR-merge：任一 fail → case 整体 fail
  ├── test-runner.ts                             # sync sequential pipeline：
  │                                              #   - parseCandidate(string) → {agent_id, agent_version?}（D3）
  │                                              #   - validateMaxParallel(n) ∈ [1, 64]
  │                                              #   - for each case 经 p-limit 控制并发：runCase(case)
  │                                              #       Step A: agent-chat.ts → answer + conversation_id
  │                                              #       Step B: analyzeAssertions → needsTrace? → B1.getTraceByConversationId
  │                                              #       Step C: assertion-evaluator → CaseResult
  │                                              #   - case 错误不中断 batch（D0 / §6）
  └── report-assembler.ts                        # 拼 trace-test-report/v1 yaml + stdout 摘要：
                                                 #   - 含 meta（candidate / eval-set / timestamp / cli_version）
                                                 #   - summary（total / pass / fail / error / by_assertion_type）
                                                 #   - cases[]（不含 severity 推断字段——brainstorm §过度工程审计删）

src/agent-providers/prompts/builtin/
  └── answer-match-reference.md                  # D5: 1 条 builtin rubric template
                                                 #   judge "this answer is semantically equivalent to this reference"
                                                 #   输出符合 answer-match-reference/v1 schema
```

### 4.4 CLI 入口（PR-A 加 build + schema validate；PR-B 加 test）

```
src/commands/trace.ts                            # MVP-A 已 ship；M5 新增三个子命令 dispatch：
  + 'eval-set build'   (PR-A)
  + 'schema validate'  (PR-A) — B5 zod 注册表薄包装
  + 'eval-set test'    (PR-B)
                                                 # 不拆 trace/<verb>.ts 子目录（与 M4 同口径，单文件 dispatch）
```

### 4.5 明确不做的事（边界）

- **不引入新共享层组件**——B1 / B5 只是在既有内核上加方法 / 加 schema，不立 B-编号
- **不读 candidate yaml 文件**（D3）——MVP-B 全用裸 `agent_id[@version]`，候选 yaml 形态留给 M6 mission.md
- **不写中央 eval-set registry**——eval-set 目录就是用户的 git 资产
- **不做 hindsight relabel**（vision 已钉 post-MVP）
- **不复用 M6 single-path executor**——test 是独立 sync pipeline，与 M6 解耦
- **不调远端 async job 设施 / evaluator 服务**（D0）
- **不写中间产物 journal**（jobs.jsonl / events.jsonl 是 M6 单路径迭代的事）

## §5 build 数据流

`kweaver trace eval-set build [--diagnosis=<dir> | --queries=<file>] --out=<dir> [--on-conflict=fail|skip|overwrite] [--redaction-rules=<path>]`

两源互斥，至少且只能一个。

### 5.1 流程图

```
                                ┌────────────────────────────┐
   CLI args ────────────────────┤ commands/trace.ts dispatch │
                                └─────────────┬──────────────┘
                                              │ parse, validate flag exclusivity
                                              ↓
                              ┌──────────────────────────────┐
                              │  eval-set/builder.ts (主流程) │
                              └──────────────┬───────────────┘
                                             │
              ┌──────────────────────────────┴──────────────────────────────┐
              │                                                             │
              ↓ --diagnosis=<dir>                                           ↓ --queries=<file>
   ┌────────────────────┐                                       ┌─────────────────────┐
   │ query-picker.ts    │  读 dir 下所有 *.yaml                   │ query-picker.ts     │  读 simplified yaml
   │ liftFromDiagnosis  │  按 trace-diagnose-report/v1 校验       │ liftFromQueriesFile │  按 trace-eval-set-input/v1 校验
   │                    │  抽 findings[*].verify_with             │                     │  lift cases[*]
   │                    │     .suggested_eval_case               │                     │  （input 必 / reference/assertions 可选）
   │                    │  → EvalCase[]                          │                     │  → EvalCase[]
   └─────────┬──────────┘                                       └──────────┬──────────┘
             │                                                              │
             └──────────────────────────┬───────────────────────────────────┘
                                        ↓ EvalCase[]
                              ┌─────────────────────┐
                              │ builder.ensureQueryId│  对每条 case：
                              │ (内联)               │   - 用户填了 → 原样保留
                              │                     │   - 未填 → hash(canonical_json(input) + tags).slice(0,12)
                              └──────────┬──────────┘
                                         ↓
                              ┌─────────────────────┐
                              │ redactor.ts         │  按规则链脱敏（D2）：
                              │ redactCases         │    --redaction-rules > <repo>/redaction-rules/ > builtin
                              │                     │  作用域：input.user_message / reference.answer
                              │                     │  输出标 redaction_rules=<source>
                              └──────────┬──────────┘
                                         ↓
                              ┌─────────────────────┐
                              │ output-writer.ts    │  preflight：读 <out>/index.yaml 现有 query_id 集合
                              │ conflict resolve    │  对新 case：
                              │                     │   - fail：冲突即 exit 6 + 打印冲突 ID
                              │                     │   - skip：保留 existing
                              │                     │   - overwrite：覆盖 + 写 .bak
                              └──────────┬──────────┘
                                         ↓
                              ┌─────────────────────┐
                              │ output-writer.ts    │  写盘：
                              │ writeShards         │   - <out>/cases.yaml （MVP 默认单 shard）
                              │ writeIndex          │   - <out>/index.yaml 增量 upsert
                              │                     │   - 已存在 cases.yaml 时 merge cases[] 数组
                              └──────────┬──────────┘
                                         ↓
                              ┌─────────────────────┐
                              │ B5 zod validate     │  对写出的文件逐个校验：
                              │ trace-eval-set/v1   │   - shard 校验，触发 refinement
                              │ + -index/v1         │   - 任何 case reference 空 + assertions 空 → fail (exit 1)
                              └──────────┬──────────┘
                                         ↓
                              ┌─────────────────────┐
                              │ stdout summary      │  打印：
                              │                     │   "✓ wrote 12 cases (3 new / 9 skipped), 1 shard"
                              │                     │   "validate: passed"
                              └─────────────────────┘
```

### 5.2 关键决策（这条 flow 内的具体处理）

1. **多个 diagnosis report 进同一 build**：`--diagnosis=` 指 dir 而非 file，CLI 遍历该 dir 下所有 `*.yaml`，每个文件按 `trace-diagnose-report/v1` 校验，校验失败的文件 fail-fast（含路径 + zod error）。
2. **finding 缺 `verify_with.suggested_eval_case` 字段**：spec 没说必填，CLI **skip + 在 summary 里报 "skipped 5 findings: no suggested_eval_case"**，不阻断。
3. **shard 分组**：MVP 默认全塞一个 `cases.yaml`（不按 tag/agent 自动分）。用户后续可手动 split 进多 shard 后重写 `index.yaml`，再跑 `kweaver trace schema validate` 校验。
4. **`query_id` 唯一性 scope**：单个 eval-set 内全局唯一（不是全 repo）；冲突检测在写盘前做。
5. **写顺序**：先写 shard，再 upsert index。两步之间崩溃 → 下次 build 重跑（shard 已写 + 自动 hash 幂等的 query_id 让重跑等价）。
6. **redaction 失败**：内置规则跑挂（regex 异常）→ fail-fast，提示用户检查规则文件 / 报 bug；不静默 fallback。
7. **`build` 是无状态纯函数**：同样输入 + 同样 `<out>` + 同样规则 → 相同输出（query_id hash 幂等 + 单 shard 单文件确定输出顺序）。

### 5.3 `--queries=<file>` 简化输入格式（D1 修订后）

```yaml
schema_version: trace-eval-set-input/v1
cases:
  # 场景 1：纯 query，无 reference / assertions —— CLI 在 schema 校验时 fail-fast
  #   提示用户补 reference 或 assertions（refinement 强制）
  - input:
      user_message: "如何申请退款？"
    query_id: refund_001                # 可选
    tags: ["refund"]                    # 可选

  # 场景 2：query + golden answer（推荐用 semantic_match 兜）
  - input:
      user_message: "订单 123 物流到哪了？"
    reference:
      answer: "您的订单 123 已在配送中，预计明天送达"
    assertions:
      - type: semantic_match
        rubric_template_ref: builtin:answer-match-reference
    tags: ["shipping"]

  # 场景 3：query + 显式 assertions（不要 reference）
  - input:
      user_message: "查询账户余额"
    assertions:
      - type: tool_call_count
        tool: balance_query
        op: gte
        n: 1
      - type: contains
        value: "余额"
    tags: ["account"]
```

CLI lift 规则：`schema_version: trace-eval-set-input/v1` → `trace-eval-set/v1` + 字段透传（用户填 reference 则保留；用户填 assertions 则保留；用户都不填则 schema 校验 fail-fast）。

### 5.4 build 退出码

| code | 语义 |
|------|------|
| `0` | 成功 |
| `1` | 一般失败（输入文件不存在 / schema 校验失败 / redaction 规则异常 / I/O 错） |
| `2` | 参数错（两源冲突 / 缺 `--out` / 等标准 Unix args misuse） |
| `6` | `query_id` 冲突且 `--on-conflict=fail` |

## §6 test 数据流

`kweaver trace eval-set test <eval-set-dir> --candidate=<agent_id>[@<version>] [--out=<dir>] [--max-parallel=<n>]`

### 6.1 流程图

```
   CLI args
     │
     ↓
   ┌────────────────────────────────────┐
   │ commands/trace.ts dispatch         │
   │  parse + validate flag             │
   └──────────────────┬─────────────────┘
                      ↓
   ┌────────────────────────────────────┐
   │ test-runner.ts (主流程)             │
   └──────────────────┬─────────────────┘
                      │
                      ↓ Stage 1: Preflight
   ┌────────────────────────────────────┐
   │ parseCandidate(string)             │  正则解析 "<agent_id>[@<version>]"
   │   → {agent_id, agent_version?}     │  非法格式 → exit 2
   │ validateMaxParallel(n)             │  ∈ [1, 64]；< 1 或 > 64 → exit 2
   │ loadEvalSet(<eval-set-dir>)        │  读 index.yaml + 列出的 shard
   │   - B5 校验 index + 每个 shard      │  schema 失败 → exit 1
   │   - 收 query_id 全局唯一性         │  冲突 → exit 1
   │   - 展平成 EvalCase[]              │
   └──────────────────┬─────────────────┘
                      ↓
                      ↓ Stage 2: 并发调度
   ┌────────────────────────────────────┐
   │ p-limit(max-parallel) 控制并发      │  默认 1（sync sequential）
   │ for each case → runCase(case)       │  失败不中断（其他 case 继续）
   └──────────────────┬─────────────────┘
                      ↓
       ┌──────────────────────────────────────────────────┐
       │           runCase(case) 子流程                     │
       ├──────────────────────────────────────────────────┤
       │                                                  │
       │  Step A：调 agent ─────────────────────────────►  │
       │    api/agent-chat.ts                             │
       │      POST /api/agent-factory/v1/app/             │
       │        {agent_id}/chat/completion                │
       │      body: {query, agent_version?, streaming:false}
       │      timeout: 60s (可配)                          │
       │    → { answer, conversation_id }                 │
       │    错误：4xx/5xx/timeout → 标 status=error +     │
       │            error_code → 不评估 assertions        │
       │                                                  │
       │  Step B：按需拉 trace ─────────────────────────►  │
       │    analyzeAssertions(case.assertions)            │
       │    → needsTrace?  (true 如果含 tool_call_*/      │
       │                    latency_ms/semantic_match)    │
       │    if needsTrace:                                │
       │      B1.getTraceByConversationId(conv_id)        │
       │        GET /api/agent-observability/v1/          │
       │          traces/by-conversation?...              │
       │      朴素重试（1-2 次，实现细节）                  │
       │      失败 → 整 case status=error + 所有          │
       │              assertion 标 skip                   │
       │                                                  │
       │  Step C：本地评估 6 种 assertion ───────────────► │
       │    assertion-evaluator.ts                        │
       │    for each assertion in case.assertions:        │
       │      switch assertion.type:                      │
       │        contains/not_contains/regex:              │
       │          → string match on answer                │
       │        tool_call_count:                          │
       │          → count spans by tool name + op比对     │
       │        tool_call_order:                          │
       │          → 解析 trace span 顺序，                │
       │            sequence 子序列匹配（允许夹杂）        │
       │        semantic_match:                           │
       │          → agent-providers 跑 rubric template    │
       │            (builtin:answer-match-reference)      │
       │          → JudgmentResponse.verdict ∈ {pass,fail}│
       │        latency_ms:                               │
       │          → trace root span end_time - start_time │
       │            与 op + value 比对                     │
       │    OR-merge：任一 fail → case 整体 fail          │
       │                                                  │
       │  Step D：拼 case result ──────────────────────►  │
       │    {                                             │
       │      query_id, status: pass|fail|error|skip,     │
       │      conversation_id, trace_id?,                 │
       │      assertion_results: [...],                   │
       │      failure_reason?                             │
       │    }                                             │
       │                                                  │
       └──────────────────┬───────────────────────────────┘
                          ↓
                          ↓ Stage 3: 汇总写盘
   ┌────────────────────────────────────┐
   │ report-assembler.ts                │
   │   - 按 trace-test-report/v1 拼     │
   │   - 含 meta（candidate / eval-set / │
   │           timestamp / cli_version） │
   │   - cases: [...]                   │
   │   - summary: {total, pass, fail,   │
   │              error, skip,           │
   │              by_assertion_type}    │
   │ B5 校验 report schema              │
   │ 写 <out>/<name>/report.yaml        │
   │   (默认 out=test-runs/, name=候选 + ts)
   │ stdout 打印彩色摘要                 │
   └──────────────────┬─────────────────┘
                      ↓
                  exit code
                   - 0：所有 case pass
                   - 1：至少一条 fail 或 error
                   - 2：preflight 阶段参数错
```

### 6.2 关键设计点（test 这条 flow 内）

1. **case 失败不中断**：单 case 出错（agent 调用挂 / trace 拉不到）标 status=error 继续跑其他 case；不让一条 case 把整个 batch 拖垮。
2. **trace 拉取按需**：`contains` / `not_contains` / `regex` 只看 answer，不拉 trace（节省 ~1 个 HTTP 往返 × case 数）。其他 4 种 assertion 类型存在时才拉。
3. **trace 拉取失败的降级**（brainstorm §过度工程审计简化）：trace fetch 失败 → 整 case `status=error`，所有 assertion 标 skip。不再做 per-assertion partial skip（state space 太复杂，trace API 不稳时用户重跑即可）。
4. **`--max-parallel` 默认 1**：MVP-B 优先稳定性 + 简单，不并发。用户显式传 `--max-parallel=8` 才并发。上限 64（与 M4 scan 同口径）。
5. **`semantic_match` 在 CI 路径**：需要 `agent-providers/` 跑实际 rubric。CI 用 stub provider 回放 fixture（`KWEAVER_DIAGNOSE_AGENT_PROVIDER=stub`，M4 已 ship 设施）；本地手测用 claude-code subprocess（需装 `claude` CLI）。
6. **`agent_version` 缺省**：用户传 `agt_42` 不带 `@<version>` → CLI 不在 body 里带 `agent_version` 字段，DA 按 latest 路由（既有 chat/completion 行为）。
7. **trace_id 字段**：报告里同时记 `conversation_id`（DA 返回的）+ `trace_id`（从 OpenSearch span 抽，方便 cross-ref M4 诊断报告）。`needsTrace=false` 时 `trace_id=null` 是合规的。
8. **不写中间产物**：MVP-B 不写 jobs.jsonl / events.jsonl 等 journal（那是 M6 单路径迭代的事）；test 是一次性进程，崩了用户直接重跑。
9. **不做 severity 字段**：M4 报告里 severity 来自规则定义的显式字段，CLI 不应自己拍脑袋推 severity。test 报告只记 verdict + failure_reason，severity 留给后续真有需求时增量加。

### 6.3 test 报告 yaml 结构（`trace-test-report/v1`）

```yaml
schema_version: trace-test-report/v1
meta:
  eval_set_dir: eval-sets/cs-v1/
  eval_set_id: cs-v1
  candidate:
    agent_id: agt_42
    agent_version: v3       # 缺省时省略字段
  cli_version: kweaver-sdk@0.8.3
  ran_at: 2026-05-13T14:23:11Z
  duration_ms: 47280
summary:
  total: 12
  pass: 7
  fail: 4
  error: 1
  skip: 0
  by_assertion_type:
    contains: { pass: 8, fail: 2 }
    tool_call_count: { pass: 5, fail: 1 }
    semantic_match: { pass: 4, fail: 1 }
    latency_ms: { pass: 11, fail: 0 }
cases:
  - query_id: refund_001
    status: fail
    conversation_id: conv_abc123
    trace_id: tr_xyz789
    duration_ms: 4321
    assertion_results:
      - assertion: { type: contains, value: "订单详情页" }
        verdict: pass
      - assertion: { type: tool_call_count, tool: retrieval, op: lte, n: 2 }
        verdict: fail
        actual: 5
    failure_reason: "tool_call_count.retrieval expected lte 2, got 5"
  - query_id: refund_002
    status: error
    conversation_id: null
    error_code: AGENT_CHAT_TIMEOUT
    error_message: "chat/completion timed out after 60s"
```

### 6.4 test 退出码

| code | 语义 |
|------|------|
| `0` | 所有 case pass |
| `1` | 至少一条 fail 或 error |
| `2` | 参数错（preflight 阶段） |

## §7 错误处理

砍完冗余后的错误处理统一约定。原则：**用户错有清晰可行动的消息；内部错暴露堆栈**——不在中间装一层"友好包装"屏蔽真相。

### 7.1 输出去向

| 类型 | 去 stdout | 去 stderr |
|------|----------|----------|
| 业务摘要（build 汇总 / test 报告头） | ✓ | |
| 报告 yaml（如果 `--out=-`） | ✓ | |
| 进度行 / spinner | ✓（ink 控制） | |
| 用户错（"file not found"、"两个 source flag 互斥"） | | ✓ |
| 内部错（zod parse 失败、网络异常）+ 堆栈 | | ✓ |

### 7.2 错误分类与处理

| 场景 | 分类 | 行为 |
|------|------|------|
| 参数互斥违反 / 缺必填 | 用户错 | stderr 打印 usage + exit 2 |
| `--candidate=` 格式非法 | 用户错 | stderr "expected `<agent_id>[@<version>]`, got `xxx`" + exit 2 |
| `--max-parallel` 非整数 / 越界 | 用户错 | stderr 提示 + exit 2 |
| 输入 dir / file 不存在 | 用户错 | stderr "file not found: <path>" + exit 1 |
| `--diagnosis=<dir>` 下某个 yaml schema 校验失败 | 用户错 | stderr 列出文件 + zod 错误位 + exit 1（**不容忍 partial：整个 build 失败**） |
| `--queries=<file>` 缺 reference / assertions 双空 | 用户错 | stderr "case[i].reference 与 assertions 不能同时为空" + exit 1 |
| `query_id` 冲突（`--on-conflict=fail`） | 用户错 | stderr 列出冲突 id + 提示 `--on-conflict=skip\|overwrite` + exit 6 |
| redaction 规则正则异常 | 用户错（rule 写错） | stderr 标错的规则 + exit 1 |
| `agent_id` 不存在（agent-chat 返 404） | 用户错 | 标该 case `status=error` + `error_code=AGENT_NOT_FOUND` + 继续其他 case |
| agent-chat 超时 / 5xx | 临时错 | 标 case `status=error` + 朴素 retry（实现细节）+ 仍失败则跳 |
| `getTraceByConversationId` 失败 | 临时错 | 标 case `status=error` + 所有 assertion 标 skip |
| zod parse 内部异常（非用户输入） | 内部错 | stderr 打堆栈 + "this is a bug, please report" + exit 1 |
| 文件系统 ENOSPC / EACCES | 内部错 | stderr 透传错误 + exit 1 |

### 7.3 不做的事

- **不做错误码 namespace 化**（如 `EVALSET_E001`）——MVP 一切错误用人类可读字符串，搜索 issue 时直接 grep 消息文本即可
- **不做错误聚合 + 退出末尾报告**——build / test 该 fail-fast 就 fail-fast，该继续就继续（test 的 case-level error），不在末尾再批量报
- **不做 sentry / 远端上报**——CLI 是本地工具，错误处理就是 print + exit

## §8 测试策略

不重复 §5/§6 流程内的单测点，这里只总览 CI 矩阵 + fixture 来源 + e2e 边界。

### 8.1 测试金字塔

```
                    ┌─────────────────────────────────┐
                    │   e2e smoke (~3 tests, 手测)    │   不在 CI 必跑，PR 描述里记录手测结果
                    │   - 真 dip-poc + 真 diag report │
                    │   - --queries + golden 跑 test  │
                    │   - schema validate 各 kind     │
                    └─────────────────────────────────┘
                  ┌───────────────────────────────────────┐
                  │   e2e CI (~5 tests, env 必备时跳过)    │   PR-A 加 2 / PR-B 加 3
                  │   - build --diagnosis 真 fixture       │
                  │   - schema validate 各 kind 推断       │
                  │   - test 走 stub provider 跑 semantic  │
                  │   - test 走 mock agent-chat + mock B1  │
                  └───────────────────────────────────────┘
              ┌─────────────────────────────────────────────────┐
              │   单测 (~40-60 cases, CI 必过)                   │   主体重量
              │   - schemas (4 套 × 合法 + 非法 + refinement)    │
              │   - picker / redactor / writer / builder        │
              │   - assertion-evaluator (6 类 × happy + edge)    │
              │   - test-runner (preflight / 并发 / case 错误)   │
              │   - api client (mock fetch，URL + headers)      │
              └─────────────────────────────────────────────────┘
```

### 8.2 PR-A 单测清单（~25-30 cases）

| 文件 | 覆盖点 |
|---|---|
| `test/eval-set-schemas.test.ts` | 4 套 zod schema 合法 + 非法各 ≥2；reference/assertions 双空 refinement fail；input/v1 加可选 reference/assertions（D1）的 lift 兼容 |
| `test/eval-set-picker.test.ts` | `liftFromDiagnosis` 用 M4 真样本（status_quo 三视图样本 + 合成 fixture）；`liftFromQueriesFile` 含 reference / 仅 input / 全空三种输入；finding 缺 `suggested_eval_case` 时 skip + summary 报数 |
| `test/eval-set-builder.test.ts` | 端到端 build 一次：picker → query-id → redact → write → validate；`query_id` hash 幂等（同输入同 ID） |
| `test/eval-set-redactor.test.ts` | builtin 5-8 条 PII 规则各匹配一例；规则链优先级（cli flag > repo > builtin）；规则正则异常 fail-fast；redaction_rules 标签写入 |
| `test/eval-set-output-writer.test.ts` | on-conflict 三策略；overwrite 写 .bak；index.yaml 增量 upsert；新建空 `<out>` |
| `test/trace-schema-validate.test.ts` | 各 kind 推断（文件名 / 父目录约定）；显式 `--kind`；推不出报 `SCHEMA_KIND_REQUIRED` exit 2 |
| `test/api/trace/observability.test.ts` 扩展 | `getTraceByConversationId` mock fetch：URL / method / headers / body / 错误码 |

### 8.3 PR-A e2e（CI 跑 + 手测）

- **CI**：`test/e2e/trace-eval-set-build.test.ts` —— 把 `status_quo/附录-完整trace样本` 跑一遍 M4 diagnose → eval-set build → schema validate 全链，需要 `KWEAVER_E2E_*` env 才跑
- **手测**：在 dip-poc 真跑一份 ticket queries（带 golden answer）→ build → schema validate → 看 yaml 长得对

### 8.4 PR-B 单测清单（~20-25 cases）

| 文件 | 覆盖点 |
|---|---|
| `test/eval-set-assertion-evaluator.test.ts` | 6 类 assertion × （happy / edge）：<br>- `contains` 中文 / 大小写 / 多次出现<br>- `regex` 多行 / 转义<br>- `tool_call_count` op eq/lte/gte 三档<br>- `tool_call_order` 子序列允许夹杂 + 不允许打乱<br>- `semantic_match` 走 stub provider 回放 fixture<br>- `latency_ms` op + value<br>OR-merge：任一 fail → case fail |
| `test/eval-set-test-runner.test.ts` | `parseCandidate` 正则（`agt_x` / `agt_x@v1` / 非法 fail）；`--max-parallel` 边界（0 / 65 → exit 2，default=1）；mock agent-chat + mock B1，验证 needsTrace 判定（contains-only case 不拉 trace）；case 错误不中断（agent-chat 404 → case error，剩下 case 继续） |
| `test/eval-set-report-assembler.test.ts` | report yaml 通过 `trace-test-report/v1` schema；`by_assertion_type` 统计准确；exit code（全 pass → 0；有 fail 或 error → 1） |
| `test/agent-providers/builtin-rubric-answer-match.test.ts` | builtin `answer-match-reference` template 通过 stub provider 跑通；JudgmentResponse 字段齐 |

### 8.5 PR-B e2e

- **CI**：`test/e2e/trace-eval-set-test.test.ts` —— `KWEAVER_DIAGNOSE_AGENT_PROVIDER=stub` 跑 semantic_match fixture
- **CI**：`test/e2e/trace-eval-set-test-mock.test.ts` —— mock 整条 HTTP 路径，验证 sync sequential / 并发 / case-level error
- **手测**：dip-poc 起真 agent → 跑 6 种 assertion 全类型一条 case 通

### 8.6 Fixture 来源

| fixture 类型 | 来源 | 放哪 |
|---|---|---|
| M4 真 diagnose report | `status_quo/附录-完整trace样本/` 跑 M4 输出 | `test/fixtures/diagnose-reports/` |
| 简化 queries 输入 | 手写 | `test/fixtures/queries-input/` |
| trace span 解析（tool_call_* / latency） | 取 M4 已 ship 的 trace fixture + 派生 | `test/fixtures/traces/` |
| semantic_match rubric judgment | stub provider 用 | `test/fixtures/stub-provider/` |
| agent-chat response | mock | inline in test |

### 8.7 测试约定（沿用 cli_conventions §7）

- 解析器单测 + API 客户端单测 + e2e smoke 三件齐（每个新命令）
- e2e 环境变量缺失时 `it.skip` 不阻断 CI
- 单测覆盖率不卡死阈值，但 picker / evaluator / runner 核心路径必须 happy + edge 各覆盖一例

### 8.8 不做的事

- **不卡 coverage %**
- **不做 mutation testing**
- **不做 snapshot test 报告 yaml**（schema 校验已经把结构钉死）
- **不做 perf benchmark**（MVP 不优化性能，假设 < 100 case / test 用得动）

## §9 反过度工程清单

brainstorm 进行到 §设计 §4 结束时，user 拉了一波 challenge "确定下没有过度工程"。审计后砍掉的：

| 砍掉的内容 | 原设计 | 砍法理由 |
|---|---|---|
| `query-id-gen.ts` 单独文件 | 一个 ~15 行的 `ensureQueryId(case)` 单独成文件 | 仪式感大于实质；合进 `builder.ts` |
| build 退出码 6 档 (0/2/3/4/6/7/1) | 细分 args misuse / file not found / schema fail / refinement fail / 等 | 收敛到 4 档（0/1/2/6）；其他错误码细分对 CI 脚本无意义，错误消息文本已够 |
| test 退出码 3 档 (0/1/5) | 区分 fail vs error vs all-pass | 收敛到 3 档（0/1/2）；区分 fail vs error 在 exit code 层面价值不大，看 report 摘要更直接 |
| test 里 per-assertion partial skip on trace_fetch_failed | trace 拉不到时 contains-only assertion 仍能跑，state space 变四态 | 收敛：trace fetch 失败 → 整 case status=error 所有 assertion skip。trace API 不稳时用户重跑就行 |
| test 里 retry 3x exp backoff on trace fetch | spec 层面写死 retry 次数 | 删 spec 这条；实现时给个朴素 1-2 次 retry，等真需要复杂 backoff 再细化 |
| report yaml 里 severity 推断规则 | tool_call_* fail → high，其他 medium | M4 报告 severity 来自规则定义的显式字段；CLI 自己拍脑袋推 severity 是无源之水。删 severity 字段，留 status + failure_reason 即够 |

并提前抵制掉的潜在膨胀：

- `--dry-run` for build：YAGNI，`git diff` 已能看 build 写了啥
- `--filter=<tag>` for test：YAGNI，用户想跑子集自己拆 eval-set 目录
- Markdown 报告（test 配 .md 输出）：M4 配的；test 报告 yaml 已含足够字段，MVP-B 不配 .md，让用户 `cat report.yaml | yq` 看
- 进度条 / spinner 专门设计：B6 既有 ink-spinner，按默认走
- query_id hash 碰撞检测：12 hex = 48 bit，birthday paradox 在 ~16M 条 case 时才有 1% 碰撞，MVP 不会到

## §10 验收口径

### 10.1 PR-A merge 后用户能多做什么

> 攥着一组 M4 诊断报告，跑一行 `kweaver trace eval-set build --diagnosis=diagnosis/latest/ --out=eval-sets/cs-v1/`，得到一个 git-trackable 的 eval-set 目录。也能跑 `kweaver trace schema validate eval-sets/cs-v1/index.yaml` 本地校验任何 yaml 文件。但**还不能跑测试**——PR-B 才解锁 baseline test report。

PR-A 完整验收清单：

- [ ] 单测 ~25-30 cases 全过
- [ ] e2e build --diagnosis= 跑通真 status_quo fixture
- [ ] 三种 user 路径手测通：
  - 手写完整 shard → schema validate 校验通过
  - `--diagnosis=` lift → 生成 shard → schema validate 通过
  - `--queries=<file>` 含 reference + assertions → lift → schema validate 通过
- [ ] redaction 在 builtin 默认下能抓到 5 类 PII；显式 `--redaction-rules=` 覆盖优先
- [ ] AGENTS.md 同步：`src/cli.ts` top-level help / `src/commands/trace.ts` / `skills/kweaver-core/references/` / README
- [ ] CI 全绿（Python pass / TypeScript pass）

### 10.2 PR-B merge 后用户能多做什么

> 完整 Story B 闭环。从 M4 诊断报告一路到 baseline test report，可以指着 report 跟团队说"这 5 条 case 现在 fail，我接下来沿 prompt 调一调看会不会变绿"，进 Story C / M6 单路径迭代的起点。

PR-B 完整验收清单：

- [ ] 单测 ~20-25 cases 全过
- [ ] e2e CI（stub provider + mock fetch）两条 e2e 全过
- [ ] 6 种 assertion 类型各一条 case 手测通（dip-poc + 真 agent）
- [ ] semantic_match builtin `answer-match-reference` template 跑通 stub provider + claude-code provider 两条路径
- [ ] case 失败不中断 batch 验证：一条 case 标 agent-chat 404，剩下 case 继续跑完
- [ ] AGENTS.md 同步
- [ ] CI 全绿

### 10.3 整 Story B 验收

```bash
# 整条用户路径
kweaver trace diagnose conv_xxx --out=diagnosis/refund.yaml
kweaver trace eval-set build --diagnosis=diagnosis/ --out=eval-sets/cs-v1/
kweaver trace schema validate eval-sets/cs-v1/index.yaml
kweaver trace eval-set test eval-sets/cs-v1/ --candidate=agt_42 --out=test-runs/baseline/
cat test-runs/baseline/report.yaml
```

跑完拿到 yaml 报告，里面有 pass/fail 数 + by_assertion_type 拆分 + 每条 case 的 verdict + failure_reason。

## §11 后续 follow-up

### 11.1 plan-traceai vision/detail 同步

本 spec doc user review 通过后，**一次性 commit** 把 vision/detail 追同步：

- vision `trace-cli-detailed-design.md` §3.2：
  - candidate 字面值占位化 → 改为 `<agent_id>[@<version>]` 裸标识（D3）
  - `--queries=<path>` 简化输入格式样例：加 reference + assertions 可选字段展示（D1）
  - 关键设计点 9 后追加 D1 修订说明
  - redaction 段落标 D2 builtin 默认行为
- vision `trace-cli-detailed-design.md` 附录 A：`eval-set/` 子树加 `assertion-evaluator.ts`；去掉 `query-id-gen.ts`
- vision `trace-ai-continuous-learning-design.md` §7.M5：
  - 入口契约 `--candidate=<...>` 去占位化，改为 `agent_id[@version]`
  - 内部要做的事追加 D5：`semantic_match` 必 ship builtin `answer-match-reference` rubric template
- plan `2026-05-11-m4-diagnose-issue-plan.md` §3 变更日志加 2026-05-13 第二行（记录 M5 spec doc + D1-D5）

### 11.2 GitHub issue 创建

随上述 commit 同步开 M5 umbrella issue：

- 标题草稿：`[traceai] M5 Eval-Set Builder — Story B 闭环（build + schema validate + test + 6 assertion）`
- body 含 PR-A / PR-B 切分 + 验收口径 + 链接到本 spec doc + 链接到 plan-traceai vision

### 11.3 implementation plan

issue 开后进 writing-plans skill，写 PR-A 实现计划（PR-B 计划等 PR-A merge 后另起）。

### 11.4 估算

| PR | 估算 | 与 M4 同环节对比 |
|---|---|---|
| PR-A (build + schema validate) | 5-7d | M4 PR-A 6-8d，M5 量略少（无规则引擎、无 rubric template registry） |
| PR-B (test + 6 assertions) | 5-7d | M4 PR-B 6-8d，M5 量略少（已有 agent-providers 复用 + 无 cross-trace synthesizer） |
| **合计** | **10-14d** | M4 总 14-16d；M5 减重在不引入新共享层 |
