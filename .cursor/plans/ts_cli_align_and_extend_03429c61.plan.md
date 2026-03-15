---
name: TS CLI Align and Extend
overview: 两侧对齐与扩展：TypeScript CLI 补充 auth login / env token / agent sessions-history / 行为对齐；Python 新增 context-loader 完整实现 + 补齐 TS 独有 CLI 命令（auth delete、token、kn stats/update、action-log cancel、agent list 分页、call -H/-verbose/-bd）；Python CLI 保留并作为第二入口。按 TESTING.zh.md 规范双侧补充测试。
todos:
  - id: auth-login-syntax
    content: "auth.ts: 新增 auth login <url> 分支，更新 help text"
    status: completed
  - id: auth-env-token
    content: "oauth.ts: ensureValidToken() 优先读取 KWEAVER_TOKEN + KWEAVER_BASE_URL 环境变量"
    status: completed
  - id: agent-sessions-history-api
    content: 新建 src/api/conversations.ts，实现 listConversations 和 listMessages，404 时 graceful fallback
    status: completed
  - id: agent-sessions-history-cmd
    content: "agent.ts: 新增 sessions/history 子命令、parse 函数、help text"
    status: completed
  - id: default-pretty-print
    content: 所有 parse 函数 pretty 默认改为 true，更新 cli.test.ts 中相关断言
    status: completed
  - id: bkn-delete-confirm
    content: "bkn.ts: parseBknDeleteArgs 新增 --yes 字段，runBknDeleteCommand 加确认提示"
    status: completed
  - id: action-execute-wait
    content: "bkn.ts: action-type execute 新增 --wait/--no-wait --timeout，执行后轮询 action-execution get"
    status: completed
  - id: parity-test-matrix
    content: 建立功能等价测试矩阵：每个命令/功能在 Python（pytest）和 TypeScript（node:test）都有对等测试用例，相同 mock 响应体、相同预期输出，确保双侧行为等价
    status: cancelled
  - id: makefile-and-tests
    content: 新增 TS Makefile（test/lint/ci），新增 test/agent.test.ts，更新 cli.test.ts；Python 补充 tests/unit/test_context_loader.py 和 test_cli.py 新命令测试
    status: completed
  - id: python-context-loader-resource
    content: 新建 src/kweaver/resources/context_loader.py：MCP JSON-RPC 客户端，实现 kn_search / query_object_instance / query_instance_subgraph / get_logic_properties_values / get_action_info / list_tools / list_resources，含 session 缓存
    status: completed
  - id: python-context-loader-store
    content: src/kweaver/config/store.py：新增 context-loader config 读写方法（load_context_loader_config / save_context_loader_config / add_context_loader_entry / set_current_context_loader），兼容 TS context-loader.json 格式
    status: completed
  - id: python-context-loader-cli
    content: 新建 src/kweaver/cli/context_loader.py：context-loader 命令组（config set/use/list/show、tools、kn-search、query-object-instance、query-instance-subgraph、get-logic-properties、get-action-info），注册到 main.py
    status: completed
  - id: python-align-ts-auth-delete
    content: src/kweaver/cli/auth.py：新增 auth delete <platform> 命令，对齐 TS auth delete
    status: completed
  - id: python-align-ts-token
    content: 新建 src/kweaver/cli/token.py：token 命令，打印当前 access token（从 PlatformStore 读取，必要时刷新）
    status: completed
  - id: python-align-ts-kn-commands
    content: src/kweaver/cli/kn.py：新增 kn stats、kn update 子命令；新增 kn list 的 sort/direction/offset/limit/tag/name-pattern 等分页参数；新增 kn action-log cancel、action-execution get 子命令
    status: completed
  - id: python-align-ts-agent-list
    content: src/kweaver/cli/agent.py：agent list 新增服务端分页/过滤参数（--size、--pagination-marker、--category-id 等），对齐 TS agent list
    status: completed
  - id: python-align-ts-call
    content: src/kweaver/cli/call.py：新增 -H/--header（可重复）、--verbose（打印请求信息到 stderr）、-bd/--biz-domain 参数，对齐 TS call
    status: completed
  - id: python-tests-context-loader
    content: 新建 tests/unit/test_context_loader.py：使用 MockTransport 测试 ContextLoaderResource 的各方法（session 初始化、kn_search、query_object_instance 等），覆盖 404 graceful fallback 场景
    status: completed
  - id: python-tests-new-cli
    content: 更新 tests/unit/test_cli.py：新增 auth delete、token、kn stats/update、context-loader config/kn-search 等命令的 CliRunner 测试
    status: completed
