# Composer Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Composer tab to KWeaver Explorer that lets users select a multi-agent template, review its agents + DPH script, create the agents on the server, execute the orchestrator with streaming output, and cleanup afterwards.

**Architecture:** New `composer.js` frontend (wizard with 3 active steps: Choose/Review/Run — Generate is Phase 2) + `explore-composer.ts` backend (4 endpoints: templates/create/run/cleanup). The backend uses low-level agent API functions directly (`createAgent`, `publishAgent`, `deleteAgent`, `fetchAgentInfo`, `sendChatRequestStream`). The frontend reuses `chatMarkdown()`, `renderProgressSteps()`, `fetchAndRenderTrace()` from `chat.js` and `api()`/`esc()`/`enc()` from `app.js`.

**Tech Stack:** TypeScript (backend), vanilla JS (frontend), SSE streaming, existing KWeaver agent APIs.

**Spec:** `docs/composer-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/typescript/src/commands/explore-composer.ts` | Create | Backend: templates/create/run/cleanup API endpoints |
| `packages/typescript/src/templates/explorer/composer.js` | Create | Frontend: wizard UI, state management, SSE consumption |
| `packages/typescript/src/templates/explorer/index.html` | Modify | Add Composer tab link + script tag |
| `packages/typescript/src/templates/explorer/app.js` | Modify | Add composer route dispatch |
| `packages/typescript/src/templates/explorer/style.css` | Modify | Add composer-specific styles |
| `packages/typescript/src/commands/explore.ts` | Modify | Import + register composer routes |

---

### Task 1: Wire up the Composer tab (HTML + app.js + explore.ts)

**Files:**
- Modify: `packages/typescript/src/templates/explorer/index.html:19-20,33`
- Modify: `packages/typescript/src/templates/explorer/app.js:105-109`
- Modify: `packages/typescript/src/commands/explore.ts:10,167`
- Create: `packages/typescript/src/commands/explore-composer.ts` (skeleton)
- Create: `packages/typescript/src/templates/explorer/composer.js` (skeleton)

- [ ] **Step 1: Add tab link and script tag to index.html**

In `index.html`, add the Composer tab after the Vega tab (line 20), and add the script after `vega.js` (line 33):

```html
<!-- line 20, after Vega tab -->
<a class="tab" href="#/composer" data-tab="composer">Composer</a>

<!-- line 33, after vega.js script -->
<script src="/composer.js"></script>
```

- [ ] **Step 2: Add route dispatch in app.js**

In `app.js`, add an `else if` branch after the vega branch (around line 107):

```javascript
} else if (route.tab === "composer") {
  if (typeof renderComposer === "function") renderComposer($content, route.parts, route.params);
}
```

- [ ] **Step 3: Create skeleton composer.js**

Create `packages/typescript/src/templates/explorer/composer.js` with a minimal `renderComposer`:

```javascript
/* global api, esc, enc, extractList, navGeneration, chatMarkdown, renderProgressSteps, fetchAndRenderTrace, renderBubble */

// ── Composer state ──────────────────────────────────────────────────────────

const composerState = {
  step: 1,           // 1=Choose, 3=Review, 4=Run (step 2 is Phase 2)
  config: null,      // ComposerConfig
  exec: null,        // execution state
};

// ── Main entry point ────────────────────────────────────────────────────────

// eslint-disable-next-line no-unused-vars
function renderComposer($el, parts, params) {
  $el.innerHTML = '<div class="composer-wizard"><h2>Composer</h2><p>Coming soon...</p></div>';
}
```

- [ ] **Step 4: Create skeleton explore-composer.ts**

Create `packages/typescript/src/commands/explore-composer.ts`:

```typescript
import { IncomingMessage, ServerResponse } from "node:http";
import { type TokenProvider } from "./explore-bkn.js";

export function registerComposerRoutes(
  _getToken: TokenProvider,
  _businessDomain: string,
): Map<string, (req: IncomingMessage, res: ServerResponse) => void> {
  const routes = new Map<string, (req: IncomingMessage, res: ServerResponse) => void>();

  // Endpoints will be added in subsequent tasks

  return routes;
}
```

- [ ] **Step 5: Register composer routes in explore.ts**

In `explore.ts`, add the import (after line 10):

```typescript
import { registerComposerRoutes } from "./explore-composer.js";
```

Add route registration (after line 167, following the vega routes pattern):

```typescript
  // Composer routes
  const composerRoutes = registerComposerRoutes(freshToken, businessDomain);
  for (const [key, handler] of composerRoutes) routes.set(key, handler);
```

- [ ] **Step 6: Build and verify**

Run: `cd packages/typescript && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 7: Commit**

```bash
git add packages/typescript/src/commands/explore-composer.ts \
       packages/typescript/src/templates/explorer/composer.js \
       packages/typescript/src/templates/explorer/index.html \
       packages/typescript/src/templates/explorer/app.js \
       packages/typescript/src/commands/explore.ts
git commit -m "feat(composer): wire up Composer tab skeleton in Explorer"
```

---

### Task 2: Backend — templates endpoint + hardcoded templates

**Files:**
- Modify: `packages/typescript/src/commands/explore-composer.ts`

- [ ] **Step 1: Add templates data and GET endpoint**

Replace the contents of `explore-composer.ts` with the full templates endpoint:

```typescript
import { IncomingMessage, ServerResponse } from "node:http";
import { jsonResponse, type TokenProvider } from "./explore-bkn.js";

