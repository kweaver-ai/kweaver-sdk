# Agent CLI Mode 参数支持

日期：2026-05-06

## 背景

`agent-factory` 已通过 `config.mode` 统一表达 Agent 模式，当前支持 `default`、`dolphin`、`react` 三种取值。其中 `react` 模式可使用专属配置 `react_config`，并由后端校验该配置只允许出现在 `mode=react` 时。

## 本次变更

TypeScript CLI 的 `agent create` 和 `agent update` 增加 `--mode <default|dolphin|react>` 参数：

```bash
kweaver agent create --name <name> --profile <profile> --mode react --config ./agent-config.json
kweaver agent update <agent_id> --mode react --config-path ./agent-config.json
```

行为约定：

- 显式传入 `--mode` 时，CLI 会覆盖最终请求体中的 `config.mode`。
- 未传 `--mode` 时，如果配置中已有合法 `config.mode`，CLI 会保留原值。
- 未传 `--mode` 且配置中缺少 `config.mode` 时，CLI 会补齐为 `default`。
- 如果 `--mode` 或配置中的 `config.mode` 不是 `default`、`dolphin`、`react`，CLI 会在发送 HTTP 请求前报错。
- `agent update --config-path` 优先按配置根对象读取；如果文件是完整 Agent JSON 且包含顶层 `config` 对象，CLI 会使用该嵌套 `config`，避免把整份 Agent 元数据误写入配置。
- `create` 继续调用通用接口 `/api/agent-factory/v3/agent`；`update` 继续调用 `/api/agent-factory/v3/agent/{agent_id}`。

## ReAct 配置

`react_config` 仍通过 `--config` 或 `--config-path` 提供，不新增独立 CLI 参数。

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

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `disable_history_in_a_conversation` | boolean | 是否禁用单次会话历史。为 `true` 时，同一会话中的每个问题都会独立处理，不依赖该会话前面的历史消息。 |
| `disable_llm_cache` | boolean | 是否禁用 LLM 缓存。仅当 agent-executor 服务侧启用了 LLM 缓存能力时生效；如果服务侧没有开启缓存，此配置无实际效果。 |

## 影响范围

- 影响命令：`kweaver agent create`、`kweaver agent update`。
- 不改变 `agent chat`、`agent publish`、`agent get` 等命令行为。
- 不新增 `/agent/react` 专用接口调用路径，避免对旧部署产生额外兼容风险。

## 验证

本次变更增加了 `test/agent.mode.test.ts`，覆盖：

- `config.mode` 默认补齐、合法保留、显式覆盖和非法值拒绝。
- create/update 最终请求体中的 `config.mode`。
- update `--config-path` 对配置根对象和完整 Agent JSON 的兼容读取。
- create/update help 中的 `--mode` 与 `react_config` 说明。

验证命令：

```bash
npm test -- --test-name-pattern='agent|agent mode'
npm run lint -- --pretty false
npm run build
node bin/kweaver.js agent create --help
node bin/kweaver.js agent update --help
```