isProject: false
---

# TypeScript CLI 对齐与扩展

## 变更范围

### TypeScript (`/Users/cx/Work/kweaver-caller/`)

#### 1. Auth: 补充 `auth login <url>` 语法 + 环境变量 Token

`**[src/commands/auth.ts](src/commands/auth.ts)**`

在 `runAuthCommand()` 中新增 `target === "login"` 分支，将 `rest[0]` 作为 URL，`rest.slice(1)` 作为其余参数，路由到与 `auth <url>` 相同的 login 逻辑：

```typescript
// 新增：auth login <url> 语法
if (target === "login") {
  const url = rest[0];
  if (!url) { console.error("Usage: kweaver auth login <platform-url>"); return 1; }
  return runAuthCommand([url, ...rest.slice(1)]);
}
```

同时更新 help text 和 `--help` 输出，增加 `kweaver auth login <url>` 一行。

`**[src/auth/oauth.ts](src/auth/oauth.ts)**`

在 `ensureValidToken()` 开头检查环境变量，与 Python `TokenAuth` 对齐：

```typescript
export async function ensureValidToken(): Promise<{ baseUrl: string; accessToken: string }> {
  const envToken = process.env.KWEAVER_TOKEN;
  const envBaseUrl = process.env.KWEAVER_BASE_URL;
  if (envToken && envBaseUrl) {
    return { baseUrl: normalizeBaseUrl(envBaseUrl), accessToken: envToken };
  }
  // ... 原有逻辑
}
```

---

#### 2. Agent: 新增 `sessions` 和 `history` 子命令

`**[src/api/conversations.ts](src/api/conversations.ts)`（新文件）**

```typescript
export interface ListConversationsOptions {
  baseUrl: string; accessToken: string;
  agentId: string; businessDomain?: string; limit?: number;
}
export interface ListMessagesOptions {
  baseUrl: string; accessToken: string;
  conversationId: string; businessDomain?: string; limit?: number;
}
export async function listConversations(opts: ListConversationsOptions): Promise<string>
export async function listMessages(opts: ListMessagesOptions): Promise<string>
```

调用路径（REST 端点参考 agent-app 服务，如 404 则返回 `[]`）：

- 会话列表：`GET /api/agent-app/v1/app/{agentId}/conversations`
- 消息历史：`GET /api/agent-app/v1/conversations/{conversationId}/messages`

两个函数均对 404/错误做 graceful fallback（返回空数组字符串），因部分环境可能未部署这些端点。

`**[src/commands/agent.ts](src/commands/agent.ts)**`

新增两个 parse 函数和两个 run 函数：

- `parseAgentSessionsArgs(args)` → `{ agentId, businessDomain, limit, pretty }`
- `parseAgentHistoryArgs(args)` → `{ conversationId, businessDomain, limit, pretty }`

在 `runAgentCommand()` 中新增分支：

```typescript
if (subcommand === "sessions") return runAgentSessionsCommand(rest);
if (subcommand === "history")  return runAgentHistoryCommand(rest);
```

更新 help text 增加：

```
  sessions <agent_id>                List all conversations for an agent
       [--limit n] [-bd domain] [--pretty]
  history <conversation_id>          Show message history for a conversation
       [--limit n] [-bd domain] [--pretty]
```

---

#### 3. 行为对齐

**3a. 默认 pretty-print（对齐 Python 始终 indent=2 输出）**

所有 parse 函数中 `let pretty = false` 改为 `let pretty = true`。影响文件：

- `src/commands/agent.ts` — `parseAgentListArgs`、`parseAgentSessionsArgs`、`parseAgentHistoryArgs`
- `src/commands/bkn.ts` — 所有 `parse*Args` 函数
- `src/commands/call.ts` — `parseCallArgs`

`--pretty` flag 保留，意义变为"保持 pretty（已默认）"；如需紧凑输出，可加 `--compact`（可选，不强制实现）。

**3b. `bkn delete` 删除确认（对齐 Python `--yes` 行为）**

`parseBknDeleteArgs()` 新增 `yes: boolean` 字段：

```typescript
if (arg === "--yes" || arg === "-y") { yes = true; continue; }
// 默认 yes = false
```

`runBknDeleteCommand()` 中，若 `!yes`，从 stdin 读取确认：

```
Delete knowledge network kn-123? [y/N] _
```

