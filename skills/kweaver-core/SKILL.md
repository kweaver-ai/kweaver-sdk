---
name: kweaver-core
description: >-
  通过 kweaver CLI 登录 KWeaver 平台、与 Agent 对话、管理和查询知识网络（KN）、
  调用 Context Loader 从知识网络检索概念和实例。
  当用户需要认证、Agent 对话、KN 管理/查询、知识检索时使用。
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
| `bkn` | 知识网络管理与查询（list/get/create/update/delete/export/stats；object-type CRUD/properties、relation-type CRUD、subgraph、action-type、action-log） |
| `agent` | Agent 管理与对话（list、get、chat、sessions、history） |
| `context-loader` | 分层检索（config、kn-search、query-object-instance、query-instance-subgraph、get-logic-properties、get-action-info） |
| `call` | 通用 API 调用（GET/POST，自动注入认证） |
| `token` | 打印当前 access token |

---

## 按需阅读

需要具体命令形态、参数或编排时，读取本 skill 目录下的 reference 文件：

- **BKN 管理/查询、Condition 语法、典型编排** → `references/bkn.md`
- **Agent 对话、多轮会话、历史记录** → `references/agent.md`
- **Action 执行、约束、日志** → `references/action.md`
- **完整命令示例、端到端流程** → `references/examples.md`

---

## 注意事项

- **不要自行猜测或枚举 business_domain 值**，只使用环境变量中配置的值
- `action-type execute` 有副作用，仅在用户明确请求时执行，执行前向用户确认
- 所有命令输出 JSON 格式，默认 pretty-print（indent=2）