// ── ComposerConfig types (runtime, no separate file needed) ─────────────────

interface ComposerAgentDef {
  ref: string;
  name: string;
  profile: string;
  system_prompt: string;
}

interface ComposerConfig {
  name: string;
  description: string;
  mode: "dolphin" | "react_sub_agents" | "single_react";
  templateId?: string;
  agents: ComposerAgentDef[];
  orchestrator: {
    name: string;
    profile: string;
    system_prompt: string;
    dolphin?: string;
    is_dolphin_mode?: number;
  };
}

// ── Hardcoded templates ─────────────────────────────────────────────────────

const TEMPLATES: ComposerConfig[] = [
  {
    name: "Blank",
    description: "Start from scratch — add your own agents and orchestration script.",
    mode: "dolphin",
    templateId: "blank",
    agents: [],
    orchestrator: {
      name: "Orchestrator",
      profile: "Orchestrates agent collaboration",
      system_prompt: "You orchestrate a multi-agent workflow.",
      dolphin: "",
      is_dolphin_mode: 1,
    },
  },
  {
    name: "Code Development",
    description: "Three-stage software development: architect designs, developer implements, reviewer validates.",
    mode: "dolphin",
    templateId: "code-dev",
    agents: [
      {
        ref: "architect",
        name: "Architect",
        profile: "Designs software architecture and specifications",
        system_prompt: "You are a software architect. Given a requirement, produce a clear technical design with component breakdown, data flow, and API contracts. Be concise and precise.",
      },
      {
        ref: "developer",
        name: "Developer",
        profile: "Implements code based on architecture specs",
        system_prompt: "You are a senior developer. Given a technical design, write clean, well-structured code that follows the spec exactly. Include brief inline comments for non-obvious logic.",
      },
      {
        ref: "reviewer",
        name: "Reviewer",
        profile: "Reviews code for correctness, security, and quality",
        system_prompt: "You are a code reviewer. Examine the provided code against the original design. Check for correctness, security issues, edge cases, and code quality. Provide actionable feedback.",
      },
    ],
    orchestrator: {
      name: "Code Dev Orchestrator",
      profile: "Orchestrates a three-stage code development pipeline",
      system_prompt: "You orchestrate a code development workflow with three specialists: an architect, a developer, and a reviewer.",
      dolphin: "@architect(query=$input) -> $design\n@developer(spec=$design) -> $code\n@reviewer(code=$code, spec=$design) -> $review",
      is_dolphin_mode: 1,
    },
  },
  {
    name: "Research & Synthesize",
    description: "Multi-perspective research: two researchers explore different angles, then a synthesizer combines findings.",
    mode: "dolphin",
    templateId: "research",
    agents: [
      {
        ref: "researcher_a",
        name: "Researcher A",
        profile: "Researches from a technical/scientific perspective",
        system_prompt: "You are a technical researcher. Given a topic, explore it from a technical and scientific perspective. Provide factual, evidence-based analysis with key findings and data points.",
      },
      {
        ref: "researcher_b",
        name: "Researcher B",
        profile: "Researches from a practical/business perspective",
        system_prompt: "You are a business analyst. Given a topic, explore it from a practical, market, and business perspective. Focus on real-world applications, trends, and strategic implications.",
      },
      {
        ref: "synthesizer",
        name: "Synthesizer",
        profile: "Synthesizes multiple research perspectives into a unified report",
        system_prompt: "You are a research synthesizer. Given multiple research perspectives on the same topic, combine them into a coherent, well-structured report. Highlight agreements, tensions, and actionable insights.",
      },
    ],
    orchestrator: {
      name: "Research Orchestrator",
      profile: "Orchestrates multi-perspective research and synthesis",
      system_prompt: "You orchestrate a research workflow: two researchers explore a topic from different angles, then a synthesizer combines their findings.",
      dolphin: "@researcher_a(topic=$input) -> $perspective_a\n@researcher_b(topic=$input) -> $perspective_b\n@synthesizer(research_a=$perspective_a, research_b=$perspective_b) -> $report",
      is_dolphin_mode: 1,
    },
  },
];

// ── Route registration ──────────────────────────────────────────────────────