**3c. `bkn action-type execute --wait` 等待轮询（对齐 Python `action execute --wait`）**

`parseBknActionTypeExecuteArgs()` 新增：

- `--wait / --no-wait`（默认 `--wait`）
- `--timeout <seconds>`（默认 300）

执行后，若 `wait=true`，轮询 `bkn action-execution get <kn-id> <exec-id>`，直到状态为终态（`SUCCESS`/`FAILED`/`CANCELLED`），或超时报错。

---

#### 4. 测试（严格遵循 TESTING.zh.md 规范 + 双侧功能等价保证）

##### 4.0 功能等价原则

**核心约束**：Python 和 TypeScript 对同一功能的测试必须覆盖相同的场景，使用相同的 mock 响应体，验证等价的输出格式。

等价规则：

- **相同 mock 响应体**：Python `MockTransport` 和 TypeScript `globalThis.fetch` mock 返回相同 JSON 结构
- **相同命令语义**：相同 flag 名称、相同默认值、相同错误提示
- **相同输出格式**：两侧均 pretty-print JSON（`indent=2`），字段顺序可差异，但字段集合一致
- **例外（不要求等价）**：交互式 TUI（TS 独有）、流式渲染细节（TS 实时 streaming，Python 全量输出）

##### 4.1 功能等价测试矩阵

每行代表一个功能点，两侧都必须有对应的测试用例：


| 功能                                     | Python 测试文件                                   | TypeScript 测试文件                                       | Mock 响应体                                                       |
| -------------------------------------- | --------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------- |
| `auth login`                           | `test_cli.py::test_auth_login_`*              | `cli.test.ts::login with --no-open`                   | OAuth `/oauth2/clients`、`/oauth2/token`                        |
| `auth status`                          | `test_cli.py::test_auth_status_`*             | `cli.test.ts::formatAuthStatusSummary` *              | — (store 直读)                                                   |
| `auth list`                            | `test_cli.py::test_auth_list_`*               | `cli.test.ts::run auth list`                          | — (store 直读)                                                   |
| `auth delete`                          | `test_cli.py::test_auth_delete_`*             | `cli.test.ts::run auth delete removes platform`       | —                                                              |
| `token`                                | `test_cli.py::test_token_*`                   | `cli.test.ts::ensureValidToken env var *`             | — (store 直读)                                                   |
| `agent list`                           | `test_agents.py::test_agent_list_*`           | `cli.test.ts::parseAgentListArgs *`                   | `POST /api/agent-factory/v3/published/agent`                   |
| `agent chat -m`                        | `test_agents.py::test_chat_*`                 | `agent-chat.test.ts::sendChatRequest *`               | `POST /api/agent-app/.../chat/completion`                      |
| `agent sessions`                       | `test_agents.py::test_agent_sessions_*`       | `agent.test.ts::parseAgentSessionsArgs *`             | `GET /api/agent-app/.../conversations`                         |
| `agent history`                        | `test_agents.py::test_agent_history_*`        | `agent.test.ts::parseAgentHistoryArgs *`              | `GET /api/agent-app/.../conversations/.../messages`            |
| `bkn/kn list`                          | `test_knowledge_networks.py::test_list_*`     | `cli.test.ts::parseBknListArgs *`                     | `GET /api/ontology-manager/.../knowledge-networks`             |
| `bkn/kn get`                           | `test_knowledge_networks.py::test_get_*`      | `cli.test.ts::parseBknGetArgs *`                      | `GET /api/ontology-manager/.../knowledge-networks/{id}`        |
| `bkn/kn delete --yes`                  | `test_knowledge_networks.py::test_delete_*`   | `cli.test.ts::parseBknDeleteArgs --yes *`             | `DELETE /api/ontology-manager/...`                             |
| `bkn/kn stats`                         | `test_knowledge_networks.py::test_stats_*`    | *(待补充)*                                               | `GET .../statistics`                                           |
| `bkn/kn action-type execute --wait`    | `test_action_types.py::test_execute_wait_`*   | `cli.test.ts::parseBknActionTypeExecuteArgs --wait` * | `POST .../action-types/.../execute` + `GET .../execution/{id}` |
| `bkn/kn action-log cancel`             | `test_action_types.py::test_cancel_`*         | *(待补充)*                                               | `POST .../action-logs/{id}/cancel`                             |
| `context-loader config set/show`       | `test_context_loader.py::test_config_`*       | `cli.test.ts::run context-loader config set use list` | — (store 直读)                                                   |
| `context-loader kn-search`             | `test_context_loader.py::test_kn_search_`*    | `context-loader.test.ts::kn-search` *                 | MCP `tools/call` (`kn_search`)                                 |
| `context-loader query-object-instance` | `test_context_loader.py::test_query_object_`* | `context-loader.test.ts::query-object-instance `*     | MCP `tools/call` (`query_object_instance`)                     |
| `call -H --verbose`                    | `test_cli.py::test_call_*`                    | `cli.test.ts::parseCallArgs *`                        | 任意 GET/POST                                                    |
| `KWEAVER_TOKEN env var`                | `test_cli.py::test_env_token_*`               | `cli.test.ts::ensureValidToken env var *`             | —                                                              |


