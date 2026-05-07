# Agent 命令参考

Decision Agent CRUD、发布管理与对话。

与 CLI 一致：运行 `kweaver agent` 或 `kweaver agent chat --help` 等可查看与当前版本同步的用法。

## CRUD 命令

```bash
# 已发布的 Agent
kweaver agent list [--name <kw>] [--limit 50] [--verbose]
kweaver agent get <agent_id> [--verbose] [--save-config <path>]
kweaver agent get-by-key <key>

# 私人空间的 Agent
kweaver agent personal-list [--name <kw>] [--size 48] [--verbose]

# Agent 模板
kweaver agent template-list [--name <kw>] [--size 48] [--verbose]
kweaver agent template-get <template_id> [--save-config <path>] [--verbose]

# Agent 分类
kweaver agent category-list [--verbose]

# 创建 Agent
kweaver agent create --name <name> --profile <profile> --llm-id <model_id> [--key <key>] [--product-key DIP|AnyShare|ChatBI] [--system-prompt <sp>] [--llm-max-tokens 4096] [--mode default|dolphin|react] [--config <json|path>]

# 更新/删除
kweaver agent update <agent_id> [--name <n>] [--profile <p>] [--system-prompt <sp>] [--mode default|dolphin|react] [--knowledge-network-id <id> [--config-path <path>]]
kweaver agent delete <agent_id> [-y]
```

## 发布管理

```bash
kweaver agent publish <agent_id> [--category-id <category_id>]
kweaver agent unpublish <agent_id>
```

**发布说明**：
- `--category-id`：指定 Agent 分类（可选）
- 默认发布到广场（square）
- 发布时会使用默认配置：
  ```json
  {
    "business_domain_id": "bd_public",
    "category_ids": ["<category_id>"] | [],
    "description": "",
    "publish_to_where": ["square"],
    "pms_control": null
  }
  ```

## 对话

```bash
kweaver agent chat <agent_id> -m '<message>' [--conversation-id <id>] [--stream/--no-stream]
kweaver agent chat <agent_id>                    # 交互式模式
kweaver agent sessions <agent_id> [--limit <n>]
kweaver agent history <agent_id> <conversation_id>
kweaver agent trace <conversation_id> [--view tree|perf|evidence|reasoning|all] [--full] [--json]
```

## Trace 数据

```bash
kweaver agent trace <conversation_id> --view <view>
```

底层走 trace-ai 的 `_search` 双跳查询（先按 conversation_id 聚合 traceId，再按 traceId 拉全量 spans），能恢复 by-conversation 端点漏掉的 pipeline span（HTTP 入口、内部 RPC、prompt 装配）。

选项：
- `--view tree`（默认）：按父子关系展开调用拓扑 + 每跨服务标注（agent-factory / agent-executor）
- `--view perf`：按类别（LLM / tool:* / db / prompt-build / pipeline）汇总累计耗时与次数
- `--view evidence`：列出每次工具调用的入参 + 命中条数 + `_score` + 命中名称（自动剥 trace-ai 的 `{answer:"..."}` 包裹）
- `--view reasoning`：从 chat span 的 `events` 还原完整 LLM 多轮推理（system / user / assistant / tool_call / tool result / final answer）
- `--view all`：上面四视图合并输出
- `--full`：仅对 reasoning 视图生效，关掉每条消息默认 400 字截断
- `--json`：跳过渲染，直出 `TracesByConversationResult`（含 `spans / traceIds / truncated`）

兼容老用法：`agent trace <agent_id> <conversation_id>` 仍可用，agent_id 被忽略（trace-ai 只按 conversation_id 索引）。

## 说明

- `create` 需要 `--llm-id`，可通过模型工厂 API 查询可用 LLM：`GET /api/mf-model-manager/v1/llm/list?page=1&size=100`
- `get` 的 `--save-config` 自动添加时间戳防止文件被覆盖，输出文件路径格式：`<basename>-<timestamp>.<ext>`
- `update` 的 `--config-path` 从指定路径读取配置文件（由 `get --save-config` 生成），`--knowledge-network-id` 配置业务知识网络
- `create` / `update` 支持 `--mode default|dolphin|react`，用于设置 `config.mode`；未传且配置中缺少 mode 时默认为 `default`
- `create` 的 `--config` 支持两种方式：
  - **文件路径**：`--config /path/to/config.json`（推荐，避免长度限制）
  - **JSON 字符串**：`--config '{"input":...,"llms":...}'`
