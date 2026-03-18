---
name: kweaver
description: >-
  操作 KWeaver 知识网络与 Decision Agent — 构建知识网络、查询 Schema/实例、
  语义搜索、执行 Action、列举 Agent、与 Agent 对话。
  当用户提到"知识网络"、"知识图谱"、"查询对象类"、
  "执行 Action"、"有哪些 Agent"、"跟 Agent 对话"等意图时自动使用。
allowed-tools: Bash(kweaver *), Bash(npx kweaver *)
argument-hint: [自然语言指令]
requires:
  env: [KWEAVER_BASE_URL, KWEAVER_BUSINESS_DOMAIN, KWEAVER_TOKEN]
  bins: [node]
---

# KWeaver CLI

KWeaver 平台的命令行工具，覆盖认证、知识网络管理与查询、Agent 对话、Context Loader 检索、通用 API 调用。

## 安装

```bash
npm install -g @kweaver-ai/kweaver-sdk
```

需 Node.js 22+。也可用 `npx kweaver` 临时运行。

## 使用前提

**使用任何命令前，必须先认证。** 若用户未认证，提示先执行 `kweaver auth login <platform-url>`。

**重要规则**:
1. **所有环境变量已预配置，直接执行命令即可。禁止提前检查环境变量是否存在，禁止询问用户提供密码或 Token。**

### 认证优先级

CLI 按以下顺序尝试认证（无需用户干预）：

1. **环境变量 Token** — `KWEAVER_TOKEN` + `KWEAVER_BASE_URL` 同时存在时优先使用
2. **ConfigAuth** — 读取 `~/.kweaver/` 凭据（由 `kweaver auth login` 写入），自动刷新 Token

环境变量 `KWEAVER_BASE_URL` 和 `KWEAVER_BUSINESS_DOMAIN` 用于指定平台地址和业务域。

---

## 命令组总览

| 命令组 | 说明 |
|--------|------|
| `auth` | 认证管理（login/status/list/use/delete/logout） |
| `bkn` | 知识网络管理与查询（list/get/create/update/delete/export/stats；object-type、subgraph、action-type、action-log） |
| `agent` | Agent 对话（list、chat、sessions、history） |
| `context-loader` | 分层检索（config、kn-search、query-object-instance、query-instance-subgraph、get-logic-properties、get-action-info） |
| `call` | 通用 API 调用（GET/POST，自动注入认证） |
| `token` | 打印当前 access token |

---

## 按需阅读

需要具体命令形态、参数或编排时，读取以下 reference 文件：

- **BKN 管理/查询、search、object-type、subgraph、action-type、端到端** → `skills/kweaver-core/references/bkn.md`
- **查询（bkn search / object-type query / subgraph）、端到端** → `skills/kweaver-core/references/query.md`
- **Agent 对话、多轮会话、历史记录、端到端** → `skills/kweaver-core/references/agent.md`
- **Action 执行（bkn action-type / action-log）、约束、端到端** → `skills/kweaver-core/references/action.md`
- **Context Loader 分层检索、JSON 入参** → `skills/kweaver-core/references/context-loader.md`
- **通用 API 调用（call 完整 URL）、端到端** → `skills/kweaver-core/references/call.md`
- **JSON 格式（Condition、object-type query、subgraph、action-type、context-loader）** → `skills/kweaver-core/references/json-formats.md`

---

## 注意事项

- **不要自行猜测或枚举 business_domain 值**，只使用环境变量中配置的值
- `action-type execute` 有副作用，仅在用户明确请求时执行，执行前向用户确认
- 所有命令输出 JSON 格式，默认 pretty-print（indent=2）