##### 4.2 共享 Mock 响应体规范

以下 JSON 结构在双侧测试中保持一致（避免一侧测试通过但另一侧因字段名不同而失败）：

**Agent List 响应：**

```json
{
  "entries": [
    { "id": "agent-1", "name": "Agent A", "description": "Desc A" },
    { "id": "agent-2", "name": "Agent B", "description": "" }
  ]
}
```

**Agent Chat 响应：**

```json
{
  "conversation_id": "conv_123",
  "final_answer": { "answer": { "text": "Hello back!" } }
}
```

**Knowledge Network 列表响应：**

```json
{
  "entries": [
    { "id": "kn-1", "name": "Network A", "comment": "Desc A" }
  ],
  "total_count": 1
}
```

**MCP initialize 响应（context-loader session）：**

```
HTTP 200, Header: MCP-Session-Id: session-abc123
Body: {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05","capabilities":{}}}
```

**MCP tools/call 响应（kn_search）：**

```json
{
  "jsonrpc": "2.0", "id": 2,
  "result": {
    "content": [{ "type": "text", "text": "{\"object_types\":[],\"relation_types\":[]}" }]
  }
}
```

**Conversations 列表响应（sessions / graceful 404）：**

```json
[{ "id": "conv-1", "agent_id": "agent-123" }]
```

404 时两侧均返回 `[]`（空数组）。

##### 4.3 Makefile（MUST 要求：M1-M5）

`**[Makefile](Makefile)`（新文件，在 TypeScript 项目根目录）**

```makefile
.PHONY: test test-cover lint ci

# M2/M5: make test — UT，无外部依赖，全 mock，< 60s
test:
	node --import tsx --test "test/**/*.test.ts"

# test-cover: UT + 覆盖率报告，输出到 test-result/
test-cover:
	@mkdir -p test-result
	node --import tsx \
		--experimental-test-coverage \
		--test-reporter=tap \
		--test-reporter-destination=test-result/tap.txt \
		--test-reporter=spec \
		--test-reporter-destination=stdout \
		"test/**/*.test.ts"

# M4: lint — TypeScript 类型检查（静态检查，无外部依赖）
lint:
	npx tsc --noEmit -p tsconfig.json

# M3: ci — lint + test-cover
ci: lint test-cover
```

##### 4.2 `.gitignore` 补充（M6）

在项目根 `.gitignore` 中新增：

```
test-result/
```

##### 4.3 测试隔离机制

参考现有测试的隔离方式（蓝本：`test/cli.test.ts`、`test/agent-chat.test.ts`）：

- **HTTP mock**: 替换 `globalThis.fetch` → 测试结束后还原（`finally` 块）
- **Config store mock**: `process.env.KWEAVERC_CONFIG_DIR = mkdtempSync(...)` → 每个需要 store 的测试使用独立临时目录
- **Env var mock**: 测试前设置 `process.env.KWEAVER_TOKEN`，`finally` 中删除（`delete process.env.KWEAVER_TOKEN`）
- **标准入口**: 全部通过 `node --import tsx --test` 运行，`make test` 无外部依赖即可通过

##### 4.4 `test/cli.test.ts` 修改（现有文件）

**更新受 pretty-print 默认值影响的断言**（影响以下测试）：


| 测试名称                                            | 修改前                                  | 修改后                                 |
| ----------------------------------------------- | ------------------------------------ | ----------------------------------- |
| `parseCallArgs parses curl-style...`            | `assert.equal(parsed.pretty, false)` | `assert.equal(parsed.pretty, true)` |
| `parseBknListArgs parses flags with defaults`   | `assert.equal(opts.pretty, false)`   | `assert.equal(opts.pretty, true)`   |
| `parseAgentListArgs parses flags with defaults` | `assert.equal(opts.pretty, false)`   | `assert.equal(opts.pretty, true)`   |


