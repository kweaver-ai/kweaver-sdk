# Chat Trace Enhancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real-time progress steps and post-completion trace display to the Chat tab in kweaver explore.

**Architecture:** Backend adds `onProgress` callback to SSE stream + new trace query endpoint. Frontend handles new SSE event types and renders a two-level trace view inside Agent bubbles.

**Tech Stack:** Node.js HTTP server (existing explore-chat.ts), Vanilla JS frontend (existing chat.js), CSS.

**Spec:** `docs/superpowers/specs/2026-04-09-chat-trace-design.md`

---

### Task 1: Backend — Add progress events to SSE stream

**Files:**
- Modify: `packages/typescript/src/commands/explore-chat.ts`

- [ ] **Step 1: Add `onProgress` callback to `sendChatRequestStream` call**

In `explore-chat.ts`, find the `sendChatRequestStream` call (around line 98). Add the `onProgress` callback that emits SSE events.

Current code:
```typescript
const result = await sendChatRequestStream(
  {
    baseUrl: t.baseUrl,
    accessToken: t.accessToken,
    agentId: agentInfo.id,
    agentKey: agentInfo.key,
    agentVersion: agentInfo.version,
    query: message,
    conversationId,
    stream: true,
    businessDomain,
  },
  {
    onTextDelta: (fullText: string) => {
      const event = JSON.stringify({ type: "text", fullText });
      res.write(`data: ${event}\n\n`);
    },
  },
);
```

Replace with:
```typescript
const result = await sendChatRequestStream(
  {
    baseUrl: t.baseUrl,
    accessToken: t.accessToken,
    agentId: agentInfo.id,
    agentKey: agentInfo.key,
    agentVersion: agentInfo.version,
    query: message,
    conversationId,
    stream: true,
    businessDomain,
  },
  {
    onTextDelta: (fullText: string) => {
      const event = JSON.stringify({ type: "text", fullText });
      res.write(`data: ${event}\n\n`);
    },
    onProgress: (items) => {
      const event = JSON.stringify({ type: "progress", items });
      res.write(`data: ${event}\n\n`);
    },
  },
);
```

- [ ] **Step 2: Build and verify**

```bash
cd packages/typescript && npm run build
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/typescript/src/commands/explore-chat.ts
git commit -m "feat(explore): forward onProgress as SSE events in chat stream"
```

---

### Task 2: Backend — Add trace query endpoint

**Files:**
- Modify: `packages/typescript/src/commands/explore-chat.ts`

- [ ] **Step 1: Add import for `getTracesByConversation`**

At the top of `explore-chat.ts`, add:
```typescript
import { getTracesByConversation } from "../api/conversations.js";
```

- [ ] **Step 2: Add GET /api/chat/trace route**

Inside `registerChatRoutes`, before `return routes;`, add:

```typescript
  // GET /api/chat/trace?agentId=X&conversationId=Y — fetch trace data
  routes.set("GET /api/chat/trace", async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const agentId = url.searchParams.get("agentId") || "";
      const conversationId = url.searchParams.get("conversationId") || "";
      if (!agentId || !conversationId) {
        jsonResponse(res, 400, { error: "agentId and conversationId are required" });
        return;
      }
      const t = await getToken();
      const raw = await getTracesByConversation({
        baseUrl: t.baseUrl,
        accessToken: t.accessToken,
        agentId,
        conversationId,
        businessDomain,
      });
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(raw);
    } catch (error) {
      handleApiError(res, error);
    }
  });
```

Note: `jsonResponse` and `handleApiError` are already imported from `./explore-bkn.js`.

- [ ] **Step 3: Build and verify**

```bash
cd packages/typescript && npm run build
```

- [ ] **Step 4: Commit**

```bash
git add packages/typescript/src/commands/explore-chat.ts
git commit -m "feat(explore): add GET /api/chat/trace endpoint for trace queries"
```

---

### Task 3: Frontend — Handle progress SSE events and render trace

**Files:**
- Modify: `packages/typescript/src/templates/explorer/chat.js`

- [ ] **Step 1: Add progress handling in SSE loop**

In `chatSend()`, find the SSE event handling loop (the `for (const line of lines)` block). After the `if (evt.type === "text")` block and before `else if (evt.type === "done")`, add progress handling:

```javascript
        } else if (evt.type === "progress" && Array.isArray(evt.items)) {
          // Render/update progress steps below the content
          let $trace = assistantDiv.querySelector(".trace-section");
          if (!$trace) {
            $trace = document.createElement("div");
            $trace.className = "trace-section trace-expanded";
            assistantDiv.appendChild($trace);
          }
          $trace.innerHTML = renderProgressSteps(evt.items);
          $messagesEl.scrollTop = $messagesEl.scrollHeight;
```

- [ ] **Step 2: Add `renderProgressSteps` function**

Add this function in chat.js:

```javascript
function renderProgressSteps(items) {
  if (!items || items.length === 0) return "";
  const steps = items.map(item => {
    const name = (item.skill_info && item.skill_info.name) || item.agent_name || "Step";
    const status = (item.status || "running").toLowerCase();
    const icon = status === "completed" || status === "success" ? "✅"
               : status === "failed" || status === "error" ? "❌"
               : '<span class="trace-spinner"></span>';
    const desc = item.description || "";
    return `<div class="trace-step trace-status-${esc(status)}">
      <span class="trace-step-icon">${icon}</span>
      <span class="trace-step-name">${esc(name)}</span>
      ${desc ? `<span class="trace-step-desc">${esc(desc)}</span>` : ""}
    </div>`;
  });
  return `<div class="trace-steps">${steps.join("")}</div>`;
}
```

- [ ] **Step 3: After `done` event, fetch and render full trace**

In the `evt.type === "done"` handler, after persisting the conversation, add trace fetching:

Current code:
```javascript
        } else if (evt.type === "done") {
          chatState.currentConversationId = evt.conversationId || chatState.currentConversationId;
          if (lastText) {
            chatState.conversations[agentId].push({ role: "assistant", text: lastText });
          }
```

Replace with:
```javascript
        } else if (evt.type === "done") {
          chatState.currentConversationId = evt.conversationId || chatState.currentConversationId;
          if (lastText) {
            chatState.conversations[agentId].push({ role: "assistant", text: lastText });
          }
          // Fetch full trace after completion
          const traceConvId = evt.conversationId || chatState.currentConversationId;
          if (traceConvId) {
            fetchAndRenderTrace(assistantDiv, agentId, traceConvId, $messagesEl);
          }
```

- [ ] **Step 4: Add `fetchAndRenderTrace` function**

```javascript
async function fetchAndRenderTrace(bubbleEl, agentId, conversationId, $messagesEl) {
  try {
    const data = await api("GET", `/api/chat/trace?agentId=${enc(agentId)}&conversationId=${enc(conversationId)}`);
    const sessions = extractList(data);
    if (!sessions || sessions.length === 0) return;

    // Take the latest session's spans
    const latestSession = sessions[sessions.length - 1];
    const spans = latestSession.spans || latestSession.steps || latestSession.traces || [];
    if (spans.length === 0) return;

    const totalDuration = spans.reduce((sum, s) => sum + (s.duration_ms || s.duration || 0), 0);
    const totalSec = (totalDuration / 1000).toFixed(1);

    let $trace = bubbleEl.querySelector(".trace-section");
    if (!$trace) {
      $trace = document.createElement("div");
      $trace.className = "trace-section trace-expanded";
      bubbleEl.appendChild($trace);
    }

    $trace.innerHTML = `
      <div class="trace-header" onclick="this.parentElement.classList.toggle('trace-expanded')">
        <span class="trace-toggle">▶</span>
        执行过程 (${spans.length} 步, ${totalSec}s)
      </div>
      <div class="trace-body">
        ${spans.map(span => renderTraceSpan(span)).join("")}
      </div>
    `;

    if ($messagesEl) $messagesEl.scrollTop = $messagesEl.scrollHeight;
  } catch {
    // Trace is best-effort, don't break the conversation
  }
}

function renderTraceSpan(span) {
  const name = span.name || span.skill_name || span.operation_name || "Step";
  const status = (span.status || "completed").toLowerCase();
  const icon = status === "completed" || status === "success" || status === "ok" ? "✅"
             : status === "failed" || status === "error" ? "❌"
             : "⏳";
  const durationMs = span.duration_ms || span.duration || 0;
  const durationLabel = durationMs >= 1000 ? (durationMs / 1000).toFixed(1) + "s" : durationMs + "ms";

  const hasDetail = span.input || span.output || span.args || span.result;
  const detailHtml = hasDetail ? `
    <div class="trace-detail">
      <div class="trace-detail-toggle" onclick="this.parentElement.classList.toggle('trace-detail-expanded')">▶ 查看详情</div>
      <div class="trace-detail-content">
        ${span.input ? `<div class="trace-kv"><span class="trace-kv-label">输入:</span><pre>${esc(typeof span.input === "string" ? span.input : JSON.stringify(span.input, null, 2))}</pre></div>` : ""}
        ${span.args ? `<div class="trace-kv"><span class="trace-kv-label">参数:</span><pre>${esc(typeof span.args === "string" ? span.args : JSON.stringify(span.args, null, 2))}</pre></div>` : ""}
        ${span.output ? `<div class="trace-kv"><span class="trace-kv-label">输出:</span><pre>${esc(typeof span.output === "string" ? span.output : JSON.stringify(span.output, null, 2))}</pre></div>` : ""}
        ${span.result ? `<div class="trace-kv"><span class="trace-kv-label">结果:</span><pre>${esc(typeof span.result === "string" ? span.result : JSON.stringify(span.result, null, 2))}</pre></div>` : ""}
      </div>
    </div>` : "";

  return `<div class="trace-step trace-status-${esc(status)}">
    <span class="trace-step-icon">${icon}</span>
    <span class="trace-step-name">${esc(name)}</span>
    <span class="trace-step-duration">${esc(durationLabel)}</span>
    ${detailHtml}
  </div>`;
}
```

