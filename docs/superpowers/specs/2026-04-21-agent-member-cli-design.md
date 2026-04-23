# Agent 成员关联 CLI 设计（skill / tool / mcp）

关联 issue：[#72](https://github.com/kweaver-ai/kweaver-sdk/issues/72)

## 背景

`kweaver agent update` 目前的字段级 patch 只覆盖 `--name / --profile / --system-prompt / --knowledge-network-id`，其他所有 config 字段（skills / tools / mcps / llms / 等）都必须走 `--config-path` 整份替换。结果是：把一个 skill 挂到 agent 上需要用户 `agent get > cfg.json` → 用 python/jq 手改 `config.skills.skills[]` → `agent update --config-path`——既要知道嵌套路径，又有误删 tools/mcps/llms 的风险。

这是整个 agent 成员管理共同的缺口，不是 skill 独有。issue #63 已经给 toolbox/tool 做了"父容器 CRUD + 子成员生命周期"的子子命令模式；这次用同一个模式延伸到 agent 的成员管理。

## 范围

**本次覆盖**：skill / tool / mcp 三类成员，各自 `add / remove / list` 三个动词。

**不在本次范围内**：

- `llm` 子命令（字段结构 `is_default / llm_config / max_tokens / temperature / top_p / top_k` 跟"id 数组"范式不对称，需单独设计）；
- `knowledge-network add / remove / list`（当前平台只支持单个 KN，且 `--knowledge-network-id` 写入时 `knowledge_network_name` 被留空是独立小 bug）；
- `set`（全量替换）动词——`remove + add` 组合可达成，YAGNI 至实际需求出现；
- `kweaver agent update --skill-add / --tool-add / --mcp-add` 这类 flag 形态——子子命令覆盖 95% 日常，跨成员类型的原子批量改先不做；
- 反向 `kweaver skill attach-to-agent`。

## 目标 UX

**Before**：

```bash
kweaver agent get ag_xxx --verbose > /tmp/cfg.json
python3 -c "
import json
a = json.load(open('/tmp/cfg.json'))
a['config']['skills']['skills'] = [{'skill_id':'sk_abc'}, {'skill_id':'sk_def'}]
json.dump(a['config'], open('/tmp/cfg-out.json','w'))
"
kweaver agent update ag_xxx --config-path /tmp/cfg-out.json
```

**After**：

```bash
kweaver agent skill add ag_xxx sk_abc sk_def
```

## CLI 表面

新增 9 个子子命令：

```
kweaver agent skill add    <agent-id> <skill-id>...       [--strict] [-bd <bd>]
kweaver agent skill remove <agent-id> <skill-id>...       [-bd <bd>]
kweaver agent skill list   <agent-id>                     [-bd <bd>] [--pretty|--compact]

kweaver agent tool add     <agent-id> <tool-id>...        [--strict] [-bd <bd>]
kweaver agent tool remove  <agent-id> <tool-id>...        [-bd <bd>]
kweaver agent tool list    <agent-id>                     [-bd <bd>] [--pretty|--compact]

kweaver agent mcp add      <agent-id> <mcp-id>...         [--strict] [-bd <bd>]
kweaver agent mcp remove   <agent-id> <mcp-id>...         [-bd <bd>]
kweaver agent mcp list     <agent-id>                     [-bd <bd>] [--pretty|--compact]
```

**待 plan 阶段校准的细节**（读一份真实 agent config 反推平台契约后确定）：

- `tool` 关联单位究竟是 toolbox 容器还是单个 endpoint——决定动词到底叫 `agent tool` 还是 `agent toolbox`，以及 `idField` 是 `tool_id` 还是 `toolbox_id`；
- `mcp` 关联单位——当前 CLI 无任何 mcp 命令，config 里的字段名（`mcp_server_id` / `mcp_id` / 其他）需从平台契约读出；
- 三类成员在 `config` 里的嵌套路径，例如 `config.skills.skills[]`（从 issue 观察）对其余两类是否同构。

子子命令的形态（`add / remove / list` 三词一套对称）不受这些细节影响。

## 底层机制

三组命令共享一个 patch 工具，新建文件 `packages/typescript/src/commands/agent-members.ts` 或类似：

```ts
type MemberSpec = {
  memberKind: string;          // "skill" | "tool" | "mcp"，用于错误消息
  configPath: string[];        // 例 ["skills", "skills"]
  idField: string;             // 例 "skill_id"
  fetchById: (id: string, ctx: ApiCtx) =>
    Promise<{ exists: boolean; published: boolean; name?: string }>;
};

async function patchAgentMembers(opts: {
  agentId: string;
  spec: MemberSpec;
  addIds: string[];
  removeIds: string[];
  strict: boolean;
  ctx: ApiCtx;
}): Promise<PatchReport>;
```

### 写路径（add / remove）五阶段

1. **validate**（仅 add）：对每个 addId 调 `spec.fetchById`；
   - 任一 id 不存在 → 立即终止，**不调用 updateAgent**（零侧改）；
   - 存在但 `published=false` → warning 累积；`--strict` 时升级为错误中止。
2. **fetch**：`getAgent(agentId)` 拿当前 `config`。
3. **mutate**：按 `spec.configPath` 下沉到目标数组（沿途缺失的对象/数组节点自动补齐），按 `spec.idField` 做 dedupe add 或 filter remove。
4. **write**：`updateAgent(agentId, { ...current, config: mutatedConfig })`——**完全复用 agent.ts:1460 的现有通路**，不新增 API 函数。
5. **report**：每个 id 的状态（`added / already-attached / removed / not-attached / skipped-unpublished-warn`），打印到 stdout。

### list 路径

1. `getAgent(agentId)` → 按 `spec.configPath` + `spec.idField` 取出 id 列表；
2. 并行 `spec.fetchById`（用于附带 name / status）；
3. 按 `--pretty / --compact` JSON 输出（跟 `skill list` 既有约定一致）；
4. `fetchById` 失败 → 降级为 `{ id, name: null, status: "unknown" }`，不阻塞整条 list。

### 并发

单用户 CLI 场景下，`get → update` 之间不做乐观锁。多并发写同一个 agent 的竞态是已知 limitation，设计文档层面接受。

## 校验与用户可见行为

### add — 全部存在，部分未发布（默认）

```
$ kweaver agent skill add ag_x sk_a sk_b
! sk_b  skill is in draft status (use --strict to reject, or publish it first)
✓ sk_a  added
✓ sk_b  added (draft)
• Already attached skills skipped: 0
Agent ag_x now has 5 skills attached.
```
exit 0.

### add — 任一 id 不存在

```
$ kweaver agent skill add ag_x sk_a sk_b sk_c
✗ sk_c  not found (aborting, agent not modified)
```
exit 1，零侧改。

### add — `--strict` 下 draft

add 时 `--strict` 把 unpublished warning 升级为错误，也零侧改，exit 1。

### add — 重复添加

```
$ kweaver agent skill add ag_x sk_a
• sk_a  already attached (skipped)
Agent ag_x now has 4 skills attached.
```
exit 0。

### remove

```
$ kweaver agent skill remove ag_x sk_a sk_z
✓ sk_a  removed
• sk_z  not attached (skipped)
Agent ag_x now has 3 skills attached.
```
exit 0。remove 不调用 `fetchById`——只做数组过滤，悬挂引用被清掉反而是好事。

### list 输出

```json
[
  {"skill_id": "sk_a", "name": "mysql-foundation", "status": "published"},
  {"skill_id": "sk_b", "name": "api-client", "status": "draft"},
  {"skill_id": "sk_c", "name": null, "status": "unknown"}
]
```

### exit code 约定

| 情形 | exit |
|---|---|
| agent 不存在（来自 `agent get` HTTP 错误） | 1 |
| add 时任一 id 不存在 | 1（零侧改） |
| add 时 `--strict` 下有 draft id | 1（零侧改） |
| add 时仅 dedupe skip | 0 |
| remove 时全部 not-attached | 0（skip 不是错误） |
| 底层 `updateAgent` HTTP 失败 | 1 |

`--strict` 当前只作用于 add；remove 不需要。

## 测试

仓库使用 Node 内置 `node:test`，`test/*.test.ts` 走 mock HTTP，`test/e2e/*.test.ts` 打真实平台。两类都写。

### 单元 — `test/agent-member-patch.test.ts`

验证 `patchAgentMembers` 的纯逻辑，不测 HTTP 细节：

1. config 路径缺失（`config` 里无 `skills` 键）时自动补齐嵌套节点后写入；
2. 已存在 id 再 add → skip，不出现在 update body 的重复条目里；
3. remove 过滤保留原有顺序；remove 不在列表里的 id → skip，不报错；
4. add 有不存在的 id → 根本不调用 `updateAgent`（验证零侧改）；
5. `--strict` + draft id → 也不调用 `updateAgent`；
6. 非 `--strict` + draft id → 照常 update，warning 出现在 stderr；
7. list 路径里 `fetchById` 失败降级为 `status: "unknown"`。

### 集成 — `test/agent-member-cmd.test.ts`

每组 member × `{add, remove, list}` 各一条正向 + 一条反向用例，验证：

- 参数解析、help 文本；
- `-bd / --pretty / --compact` 继承；
- 未知子子命令的错误消息；
- 跟 `test/agent.test.ts` 既有模式对齐。

### e2e — `test/e2e/agent-member.test.ts`

用真实平台 token 跑 "创建测试 agent → skill add → skill list → skill remove → 清理" 的最小闭环。tool / mcp 的 e2e 在 plan 阶段契约定好后再补。遵循仓库 e2e 惯例：从 `~/.env.secrets` 读凭证、测完清理现场。

### 手工验证

在 dip-poc 上跑一次端到端，用 `agent skill add` 替换 issue #72 里那段 python+jq 流程，产出 "before / after" 对比贴回 issue 作为关闭凭证。

## 文件改动清单

新增：

- `packages/typescript/src/commands/agent-members.ts` — `patchAgentMembers` + 三个 MemberSpec 定义 + 三个命令 handler
- `test/agent-member-patch.test.ts`
- `test/agent-member-cmd.test.ts`
- `test/e2e/agent-member.test.ts`

修改：

- `packages/typescript/src/commands/agent.ts` — `runAgentCommand` 路由新增 `skill / tool / mcp` 三个子子命令分支；更新 help 文本
- （可能）`packages/typescript/src/api/skills.ts` / `toolboxes.ts` / 新建 mcp API 文件 — 仅在现有 `fetchById` 能力不足时补充 get-by-id 函数

## 已知 limitation

1. 多并发 CLI 写同一个 agent 时 `get → update` 有竞态，不做乐观锁；
2. `agent tool / mcp` 的动词命名与 `idField` 需 plan 阶段读真实 config 校准；
3. `fetchById` 每个 id 一次请求，批量 add 时 N 个 id 就 N 次 round-trip，不引入批量接口；
4. 不做 llm / knowledge-network 的对称命令（单独 issue）。
