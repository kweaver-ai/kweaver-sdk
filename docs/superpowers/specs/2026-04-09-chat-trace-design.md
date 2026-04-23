# Chat Tab Trace Enhancement — Design Spec

**Date:** 2026-04-09
**Status:** Draft

## Overview

Add real-time progress and post-completion trace display to the Chat tab in `kweaver explore`. During Agent execution, show live progress steps; after completion, show a two-level trace view with call chain and evidence (inputs/outputs).

## Backend Changes

### 1. Stream Progress via SSE (`explore-chat.ts`)

Add `onProgress` callback to `sendChatRequestStream` in the `POST /api/chat/send` handler. When progress updates arrive, emit SSE events:

```
data: {"type":"progress","items":[{"agent_name":"...","skill_info":{"name":"...","type":"..."},"status":"running","description":"..."}]}
```

The `ProgressItem` interface (from `api/agent-chat.ts`) includes:
- `agent_name` — which agent is executing
- `skill_info.name` — skill/tool being called
- `skill_info.type` — skill type
- `status` — `running`, `completed`, `failed`
- `answer` — intermediate result
- `description` — step description

### 2. New Trace Endpoint

```
GET /api/chat/trace?agentId=<id>&conversationId=<id>
```

Calls `getTracesByConversation()` from `api/conversations.ts`. Returns the raw trace JSON from the backend.

## Frontend Changes (`chat.js`)

### 1. Real-time Progress (during streaming)

When a `progress` SSE event arrives:
- Render a step list below the streaming text in the Agent bubble
- Each step shows: skill name + status indicator (spinner for `running`, ✅ for `completed`, ❌ for `failed`)
- Steps update in place as new progress events arrive

### 2. Post-completion Trace (after `done` event)

After receiving `done`:
1. Call `GET /api/chat/trace?agentId=X&conversationId=Y`
2. Replace the progress steps with the full two-level trace view

### 3. Trace Display Structure

```
[Agent reply text]

▼ 执行过程 (3 步, 2.1s)
┣ ✅ 知识检索  320ms
┃   ▶ 查看详情
┃     输入: {"query": "..."}
┃     输出: {"results": [...]}
┣ ✅ 数据分析  1.2s
┗ ✅ 答案生成  580ms
```

**Level 1:** Step name + status icon + duration — always visible when trace is expanded
**Level 2:** Input parameters + output results — collapsed by default, click "查看详情" to expand

### 4. Expand/Collapse Behavior

- **Latest Agent reply:** trace section default expanded
- **Historical replies:** trace section default collapsed, shows summary "执行过程 (N 步, Xs)"
- User can toggle any trace section open/closed

### 5. Status Indicators

| Status | Icon | Visual |
|--------|------|--------|
| `running` | ⏳ | CSS spinner animation |
| `completed` | ✅ | Green |
| `failed` | ❌ | Red |

### 6. Graceful Degradation

- If `onProgress` returns no data: no progress section shown
- If `GET /api/chat/trace` fails: show "Trace unavailable" in gray, don't break the conversation
- If trace returns empty data: collapse the section

## File Changes

| File | Change |
|------|--------|
| `src/commands/explore-chat.ts` | Add `onProgress` callback to SSE stream; add `GET /api/chat/trace` route |
| `src/templates/explorer/chat.js` | Handle `progress` SSE events; render trace UI; call trace API after `done` |
| `src/templates/explorer/style.css` | Add trace-related styles (`.trace-section`, `.trace-step`, `.trace-detail`, spinner) |

## Not In Scope

- Trace data persistence (traces come from backend API, not stored locally)
- Trace comparison across conversations
- Trace export/download
- Span-level waterfall visualization (Jaeger-style)
