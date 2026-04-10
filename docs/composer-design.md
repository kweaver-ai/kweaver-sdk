# Composer — 多智能体编排功能设计

> 初版设计 | 2026-04-10

## 1. 背景与目标

在 KWeaver Explorer UI 中新增 Composer 功能，允许用户通过一句自然语言描述或选择模板，自动生成多智能体协作编排，并在界面中完成审查、执行和监控。

类似 Petri 的四步流程：**Choose → Generate → Review → Run**。

### 1.1 现有能力

| 能力 | 状态 | 位置 |
|------|------|------|
| Agent CRUD（创建/更新/删除/发布） | ✅ | `src/resources/agents.ts` |
| Agent Chat（单轮/流式/SSE） | ✅ | `src/api/agent-chat.ts` |
| Trace 追踪 | ✅ | `src/api/conversations.ts` |
| Dolphin 编排字段 | ✅ | `AgentConfig.dolphin` + `is_dolphin_mode` |
| Explorer UI（Dashboard/Chat/BKN/Vega） | ✅ | `src/templates/explorer/` |
| SSE streaming + progress 渲染 | ✅ | `explore-chat.ts` + `chat.js` |

### 1.2 三种 Agent 模式

| 模式 | 说明 | 配置方式 |
|------|------|----------|
| **单 Agent (ReAct)** | 一个 agent 自主推理、调工具、迭代 | 普通 Decision Agent |
| **Dolphin 编排** | DPH 脚本定义多 agent 协作流程 | `is_dolphin_mode=1` + `dolphin` 字段存 DPH 内容 |
| **ReAct + 子 Agent** | 主 agent 用 ReAct 推理，按需调度子 agent 作为 skill | Agent-as-Skill 模式 |

---

## 2. 数据模型

### 2.1 ComposerConfig（核心数据结构）

贯穿 wizard 四步的核心数据结构，从 Generate 生成、在 Review 编辑、在 Run 执行。

```typescript
interface ComposerConfig {
  name: string;                   // composer 名称
  description: string;            // composer 描述
  mode: "dolphin" | "react_sub_agents" | "single_react";
  templateId?: string;            // 来源模板 ID（可选）

  // 子 agent 定义（single_react 模式为空）
  agents: ComposerAgentDef[];

  // 主 agent / 编排器
  orchestrator: {
    name: string;
    profile: string;
    system_prompt: string;
    dolphin?: string;             // DPH 脚本内容（dolphin 模式）
    is_dolphin_mode?: number;     // 1 = 开启 dolphin 模式
    llms?: AgentLlmItem[];
  };
}

interface ComposerAgentDef {
  ref: string;                    // DPH 脚本中的引用名，如 "researcher"
  name: string;                   // agent 显示名
  profile: string;                // agent 简介
  system_prompt: string;          // system prompt
  skills?: Record<string, unknown>;
  data_source?: Record<string, unknown>;
}
```

### 2.2 执行状态

```typescript
interface ComposerExecState {
  status: "idle" | "creating" | "running" | "done" | "error";
  createdAgents: Record<string, string>;  // ref → agentId
  orchestratorId?: string;
  conversationId?: string;
  error?: string;
  progress: ComposerExecStep[];
}

interface ComposerExecStep {
  label: string;
  status: "pending" | "running" | "done" | "error";
  detail?: string;
}
```

---

## 3. Wizard UI 设计

### 3.1 整体布局

新增 Explorer tab `#/composer`，顶部水平步骤条（四个圆圈连线），下方内容区，底部导航按钮。

