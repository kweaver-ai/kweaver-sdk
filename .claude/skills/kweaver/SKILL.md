---
name: kweaver
description: >-
  操作 KWeaver 知识网络与 Decision Agent — 构建知识网络、查询 Schema/实例、
  语义搜索、执行 Action、Agent CRUD 与对话。
  操作 Vega 可观测平台 — 查询 Catalog/资源/连接器类型、健康巡检。
  当用户提到"知识网络"、"知识图谱"、"查询对象类"、
  "执行 Action"、"有哪些 Agent"、"创建 Agent"、"跟 Agent 对话"、
  "数据源"、"Catalog"、"Vega"、
  "健康检查"、"巡检"等意图时自动使用。
allowed-tools: Bash(npx tsx packages/typescript/src/cli.ts *)
argument-hint: [自然语言指令]
---

# KWeaver CLI (TypeScript)

KWeaver 平台的命令行工具，覆盖认证、知识网络管理与查询、Agent CRUD 与对话、数据源管理。

## 使用方式

```bash
npx tsx packages/typescript/src/cli.ts <command> [subcommand] [options]
```

简写别名（后续说明中均用简写）：

```bash
alias kweaver="npx tsx packages/typescript/src/cli.ts"
```

## 使用前提

**认证凭据通过 `~/.kweaver/` 管理，支持自动刷新。禁止提前检查环境变量，禁止询问用户提供密码或 Token。**

### 认证优先级

1. `KWEAVER_TOKEN` + `KWEAVER_BASE_URL` 环境变量 → 静态 Token（如存在则优先使用，**不会**自动刷新）
2. `~/.kweaver/` 凭据（`kweaver auth login` 写入）→ 自动刷新（推荐）

### SDK 自动刷新

```typescript
const client = await KWeaverClient.connect();  // 自动检测过期 + refresh
```

## 命令组总览

| 命令组 | 说明 | 详细参考 |
|--------|------|---------|
| `auth` | 认证管理（login/logout/status） | `references/auth.md` |
| `bkn` | BKN 知识网络管理、Schema、查询、Action | `references/bkn.md` |
| `agent` | Agent CRUD、发布、对话 | `references/agent.md` |
| `ds` | 数据源管理 | `references/ds.md` |
| `vega` | Vega 可观测平台（catalogs、resources、connector-types、health） | `references/vega.md` |
| `context-loader` | MCP 分层检索 | `references/context-loader.md` |
| `call` | 通用 API 调用 | `references/call.md` |

**按需阅读**：需要具体命令参数或编排示例时，读取对应的 reference 文件。

## 注意事项

- **不要自行猜测 business_domain 值**，使用默认值 `bd_public`
- Action 执行有副作用，执行前向用户确认
- Token 1 小时过期，SDK 的 `connect()` 和 CLI 的 `ensureValidToken` 自动刷新
- 如果 refresh token 也失效，提示用户 `kweaver auth login`
