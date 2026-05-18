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

## 8 Help 文本格式（MUST）

所有 `--help` / `-h` 输出必须通过 `packages/typescript/src/help/format.ts` 提供的 formatter 渲染，输出统一 gh CLI 风格。**禁止再硬编码大段 help 字符串。**

参考风格：`gh --help` / `gh <command> --help`（[GitHub CLI](https://cli.github.com/manual/)）。

### 8.1 顶层 (`kweaver --help`)

固定结构：

```text
KWeaver SDK — operate KWeaver platform from CLI

USAGE
  kweaver <command> <subcommand> [flags]

CORE COMMANDS
  auth:        一行简介
  agent:       一行简介
  ...

PLATFORM COMMANDS
  model:       一行简介
  ...

ADDITIONAL COMMANDS
  config:      一行简介
  ...

FLAGS
  --base-url <url>   Override platform URL  (env: KWEAVER_BASE_URL)
  --token <value>    Override access token  (env: KWEAVER_TOKEN)
  ...

ENVIRONMENT
  KWEAVER_PROFILE     Isolate active-platform/user state per shell
  ...

EXAMPLES
  $ kweaver auth https://platform.example.com
  $ kweaver agent chat <agent_id> -m "hello"
  $ kweaver bkn build <kn-id> --wait

LEARN MORE
  Use `kweaver <command> --help` for more info
```

要求：

- 顶层**只列 command 名 + 一行简介**，禁止列子命令签名 / flag 细节（下钻到二级）
- 分组语义化：`CORE` / `PLATFORM` / `ADDITIONAL`，新增顶层命令时必须明确归属
- `EXAMPLES` 控制在 3 行，必须是真实可运行命令
- `LEARN MORE` 指向下钻入口

### 8.2 二级 (`kweaver <command> --help`)

固定结构：

```text
<一句话 tagline>

USAGE
  kweaver <command> <subcommand> [flags]

AVAILABLE COMMANDS
  list:    一行说明
  get:     一行说明
  ...

INHERITED FLAGS
  --base-url, --token, --user, --help

EXAMPLES
  $ kweaver <command> list --limit 10

LEARN MORE
  Use `kweaver <command> <subcommand> --help` for flag details
```

要求：

- 子命令列表两列对齐，左列 `name:`，右列描述 ≤ 60 字符
- 子命令数 > 8 时**必须进一步分组**（参考 `skill` 的 Registry / Market / Content / Lifecycle 四组）
- `INHERITED FLAGS` 只列继承自顶层的；本命令独有 flag 下沉到三级

### 8.3 三级 (`kweaver <command> <subcommand> --help`)

固定结构：

```text
<一句话 tagline>

USAGE
  kweaver <command> <subcommand> [args] [flags]

FLAGS
  --foo <value>      Description
  --bar              Boolean flag

EXAMPLES
  $ kweaver <command> <subcommand> --foo bar
```

要求：

- 以下"高频"命令**必须**有完整三级 help：
  - `auth login`
  - `agent chat`
  - `bkn build` / `bkn push` / `bkn pull`
  - `dataflow run`
  - `call`
- 其他三级命令至少打印 `USAGE` 一行
- FLAG 按语义分组渲染（如 `auth login` 分 "Login options" / "TLS options"），调用 `block()` formatter
- EXAMPLES 至少 1 条，覆盖最常见用法

### 8.4 实现规则

新增 / 修改 CLI 命令时必须遵守：

1. **调用 formatter**：`renderHelp({ tagline, usage, sections, flags, environment?, examples, learnMore })`，不准 `console.log("...大字符串...")`
2. **字段缺省传 `undefined`** 而非空字符串
3. **`kweaver help all`** 输出完整签名作迁移期兜底；新增命令时同步追加
4. **行宽 80 列**：formatter 默认 80 列换行；超长描述写多段而不是堆一行
5. **单测**：断言关键 section 标题（`USAGE` / `AVAILABLE COMMANDS` / `FLAGS`）存在，防格式回归

### 8.5 已知例外

- `kweaver dataflow` 用 yargs：必须通过 `.usage()` / `.epilog()` 贴近本规范的视觉，文案保持一致；不强制走 formatter
- `kweaver token`：无 flag，输出 `USAGE` + 一行说明即可
- `kweaver call` / `kweaver curl` 别名：EXAMPLES 段强调 curl-style 用法

### 8.6 PR 自检（CLI 相关 PR 必查）

- [ ] 顶层 / 二级 / 三级 help 均通过 formatter 渲染
- [ ] 顶层无子命令签名泄漏
- [ ] 子命令数 > 8 已分组
- [ ] 高频三级命令有 FLAGS + EXAMPLES
- [ ] `kweaver help all` 已同步
- [ ] 单测断言关键 section 标题