**新增测试（追加到文件末尾）：**

```typescript
// auth login <url> 语法路由
test("run auth login <url> is equivalent to auth <url>", async () => {
  // 验证 runAuthCommand(["login", "bad-url"]) 与 runAuthCommand(["bad-url"]) 行为一致
  // 使用空 configDir，均因无 OAuth server 返回失败（exit code 1）
  // 目的：验证路由正确，不是测试完整登录流程
});

// 环境变量 Token auth
test("ensureValidToken returns env token when KWEAVER_TOKEN and KWEAVER_BASE_URL are set", async () => {
  process.env.KWEAVER_TOKEN = "env-token-123";
  process.env.KWEAVER_BASE_URL = "https://env.example.com/";
  try {
    const { ensureValidToken } = await import("../src/auth/oauth.js");
    const result = await ensureValidToken();
    assert.equal(result.accessToken, "env-token-123");
    assert.equal(result.baseUrl, "https://env.example.com"); // 去掉尾部斜杠
  } finally {
    delete process.env.KWEAVER_TOKEN;
    delete process.env.KWEAVER_BASE_URL;
  }
});

// bkn delete --yes 跳过确认
test("parseBknDeleteArgs parses --yes flag to skip confirmation", () => {
  const opts = parseBknDeleteArgs(["kn-123", "--yes"]);
  assert.equal(opts.knId, "kn-123");
  assert.equal(opts.yes, true);
});

test("parseBknDeleteArgs defaults yes to false", () => {
  const opts = parseBknDeleteArgs(["kn-123"]);
  assert.equal(opts.yes, false);
});

test("parseBknDeleteArgs accepts -y shorthand", () => {
  const opts = parseBknDeleteArgs(["kn-123", "-y"]);
  assert.equal(opts.yes, true);
});

// action-type execute --wait/--no-wait flags
test("parseBknActionTypeExecuteArgs defaults to wait=true timeout=300", () => {
  const opts = parseBknActionTypeExecuteArgs(["kn-123", "at-456", "{}"]);
  assert.equal(opts.wait, true);
  assert.equal(opts.timeout, 300);
});

test("parseBknActionTypeExecuteArgs parses --no-wait", () => {
  const opts = parseBknActionTypeExecuteArgs(["kn-123", "at-456", "{}", "--no-wait"]);
  assert.equal(opts.wait, false);
});

test("parseBknActionTypeExecuteArgs parses --timeout", () => {
  const opts = parseBknActionTypeExecuteArgs(["kn-123", "at-456", "{}", "--timeout", "60"]);
  assert.equal(opts.timeout, 60);
});
```

##### 4.5 `test/agent.test.ts`（新文件）

测试蓝本：参考 `test/agent-chat.test.ts`（fetch mock 写法）和 `test/cli.test.ts`（store + importModule 写法）。

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  parseAgentSessionsArgs,
  parseAgentHistoryArgs,
} from "../src/commands/agent.js";
import {
  listConversations,
  listMessages,
} from "../src/api/conversations.js";

const originalFetch = globalThis.fetch;

function createConfigDir(): string {
  return mkdtempSync(join(tmpdir(), "kweaverc-agent-"));
}

async function importCliModule(configDir: string) {
  process.env.KWEAVERC_CONFIG_DIR = configDir;
  const moduleUrl = pathToFileURL(join(process.cwd(), "src/cli.ts")).href;
  return import(`${moduleUrl}?t=${Date.now()}-${Math.random()}`);
}

async function importStoreModule(configDir: string) {
  process.env.KWEAVERC_CONFIG_DIR = configDir;
  const moduleUrl = pathToFileURL(join(process.cwd(), "src/config/store.ts")).href;
  return import(`${moduleUrl}?t=${Date.now()}-${Math.random()}`);
}

// ── parseAgentSessionsArgs ──────────────────────────────────────────────────

test("parseAgentSessionsArgs requires agent_id", () => {
  assert.throws(() => parseAgentSessionsArgs([]), /Missing agent_id/);
});

test("parseAgentSessionsArgs parses positional agent_id", () => {
  const opts = parseAgentSessionsArgs(["agent-123"]);
  assert.equal(opts.agentId, "agent-123");
  assert.equal(opts.businessDomain, "bd_public");
  assert.equal(opts.pretty, true);         // 默认 pretty=true
  assert.equal(opts.limit, undefined);
});