```
┌─ KWeaver Core ──────────────────────────────────────────────┐
│  Dashboard  Decision Agents  BKN  Vega  [Composer]          │
├─────────────────────────────────────────────────────────────┤
│           ① Choose ── ② Generate ── ③ Review ── ④ Run       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│                      [步骤内容区]                             │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  [← Back]                                      [Next →]     │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Step 1: Choose

```
┌───────────────────────────────┬─────────────────────────────┐
│  What do you want to build?   │  Browse templates            │
│                               │                              │
│  ┌─────────────────────────┐  │  ┌──────────┐ ┌───────────┐ │
│  │ Build a code review     │  │  │  Blank   │ │ code-dev  │ │
│  │ composition with three     │  │  │          │ │ 3 stages  │ │
│  │ stages — a designer     │  │  │          │ │ designer, │ │
│  │ creates architecture... │  │  │          │ │ developer,│ │
│  └─────────────────────────┘  │  │          │ │ reviewer  │ │
│                               │  └──────────┘ └───────────┘ │
│  [Next →]                     │                              │
└───────────────────────────────┴─────────────────────────────┘
```

- **左侧**：textarea 输入自然语言描述，点 Next 进入 Step 2（Generate）
- **右侧**：预定义模板卡片网格，点击模板直接跳到 Step 3（Review）
- **Blank 模板**：跳到 Step 3 空白编辑模式

### 3.3 Step 2: Generate

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│    ✅ Analyzing requirements...                              │
│    ⏳ Designing agent roles...                               │
│    ○  Writing orchestration script...                        │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  [meta-agent 思考过程的 streaming 输出]               │    │
│  │  "Based on your description, I'll create three      │    │
│  │   specialized agents: a researcher for..."          │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  [Cancel]                                                   │
└─────────────────────────────────────────────────────────────┘
```

- `POST /api/composer/generate` 发送用户描述
- 服务端通过 meta-agent SSE 流式返回进度
- 最终事件 `type: "composer_config"` 包含生成的 ComposerConfig JSON
- 成功后自动跳转 Step 3

### 3.4 Step 3: Review

```
┌────────────────────────┬────────────────────────────────────┐
│  Composer: code-dev    │  Orchestration Script (DPH)        │
│  Desc: Software dev... │  ┌────────────────────────────────┐│
│                        │  │ @researcher(query=$input)      ││
│  Agents:               │  │   -> research                  ││
│  ┌──────────────────┐  │  │                                ││
│  │ ▶ researcher     │  │  │ @developer(spec=$research)     ││
│  │   System prompt: │  │  │   -> code                      ││
│  │   [editable...]  │  │  │                                ││
│  │                  │  │  │ @reviewer(code=$code)           ││
│  │ ▶ developer      │  │  │   -> review                    ││
│  │   System prompt: │  │  └────────────────────────────────┘│
│  │   [editable...]  │  │                                    │
│  │                  │  │  Mode: [dolphin ▾]                 │
│  │ ▶ reviewer       │  │                                    │
│  │   System prompt: │  │                                    │
│  │   [editable...]  │  │                                    │
│  └──────────────────┘  │                                    │
│  [+ Add Agent]         │                                    │
├────────────────────────┴────────────────────────────────────┤
│  [← Back]                                  [Create & Run →] │
└─────────────────────────────────────────────────────────────┘
```

- **左侧**：agent 列表，每个 agent 可折叠/展开编辑 name、profile、system_prompt
- **右侧**：DPH 脚本编辑器（monospace textarea），dolphin 模式下可编辑
- **底部**：mode 下拉切换（dolphin / react_sub_agents / single_react）
- 支持增删 agent

### 3.5 Step 4: Run

```
┌─────────────────────────────────────────────────────────────┐
│  Creating Composition...                                        │
│  ✅ Created agent: researcher (id: abc123)                   │
│  ✅ Created agent: developer (id: def456)                    │
│  ✅ Created agent: reviewer (id: ghi789)                     │
│  ✅ Created orchestrator: code-dev-main (id: jkl012)         │
│  ⏳ Running composition...                                      │
│                                                              │
│  ── Composer Output ─────────────────────────────────────    │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  [streaming 输出，复用 chat.js 渲染逻辑]               │   │
│  │  - tool call cards                                    │   │
│  │  - progress steps                                     │   │
│  │  - segments                                           │   │
│  │  - markdown 文本                                      │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ── Trace ───────────────────────────────────────────────    │
│  [复用 chat.js 的 trace 渲染]                                │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│  [Cleanup Agents]                        [Open in Chat →]    │
└──────────────────────────────────────────────────────────────┘
```

- **Phase 1**：`POST /api/composer/create` 依次创建子 agents + orchestrator + 发布
- **Phase 2**：`POST /api/composer/run` SSE 流式执行 orchestrator
- **Phase 3**：展示结果 + 自动获取 trace
- **Cleanup**：一键删除所有创建的 agent
- **Open in Chat**：跳转到 `#/chat/{orchestratorId}` 继续对话

