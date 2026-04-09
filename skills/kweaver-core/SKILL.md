---
name: kweaver-core
description: >-
  操作 KWeaver 知识网络与 Decision Agent — 构建知识网络、查询 Schema/实例、
  语义搜索、执行 Action、Agent CRUD 与对话、Trace 数据分析。
  操作 Dataflow 文档流程 — 列出流程、触发运行、查询运行历史、查看步骤日志。
  操作 Skill 管理模块 — 注册 Skill、市场查找、渐进式读取、下载与安装。
  操作 Vega 可观测平台 — 查询 Catalog/资源/连接器类型、健康巡检。
  当用户提到"知识网络"、"知识图谱"、"查询对象类"、
  "执行 Action"、"有哪些 Agent"、"创建 Agent"、"跟 Agent 对话"、"列出所有 Agent 模板"、"列出我创建的Agent"、
  "列出私人空间的Agent"、"dataflow"、"数据流"、"流程编排"、"流程运行记录"、"流程日志"、
  "触发 dataflow"、"查看 dataflow 运行历史"、"Skill"、"技能包"、"注册 Skill"、"安装 Skill"、"读取 SKILL.md"、
  "数据源"、"数据视图"、"原子视图"、"Catalog"、"Vega"、
  "健康检查"、"巡检"、"trace"、"证据链"、"数据流追踪"、"数据来源"、"数据怎么得到的"等意图时自动使用。
allowed-tools: Bash(kweaver *), Bash(npx kweaver *)
argument-hint: [自然语言指令]
---

# KWeaver CLI

KWeaver 平台的命令行工具，覆盖认证、平台业务域（`config`）、知识网络管理与查询、Agent CRUD 与对话、数据源管理。

## 安装

```bash
npm install -g @kweaver-ai/kweaver-sdk
```

需 Node.js 22+。也可用 `npx kweaver` 临时运行。

## 使用方式

```bash
kweaver [--user <userId|username>] <command> [subcommand] [options]
```

**完整子命令与参数以当前安装的 CLI 为准**：运行 `kweaver --help`（或 `-h`）查看与代码同步的用法列表；查版本用 `kweaver --version` / `-V` / `kweaver version`。子命令细节用 `kweaver <group> <subcommand> --help`（例如 `kweaver auth --help`、`kweaver bkn push --help`）。

本 skill 下的 `references/*.md` 与 CLI 行为对齐；**表格与 reference 为速查**，新增标志（如 `auth` 的 `--alias`、BKN `validate`/`push` 的编码选项）在 reference 中有说明。

**别名**：`kweaver curl` 等同于 `kweaver call`；`kweaver context` 等同于 `kweaver context-loader`。

**业务域（business domain）**：多数请求依赖 `x-business-domain`。`kweaver auth login` 后应优先执行 `kweaver config show`；列表为空时用 `config list-bd` 查看平台可选域，再 `config set-bd <uuid>`。详见 [`references/config.md`](references/config.md)。

## 使用前提

**认证凭据通过 `~/.kweaver/` 管理。默认操作：在存在 `refresh_token` 时，用 OAuth2 `refresh_token` 授权换发新的 `access_token`（过期或临近过期时自动执行，无需额外参数）。禁止提前检查环境变量，禁止询问用户提供密码或 Token。**

### 认证优先级

1. `KWEAVER_TOKEN` + `KWEAVER_BASE_URL` 环境变量 → 静态 Token（如存在则优先使用，**不会**用 refresh 换发）
2. `~/.kweaver/` 凭据（`kweaver auth login` 写入）→ **默认**用 refresh_token 换发 access_token（推荐）
3. `KWEAVER_USER` 环境变量（或全局 `--user` 参数）→ 使用指定用户的凭证，不切换活跃用户

### 业务域优先级（与认证独立）

1. `KWEAVER_BUSINESS_DOMAIN` 环境变量  
2. 当前平台 `config.json` 中的 `businessDomain`（`kweaver config set-bd`）  
3. 默认 `bd_public`（首次登录后 CLI 可能已自动写入更合适的值）

## 命令组总览

