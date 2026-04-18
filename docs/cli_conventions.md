# KWeaver CLI 命令约定

> 本文档定义 `kweaver` CLI 命令的结构、命名与扩展约定。**新增命令前必须先对齐本文档**。

## 1 层级

固定 **2 级**：`kweaver <资源> <动作>`。
- ✅ `kweaver bkn create`
- ✅ `kweaver toolbox publish <id>`
- ❌ `kweaver factory toolbox create`（禁止 3 级分组）
- ❌ `kweaver toolbox <id> tool upload`（禁止 RESTful 嵌套）

## 2 同域多资源

当一个域内多个资源是同一类时，用 `<前缀>-<子资源>` **软分组**，仍保持 2 级。
- ✅ `bkn`, `bkn-ops`, `bkn-query`, `bkn-schema`（共享 `bkn` 前缀，仍是 2 级命令）
- ✅ `explore-bkn`, `explore-chat`, `explore-vega`（同上）

不同概念资源即便在同一业务域，也保持平铺顶层命令而非引入 3 级嵌套。例如 `toolbox` 与 `tool`：
- ✅ `kweaver toolbox <action>` + `kweaver tool <action>`

## 3 父子关系

资源间的父子关系通过 **flag** 表达，不做 URL 风格嵌套。
- ✅ `kweaver tool upload --toolbox <box_id> spec.yaml`
- ❌ `kweaver toolbox <box_id> tool upload spec.yaml`

## 4 底层逃生口

`kweaver call` 必须能覆盖任何后端 API（含 multipart 文件上传），保证：
- 缺专用命令时，用户**不必退回 raw `curl` + 手动拼 token**
- 任何新接口可立刻通过 `kweaver call` 调用，专用命令是面向用户体验的糖

具体能力清单见 `kweaver call --help`。

## 5 Subcommand 一致性

每个资源的 subcommand 命名遵循动词约定：
| 动作 | Subcommand | 备注 |
|---|---|---|
| 列举 | `list` | 支持 `--keyword`, `--limit`, `--offset` 等通用过滤 |
| 详情 | `get <id>` | |
| 创建 | `create [args]` | |
| 更新 | `update <id> [args]` | |
| 删除 | `delete <id> [-y]` | `-y` 跳过确认 |
| 上传文件 | `upload <file>` | 走 multipart |
| 状态变更 | `<verb>`（如 `publish`, `enable`, `set-status`） | 优先具名动词，回退到 `set-status` |

## 6 通用 flag

所有命令必须支持：
- `-bd, --biz-domain <value>` — 覆盖业务域
- `--pretty` — 美化 JSON 输出（默认开启）
- `-h, --help` — 子命令帮助

## 7 测试要求

新命令必须包含：
1. **解析器单测**（`test/<cmd>-cmd.test.ts`）：覆盖每个 flag 的 happy path 与至少一个错误路径
2. **API 客户端单测**（`test/<resource>.test.ts`）：mock `fetch`，断言 URL、method、headers、body
3. **e2e smoke**（`test/e2e/<resource>.test.ts`）：跑通完整链路，环境变量缺失时跳过