---

## 4. API 设计

### 4.1 端点列表

| Method | Path | 说明 | 响应 |
|--------|------|------|------|
| `GET` | `/api/composer/templates` | 获取预定义模板 | `ComposerConfig[]` |
| `POST` | `/api/composer/generate` | NL → ComposerConfig（SSE） | SSE events |
| `POST` | `/api/composer/create` | 创建 agents + orchestrator | `{ orchestratorId, agentIds }` |
| `POST` | `/api/composer/run` | 执行 orchestrator（SSE） | SSE events（复用 chat SSE 格式） |
| `DELETE` | `/api/composer/cleanup` | 删除 agent 列表 | `{ deleted: string[] }` |

### 4.2 SSE 事件格式

**Generate 端点** (`POST /api/composer/generate`):

```
data: {"type": "progress", "step": "analyzing", "message": "Analyzing requirements..."}
data: {"type": "text", "fullText": "...", "currentText": "..."}
data: {"type": "composer_config", "config": { ...ComposerConfig }}
data: {"type": "done"}
data: {"type": "error", "error": "..."}
```

**Run 端点** (`POST /api/composer/run`):

复用 `explore-chat.ts` 的 SSE 格式，事件类型完全一致：
- `text` — streaming 文本
- `progress` — 步骤进度
- `segment` — 分段完成
- `step_meta` — tool/skill 调用元数据
- `conversation_id` — 会话 ID
- `done` — 完成

### 4.3 Create 端点执行逻辑

```
POST /api/composer/create { config: ComposerConfig }

1. for each agent in config.agents:
   a. createAgent({
        name: agent.name,
        profile: agent.profile,
        config: {
          input: { fields: [{ name: "user_input", type: "string" }] },
          output: { default_format: "markdown" },
          system_prompt: agent.system_prompt,
          skills: agent.skills,
          data_source: agent.data_source,
          llms: config.orchestrator.llms  // 继承主 agent LLM 配置
        }
      })
   b. publishAgent(agentId)
   c. 记录 ref → { id, key }

2. 处理 DPH 脚本：
   - 将 @ref 引用替换为实际 agent key（如 @researcher → @agent_key_xxx）

3. createAgent({
     name: config.orchestrator.name,
     profile: config.orchestrator.profile,
     config: {
       system_prompt: config.orchestrator.system_prompt,
       dolphin: processedDphScript,
       is_dolphin_mode: 1,
       llms: config.orchestrator.llms
     }
   })

4. publishAgent(orchestratorId)

5. return { orchestratorId, agentIds: { ref: id, ... } }
```

---

## 5. Meta-Agent 生成策略

### 5.1 方案选择

初版采用**方案 B：硬编码 system prompt**，服务端用一个临时 agent 对话来生成 ComposerConfig。

### 5.2 System Prompt 模板

```
You are a composer architect for KWeaver Decision Agents.
Given a natural-language description, generate a ComposerConfig JSON.

## Agent Modes
- dolphin: DPH script orchestrates agents sequentially/parallel
- react_sub_agents: main agent calls sub-agents as skills on-demand
- single_react: single agent with tools (no sub-agents)

## DPH Script Syntax
- Call sub-agent: @agent_ref(param="value") -> $result
- Prompt block: /prompt/(model="v3") ... -> $var
- Explore block: /explore/(tools=[...]) ... -> $var
- Judge block: /judge/(criteria="...") ... -> $var
- Loop: /for/ $item in $list: @agent($item) >> $results /end/
- Variable reference: $variable_name

## Output Format
Return a single JSON code block:
```json
{
  "name": "composer-name",
  "description": "what it does",
  "mode": "dolphin",
  "agents": [
    {
      "ref": "short_name",
      "name": "Display Name",
      "profile": "Brief description",
      "system_prompt": "You are a ..."
    }
  ],
  "orchestrator": {
    "name": "Orchestrator Name",
    "profile": "Orchestrates the composition",
    "system_prompt": "You orchestrate ...",
    "dolphin": "@agent1(query=$input) -> $r1\n@agent2(data=$r1) -> $r2"
  }
}
```

## Examples

### Example 1: Code Review Composition
Input: "Build a code review composition: designer, developer, reviewer"
(此处嵌入完整示例)

### Example 2: Research Composition
Input: "Research a topic from multiple angles then synthesize"
(此处嵌入完整示例)
```