export function registerComposerRoutes(
  _getToken: TokenProvider,
  _businessDomain: string,
): Map<string, (req: IncomingMessage, res: ServerResponse) => void> {
  const routes = new Map<string, (req: IncomingMessage, res: ServerResponse) => void>();

  // GET /api/composer/templates
  routes.set("GET /api/composer/templates", (_req, res) => {
    jsonResponse(res, 200, TEMPLATES);
  });

  return routes;
}
```

- [ ] **Step 2: Build and verify**

Run: `cd packages/typescript && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add packages/typescript/src/commands/explore-composer.ts
git commit -m "feat(composer): add templates endpoint with 3 hardcoded templates"
```

---

### Task 3: Backend — create endpoint (create + publish agents + orchestrator)

**Files:**
- Modify: `packages/typescript/src/commands/explore-composer.ts`

- [ ] **Step 1: Add imports for agent APIs**

Add these imports at the top of `explore-composer.ts`:

```typescript
import { createAgent, publishAgent, deleteAgent } from "../api/agent-list.js";
import { fetchAgentInfo } from "../api/agent-chat.js";
import { readBody, handleApiError, jsonResponse, type TokenProvider } from "./explore-bkn.js";
```

(Replace the existing import line that only imports `jsonResponse` and `TokenProvider`.)

- [ ] **Step 2: Add the create endpoint**

Inside `registerComposerRoutes`, after the templates route, add:

```typescript
  // POST /api/composer/create — create sub-agents + orchestrator, publish all
  routes.set("POST /api/composer/create", async (req, res) => {
    let bodyStr: string;
    try {
      bodyStr = await readBody(req);
    } catch {
      jsonResponse(res, 400, { error: "Failed to read request body" });
      return;
    }

    let config: ComposerConfig;
    try {
      const parsed = JSON.parse(bodyStr) as { config?: ComposerConfig };
      config = parsed.config!;
      if (!config || !config.orchestrator) {
        jsonResponse(res, 400, { error: "Invalid config: orchestrator is required" });
        return;
      }
    } catch {
      jsonResponse(res, 400, { error: "Invalid JSON body" });
      return;
    }

    const t = await getToken();
    const createdAgentIds: string[] = []; // for rollback on failure
    const agentMap: Record<string, { id: string; key: string }> = {};

    try {
      // 1. Create and publish each sub-agent
      for (const agent of config.agents) {
        const createBody = JSON.stringify({
          name: agent.name,
          profile: agent.profile,
          avatar_type: 1,
          avatar: "icon-dip-agent-default",
          product_key: "DIP",
          config: {
            input: { fields: [{ name: "user_input", type: "string" }] },
            output: { default_format: "markdown" },
            system_prompt: agent.system_prompt,
          },
        });

        const raw = await createAgent({
          baseUrl: t.baseUrl,
          accessToken: t.accessToken,
          body: createBody,
          businessDomain,
        });
        const result = JSON.parse(raw) as { data?: { id?: string } };
        const agentId = result.data?.id ?? "";
        if (!agentId) throw new Error(`Failed to create agent "${agent.name}": no ID returned`);
        createdAgentIds.push(agentId);

        await publishAgent({
          baseUrl: t.baseUrl,
          accessToken: t.accessToken,
          agentId,
          businessDomain,
        });

        // Get agent key for DPH script substitution
        const info = await fetchAgentInfo({
          baseUrl: t.baseUrl,
          accessToken: t.accessToken,
          agentId,
          version: "v0",
          businessDomain,
        });
        agentMap[agent.ref] = { id: agentId, key: info.key };
      }

      // 2. Process DPH script — replace @ref with @agent_key
      let dolphinScript = config.orchestrator.dolphin || "";
      for (const [ref, info] of Object.entries(agentMap)) {
        dolphinScript = dolphinScript.replace(
          new RegExp(`@${ref}\\b`, "g"),
          `@${info.key}`,
        );
      }

      // 3. Create and publish orchestrator
      const orchBody = JSON.stringify({
        name: config.orchestrator.name,
        profile: config.orchestrator.profile,
        avatar_type: 1,
        avatar: "icon-dip-agent-default",
        product_key: "DIP",
        config: {
          input: { fields: [{ name: "user_input", type: "string" }] },
          output: { default_format: "markdown" },
          system_prompt: config.orchestrator.system_prompt,
          dolphin: dolphinScript,
          is_dolphin_mode: config.orchestrator.is_dolphin_mode ?? 1,
        },
      });

      const orchRaw = await createAgent({
        baseUrl: t.baseUrl,
        accessToken: t.accessToken,
        body: orchBody,
        businessDomain,
      });
      const orchResult = JSON.parse(orchRaw) as { data?: { id?: string } };
      const orchestratorId = orchResult.data?.id ?? "";
      if (!orchestratorId) throw new Error("Failed to create orchestrator: no ID returned");
      createdAgentIds.push(orchestratorId);

      await publishAgent({
        baseUrl: t.baseUrl,
        accessToken: t.accessToken,
        agentId: orchestratorId,
        businessDomain,
      });

      // 4. Return result
      const agentIds: Record<string, string> = {};
      for (const [ref, info] of Object.entries(agentMap)) {
        agentIds[ref] = info.id;
      }

      jsonResponse(res, 200, { orchestratorId, agentIds, allAgentIds: createdAgentIds });
    } catch (error) {
      // Rollback: delete any agents we created
      for (const id of createdAgentIds) {
        try {
          await deleteAgent({
            baseUrl: t.baseUrl,
            accessToken: t.accessToken,
            agentId: id,
            businessDomain,
          });
        } catch { /* best effort cleanup */ }
      }
      handleApiError(res, error);
    }
  });
