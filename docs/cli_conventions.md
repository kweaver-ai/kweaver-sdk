# KWeaver CLI 命令约定

> 本文档定义 `kweaver` CLI 命令的结构、命名与扩展约定。**新增命令前必须先对齐本文档**。

## 1 层级

固定 **2 级**：`kweaver <资源> <动作>`。
- ✅ `kweaver bkn create`
- ✅ `kweaver toolbox publish <id>`
- ❌ `kweaver factory toolbox create`（禁止 3 级分组）
- ❌ `kweaver toolbox <id> tool upload`（禁止 RESTful 嵌套）

## 2 多资源同域

一个域内有多个资源时，**优先在已有顶层命令下用 subcommand 分组**，而不是引入新的顶层命令。已成熟的例子是 `bkn`：

- `kweaver bkn object-type {list,get,create,update,delete,query,properties}`
- `kweaver bkn relation-type {list,get,create,update,delete}`
- `kweaver bkn action-type {list,query,execute}`
- `kweaver bkn action-schedule …`、`bkn action-log …`

形式是 `kweaver <顶层> <子资源> <动作>`，仍属可接受范围（顶层命令依旧是 2 级分发：第二段是子资源名，自身在内部再分发动作）。

只有当**两个资源在概念上彼此独立、其中一个完全可以脱离另一个使用**时，才拆成两个顶层命令。`toolbox` 与 `tool` 即如此：tool 必须属于某个 toolbox（父子关系靠 flag 表达，见 §3），但用户操作 toolbox 时（list/publish/delete）完全不需要触及 tool，反之亦然。

## 3 父子关系

资源间的父子关系通过 **flag** 表达，不做 URL 风格嵌套。
- ✅ `kweaver tool upload --toolbox <box_id> spec.yaml`
- ❌ `kweaver toolbox <box_id> tool upload spec.yaml`

## 4 底层逃生口

`kweaver call` 必须能覆盖任何后端 API（含 multipart 文件上传），保证：
- 缺专用命令时，用户**不必退回 raw `curl` + 手动拼 token**
- 任何新接口可立刻通过 `kweaver call` 调用，专用命令是面向用户体验的糖

具体能力清单见 `kweaver call --help`。

> ⚠️ `kweaver call --help` 与本节描述必须保持同步——新增 `call` 能力时，help 文本与本节同改。

## 5 Subcommand 一致性

每个资源的 subcommand 命名遵循动词约定：
| 动作 | Subcommand | 备注 |
|---|---|---|
| 列举 | `list` | 支持 `--keyword`, `--limit`, `--offset` 等通用过滤 |
| 详情 | `get <id>` | |
| 创建 | `create [args]` | |
| 更新 | `update <id> [args]` | |
| 删除 | `delete <id> [-y\|--yes]` | `-y`/`--yes` 跳过确认 |
| 上传文件 | `upload <file>` | 走 multipart |
| 状态变更 | `<verb>`（如 `publish`, `enable`, `set-status`） | 优先具名动词，回退到 `set-status` |

## 6 通用 flag

**返回 JSON 的命令**应该支持：
- `-bd, --biz-domain <value>` — 覆盖业务域（凡需要打到平台 API 的命令都要支持）
- `--pretty` / `--compact` — 输出格式开关；`--pretty` 默认开启，`--compact` 用于 pipeline 友好输出

**所有命令**应该支持：
- `-h, --help` — 子命令帮助

**不适用的情形**（已有先例）：
- `kweaver token` / `kweaver auth …` — 输出非 JSON、或交互流程，不需要 `--pretty`
- `kweaver agent chat` — 流式文本输出，不需要 `--pretty`
- 部分早期命令（如 `ds get`、`ds delete`）输出已经默认 pretty 且不可关闭——后续重构时统一即可，不阻塞新命令开发

## 7 测试要求

新命令必须包含：
1. **解析器单测**（`test/<cmd>-cmd.test.ts`）：覆盖每个 flag 的 happy path 与至少一个错误路径
2. **API 客户端单测**（`test/<resource>.test.ts`）：mock `fetch`，断言 URL、method、headers、body
3. **e2e smoke**（`test/e2e/<resource>.test.ts`）：跑通完整链路，环境变量缺失时跳过