- `react_config` 仅允许用于 `mode=react`，通过 `--config` 或 `--config-path` 传入：
  ```json
  {
    "mode": "react",
    "react_config": {
      "disable_history_in_a_conversation": false,
      "disable_llm_cache": false
    }
  }
  ```
  字段说明：
  | 字段 | 类型 | 默认示例 | 说明 |
  | --- | --- | --- | --- |
  | `disable_history_in_a_conversation` | boolean | `false` | 是否禁用单次会话历史。为 `true` 时，同一会话中的每个问题都会独立处理，不依赖该会话前面的历史消息。 |
  | `disable_llm_cache` | boolean | `false` | 是否禁用 LLM 缓存。仅当 agent-executor 服务侧启用了 LLM 缓存能力时生效；如果服务侧没有开启缓存，此配置无实际效果。 |
- `template-get` 的 `--save-config` 自动添加时间戳防止文件被覆盖
- `update` 采用 read-modify-write 模式：先 GET 当前配置，修改字段后 PUT 回去
- `list` 只返回已发布的 agent；`get` 可以获取未发布的（需要是 owner）
- `publish` 后 agent 才会出现在 `list` 里

## 更新 Agent 知识网络配置

通过 `get --save-config` 保存配置，然后使用 `update --config-path --knowledge-network-id` 更新。

```bash
# 1. 获取并保存 Agent 配置（自动添加时间戳）
kweaver agent get <agent_id> --save-config /tmp/agent_config.json
# 输出: /tmp/agent_config-2026-04-02T14-50-55.json

# 2. 更新知识网络配置
kweaver agent update <agent_id> --config-path /tmp/agent_config-2026-04-02T14-50-55.json --knowledge-network-id d5ordervm0qr3o2trdn0

# 3. 重新发布使配置生效
kweaver agent publish <agent_id>
```

**选项说明**：
- `--save-config <path>`：保存配置到文件，自动添加时间戳防止覆盖
  - 支持目录路径（以 `/` 结尾），自动生成文件名
  - 自动创建不存在的目录
- `--config-path <path>`：从文件读取配置（配合 `--save-config` 使用）
- `--knowledge-network-id <id>`：配置业务知识网络ID

**简写方式**（不保存文件）：
```bash
# 直接更新知识网络（自动从API获取当前配置）
kweaver agent update <agent_id> --knowledge-network-id <kn_id>
```

## 基于模板创建 Agent

通过模板快速创建 Agent，避免手动配置复杂的 config 对象。

### 方式一：使用 --save-config（推荐）

直接保存模板配置到文件，避免长 JSON 字符串被截断。

```bash
# 1. 列举所有模板
kweaver agent template-list

# 2. 保存模板配置到文件（自动添加时间戳，防止覆盖）
kweaver agent template-get <template_id> --save-config /tmp/config.json
# 输出: /tmp/config-2026-04-02T14-30-45.json

# 3. 使用配置文件创建 Agent
kweaver agent create --name "我的Agent" --profile "描述" --config /tmp/config-2026-04-02T14-30-45.json
```

**--save-config 说明**：
- 输出文件路径自动添加时间戳，格式：`<basename>-<timestamp>.<ext>`
- 支持目录路径（以 `/` 结尾），自动生成文件名：`/tmp/dir/` → `/tmp/dir/agent-config-2026-04-02T14-30-45.json`
- 自动创建不存在的目录

### 方式二：手动提取配置

```bash
# 1. 获取模板详情
kweaver agent template-get <template_id> --verbose

# 2. 从返回的 JSON 中提取 config 对象，手动创建 Agent
kweaver agent create --name "我的Agent" --profile "描述" --config '{"input":{...},"llms":...}'
```