### 5.3 解析逻辑

从 agent 回复中提取 ` ```json ... ``` ` 代码块，JSON.parse 后验证结构完整性。

---

## 6. 文件变更清单

### 6.1 新增文件

| 文件 | 说明 | 预估行数 |
|------|------|----------|
| `src/templates/explorer/composer.js` | Composer wizard 前端逻辑 | ~500 |
| `src/commands/explore-composer.ts` | Composer API 路由处理 | ~250 |

### 6.2 修改文件

| 文件 | 变更内容 |
|------|----------|
| `src/templates/explorer/index.html` | 第 20 行后添加 `<a class="tab" href="#/composer" data-tab="composer">Composer</a>`；第 33 行后添加 `<script src="/composer.js"></script>` |
| `src/templates/explorer/app.js` | 第 107 行后添加 `else if (route.tab === "composer") { renderComposer($content, route.parts, route.params); }` |
| `src/templates/explorer/style.css` | 添加 `.composer-wizard`、`.composer-stepper`、`.composer-agent-card`、`.composer-dph-editor`、`.composer-exec-log` 等样式 |
| `src/commands/explore.ts` | 第 10 行添加 `import { registerComposerRoutes } from "./explore-composer.js"`；第 167 行后注册 composer 路由 |

---

## 7. 与现有代码的复用

| 现有能力 | 复用位置 |
|----------|----------|
| `explore-chat.ts` SSE streaming 模式 | `explore-composer.ts` 的 generate 和 run 端点完全复用 |
| `chat.js` 的 `chatMarkdown()` | `composer.js` 渲染 agent 输出 |
| `chat.js` 的 progress/tool card 渲染 | `composer.js` Step 4 进度和 tool call 展示 |
| `chat.js` 的 trace 获取和渲染 | `composer.js` Step 4 trace 展示 |
| `app.js` 的 `api()` / `esc()` / `extractList()` | `composer.js` 直接使用这些全局函数 |
| `createAgent` / `publishAgent` / `deleteAgent` API | `explore-composer.ts` 的 create 和 cleanup 端点 |
| Dashboard 的 summary card 样式 | Step 1 模板卡片样式 |

---

## 8. 分阶段实施

### Phase 1: 骨架 + 模板驱动（优先）

目标：用模板跑通 Choose → Review → Run 全流程。

- `composer.js`：wizard 框架 + Step 1 模板选择 + Step 3 静态展示 + Step 4 执行
- `explore-composer.ts`：templates / create / run / cleanup 端点
- 修改 `index.html`、`app.js`、`explore.ts` 接入
- 基础 CSS
- 硬编码 2-3 个模板（Blank、code-dev、research）

### Phase 2: NL 生成

目标：打通自然语言描述 → 自动生成编排的完整流程。

- 实现 `POST /api/composer/generate`（meta-agent SSE）
- Step 2 Generate UI
- Meta-agent prompt 设计与调试
- textarea → generate → review 流程

### Phase 3: 编辑能力 + 打磨

目标：Review 步骤可完整编辑，整体体验打磨。

- Step 3 可编辑（agent 增删改、DPH 脚本编辑）
- Mode 切换 UI
- DPH 简单语法高亮（关键词着色）
- 创建失败回滚
- 更多模板 + 模板管理
- Composer 历史（localStorage）

---

## 9. 验证方式

1. `kweaver explore` 启动后，顶部 tab 栏出现 **Composer**
2. 点击模板 → Review 正确展示 agent 列表和 DPH 脚本 → Create & Run 成功创建 agents
3. Run 阶段 streaming 输出正常，progress steps 和 tool call cards 正确渲染
4. 执行完成后 trace 正确展示
5. Cleanup 成功删除所有创建的 agent
6. （Phase 2）自然语言描述生成合理的 ComposerConfig
7. （Phase 3）Review 中编辑 agent 后执行结果反映修改