| 命令组 | 说明 | 常用命令 | 详细参考 |
|--------|------|---------|---------|
| `auth` | 认证管理（支持多账号） | `auth login <url> [--alias name]`（简写：`auth <url> [--alias …]`）；可选 `-u`/`-p` 或 `--playwright`；`auth list`（树形展示所有平台及用户）；`auth users`（列出用户名）；`auth switch --user <username>`（按用户名切换）；全局 `--user <name>` 可免切换使用指定用户凭证（env: `KWEAVER_USER`）；`auth use` / `status` / `logout` / `delete` 支持平台 URL 或别名 | `references/auth.md` |
| `token` | 打印当前 access token（自动刷新） | `token` | — |
| `config` | **平台业务域（优先于多数 bkn/agent/ds 操作）** | `config show`, `config list-bd`, `config set-bd <uuid>` | `references/config.md` |
| `bkn` | BKN 知识网络管理、Schema、查询、Action | `bkn validate`/`push` 默认检测 `.bkn` 编码并规范为 UTF-8，可用 `--no-detect-encoding` 或 `--source-encoding gb18030`；另有 `pull`、`object-type`、`search`、`create-from-ds`/`create-from-csv` 等，见 `references/bkn.md` | `references/bkn.md` |
| `agent` | Agent CRUD、发布、对话、Trace、模板、分类 | `agent list`, `agent get <id>`, `agent create --name <n> --profile <p> --config <json>`, `agent publish <id> --category-id <cid>`, `agent chat <id> -m "..."`、`agent category-list`, `agent template-list`, `agent template-get <tpl_id>`、`agent sessions <agent_id>`、`agent history <conversation_id>`、`agent trace <conversation_id>` | `references/agent.md` |
| `ds` | 数据源管理 | `ds list`, `ds get <id>`, `ds import-csv <ds_id> --files <glob> [--recreate]` | `references/ds.md` |
| `dataview` | 原子/自定义数据视图（mdl-data-model） | `dataview list`、`find --name`、`get`、`query`（SQL / mdl-uniquery）、`delete` | `references/dataview.md` |
| `dataflow` | Dataflow 文档流程 | `dataflow list`, `dataflow run <dagId> --file <path>`, `dataflow run <dagId> --url <remote-url> --name <filename>`, `dataflow runs <dagId> [--since <date-like>]`, `dataflow logs <dagId> <instanceId> [--detail]` | `references/dataflow.md` |
| `skill` | Skill 注册、市场查找、渐进式读取、下载与安装 | `skill list`、`market`、`register --zip-file`、`content`、`read-file`、`install` | `references/skill.md` |
| `vega` | Vega 可观测平台 | `vega health`, `vega catalog list`, `vega resource list` | `references/vega.md` |
| `context-loader` | MCP 分层检索 | `context-loader config show`, `context-loader kn-search <query>` | `references/context-loader.md` |
| `call` | 通用 API 调用 | `call <url> [-X POST] [-d '...']`（可用 `curl` 别名；支持 `--url`、`--data-raw` 等，见 `kweaver --help`） | `references/call.md` |

## 操作指南

| 场景 | 说明 | 详细参考 |
|------|------|---------|
| 登录后确认业务域 | `config show`；若异常或列表为空 → `config list-bd` → `config set-bd <uuid>` | [references/config.md](references/config.md) |
| 从数据库/CSV 构建 KN | 连接数据源 → CSV 导入 → 创建 KN → 构建索引 → 查询验证 → 绑定 Agent | [references/build-kn-from-db.md](references/build-kn-from-db.md) |
| CLI 排障速查 | 权限、pull、build、import、dataview SQL 等 | [references/troubleshooting.md](references/troubleshooting.md) |
| 列/查数据视图 | `list` 浏览；`find --name` 按名搜索（`--exact`/`--wait`）；`query` 对视图跑 SQL | [references/dataview.md](references/dataview.md) |
| 管理 Dataflow 文档流程 | `list` 看 DAG；`run` 触发本地文件或远程 URL；`runs --since` 看自然日运行记录；`logs --detail` 查步骤载荷 | [references/dataflow.md](references/dataflow.md) |
| Trace 数据分析 | `agent trace <conversation_id>` 获取 trace 数据，构建证据链 | — |
| 管理 Skill | `list` / `market` 查找 Skill；`content` / `read-file` 渐进式读取；`install` 下载并解压本地使用 | [references/skill.md](references/skill.md) |

**按需阅读**：需要子命令完整参数或编排示例时，读取对应的 reference 文件。

## 调用示例

```
/kweaver-core 列出所有知识网络
/kweaver-core 查看 Vega 健康状况
/kweaver-core 有哪些 Agent
/kweaver-core 跟 Agent xxx 对话，问他"今天库存情况"
/kweaver-core 搜索知识网络 xxx 中关于"供应链"的内容
/kweaver-core 用 dataview find 模糊搜索名字含 BOM 的数据视图
/kweaver-core 列出所有 dataflow
/kweaver-core 触发 dataflow 123，上传本地文件 ./demo.pdf
/kweaver-core 查看 dataflow 123 在 2026-04-01 的运行记录
/kweaver-core 查看 dataflow 123 的实例 456 日志，并展开 input output
/kweaver-core 列出所有 Agent 模板
/kweaver-core 基于 "数据分析助手" 模板创建一个新的 Agent
/kweaver-core 在 skill market 里查找名字包含 kweaver 的 skill
/kweaver-core 读取 skill xxx 的 SKILL.md 并保存到本地目录
```

## 注意事项

- **不要自行猜测 business_domain 值**。首次使用时运行 `kweaver config show` 或 `kweaver config list-bd` 确认当前 business domain。如果返回 `bd_public (default)` 但命令结果为空，可能需要用 `kweaver config set-bd <uuid>` 设置正确的值（也可用 `config list-bd` 从平台列出后再 `set-bd`，或从平台 UI 请求头中获取 `X-Business-Domain`）
- Action 执行有副作用，执行前向用户确认
- **禁止运行 `kweaver auth status` 做预检**。直接执行目标命令，CLI 会自动处理认证和 token 刷新
- Token 1 小时过期。当 `~/.kweaver/` 中存在 `refresh_token`（通过 OAuth2 登录获得）时，CLI 会**自动刷新**；仅 Playwright cookie 登录（无 `refresh_token`）时需要用户重新运行 `kweaver auth login <url>`。遇到 401 错误时 CLI 会自动尝试刷新，刷新失败才提示用户重新登录

## 查询策略（object-type query）

调用 `object-type query` 时必须限制 `limit`、用 `search_after` 分页、用 `condition` 过滤，避免宽表 JSON 截断。完整规则与示例见 [`references/bkn.md`](references/bkn.md#object-type-query-strategy-for-llm-and-agent)。