### 完整示例

```bash
# 1. 列举所有分类（可选）
kweaver agent category-list

# 2. 列举所有模板
kweaver agent template-list

# 返回示例：
# [
#   {"id": "88", "name": "合同审核助手演示版_模板", "description": "..."},
#   {"id": "92", "name": "业务知识网络召回_模板", "description": "..."}
# ]

# 3. 保存模板配置
CONFIG=$(kweaver agent template-get 88 --save-config /tmp/contract-audit.json)
echo "配置已保存到: $CONFIG"

# 4. 创建 Agent
AGENT_ID=$(kweaver agent create --name "合同审核助手" --profile "基于模板创建" --config "$CONFIG" | jq -r '.id')

# 5. 发布 Agent
kweaver agent publish $AGENT_ID
```

## 端到端示例

```bash
# 方式一：从零创建 → 配置知识网络 → 发布 → 对话 → 清理
kweaver agent create --name "测试助手" --profile "SDK 测试用" --llm-id <model_id> --system-prompt "你是一个测试助手"
kweaver agent update <agent_id> --knowledge-network-id <kn_id>
kweaver agent publish <agent_id> --category-id 01JRYRKP0M8VYHQSX4FXR5CKG1
kweaver agent chat <agent_id> -m "你好"
kweaver agent unpublish <agent_id>
kweaver agent delete <agent_id> -y

# 方式二：基于模板创建（推荐）
CONFIG=$(kweaver agent template-get 88 --save-config /tmp/config.json)
AGENT_ID=$(kweaver agent create --name "合同审核助手" --profile "描述" --config "$CONFIG" | jq -r '.id')
kweaver agent publish $AGENT_ID
kweaver agent chat $AGENT_ID -m "帮忙审核合同：JJFAGHBJF25090012"

# 多轮对话
kweaver agent chat <agent_id> -m "分析库存数据" --no-stream
kweaver agent chat <agent_id> -m "给出改进建议" --conversation-id <conv_id>
kweaver agent history <agent_id> <conv_id>
```
## Trace 数据分析

`kweaver agent trace <cid> --view <view>` 直接用 SDK 内置的四视图，**不要再手工拼证据链** —— 视图已经把工具入参 / 命中数据 / LLM 多轮推理还原好了。

| 用户意图 | 选哪个 view |
|---|---|
| "为什么慢 / 哪个 tool 卡了" | `perf` |
| "调用了哪些服务、谁调谁" | `tree` |
| "数据是怎么查到的、命中了什么" | `evidence` |
| "agent 当时怎么想的、为什么这么决策" | `reasoning`（完整推理需配 `--full`） |
| "都看一眼" | `all` |

### 操作步骤

1. **拿 conversation_id**：用户给 / 从 `agent sessions <agent_id>` 选
2. **跑视图**：`kweaver agent trace <cid> --view <pick-one>`
3. **判读输出，回答用户问题**：
   - 工具失败标 `Err`、入参与命中行已在 `evidence` 视图里
   - LLM 自我纠错（重试、换格式）会在 `reasoning` 的 assistant 消息里直接看到原话
   - tool result 默认剥过 trace-ai 的 `{answer:"..."}` 外壳

### 已知埋点缺口（看到这些不要慌）

- 部分 `execute_tool` span 在 tree 里挂在根（orphan）：agent-executor 的 task scheduler 没传 OTel context，**这是后端埋点问题，不是 SDK bug**
- `tool.result` 写到 attributes 时是 Python repr（单引号）而非合法 JSON：reasoning 视图已做 forgiving 解析；如果某条仍显示原文 `{'answer': ...}` 就是这种情况

**解释**：
1. 14:30:00 收到订单请求
2. 校验通过但标记了警告
3. 支付检查发现余额不足
4. 订单因支付失败被拒绝

### 分析技巧

- 查找 trace 中的错误事件或异常
- 关注时间戳以理解执行顺序
- 识别 spans 之间的父子关系
- 突出流程中的关键决策点
- 向用户解释时使用清晰、非技术性的语言