- [ ] **Step 5: Make historical trace sections collapsed by default**

In `renderChatConversation()`, when rendering historical assistant messages, the trace section should be collapsed. The latest message trace is expanded. This is handled by CSS class: `.trace-expanded` shows the body, without it the body is hidden. The `fetchAndRenderTrace` adds `trace-expanded` by default for the streaming bubble. For historical messages, trace sections are not rendered (they're not persisted in `chatState.conversations`), so this is automatically correct — only the current streaming response gets a trace.

- [ ] **Step 6: Build and verify**

```bash
cd packages/typescript && npm run build
```

- [ ] **Step 7: Commit**

```bash
git add packages/typescript/src/templates/explorer/chat.js
git commit -m "feat(explore): render progress steps and trace in chat bubbles"
```

---

### Task 4: CSS — Add trace styles

**Files:**
- Modify: `packages/typescript/src/templates/explorer/style.css`

- [ ] **Step 1: Add trace-related CSS**

Append to `style.css`:

```css
/* ── Trace Section ────────────────────────────────────────────────────────── */

.trace-section {
  margin-top: 12px;
  border-top: 1px solid var(--border);
  padding-top: 8px;
  font-size: 13px;
}

.trace-header {
  cursor: pointer;
  color: var(--text-secondary);
  font-size: 12px;
  padding: 4px 0;
  user-select: none;
}

.trace-header:hover {
  color: var(--text);
}

.trace-toggle {
  display: inline-block;
  transition: transform 0.2s;
  margin-right: 4px;
  font-size: 10px;
}

.trace-expanded .trace-toggle {
  transform: rotate(90deg);
}

.trace-body {
  display: none;
  padding: 4px 0 4px 8px;
}

.trace-expanded .trace-body {
  display: block;
}

.trace-steps {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.trace-step {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  background: var(--bg);
}

.trace-step-icon {
  flex-shrink: 0;
  width: 18px;
  text-align: center;
}

.trace-step-name {
  font-weight: 500;
  color: var(--text);
}

.trace-step-desc {
  color: var(--text-secondary);
  font-size: 12px;
}

.trace-step-duration {
  margin-left: auto;
  color: var(--text-secondary);
  font-size: 12px;
  flex-shrink: 0;
}

.trace-spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: trace-spin 0.8s linear infinite;
}

@keyframes trace-spin {
  to { transform: rotate(360deg); }
}

/* ── Trace Detail (Level 2) ──────────────────────────────────────────────── */

.trace-detail {
  margin-top: 4px;
  margin-left: 24px;
}

.trace-detail-toggle {
  cursor: pointer;
  color: var(--accent);
  font-size: 12px;
  user-select: none;
}

.trace-detail-toggle:hover {
  text-decoration: underline;
}

.trace-detail-content {
  display: none;
  margin-top: 4px;
}

.trace-detail-expanded .trace-detail-content {
  display: block;
}

.trace-kv {
  margin-bottom: 6px;
}

.trace-kv-label {
  font-size: 11px;
  color: var(--text-secondary);
  font-weight: 500;
}

.trace-kv pre {
  margin: 2px 0 0 0;
  padding: 8px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 11px;
  line-height: 1.4;
  overflow-x: auto;
  max-height: 200px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-word;
}
```

- [ ] **Step 2: Build and verify**

```bash
cd packages/typescript && npm run build
```

- [ ] **Step 3: Commit**

```bash
git add packages/typescript/src/templates/explorer/style.css
git commit -m "feat(explore): add trace section CSS styles"
```

---

### Task 5: Test and verify

**Files:**
- Modify: `packages/typescript/test/explore.test.ts` (optional, if adding test)

- [ ] **Step 1: Run full test suite**

```bash
cd packages/typescript && npm test
```
Expected: all tests pass, 0 fail.

- [ ] **Step 2: Build and run manual smoke test**

```bash
cd packages/typescript && npm run build && node dist/cli.js explore --no-open
```

Open `http://localhost:3721/#/chat`, select an agent, send a message. Verify:
1. During streaming: progress steps appear below the response text (if the Agent uses skills)
2. After completion: trace section appears with expandable steps
3. Click "查看详情" on a step: shows input/output
4. Historical messages: trace section is not shown (only current response gets trace)

- [ ] **Step 3: Commit any fixes from smoke test**

```bash
git add -u
git commit -m "fix(explore): address trace rendering issues from smoke test"
```