test("parseAgentSessionsArgs parses --limit and -bd", () => {
  const opts = parseAgentSessionsArgs(["agent-123", "--limit", "10", "-bd", "bd_enterprise"]);
  assert.equal(opts.limit, 10);
  assert.equal(opts.businessDomain, "bd_enterprise");
});

test("parseAgentSessionsArgs throws on unknown flag", () => {
  assert.throws(() => parseAgentSessionsArgs(["agent-123", "--unknown"]), /Unsupported/);
});

// ── parseAgentHistoryArgs ───────────────────────────────────────────────────

test("parseAgentHistoryArgs requires conversation_id", () => {
  assert.throws(() => parseAgentHistoryArgs([]), /Missing conversation_id/);
});

test("parseAgentHistoryArgs parses positional conversation_id", () => {
  const opts = parseAgentHistoryArgs(["conv-abc"]);
  assert.equal(opts.conversationId, "conv-abc");
  assert.equal(opts.pretty, true);
  assert.equal(opts.limit, undefined);
});

test("parseAgentHistoryArgs parses --limit", () => {
  const opts = parseAgentHistoryArgs(["conv-abc", "--limit", "20"]);
  assert.equal(opts.limit, 20);
});

test("parseAgentHistoryArgs throws on unknown flag", () => {
  assert.throws(() => parseAgentHistoryArgs(["conv-abc", "--unknown"]), /Unsupported/);
});

// ── listConversations API (fetch mock) ─────────────────────────────────────