```

Note: change the function signature to use the parameters:

```typescript
export function registerComposerRoutes(
  getToken: TokenProvider,
  businessDomain: string,
): Map<string, (req: IncomingMessage, res: ServerResponse) => void> {
```

- [ ] **Step 3: Build and verify**

Run: `cd packages/typescript && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add packages/typescript/src/commands/explore-composer.ts
git commit -m "feat(composer): add create endpoint — creates sub-agents + orchestrator"
```

---

### Task 4: Backend — run endpoint (SSE streaming) + cleanup endpoint

**Files:**
- Modify: `packages/typescript/src/commands/explore-composer.ts`

- [ ] **Step 1: Add sendChatRequestStream import**

Add to the existing import from `agent-chat.js`:

```typescript
import { fetchAgentInfo, sendChatRequestStream } from "../api/agent-chat.js";
```

- [ ] **Step 2: Add the run endpoint**

Inside `registerComposerRoutes`, after the create route:

```typescript
  // POST /api/composer/run — execute orchestrator via SSE (same format as chat)
  routes.set("POST /api/composer/run", async (req, res) => {
    let bodyStr: string;
    try {
      bodyStr = await readBody(req);
    } catch {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Failed to read request body" }));
      return;
    }

    let orchestratorId: string;
    let message: string;
    try {
      const body = JSON.parse(bodyStr) as { orchestratorId?: string; message?: string };
      orchestratorId = body.orchestratorId ?? "";
      message = body.message ?? "";
    } catch {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Invalid JSON body" }));
      return;
    }

    if (!orchestratorId || !message) {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "orchestratorId and message are required" }));
      return;
    }

    const t = await getToken();
    let agentInfo: { id: string; key: string; version: string };
    try {
      agentInfo = await fetchAgentInfo({
        baseUrl: t.baseUrl,
        accessToken: t.accessToken,
        agentId: orchestratorId,
        version: "v0",
        businessDomain,
      });
    } catch (error) {
      handleApiError(res, error);
      return;
    }

    // SSE headers
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const heartbeat = setInterval(() => {
      try { res.write(": heartbeat\n\n"); } catch { /* connection gone */ }
    }, 15000);

    try {
      const result = await sendChatRequestStream(
        {
          baseUrl: t.baseUrl,
          accessToken: t.accessToken,
          agentId: agentInfo.id,
          agentKey: agentInfo.key,
          agentVersion: agentInfo.version,
          query: message,
          stream: true,
          businessDomain,
        },
        {
          onTextDelta: (fullText: string, currentSegmentText: string) => {
            res.write(`data: ${JSON.stringify({ type: "text", fullText, currentText: currentSegmentText })}\n\n`);
          },
          onProgress: (items) => {
            res.write(`data: ${JSON.stringify({ type: "progress", items })}\n\n`);
          },
          onSegmentComplete: (segmentText: string, segmentIndex: number) => {
            res.write(`data: ${JSON.stringify({ type: "segment", text: segmentText, index: segmentIndex })}\n\n`);
          },
          onStepMeta: (meta: Record<string, unknown>) => {
            res.write(`data: ${JSON.stringify({ type: "step_meta", meta })}\n\n`);
          },
          onConversationId: (convId: string) => {
            res.write(`data: ${JSON.stringify({ type: "conversation_id", conversationId: convId })}\n\n`);
          },
        },
      );

      clearInterval(heartbeat);
      res.write(`data: ${JSON.stringify({ type: "done", conversationId: result.conversationId ?? "" })}\n\n`);
      res.end();
    } catch (error) {
      clearInterval(heartbeat);
      const errMsg = error instanceof Error ? error.message : String(error);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: errMsg }));
      } else {
        res.write(`data: ${JSON.stringify({ type: "error", error: errMsg })}\n\n`);
        res.end();
      }
    }
  });
