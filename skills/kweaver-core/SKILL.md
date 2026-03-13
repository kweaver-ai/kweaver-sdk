---
name: kweaver-core
description: >-
  通过 kweaver SDK 和 CLI 登录 KWeaver/ADP 平台、管理和查询知识网络、
  执行 Action、与 Decision Agent 对话。
  当用户需要认证、知识网络管理/查询、Agent 对话、Action 执行时使用。
---

# KWeaver Core

KWeaver/ADP 平台的 Python SDK + CLI 工具，覆盖认证、知识网络管理与查询、Action 执行、Agent 对话四大能力。

## 安装

```bash
pip install kweaver-sdk          # 核心 SDK
pip install kweaver-sdk[cli]     # 含 CLI 命令行工具
```

或从源码安装：

```bash
pip install -e /path/to/kweaver-sdk         # 核心
pip install -e "/path/to/kweaver-sdk[cli]"  # 含 CLI
```

需 Python >= 3.10。

通过 skills.sh 安装到 Agent 平台：

```bash
npx skills add <repo>/kweaver-sdk --skill kweaver-core
```

## 使用前提

**使用任何命令或 SDK 调用前，必须先认证。** 若用户未认证，提示先执行 `kweaver auth login <platform-url>`。

登录流程：`kweaver auth login <url>` 会自动注册 OAuth 客户端、打开浏览器、回调获取 token，存储到 `~/.kweaver/`。可用 `--alias` 给平台取别名。与 kweaverc (TypeScript CLI) 共享凭据。

## 认证命令速查

```bash
kweaver auth login <platform-url>
kweaver auth login <platform-url> --alias <name>
kweaver auth status
kweaver auth list
kweaver auth use <platform-url|alias>
kweaver auth logout
```

## 2. 知识网络管理与查询

管理知识网络，查询对象实例、子图、语义搜索。常用：`kweaver kn list` 列出网络；`kweaver query search <kn-id> "<query>"` 语义搜索；`kweaver query instances <kn-id> <ot-id>` 查询对象实例。

详细命令、参数与 SDK 用法见 [references/kn.md](references/kn.md)。

## 3. Action 执行

查询和执行知识网络中的 Action（有副作用）。常用：`kweaver action query <kn-id> <at-id>` 查看 Action 定义；`kweaver action execute <kn-id> <at-id>` 执行。

详细命令与 SDK 用法见 [references/action.md](references/action.md)。

## 4. Agent 对话

与 Decision Agent 进行非交互式多轮对话。常用：`kweaver agent list` 查看可用 Agent；`kweaver agent chat <agent-id> -m "..." ` 发送消息。

详细命令、策略与约束见 [references/agent.md](references/agent.md)。

## SDK vs CLI 的选择

- **CLI**：适合简单查询、快速验证、Shell 脚本集成
- **SDK（Python）**：适合复杂编排、多步流程、需要程序化处理结果的场景

两者共享 `~/.kweaver/` 认证存储，用任一方式登录后另一方直接可用。