test("listConversations returns body on 200", { concurrency: false }, async () => {
  const payload = [{ id: "conv-1", agent_id: "agent-123" }];
  globalThis.fetch = async () =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  try {
    const result = await listConversations({
      baseUrl: "https://dip.aishu.cn",
      accessToken: "token-abc",
      agentId: "agent-123",
    });
    assert.deepEqual(JSON.parse(result), payload);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("listConversations returns empty array on 404", { concurrency: false }, async () => {
  globalThis.fetch = async () => new Response("Not Found", { status: 404 });
  try {
    const result = await listConversations({
      baseUrl: "https://dip.aishu.cn",
      accessToken: "token-abc",
      agentId: "agent-123",
    });
    assert.deepEqual(JSON.parse(result), []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ── listMessages API (fetch mock) ───────────────────────────────────────────

test("listMessages returns body on 200", { concurrency: false }, async () => {
  const payload = [{ id: "msg-1", role: "user", content: "hello" }];
  globalThis.fetch = async () =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  try {
    const result = await listMessages({
      baseUrl: "https://dip.aishu.cn",
      accessToken: "token-abc",
      conversationId: "conv-abc",
    });
    assert.deepEqual(JSON.parse(result), payload);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("listMessages returns empty array on 404", { concurrency: false }, async () => {
  globalThis.fetch = async () => new Response("Not Found", { status: 404 });
  try {
    const result = await listMessages({
      baseUrl: "https://dip.aishu.cn",
      accessToken: "token-abc",
      conversationId: "conv-abc",
    });
    assert.deepEqual(JSON.parse(result), []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ── agent sessions / history via CLI (store + fetch mock) ──────────────────

test("run agent sessions prints conversations for agent", { concurrency: false }, async () => {
  const configDir = createConfigDir();
  const store = await importStoreModule(configDir);
  store.saveClientConfig({
    baseUrl: "https://dip.aishu.cn",
    clientId: "c", clientSecret: "s",
    redirectUri: "http://127.0.0.1:9010/cb",
    logoutRedirectUri: "http://127.0.0.1:9010/logout",
    scope: "openid",
  });
  store.saveTokenConfig({
    baseUrl: "https://dip.aishu.cn",
    accessToken: "token-test",
    tokenType: "bearer",
    scope: "openid",
    obtainedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  });
  store.setCurrentPlatform("https://dip.aishu.cn");

  globalThis.fetch = async () =>
    new Response(JSON.stringify([{ id: "conv-1", agent_id: "agent-abc" }]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  try {
    const cli = await importCliModule(configDir);
    const code = await cli.run(["agent", "sessions", "agent-abc"]);
    assert.equal(code, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("run agent history prints messages for conversation", { concurrency: false }, async () => {
  const configDir = createConfigDir();
  const store = await importStoreModule(configDir);
  store.saveClientConfig({
    baseUrl: "https://dip.aishu.cn",
    clientId: "c", clientSecret: "s",
    redirectUri: "http://127.0.0.1:9010/cb",
    logoutRedirectUri: "http://127.0.0.1:9010/logout",
    scope: "openid",
  });
  store.saveTokenConfig({
    baseUrl: "https://dip.aishu.cn",
    accessToken: "token-test",
    tokenType: "bearer",
    scope: "openid",
    obtainedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  });
  store.setCurrentPlatform("https://dip.aishu.cn");

  globalThis.fetch = async () =>
    new Response(JSON.stringify([{ id: "msg-1", role: "user", content: "hi" }]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  try {
    const cli = await importCliModule(configDir);
    const code = await cli.run(["agent", "history", "conv-abc"]);
    assert.equal(code, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("run agent shows sessions and history in help text", async () => {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  try {
    const { runAgentCommand } = await import("../src/commands/agent.js");
    await runAgentCommand([]);
    const help = lines.join("\n");
    assert.ok(help.includes("sessions"), "help should list sessions subcommand");
    assert.ok(help.includes("history"), "help should list history subcommand");
  } finally {
    console.log = originalLog;
  }
});
```

##### 4.6 可验证规则对照（TESTING.zh.md §8）


| 规则                                 | 验证方式                                  | 状态  |
| ---------------------------------- | ------------------------------------- | --- |
| M1: Makefile 存在                    | `test -f Makefile`                    | 新增  |
| M2: `test` target                  | `grep -q '^test:' Makefile`           | 新增  |
| M3: `ci` target                    | `grep -q '^ci:' Makefile`             | 新增  |
| M4: `lint` target                  | `grep -q '^lint:' Makefile`           | 新增  |
| M5: `make test` 无外部依赖              | 全 fetch mock，`KWEAVERC_CONFIG_DIR` 隔离 | 已满足 |
| M6: `test-result/` in `.gitignore` | `grep -rq 'test-result' .gitignore`   | 新增  |


---

### Python (`/Users/cx/Work/kweaver-ai/kweaver-sdk/`)

`**pyproject.toml` 保持不变**，Python CLI 入口保留作为第二入口（用于测试和开发）。

---

#### 5. Context Loader Resource（新文件）

`**[src/kweaver/resources/context_loader.py](src/kweaver/resources/context_loader.py)`**

MCP JSON-RPC 2.0 客户端，与 TypeScript `src/api/context-loader.ts` 对等：

```python
class ContextLoaderResource:
    """MCP context-loader client over HTTP (JSON-RPC 2.0)."""

    MCP_PROTOCOL_VERSION = "2024-11-05"
    _session_cache: dict[str, str] = {}  # (mcp_url, kn_id) → session_id

    def __init__(self, http: HttpClient, mcp_url: str, kn_id: str) -> None: ...

    # Session management（内部）
    def _ensure_session(self) -> str: ...  # initialize + notifications/initialized

    # Layer 1
    def kn_search(self, query: str, *, only_schema: bool = False) -> dict: ...
    def kn_schema_search(self, query: str, *, max_concepts: int = 10) -> dict: ...

    # Layer 2
    def query_object_instance(self, ot_id: str, condition: dict, *, limit: int = 20) -> dict: ...
    def query_instance_subgraph(self, relation_type_paths: list[dict]) -> dict: ...

    # Layer 3
    def get_logic_properties_values(self, ot_id: str, query: str,
        instance_identities: list[dict], properties: list[str]) -> dict: ...
    def get_action_info(self, at_id: str, instance_identity: dict) -> dict: ...

    # MCP introspection
    def list_tools(self) -> dict: ...
    def list_resources(self) -> dict: ...
```

Session 缓存用类变量（per-process），key 为 `f"{mcp_url}:{kn_id}"`，与 TS 逻辑一致。

注册到 `KWeaverClient`：

```python
# _client.py 新增
from kweaver.resources.context_loader import ContextLoaderResource
# __init__ 中按需创建（需要 mcp_url + kn_id，通过 PlatformStore 读取）
```

---

#### 6. PlatformStore context-loader 扩展

`**[src/kweaver/config/store.py](src/kweaver/config/store.py)**`

新增方法，格式与 TS `context-loader.json` 完全兼容：

```python
@dataclass
class ContextLoaderEntry:
    name: str
    kn_id: str

@dataclass
class ContextLoaderConfig:
    configs: list[ContextLoaderEntry]
    current: str  # 当前 entry 名称

class PlatformStore:
    def load_context_loader_config(self, url: str | None = None) -> ContextLoaderConfig | None: ...
    def save_context_loader_config(self, url: str, config: ContextLoaderConfig) -> None: ...
    def add_context_loader_entry(self, url: str, name: str, kn_id: str) -> None: ...
    def set_current_context_loader(self, url: str, name: str) -> None: ...
    def remove_context_loader_entry(self, url: str, name: str) -> None: ...
    def get_current_context_loader_kn(self, url: str | None = None) -> tuple[str, str] | None:
        # returns (mcp_url, kn_id) or None
```

---

#### 7. Context Loader CLI 命令组（新文件）

`**[src/kweaver/cli/context_loader.py](src/kweaver/cli/context_loader.py)**`

Click 命令组，对齐 TS `kweaverc context-loader`：

```
kweaver context-loader config set --kn-id <id> [--name <name>]
kweaver context-loader config use <name>
kweaver context-loader config list
kweaver context-loader config show
kweaver context-loader tools
kweaver context-loader kn-search <query> [--only-schema]
kweaver context-loader query-object-instance '<json>'
kweaver context-loader query-instance-subgraph '<json>'
kweaver context-loader get-logic-properties '<json>'
kweaver context-loader get-action-info '<json>'
```

注册到 `src/kweaver/cli/main.py`：`main.add_command(context_loader_group)`

---

#### 8. Python CLI 补齐 TS 独有命令

`**[src/kweaver/cli/auth.py](src/kweaver/cli/auth.py)**` — 新增：

```
kweaver auth delete <platform>    # 删除平台配置（调用 PlatformStore.delete()）
```

**新建 `[src/kweaver/cli/token.py](src/kweaver/cli/token.py)`**：

```
kweaver token    # 打印当前 access token，必要时刷新（读 PlatformStore）
```

`**[src/kweaver/cli/kn.py](src/kweaver/cli/kn.py)**` — 新增：

```
kweaver kn stats <kn_id>                      # 获取 KN 统计信息
kweaver kn update <kn_id> --name <n> [...]    # 更新 KN 元数据
kweaver kn list --offset N --limit N --sort X --direction asc/desc --tag T --name-pattern P
kweaver kn action-log cancel <kn_id> <log_id>
kweaver kn action-execution get <kn_id> <exec_id>
```

`**[src/kweaver/cli/agent.py](src/kweaver/cli/agent.py)**` — `agent list` 新增参数：

```
--size N / --pagination-marker S / --category-id C / --custom-space-id S / --is-to-square 0|1
```

`**[src/kweaver/cli/call.py](src/kweaver/cli/call.py)**` — 新增：

```
-H/--header "Name: Value"   # 可重复，追加自定义 header
--verbose                   # 打印请求详情到 stderr（method、URL、headers）
-bd/--biz-domain <domain>   # 覆盖 x-business-domain（默认读 KWEAVER_BUSINESS_DOMAIN env）
```

---

#### 9. Python 测试（TESTING.zh.md 规范）

**新建 `[tests/unit/test_context_loader.py](tests/unit/test_context_loader.py)`**

使用现有 `MockTransport`（`tests/conftest.py`）：

```python
# 测试 session 初始化
def test_ensure_session_sends_initialize_and_notification(mock_transport): ...

# 测试 kn_search 调用 tools/call
def test_kn_search_calls_mcp_tool(mock_transport): ...

# 测试 404 graceful fallback（query_object_instance）
def test_query_object_instance_returns_empty_on_404(mock_transport): ...

# 测试 MISSING_INPUT_PARAMS 错误处理
def test_get_logic_properties_raises_on_missing_params(mock_transport): ...

# 测试 session 缓存复用（同 mcp_url+kn_id 只 initialize 一次）
def test_session_is_cached_across_calls(mock_transport): ...
```

**更新 `[tests/unit/test_cli.py](tests/unit/test_cli.py)`**

```python
# 新增 auth delete 测试
def test_auth_delete_removes_platform(cli_runner): ...

# 新增 token 命令测试
def test_token_prints_access_token(cli_runner): ...

# 新增 context-loader config set/show 测试
def test_context_loader_config_set(cli_runner): ...
def test_context_loader_kn_search(cli_runner, mock_transport): ...

# 新增 kn stats / kn action-log cancel 测试
def test_kn_stats(cli_runner, mock_transport): ...
def test_kn_action_log_cancel(cli_runner, mock_transport): ...
```