```

- [ ] **Step 3: Add the cleanup endpoint**

After the run route:

```typescript
  // DELETE /api/composer/cleanup — delete a list of agents
  routes.set("DELETE /api/composer/cleanup", async (req, res) => {
    let bodyStr: string;
    try {
      bodyStr = await readBody(req);
    } catch {
      jsonResponse(res, 400, { error: "Failed to read request body" });
      return;
    }

    let agentIds: string[];
    try {
      const body = JSON.parse(bodyStr) as { agentIds?: string[] };
      agentIds = body.agentIds ?? [];
    } catch {
      jsonResponse(res, 400, { error: "Invalid JSON body" });
      return;
    }

    const t = await getToken();
    const deleted: string[] = [];
    const errors: string[] = [];

    for (const id of agentIds) {
      try {
        await deleteAgent({
          baseUrl: t.baseUrl,
          accessToken: t.accessToken,
          agentId: id,
          businessDomain,
        });
        deleted.push(id);
      } catch (error) {
        errors.push(`${id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    jsonResponse(res, 200, { deleted, errors });
  });
```

- [ ] **Step 4: Build and verify**

Run: `cd packages/typescript && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/typescript/src/commands/explore-composer.ts
git commit -m "feat(composer): add run (SSE) and cleanup endpoints"
```

---

### Task 5: Frontend — wizard framework + Step 1 (Choose)

**Files:**
- Modify: `packages/typescript/src/templates/explorer/composer.js`

- [ ] **Step 1: Implement the wizard framework and Step 1**

Replace the entire `composer.js` with:

```javascript
/* global api, esc, enc, navGeneration, chatMarkdown, renderProgressSteps, fetchAndRenderTrace */

// ── Composer state ──────────────────────────────────────────────────────────

const composerState = {
  step: 1,           // 1=Choose, 3=Review, 4=Run
  config: null,      // ComposerConfig selected/edited
  templates: null,   // cached template list
  exec: null,        // ComposerExecState
  abortController: null,
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function composerSetStep(step) {
  composerState.step = step;
  var $el = document.getElementById("content");
  if ($el) renderComposer($el);
}

function renderStepper(currentStep) {
  var steps = [
    { num: 1, label: "Choose" },
    { num: 2, label: "Generate", disabled: true },
    { num: 3, label: "Review" },
    { num: 4, label: "Run" },
  ];
  return '<div class="composer-stepper">' + steps.map(function(s) {
    var cls = "composer-step-dot";
    if (s.num === currentStep) cls += " active";
    else if (s.num < currentStep) cls += " done";
    if (s.disabled) cls += " disabled";
    return '<div class="' + cls + '"><span class="composer-step-num">' + s.num + '</span><span class="composer-step-label">' + s.label + '</span></div>';
  }).join('<div class="composer-step-line"></div>') + '</div>';
}

// ── Step 1: Choose ──────────────────────────────────────────────────────────

async function renderStep1($el) {
  var templates = composerState.templates;
  if (!templates) {
    $el.innerHTML = renderStepper(1) + '<div class="composer-content"><div class="loading-skeleton">Loading templates...</div></div>';
    try {
      templates = await api("GET", "/api/composer/templates");
      composerState.templates = templates;
    } catch (err) {
      $el.innerHTML = renderStepper(1) + '<div class="composer-content"><div class="error-banner">Failed to load templates: ' + esc(err.message || String(err)) + '</div></div>';
      return;
    }
  }

  var html = renderStepper(1);
  html += '<div class="composer-content">';
  html += '<div class="composer-choose-layout">';

  // Left: NL description (Phase 2 — disabled for now)
  html += '<div class="composer-choose-left">';
  html += '<h3>Describe what you want to build</h3>';
  html += '<textarea class="composer-nl-input" placeholder="e.g., Build a research pipeline that explores a topic from multiple angles and synthesizes the findings..." disabled></textarea>';
  html += '<p class="composer-hint">Natural language generation coming in Phase 2</p>';
  html += '</div>';

  // Right: Template cards
  html += '<div class="composer-choose-right">';
  html += '<h3>Or pick a template</h3>';
  html += '<div class="composer-template-grid">';
  for (var i = 0; i < templates.length; i++) {
    var t = templates[i];
    var agentCount = (t.agents || []).length;
    html += '<div class="composer-template-card" data-idx="' + i + '">';
    html += '<div class="composer-template-name">' + esc(t.name) + '</div>';
    html += '<div class="composer-template-desc">' + esc(t.description) + '</div>';
    if (agentCount > 0) {
      html += '<div class="composer-template-meta">' + agentCount + ' agent' + (agentCount > 1 ? 's' : '') + '</div>';
    }
    html += '</div>';
  }
  html += '</div>';
  html += '</div>';

  html += '</div>'; // choose-layout
  html += '</div>'; // content

  $el.innerHTML = html;

  // Bind template card clicks
  var cards = $el.querySelectorAll(".composer-template-card");
  cards.forEach(function(card) {
    card.addEventListener("click", function() {
      var idx = parseInt(card.dataset.idx, 10);
      var selected = composerState.templates[idx];
      // Deep clone the template so edits don't mutate the original
      composerState.config = JSON.parse(JSON.stringify(selected));
      composerSetStep(3);
    });
  });
}

// ── Step 3: Review (read-only in Phase 1) ───────────────────────────────────

function renderStep3($el) {
  var config = composerState.config;
  if (!config) { composerSetStep(1); return; }

  var html = renderStepper(3);
  html += '<div class="composer-content">';
  html += '<div class="composer-review-layout">';

  // Left: agent list
  html += '<div class="composer-review-left">';
  html += '<div class="composer-review-header">';
  html += '<h3>' + esc(config.name) + '</h3>';
  html += '<p class="composer-review-desc">' + esc(config.description) + '</p>';
  html += '</div>';
  html += '<h4>Agents (' + config.agents.length + ')</h4>';

  for (var i = 0; i < config.agents.length; i++) {
    var agent = config.agents[i];
    html += '<details class="composer-agent-card">';
    html += '<summary><strong>' + esc(agent.ref) + '</strong> — ' + esc(agent.name) + '</summary>';
    html += '<div class="composer-agent-detail">';
    html += '<div class="composer-field"><label>Profile</label><div>' + esc(agent.profile) + '</div></div>';
    html += '<div class="composer-field"><label>System Prompt</label><pre class="composer-prompt-preview">' + esc(agent.system_prompt) + '</pre></div>';
    html += '</div>';
    html += '</details>';
  }

  html += '</div>'; // review-left

  // Right: DPH script + mode
  html += '<div class="composer-review-right">';
  html += '<h4>Orchestration Script (DPH)</h4>';
  html += '<pre class="composer-dph-editor">' + esc(config.orchestrator.dolphin || "(no script)") + '</pre>';
  html += '<div class="composer-mode-display">Mode: <strong>' + esc(config.mode) + '</strong></div>';
  html += '</div>'; // review-right

  html += '</div>'; // review-layout

  // Bottom navigation
  html += '<div class="composer-nav">';
  html += '<button class="composer-btn composer-btn-secondary" id="composer-back">← Back</button>';
  html += '<button class="composer-btn composer-btn-primary" id="composer-run">Create & Run →</button>';
  html += '</div>';

  html += '</div>'; // content

  $el.innerHTML = html;

  document.getElementById("composer-back").addEventListener("click", function() {
    composerSetStep(1);
  });
  document.getElementById("composer-run").addEventListener("click", function() {
    composerSetStep(4);
  });
}

// ── Main entry point ────────────────────────────────────────────────────────

// eslint-disable-next-line no-unused-vars
function renderComposer($el) {
  switch (composerState.step) {
    case 1: renderStep1($el); break;
    case 3: renderStep3($el); break;
    case 4: renderStep4($el); break;
    default: renderStep1($el);
  }
}
```

Note: `renderStep4` will be added in the next task. For now the code will reference it but it won't be called until the user clicks "Create & Run".

- [ ] **Step 2: Commit**

```bash
git add packages/typescript/src/templates/explorer/composer.js
git commit -m "feat(composer): implement wizard framework + Step 1 (Choose) + Step 3 (Review)"
```

---

### Task 6: Frontend — Step 4 (Run) with create, SSE streaming, trace, and cleanup

**Files:**
- Modify: `packages/typescript/src/templates/explorer/composer.js`

- [ ] **Step 1: Add renderStep4 function**

Add this function before the `renderComposer` function in `composer.js`:

```javascript
// ── Step 4: Run ─────────────────────────────────────────────────────────────

async function renderStep4($el) {
  var config = composerState.config;
  if (!config) { composerSetStep(1); return; }

  var html = renderStepper(4);
  html += '<div class="composer-content">';
  html += '<div class="composer-exec-log" id="composer-log"></div>';
  html += '<div class="composer-output" id="composer-output"></div>';
  html += '<div class="composer-trace" id="composer-trace"></div>';
  html += '<div class="composer-nav" id="composer-run-nav" style="display:none">';
  html += '<button class="composer-btn composer-btn-secondary" id="composer-cleanup">Cleanup Agents</button>';
  html += '<button class="composer-btn composer-btn-primary" id="composer-open-chat">Open in Chat →</button>';
  html += '</div>';
  html += '</div>';
  $el.innerHTML = html;

  var $log = document.getElementById("composer-log");
  var $output = document.getElementById("composer-output");
  var $trace = document.getElementById("composer-trace");
  var $nav = document.getElementById("composer-run-nav");

  function logStep(label, status, detail) {
    var icon = status === "done" ? "✅" : status === "error" ? "❌" : '<span class="trace-spinner"></span>';
    var html = '<div class="composer-log-entry composer-log-' + status + '">' + icon + ' ' + esc(label);
    if (detail) html += ' <span class="composer-log-detail">(' + esc(detail) + ')</span>';
    html += '</div>';
    $log.insertAdjacentHTML("beforeend", html);
    $log.scrollTop = $log.scrollHeight;
  }

  // Phase 1: Create agents
  logStep("Creating agents...", "running");
  var createResult;
  try {
    createResult = await api("POST", "/api/composer/create", { config: config });
  } catch (err) {
    logStep("Failed to create agents", "error", err.message || String(err));
    return;
  }

  var orchestratorId = createResult.orchestratorId;
  var allAgentIds = createResult.allAgentIds || [];

  // Update log with created agents
  $log.innerHTML = ""; // clear "creating..." line
  for (var ref in (createResult.agentIds || {})) {
    logStep("Created agent: " + ref, "done", createResult.agentIds[ref]);
  }
  logStep("Created orchestrator: " + config.orchestrator.name, "done", orchestratorId);

  // Phase 2: Run orchestrator via SSE
  logStep("Running orchestrator...", "running");

  // Prompt user for input
  $output.innerHTML = '<div class="composer-input-section">' +
    '<label>Input message for the orchestrator:</label>' +
    '<div class="composer-input-row">' +
    '<input type="text" class="composer-run-input" id="composer-run-input" placeholder="Enter your request..." />' +
    '<button class="composer-btn composer-btn-primary" id="composer-send">Run</button>' +
    '</div></div>';

  var $input = document.getElementById("composer-run-input");
  var $sendBtn = document.getElementById("composer-send");

  // Wait for user to provide input and click Run
  await new Promise(function(resolve) {
    function doSend() {
      var msg = $input.value.trim();
      if (!msg) return;
      $sendBtn.disabled = true;
      $input.disabled = true;
      resolve(msg);
    }
    $sendBtn.addEventListener("click", doSend);
    $input.addEventListener("keydown", function(e) {
      if (e.key === "Enter") doSend();
    });
    $input.focus();
  }).then(function(message) {
    return runOrchestrator(message, orchestratorId, allAgentIds, $log, $output, $trace, $nav);
  });
}

async function runOrchestrator(message, orchestratorId, allAgentIds, $log, $output, $trace, $nav) {
  // Clear input section, show streaming output area
  $output.innerHTML = '<div class="composer-stream-area"><div class="composer-stream-text" id="composer-stream-text"></div>' +
    '<div class="composer-stream-progress" id="composer-stream-progress"></div></div>';

  var $streamText = document.getElementById("composer-stream-text");
  var $streamProgress = document.getElementById("composer-stream-progress");
  var conversationId = null;
  var fullText = "";

  var abortController = new AbortController();
  composerState.abortController = abortController;

  try {
    var res = await fetch("/api/composer/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orchestratorId: orchestratorId, message: message }),
      signal: abortController.signal,
    });

    if (!res.ok || !res.body) {
      var errText = await res.text();
      $log.querySelector(".composer-log-entry:last-child").innerHTML = "❌ Run failed: " + esc(errText);
      return;
    }

    var reader = res.body.getReader();
    var decoder = new TextDecoder();
    var buf = "";

    while (true) {
      var chunk = await reader.read();
      if (chunk.done) break;
      buf += decoder.decode(chunk.value, { stream: true });
      var lines = buf.split("\n");
      buf = lines.pop() || "";

      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (!line.startsWith("data: ")) continue;
        var dataStr = line.slice(6).trim();
        if (!dataStr) continue;
        var evt;
        try { evt = JSON.parse(dataStr); } catch { continue; }

        if (evt.type === "text") {
          fullText = evt.fullText || fullText;
          $streamText.innerHTML = chatMarkdown(fullText);
          $streamText.scrollTop = $streamText.scrollHeight;
        } else if (evt.type === "progress") {
          $streamProgress.innerHTML = renderProgressSteps(evt.items);
        } else if (evt.type === "step_meta") {
          // Render as progress-like card
          if (evt.meta) {
            var metaHtml = '<div class="composer-step-meta">⚡ ' + esc(evt.meta.skill_name || evt.meta.name || "Step") + '</div>';
            $streamProgress.insertAdjacentHTML("beforeend", metaHtml);
          }
        } else if (evt.type === "conversation_id") {
          conversationId = evt.conversationId;
        } else if (evt.type === "done") {
          conversationId = conversationId || evt.conversationId;
        } else if (evt.type === "error") {
          $streamText.insertAdjacentHTML("beforeend", '<div class="error-banner">' + esc(evt.error) + '</div>');
        }
      }
    }

    // Update log
    var logEntries = $log.querySelectorAll(".composer-log-entry");
    var lastEntry = logEntries[logEntries.length - 1];
    if (lastEntry) lastEntry.innerHTML = "✅ Orchestrator completed";

  } catch (err) {
    if (err.name !== "AbortError") {
      $streamText.insertAdjacentHTML("beforeend", '<div class="error-banner">Stream error: ' + esc(err.message || String(err)) + '</div>');
    }
  }

  composerState.abortController = null;

  // Phase 3: Fetch trace
  // Note: fetchAndRenderTrace expects a bubbleEl to append a .trace-section into.
  // We create a wrapper div and pass it as bubbleEl so the trace renders inside $trace.
  if (conversationId && orchestratorId) {
    $trace.innerHTML = '<div class="composer-trace-loading">Loading trace...</div>';
    try {
      var traceWrapper = document.createElement("div");
      $trace.innerHTML = "";
      $trace.appendChild(traceWrapper);
      await fetchAndRenderTrace(traceWrapper, orchestratorId, conversationId, $trace);
      if (!traceWrapper.querySelector(".trace-section")) {
        $trace.innerHTML = '<div class="composer-hint">No trace data available</div>';
      }
    } catch {
      $trace.innerHTML = '<div class="composer-hint">Trace not available</div>';
    }
  }

  // Show navigation buttons
  $nav.style.display = "";
  composerState.exec = { orchestratorId: orchestratorId, allAgentIds: allAgentIds, conversationId: conversationId };

  document.getElementById("composer-cleanup").addEventListener("click", async function() {
    if (!confirm("Delete all " + allAgentIds.length + " agents created by this composition?")) return;
    this.disabled = true;
    this.textContent = "Cleaning up...";
    try {
      var result = await api("DELETE", "/api/composer/cleanup", { agentIds: allAgentIds });
      this.textContent = "✅ Cleaned up " + (result.deleted || []).length + " agents";
    } catch (err) {
      this.textContent = "❌ Cleanup failed";
    }
  });

  document.getElementById("composer-open-chat").addEventListener("click", function() {
    location.hash = "#/chat/" + enc(orchestratorId);
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/typescript/src/templates/explorer/composer.js
git commit -m "feat(composer): implement Step 4 (Run) with SSE streaming, trace, and cleanup"
```

---

### Task 7: CSS styles for Composer wizard

**Files:**
- Modify: `packages/typescript/src/templates/explorer/style.css`

- [ ] **Step 1: Add composer styles at the end of style.css**

Append the following CSS to the end of `style.css`:

```css
/* ── Composer ────────────────────────────────────────────────────────────── */

.composer-wizard {
  padding: 24px;
  max-width: 1200px;
  margin: 0 auto;
}

/* Stepper */
.composer-stepper {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0;
  padding: 24px 0 32px;
}

.composer-step-dot {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  position: relative;
}

.composer-step-num {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 14px;
  border: 2px solid var(--border);
  color: var(--text-secondary);
  background: var(--surface);
  transition: var(--transition-smooth);
}

.composer-step-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
}

.composer-step-dot.active .composer-step-num {
  border-color: var(--accent);
  background: var(--accent);
  color: #fff;
}

.composer-step-dot.active .composer-step-label {
  color: var(--accent);
  font-weight: 600;
}

.composer-step-dot.done .composer-step-num {
  border-color: var(--accent);
  color: var(--accent);
}

.composer-step-dot.disabled {
  opacity: 0.4;
}

.composer-step-line {
  width: 60px;
  height: 2px;
  background: var(--border);
  margin: 0 8px;
  margin-bottom: 22px;
}

/* Content area */
.composer-content {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 32px;
  box-shadow: var(--shadow-sm);
}

/* Step 1: Choose layout */
.composer-choose-layout {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 32px;
}

.composer-choose-left h3,
.composer-choose-right h3 {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 16px;
  color: var(--text);
}

.composer-nl-input {
  width: 100%;
  min-height: 160px;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  font-family: inherit;
  font-size: 14px;
  resize: vertical;
  background: var(--bg);
  color: var(--text);
}

.composer-nl-input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.composer-hint {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 8px;
}

/* Template grid */
.composer-template-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 16px;
}

.composer-template-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 20px;
  cursor: pointer;
  transition: var(--transition-smooth);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.composer-template-card:hover {
  border-color: var(--accent);
  box-shadow: var(--shadow-md);
  transform: translateY(-2px);
}

.composer-template-name {
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
}

.composer-template-desc {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
}

.composer-template-meta {
  font-size: 12px;
  color: var(--accent);
  font-weight: 500;
  margin-top: auto;
}

/* Step 3: Review layout */
.composer-review-layout {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 32px;
}

.composer-review-header {
  margin-bottom: 20px;
}

.composer-review-header h3 {
  font-size: 20px;
  font-weight: 700;
  margin-bottom: 4px;
}

.composer-review-desc {
  font-size: 13px;
  color: var(--text-secondary);
}

.composer-review-left h4,
.composer-review-right h4 {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 12px;
}

.composer-agent-card {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  margin-bottom: 8px;
  overflow: hidden;
}

.composer-agent-card summary {
  padding: 12px 16px;
  cursor: pointer;
  font-size: 14px;
}

.composer-agent-card[open] summary {
  border-bottom: 1px solid var(--border);
}

.composer-agent-detail {
  padding: 16px;
}

.composer-field {
  margin-bottom: 12px;
}

.composer-field label {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 4px;
}

.composer-prompt-preview {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 12px;
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 200px;
  overflow-y: auto;
}

.composer-dph-editor {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 16px;
  font-family: "SF Mono", "Fira Code", "Consolas", monospace;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  min-height: 200px;
}

.composer-mode-display {
  margin-top: 16px;
  font-size: 13px;
  color: var(--text-secondary);
}

/* Navigation */
.composer-nav {
  display: flex;
  justify-content: space-between;
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid var(--border);
}

.composer-btn {
  padding: 10px 24px;
  border-radius: var(--radius-pill);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  border: none;
  transition: var(--transition-smooth);
}

.composer-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.composer-btn-primary {
  background: var(--accent);
  color: #fff;
}

.composer-btn-primary:hover:not(:disabled) {
  background: var(--accent-hover);
}

.composer-btn-secondary {
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border);
}

.composer-btn-secondary:hover:not(:disabled) {
  background: var(--border);
}

/* Step 4: Execution */
.composer-exec-log {
  margin-bottom: 20px;
}

.composer-log-entry {
  padding: 8px 0;
  font-size: 14px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.composer-log-detail {
  color: var(--text-secondary);
  font-size: 12px;
}

.composer-stream-area {
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.composer-stream-text {
  padding: 20px;
  min-height: 200px;
  max-height: 500px;
  overflow-y: auto;
  font-size: 14px;
  line-height: 1.6;
}

.composer-stream-progress {
  border-top: 1px solid var(--border);
  padding: 12px 16px;
}

.composer-stream-progress:empty {
  display: none;
}

.composer-step-meta {
  font-size: 13px;
  padding: 4px 0;
  color: var(--text-secondary);
}

.composer-input-section {
  margin-bottom: 20px;
}

.composer-input-section label {
  display: block;
  font-size: 14px;
  font-weight: 500;
  margin-bottom: 8px;
}

.composer-input-row {
  display: flex;
  gap: 8px;
}

.composer-run-input {
  flex: 1;
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  font-size: 14px;
  background: var(--bg);
  color: var(--text);
}

.composer-run-input:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-glow);
}

.composer-trace {
  margin-top: 20px;
}

.composer-trace-loading {
  font-size: 13px;
  color: var(--text-secondary);
  padding: 12px 0;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/typescript/src/templates/explorer/style.css
git commit -m "feat(composer): add CSS styles for wizard, stepper, cards, review, and execution"
```

---

### Task 8: Build, copy dist, and manual verification

**Files:**
- No new files — build and verify the existing code.

- [ ] **Step 1: Build TypeScript**

Run: `cd packages/typescript && npx tsc`
Expected: Clean compilation, no errors.

- [ ] **Step 2: Copy new frontend files to dist**

The build copies `src/templates/` to `dist/templates/` via tsc. Verify the files exist:

Run: `ls packages/typescript/dist/templates/explorer/composer.js packages/typescript/dist/commands/explore-composer.js`
Expected: Both files exist.

If `composer.js` wasn't copied (tsc doesn't copy non-ts files automatically), check the build setup:

Run: `head -5 packages/typescript/tsconfig.json`

If static files aren't auto-copied, manually copy:
Run: `cp packages/typescript/src/templates/explorer/composer.js packages/typescript/dist/templates/explorer/composer.js`

- [ ] **Step 3: Smoke test**

Run: `cd packages/typescript && node dist/cli.js explore --port 3722`

Verify in browser at `http://localhost:3722`:
1. Composer tab appears in the top bar
2. Clicking Composer shows Step 1 with template cards
3. Clicking a template card shows Step 3 (Review) with agents and DPH script
4. Clicking "Create & Run" shows Step 4 with creation log and input prompt

- [ ] **Step 4: Commit any fixes**

If any fixes were needed during verification:

```bash
git add -A
git commit -m "fix(composer): address build/runtime issues from smoke test"
```
