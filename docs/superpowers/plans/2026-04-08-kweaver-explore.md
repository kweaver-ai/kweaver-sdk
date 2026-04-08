# KWeaver Explore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade `bkn explore` to `kweaver explore` — a top-level command with Dashboard, Chat, BKN, and Vega tabs in a single SPA.

**Architecture:** Incremental refactor of existing bkn-explore. Split the monolithic bkn-explore.ts into explore.ts (main entry + server) + per-tab handler files. Split the monolithic app.js into per-tab frontend modules. Add new Chat and Vega capabilities.

**Tech Stack:** Node.js native HTTP server, Vanilla JS SPA, zero dependencies.

**Spec:** `docs/superpowers/specs/2026-04-08-kweaver-explore-design.md`

---

### Task 1: CLI — Register `explore` as top-level command

**Files:**
- Modify: `packages/typescript/src/cli.ts` (add explore dispatch)
- Modify: `packages/typescript/src/commands/bkn.ts` (remove explore subcommand)
- Create: `packages/typescript/src/commands/explore.ts` (new entry point, initially re-exports bkn-explore)
- Test: `packages/typescript/test/explore.test.ts`

- [ ] **Step 1: Write failing test for parseExploreArgs**

```typescript
// packages/typescript/test/explore.test.ts
import { describe, it, expect } from "vitest";
import { parseExploreArgs } from "../src/commands/explore.js";

describe("parseExploreArgs", () => {
  it("defaults: no args", () => {
    const opts = parseExploreArgs([]);
    expect(opts.port).toBe(3721);
    expect(opts.open).toBe(true);
    expect(opts.knId).toBe("");
    expect(opts.agentId).toBe("");
  });

  it("--kn flag", () => {
    const opts = parseExploreArgs(["--kn", "kn-123"]);
    expect(opts.knId).toBe("kn-123");
  });

  it("--agent flag", () => {
    const opts = parseExploreArgs(["--agent", "agent-456"]);
    expect(opts.agentId).toBe("agent-456");
  });

  it("--port and --no-open", () => {
    const opts = parseExploreArgs(["--port", "4000", "--no-open"]);
    expect(opts.port).toBe(4000);
    expect(opts.open).toBe(false);
  });

  it("-bd flag", () => {
    const opts = parseExploreArgs(["-bd", "my-domain"]);
    expect(opts.businessDomain).toBe("my-domain");
  });

  it("--help throws", () => {
    expect(() => parseExploreArgs(["--help"])).toThrow("help");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/typescript && npx vitest run test/explore.test.ts`
Expected: FAIL — cannot import parseExploreArgs

- [ ] **Step 3: Create explore.ts with parseExploreArgs**

```typescript
// packages/typescript/src/commands/explore.ts
import { createInterface } from "node:readline";
import { ensureValidToken, formatHttpError, with401RefreshRetry } from "../auth/oauth.js";
import { listKnowledgeNetworks } from "../api/knowledge-networks.js";
import { resolveBusinessDomain } from "../config/store.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExploreOptions {
  knId: string;
  agentId: string;
  port: number;
  open: boolean;
  businessDomain: string;
}

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

export function parseExploreArgs(args: string[]): ExploreOptions {
  const opts: ExploreOptions = {
    knId: "",
    agentId: "",
    port: 3721,
    open: true,
    businessDomain: "",
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--help" || a === "-h") throw new Error("help");
    if (a === "--port" && args[i + 1]) { opts.port = Number(args[++i]); continue; }
    if (a === "--no-open") { opts.open = false; continue; }
    if (a === "--kn" && args[i + 1]) { opts.knId = args[++i]; continue; }
    if (a === "--agent" && args[i + 1]) { opts.agentId = args[++i]; continue; }
    if ((a === "-bd" || a === "--biz-domain") && args[i + 1]) { opts.businessDomain = args[++i]; continue; }
  }
  return opts;
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

function printExploreHelp(): void {
  console.log(`kweaver explore

Launch an interactive web UI for exploring KWeaver resources.

Usage:
  kweaver explore [options]

Options:
  --kn <id>          Open directly to BKN tab with specified KN
  --agent <id>       Open directly to Chat tab with specified Agent
  --port <n>         HTTP server port (default: 3721)
  --no-open          Don't auto-open browser
  -bd <value>        Business domain override
  -h, --help         Show this help
`);
}

// ---------------------------------------------------------------------------
// Main entry (stub — will be filled in Task 3)
// ---------------------------------------------------------------------------

export async function runExploreCommand(args: string[]): Promise<number> {
  let opts: ExploreOptions;
  try {
    opts = parseExploreArgs(args);
  } catch (err: any) {
    if (err?.message === "help") { printExploreHelp(); return 0; }
    throw err;
  }

  // TODO: will be implemented in subsequent tasks
  console.log("explore command not yet fully implemented");
  return 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/typescript && npx vitest run test/explore.test.ts`
Expected: PASS (all 6 tests)

- [ ] **Step 5: Wire explore into cli.ts and remove bkn explore**

In `packages/typescript/src/cli.ts`, add import and dispatch:

```typescript
// Add import near top:
import { runExploreCommand } from "./commands/explore.js";

// Add in the command dispatch block (before the bkn command):
if (command === "explore") {
  return runExploreCommand(rest);
}
```

In `packages/typescript/src/commands/bkn.ts`, remove the explore subcommand:
- Remove the import of `runKnExploreCommand` from `./bkn-explore.js`
- Remove the line `if (subcommand === "explore") return runKnExploreCommand(rest);`
- Remove "explore" from the help text in `printKnHelp()`

- [ ] **Step 6: Commit**

```bash
git add packages/typescript/src/commands/explore.ts \
       packages/typescript/test/explore.test.ts \
       packages/typescript/src/cli.ts \
       packages/typescript/src/commands/bkn.ts
git commit -m "feat(explore): register explore as top-level command with arg parsing"
```

---

### Task 2: Backend — Extract BKN handlers from bkn-explore.ts into explore-bkn.ts

**Files:**
- Create: `packages/typescript/src/commands/explore-bkn.ts` (BKN API handlers + meta loading)
- Modify: `packages/typescript/src/commands/bkn-explore.ts` (will be deleted at end of task)
- Modify: `packages/typescript/test/explore.test.ts` (move buildMeta/retry tests)

- [ ] **Step 1: Create explore-bkn.ts by extracting from bkn-explore.ts**

Extract these from `bkn-explore.ts` into `explore-bkn.ts`:
- `ExploreMeta` interface and sub-interfaces (`ExploreOt`, `ExploreRt`, `ExploreAt`, `ExploreBkn`, `ExploreStats`)
- `buildMeta()` function
- `loadExploreMetaWithRetry()` function
- `isRetryableExploreBootstrapError()` function
- `EXPLORE_BOOTSTRAP_RETRY_DELAY_MS` and `EXPLORE_BOOTSTRAP_MAX_ATTEMPTS` constants
- `registerBknRoutes()` — new function wrapping the BKN API route handlers (extracted from `startServer()`)

The new `registerBknRoutes()` function signature:

```typescript
export function registerBknRoutes(
  meta: ExploreMeta,
  token: { baseUrl: string; accessToken: string },
  businessDomain: string,
): Map<string, (req: IncomingMessage, res: ServerResponse) => void> {
  // Returns a map of { "METHOD path" → handler }
  // e.g. "GET /api/bkn/meta", "POST /api/bkn/instances", etc.
  // Note: paths now have /bkn/ prefix (was /api/meta, now /api/bkn/meta)
}
```

Extract the 5 route handlers from `startServer()` lines 343-434 of bkn-explore.ts. Change URL prefixes from `/api/` to `/api/bkn/`:
- `GET /api/meta` → `GET /api/bkn/meta`
- `POST /api/instances` → `POST /api/bkn/instances`
- `POST /api/subgraph` → `POST /api/bkn/subgraph`
- `POST /api/search` → `POST /api/bkn/search`
- `POST /api/properties` → `POST /api/bkn/properties`

- [ ] **Step 2: Move buildMeta and retry tests to explore.test.ts**

Add to `packages/typescript/test/explore.test.ts`:

```typescript
import { buildMeta, isRetryableExploreBootstrapError } from "../src/commands/explore-bkn.js";

describe("buildMeta", () => {
  // Copy the existing tests from bkn-explore.test.ts lines 35-92
  // Update imports to point to explore-bkn.js
});

describe("isRetryableExploreBootstrapError", () => {
  // Copy the existing tests from bkn-explore.test.ts lines 94-105
  // Update imports to point to explore-bkn.js
});
```

- [ ] **Step 3: Run tests**

Run: `cd packages/typescript && npx vitest run test/explore.test.ts`
Expected: PASS (all tests including moved ones)

- [ ] **Step 4: Delete bkn-explore.ts and bkn-explore.test.ts**

```bash
rm packages/typescript/src/commands/bkn-explore.ts
rm packages/typescript/test/bkn-explore.test.ts
```

- [ ] **Step 5: Run full test suite to verify nothing breaks**

Run: `cd packages/typescript && npx vitest run`
Expected: PASS (no other file should import bkn-explore directly)

- [ ] **Step 6: Commit**

```bash
git add packages/typescript/src/commands/explore-bkn.ts \
       packages/typescript/test/explore.test.ts
git add -u  # stages deletions
git commit -m "refactor(explore): extract BKN handlers into explore-bkn.ts"
```

---

### Task 3: Backend — Build the unified server in explore.ts

**Files:**
- Modify: `packages/typescript/src/commands/explore.ts` (add server startup, route dispatch, KN selection)

- [ ] **Step 1: Implement the server in explore.ts**

Port the `startServer()` and `selectKnInteractive()` logic from the old bkn-explore.ts into explore.ts, with these changes:

1. **Template directory**: Change from `templates/bkn-explorer/` to `templates/explorer/`
2. **Route dispatch**: Instead of inline route handlers, collect routes from per-module `register*Routes()` functions:

```typescript
import { registerBknRoutes, loadExploreMetaWithRetry, type ExploreMeta } from "./explore-bkn.js";

async function startServer(
  opts: ExploreOptions,
  token: { baseUrl: string; accessToken: string },
  businessDomain: string,
): Promise<void> {
  // Load BKN meta if knId is provided (optional — dashboard can work without it)
  let bknMeta: ExploreMeta | null = null;
  if (opts.knId) {
    bknMeta = await loadExploreMetaWithRetry(token.baseUrl, token.accessToken, opts.knId, businessDomain);
  }

  // Collect route handlers from each module
  const routes = new Map<string, (req: IncomingMessage, res: ServerResponse) => void>();

  // Dashboard route
  routes.set("GET /api/dashboard", async (req, res) => {
    // Will be implemented in Task 5
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ knList: [], agents: [], catalogs: [] }));
  });

  // BKN routes (only if meta loaded)
  if (bknMeta) {
    const bknRoutes = registerBknRoutes(bknMeta, token, businessDomain);
    for (const [key, handler] of bknRoutes) routes.set(key, handler);
  }

  // Create HTTP server with route matching + static file fallback
  // (Port the static file serving logic from bkn-explore.ts lines 437-486)
  // Change template dir from bkn-explorer to explorer
}
```

2. **Initial hash**: Pass the initial hash to the frontend via a query param or inline script:
   - `--kn kn-123` → browser opens `http://localhost:3721/#/bkn/kn-123`
   - `--agent agent-456` → browser opens `http://localhost:3721/#/chat/agent-456`
   - no flags → browser opens `http://localhost:3721/#/`

3. **Port the runKnExploreCommand logic** into `runExploreCommand()`:
   - Token acquisition via `ensureValidToken()`
   - Business domain resolution via `resolveBusinessDomain()`
   - KN interactive selection (only if `--kn` flag used but no value — not on bare `kweaver explore`)
   - Server startup
   - Browser launch
   - Ctrl+C handling

- [ ] **Step 2: Build and verify server starts**

Run: `cd packages/typescript && npm run build && node dist/cli.js explore --no-open`
Expected: Server starts on port 3721 (will 404 on pages since templates don't exist yet)

- [ ] **Step 3: Commit**

```bash
git add packages/typescript/src/commands/explore.ts
git commit -m "feat(explore): implement unified server with route dispatch"
```

---

### Task 4: Frontend — Create explorer shell (index.html + app.js + style.css)

**Files:**
- Create: `packages/typescript/src/templates/explorer/index.html`
- Create: `packages/typescript/src/templates/explorer/app.js`
- Create: `packages/typescript/src/templates/explorer/style.css`
- Remove: `packages/typescript/src/templates/bkn-explorer/` (entire directory)

- [ ] **Step 1: Create index.html with tab navigation**

```html
<!-- packages/typescript/src/templates/explorer/index.html -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>KWeaver Explorer</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/style.css" />
</head>
<body>
  <header id="top-bar">
    <div class="top-bar-left">
      <span class="logo">⬡ KWeaver Explorer</span>
    </div>
    <nav id="tab-bar">
      <a class="tab" href="#/" data-tab="dashboard">Dashboard</a>
      <a class="tab" href="#/chat" data-tab="chat">Chat</a>
      <a class="tab" href="#/bkn" data-tab="bkn">BKN</a>
      <a class="tab" href="#/vega" data-tab="vega">Vega</a>
    </nav>
    <div class="top-bar-right">
      <span id="env-label"></span>
    </div>
  </header>
  <main id="content"></main>

  <script src="/app.js"></script>
  <script src="/dashboard.js"></script>
  <script src="/bkn.js"></script>
  <script src="/chat.js"></script>
  <script src="/vega.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create app.js with router and shared utilities**

```javascript
// packages/typescript/src/templates/explorer/app.js

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------
let navGeneration = 0;

// ---------------------------------------------------------------------------
// Utilities (carried over from bkn-explorer/app.js)
// ---------------------------------------------------------------------------
function esc(s) {
  if (s == null) return "";
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function enc(s) { return encodeURIComponent(s); }

function formatValue(v) {
  if (v == null) return '<span class="null">—</span>';
  if (typeof v === "object") return "<pre>" + esc(JSON.stringify(v, null, 2)) + "</pre>";
  return esc(String(v));
}

// ---------------------------------------------------------------------------
// Cache utility
// ---------------------------------------------------------------------------
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function cachedFetch(cache, key, fetcher) {
  const entry = cache[key];
  if (entry && Date.now() - entry.ts < CACHE_TTL) return Promise.resolve(entry.data);
  return fetcher().then(data => { cache[key] = { data, ts: Date.now() }; return data; });
}

// ---------------------------------------------------------------------------
// API helper
// ---------------------------------------------------------------------------
async function api(method, url, body) {
  const opts = { method, headers: {} };
  if (body) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
function getRoute() {
  const hash = location.hash.slice(1) || "/";
  const [path, qs] = hash.split("?");
  const parts = path.split("/").filter(Boolean);
  const params = new URLSearchParams(qs || "");

  if (parts.length === 0) return { view: "dashboard" };

  const tab = parts[0]; // chat, bkn, vega
  return { tab, parts: parts.slice(1), params };
}

function navigate() {
  navGeneration++;
  const route = getRoute();
  const $content = document.getElementById("content");

  // Update active tab
  document.querySelectorAll("#tab-bar .tab").forEach(t => {
    const tabName = t.dataset.tab;
    const isActive = route.view === "dashboard"
      ? tabName === "dashboard"
      : tabName === route.tab;
    t.classList.toggle("active", isActive);
  });

  // Dispatch to tab renderer
  if (route.view === "dashboard") {
    renderDashboard($content);
  } else if (route.tab === "chat") {
    renderChat($content, route.parts, route.params);
  } else if (route.tab === "bkn") {
    renderBkn($content, route.parts, route.params);
  } else if (route.tab === "vega") {
    renderVega($content, route.parts, route.params);
  } else {
    $content.innerHTML = '<div class="error-banner">Unknown route</div>';
  }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
window.addEventListener("hashchange", navigate);
window.addEventListener("DOMContentLoaded", () => {
  navigate();
});
```

- [ ] **Step 3: Create style.css**

Copy the existing `bkn-explorer/style.css` and extend with:
- Tab bar styles (`.tab`, `.tab.active`)
- Top bar layout (`#top-bar`, `.top-bar-left`, `.top-bar-right`)
- Remove sidebar styles (sidebar is now per-tab, not global)
- Add chat-specific styles (`.chat-sidebar`, `.chat-messages`, `.chat-bubble`, `.chat-input`)
- Add card styles for structured agent responses (`.entity-card`)
- Add vega-specific styles (`.catalog-card`, `.health-indicator`, `.data-preview-table`)
- Add dashboard styles (`.summary-cards`, `.resource-list`)

Keep the existing CSS variables (colors, radii, shadows) and base styles.

- [ ] **Step 4: Delete old bkn-explorer templates**

```bash
rm -rf packages/typescript/src/templates/bkn-explorer/
```

- [ ] **Step 5: Build and verify the shell loads**

Run: `cd packages/typescript && npm run build && node dist/cli.js explore --no-open`
Open `http://localhost:3721` — should see the tab bar with 4 tabs and empty content area.

- [ ] **Step 6: Commit**

```bash
git add packages/typescript/src/templates/explorer/
git add -u  # stages bkn-explorer deletion
git commit -m "feat(explore): create explorer shell with tab navigation and router"
```

---

### Task 5: Frontend + Backend — Dashboard tab

**Files:**
- Create: `packages/typescript/src/templates/explorer/dashboard.js`
- Modify: `packages/typescript/src/commands/explore.ts` (implement /api/dashboard handler)

- [ ] **Step 1: Implement /api/dashboard handler in explore.ts**

The dashboard endpoint aggregates data from three sources in parallel. Replace the stub handler:

```typescript
routes.set("GET /api/dashboard", async (_req, res) => {
  try {
    const bd = businessDomain;
    const [knRaw, agentsRaw, catalogsRaw] = await Promise.allSettled([
      with401RefreshRetry(token, () =>
        listKnowledgeNetworks({ baseUrl: token.baseUrl, accessToken: token.accessToken, businessDomain: bd })),
      with401RefreshRetry(token, () =>
        listAgents({ baseUrl: token.baseUrl, accessToken: token.accessToken, businessDomain: bd })),
      with401RefreshRetry(token, () =>
        listVegaCatalogs({ baseUrl: token.baseUrl, accessToken: token.accessToken, businessDomain: bd })),
    ]);

    const parseSettled = (r: PromiseSettledResult<string>) =>
      r.status === "fulfilled" ? JSON.parse(r.value) : { error: String(r.reason) };

    const payload = {
      kn: parseSettled(knRaw),
      agents: parseSettled(agentsRaw),
      catalogs: parseSettled(catalogsRaw),
    };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
  } catch (err: any) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: String(err) }));
  }
});
```

Add imports at top of explore.ts:
```typescript
import { listAgents } from "../api/agent-list.js";
import { listVegaCatalogs } from "../api/vega.js";
```

- [ ] **Step 2: Implement dashboard.js frontend**

```javascript
// packages/typescript/src/templates/explorer/dashboard.js

const dashboardCache = {};

async function renderDashboard($el) {
  const gen = navGeneration;
  $el.innerHTML = '<div class="loading">Loading dashboard...</div>';

  let data;
  try {
    data = await cachedFetch(dashboardCache, "main", () => api("GET", "/api/dashboard"));
  } catch (err) {
    $el.innerHTML = '<div class="error-banner">Failed to load dashboard. <a href="#/" onclick="location.reload()">Retry</a></div>';
    return;
  }
  if (navGeneration !== gen) return;

  const knList = extractList(data.kn, "entries", "knowledge_networks");
  const agentList = extractList(data.agents, "data", "entries");
  const catalogList = extractList(data.catalogs, "entries", "data");

  $el.innerHTML = `
    <div class="dashboard">
      <h2>Overview</h2>
      <div class="summary-cards">
        ${summaryCard("Knowledge Networks", knList, "#/bkn")}
        ${summaryCard("Agents", agentList, "#/chat")}
        ${summaryCard("Vega Catalogs", catalogList, "#/vega")}
      </div>
      <div class="resource-sections">
        ${knList.length ? resourceSection("Knowledge Networks", knList, kn =>
          `<a class="resource-row" href="#/bkn/${enc(kn.id || kn.kg_id)}">
            <span class="resource-name">${esc(kn.name || kn.kg_name || kn.id)}</span>
            <span class="resource-meta">${esc(kn.description || "")}</span>
          </a>`) : ""}
        ${agentList.length ? resourceSection("Agents", agentList, agent =>
          `<a class="resource-row" href="#/chat/${enc(agent.id || agent.agent_id)}">
            <span class="resource-name">${esc(agent.name || agent.agent_name || agent.id)}</span>
            <span class="resource-meta">${esc(agent.description || "")}</span>
          </a>`) : ""}
        ${catalogList.length ? resourceSection("Vega Catalogs", catalogList, cat =>
          `<a class="resource-row" href="#/vega/${enc(cat.id || cat.catalog_id)}">
            <span class="resource-name">${esc(cat.name || cat.catalog_name || cat.id)}</span>
            <span class="resource-meta">${esc(cat.type || "")}</span>
          </a>`) : ""}
      </div>
    </div>
  `;
}

// Helpers
function extractList(obj, ...keys) {
  if (obj?.error) return [];
  if (Array.isArray(obj)) return obj;
  for (const k of keys) { if (Array.isArray(obj?.[k])) return obj[k]; }
  return [];
}

function summaryCard(title, list, href) {
  const count = list.length;
  const hasError = count === 0;
  return `<a class="summary-card${hasError ? " muted" : ""}" href="${href}">
    <div class="summary-card-label">${esc(title)}</div>
    <div class="summary-card-count">${count}</div>
  </a>`;
}

function resourceSection(title, list, renderItem) {
  return `<div class="resource-section">
    <h3>${esc(title)}</h3>
    <div class="resource-list">${list.map(renderItem).join("")}</div>
  </div>`;
}
```

- [ ] **Step 3: Build and verify dashboard loads**

Run: `cd packages/typescript && npm run build && node dist/cli.js explore --no-open`
Open `http://localhost:3721/#/` — should see dashboard with summary cards and resource lists.

- [ ] **Step 4: Commit**

```bash
git add packages/typescript/src/templates/explorer/dashboard.js \
       packages/typescript/src/commands/explore.ts
git commit -m "feat(explore): implement dashboard tab with aggregated overview"
```

---

### Task 6: Frontend — BKN tab (extract from existing app.js)

**Files:**
- Create: `packages/typescript/src/templates/explorer/bkn.js`

- [ ] **Step 1: Create bkn.js by extracting from old app.js**

Move the following from the old `bkn-explorer/app.js` into `bkn.js`:
- All BKN-specific caches: `instanceListCache`, `instanceDetailCache`, `subgraphCache`, `searchCache`, `rtDetailCache`
- All BKN API wrappers: `loadMeta()`, `queryInstances()`, `queryInstancesCached()`, `querySubgraph()`, `querySubgraphCached()`, `search()`, `searchCached()`
- All BKN renderers: `renderHome()`, `renderOtList()`, `loadInstances()`, `renderInstance()`, `loadRelations()`, `renderSearch()`, `renderRtDetail()`
- Field picker logic: `pickDefaultSubtitleFields()`, `userSubtitleFields`
- `renderSidebar()`, `bindSearch()`

Adapt to new architecture:

1. **API URL prefix change**: All fetch calls change from `/api/` to `/api/bkn/`:
   - `/api/meta` → `/api/bkn/meta`
   - `/api/instances` → `/api/bkn/instances`
   - `/api/subgraph` → `/api/bkn/subgraph`
   - `/api/search` → `/api/bkn/search`
   - `/api/properties` → `/api/bkn/properties`

2. **Route structure change**: The `renderBkn($el, parts, params)` function dispatches based on parts:
   - `[]` → KN selection list (new — shows list of available KNs)
   - `[knId]` → `renderHome()` (existing, load meta for this KN)
   - `[knId, "ot", otId]` → `renderOtList()` (existing)
   - `[knId, "instance", otId, pk]` → `renderInstance()` (existing)
   - `[knId, "search"]` with `params.q` → `renderSearch()` (existing)
   - `[knId, "rt", rtId]` → `renderRtDetail()` (existing)

3. **KN selection list**: New view at `#/bkn` showing available KNs:

```javascript
async function renderKnList($el) {
  const gen = navGeneration;
  $el.innerHTML = '<div class="loading">Loading knowledge networks...</div>';
  let data;
  try {
    data = await api("GET", "/api/dashboard");
  } catch (err) {
    $el.innerHTML = '<div class="error-banner">Failed to load KN list</div>';
    return;
  }
  if (navGeneration !== gen) return;
  const knList = extractList(data.kn, "entries", "knowledge_networks");
  $el.innerHTML = `
    <div class="bkn-kn-list">
      <h2>Knowledge Networks</h2>
      <div class="resource-list">
        ${knList.map(kn => `<a class="resource-row" href="#/bkn/${enc(kn.id || kn.kg_id)}">
          <span class="resource-name">${esc(kn.name || kn.kg_name || kn.id)}</span>
          <span class="resource-meta">${esc(kn.description || "")}</span>
        </a>`).join("")}
      </div>
    </div>
  `;
}
```

4. **Meta loading per KN**: When navigating to `#/bkn/:knId`, load meta from `/api/bkn/meta`. The server needs to support dynamic KN switching — see Task 7.

- [ ] **Step 2: Build and verify BKN tab works**

Run: `cd packages/typescript && npm run build && node dist/cli.js explore --kn <some-kn-id> --no-open`
Open `http://localhost:3721/#/bkn/<kn-id>` — should render the KN home page as before.

- [ ] **Step 3: Commit**

```bash
git add packages/typescript/src/templates/explorer/bkn.js
git commit -m "feat(explore): extract BKN tab from existing app.js"
```

---

### Task 7: Backend — Dynamic KN switching for BKN tab

**Files:**
- Modify: `packages/typescript/src/commands/explore.ts` (support loading BKN meta on-demand)
- Modify: `packages/typescript/src/commands/explore-bkn.ts` (make routes work without pre-loaded meta)

- [ ] **Step 1: Modify server to support dynamic KN loading**

Currently the server loads BKN meta at startup (only if `--kn` is provided). For the multi-KN dashboard, we need to load meta on-demand when the user selects a KN in the browser.

Add a new endpoint in explore.ts:

```typescript
routes.set("POST /api/bkn/load", async (req, res) => {
  // Read knId from request body
  const body = await readBody(req);
  const { knId } = JSON.parse(body);
  if (!knId) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "knId required" }));
    return;
  }
  try {
    const meta = await loadExploreMetaWithRetry(token.baseUrl, token.accessToken, knId, businessDomain);
    // Register BKN routes for this KN (replace any previous)
    const bknRoutes = registerBknRoutes(meta, token, businessDomain);
    for (const [key, handler] of bknRoutes) routes.set(key, handler);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  } catch (err: any) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: formatHttpError(err) }));
  }
});
```

Update bkn.js to call `POST /api/bkn/load` before loading meta when entering a KN.

- [ ] **Step 2: Build and verify dynamic KN switching**

Run: `cd packages/typescript && npm run build && node dist/cli.js explore --no-open`
Open `http://localhost:3721/#/bkn` — see KN list. Click a KN → should load its schema and show the home page.

- [ ] **Step 3: Commit**

```bash
git add packages/typescript/src/commands/explore.ts \
       packages/typescript/src/commands/explore-bkn.ts
git commit -m "feat(explore): support dynamic KN loading for BKN tab"
```

---

### Task 8: Backend + Frontend — Chat tab

**Files:**
- Create: `packages/typescript/src/commands/explore-chat.ts` (Chat API handlers)
- Create: `packages/typescript/src/templates/explorer/chat.js` (Chat frontend)
- Modify: `packages/typescript/src/commands/explore.ts` (register chat routes)

- [ ] **Step 1: Create explore-chat.ts**

```typescript
// packages/typescript/src/commands/explore-chat.ts
import type { IncomingMessage, ServerResponse } from "node:http";
import { listAgents } from "../api/agent-list.js";
import { fetchAgentInfo, sendChatRequestStream, buildChatUrl } from "../api/agent-chat.js";
import { with401RefreshRetry } from "../auth/oauth.js";

export function registerChatRoutes(
  token: { baseUrl: string; accessToken: string },
  businessDomain: string,
): Map<string, (req: IncomingMessage, res: ServerResponse) => void> {
  const routes = new Map<string, (req: IncomingMessage, res: ServerResponse) => void>();

  // GET /api/chat/agents — list available agents
  routes.set("GET /api/chat/agents", async (_req, res) => {
    try {
      const raw = await with401RefreshRetry(token, () =>
        listAgents({ baseUrl: token.baseUrl, accessToken: token.accessToken, businessDomain }));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(raw);
    } catch (err: any) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(err) }));
    }
  });

  // POST /api/chat/send — send message, stream response via SSE
  routes.set("POST /api/chat/send", async (req, res) => {
    const body = await readBody(req);
    const { agentId, message, conversationId, version } = JSON.parse(body);

    try {
      // Fetch agent info to get key
      const agentInfo = await with401RefreshRetry(token, () =>
        fetchAgentInfo({
          baseUrl: token.baseUrl,
          accessToken: token.accessToken,
          agentId,
          version: version || "latest",
          businessDomain,
        }));

      // Set up SSE headers
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      });

      // Stream chat response
      const result = await sendChatRequestStream(
        {
          baseUrl: token.baseUrl,
          accessToken: token.accessToken,
          agentId: agentInfo.id,
          agentKey: agentInfo.key,
          agentVersion: agentInfo.version,
          query: message,
          conversationId,
          stream: true,
          verbose: false,
          businessDomain,
        },
        {
          onToken: (token: string) => {
            res.write(`data: ${JSON.stringify({ type: "token", text: token })}\n\n`);
          },
          onDone: (result: any) => {
            res.write(`data: ${JSON.stringify({ type: "done", conversationId: result.conversationId })}\n\n`);
            res.end();
          },
          onError: (err: any) => {
            res.write(`data: ${JSON.stringify({ type: "error", error: String(err) })}\n\n`);
            res.end();
          },
        },
      );
    } catch (err: any) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(err) }));
      }
    }
  });

  return routes;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}
```

**Note:** The `sendChatRequestStream` callback signatures above are approximate. Check the actual callback interface in `api/agent-chat.ts` and adapt. The key pattern is: receive streaming tokens from the Agent API, forward them as SSE events to the browser.

- [ ] **Step 2: Register chat routes in explore.ts**

```typescript
import { registerChatRoutes } from "./explore-chat.js";

// In startServer(), after BKN routes:
const chatRoutes = registerChatRoutes(token, businessDomain);
for (const [key, handler] of chatRoutes) routes.set(key, handler);
```

- [ ] **Step 3: Create chat.js frontend**

```javascript
// packages/typescript/src/templates/explorer/chat.js

const chatState = {
  agents: [],
  conversations: {},   // agentId → { messages: [], conversationId }
  currentAgentId: null,
};

async function renderChat($el, parts, params) {
  const gen = navGeneration;
  const agentId = parts[0] || null;

  // Load agent list if not cached
  if (!chatState.agents.length) {
    $el.innerHTML = '<div class="loading">Loading agents...</div>';
    try {
      const raw = await api("GET", "/api/chat/agents");
      chatState.agents = extractList(raw, "data", "entries");
    } catch (err) {
      $el.innerHTML = '<div class="error-banner">Failed to load agents</div>';
      return;
    }
    if (navGeneration !== gen) return;
  }

  chatState.currentAgentId = agentId;

  $el.innerHTML = `
    <div class="chat-layout">
      <div class="chat-sidebar">
        <div class="chat-sidebar-title">Agents</div>
        ${chatState.agents.map(a => {
          const id = a.id || a.agent_id;
          const name = a.name || a.agent_name || id;
          const active = id === agentId ? " active" : "";
          return `<a class="chat-agent-item${active}" href="#/chat/${enc(id)}">${esc(name)}</a>`;
        }).join("")}
      </div>
      <div class="chat-main">
        ${agentId ? chatMainArea(agentId) : '<div class="chat-placeholder">Select an agent to start chatting</div>'}
      </div>
    </div>
  `;

  if (agentId) {
    bindChatInput(agentId);
    scrollChatToBottom();
  }
}

function chatMainArea(agentId) {
  const conv = chatState.conversations[agentId] || { messages: [] };
  const agent = chatState.agents.find(a => (a.id || a.agent_id) === agentId);
  const agentName = agent ? (agent.name || agent.agent_name || agentId) : agentId;

  return `
    <div class="chat-header">${esc(agentName)}</div>
    <div class="chat-messages" id="chat-messages">
      ${conv.messages.map(m => chatBubble(m, agentName)).join("")}
    </div>
    <div class="chat-input-bar">
      <input type="text" id="chat-input" class="chat-input" placeholder="输入消息..." />
      <button id="chat-send" class="chat-send-btn">发送</button>
    </div>
  `;
}

function chatBubble(msg, agentName) {
  const isUser = msg.role === "user";
  const sender = isUser ? "You" : esc(agentName);
  const content = isUser ? esc(msg.text) : renderChatContent(msg.text);
  return `
    <div class="chat-bubble ${isUser ? "user" : "assistant"}">
      <div class="chat-bubble-sender">${sender}</div>
      <div class="chat-bubble-content">${content}</div>
    </div>
  `;
}

function renderChatContent(text) {
  // Minimal markdown: bold, code blocks, links
  let html = esc(text);
  // Code blocks: ```...```
  html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
  // Inline code: `...`
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Bold: **...**
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Line breaks
  html = html.replace(/\n/g, '<br>');
  // Entity cards: detect patterns like [instance:otId:pk:knId]
  html = html.replace(/\[instance:([^:]+):([^:]+):([^\]]+)\]/g,
    '<a class="entity-card" href="#/bkn/$3/instance/$1/$2">📋 View in BKN ↗</a>');
  return html;
}

function bindChatInput(agentId) {
  const $input = document.getElementById("chat-input");
  const $send = document.getElementById("chat-send");
  if (!$input || !$send) return;

  const send = () => {
    const text = $input.value.trim();
    if (!text) return;
    $input.value = "";
    sendMessage(agentId, text);
  };

  $send.onclick = send;
  $input.onkeydown = (e) => { if (e.key === "Enter") send(); };
}

async function sendMessage(agentId, text) {
  // Init conversation state
  if (!chatState.conversations[agentId]) {
    chatState.conversations[agentId] = { messages: [], conversationId: null };
  }
  const conv = chatState.conversations[agentId];

  // Add user message
  conv.messages.push({ role: "user", text });
  appendBubble({ role: "user", text }, "");

  // Add placeholder for assistant
  const assistantMsg = { role: "assistant", text: "" };
  conv.messages.push(assistantMsg);
  const $bubble = appendBubble(assistantMsg, "");
  const $content = $bubble.querySelector(".chat-bubble-content");

  // Stream response via SSE
  try {
    const response = await fetch("/api/chat/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId,
        message: text,
        conversationId: conv.conversationId,
      }),
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Parse SSE lines
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = JSON.parse(line.slice(6));
        if (payload.type === "token") {
          assistantMsg.text += payload.text;
          $content.innerHTML = renderChatContent(assistantMsg.text);
          scrollChatToBottom();
        } else if (payload.type === "done") {
          conv.conversationId = payload.conversationId;
        } else if (payload.type === "error") {
          $content.innerHTML = `<div class="error-banner">${esc(payload.error)}</div>`;
        }
      }
    }
  } catch (err) {
    $content.innerHTML = `<div class="error-banner">Failed to send message: ${esc(String(err))}</div>`;
  }
}

function appendBubble(msg, agentName) {
  const $messages = document.getElementById("chat-messages");
  const div = document.createElement("div");
  div.className = `chat-bubble ${msg.role === "user" ? "user" : "assistant"}`;
  const sender = msg.role === "user" ? "You" : esc(agentName);
  div.innerHTML = `
    <div class="chat-bubble-sender">${sender}</div>
    <div class="chat-bubble-content">${msg.role === "user" ? esc(msg.text) : renderChatContent(msg.text)}</div>
  `;
  $messages.appendChild(div);
  scrollChatToBottom();
  return div;
}

function scrollChatToBottom() {
  const $messages = document.getElementById("chat-messages");
  if ($messages) $messages.scrollTop = $messages.scrollHeight;
}
```

- [ ] **Step 4: Build and verify chat works**

Run: `cd packages/typescript && npm run build && node dist/cli.js explore --no-open`
Open `http://localhost:3721/#/chat` — should see agent list, click an agent, send a message, see streaming response.

- [ ] **Step 5: Commit**

```bash
git add packages/typescript/src/commands/explore-chat.ts \
       packages/typescript/src/templates/explorer/chat.js \
       packages/typescript/src/commands/explore.ts
git commit -m "feat(explore): implement Chat tab with streaming and structured cards"
```

---

### Task 9: Backend + Frontend — Vega tab

**Files:**
- Create: `packages/typescript/src/commands/explore-vega.ts` (Vega API handlers)
- Create: `packages/typescript/src/templates/explorer/vega.js` (Vega frontend)
- Modify: `packages/typescript/src/commands/explore.ts` (register vega routes)

- [ ] **Step 1: Create explore-vega.ts**

```typescript
// packages/typescript/src/commands/explore-vega.ts
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  listVegaCatalogs,
  vegaCatalogHealthStatus,
  listVegaCatalogResources,
  getVegaResource,
  queryVegaResourceData,
  listVegaDiscoverTasks,
} from "../api/vega.js";
import { with401RefreshRetry } from "../auth/oauth.js";

export function registerVegaRoutes(
  token: { baseUrl: string; accessToken: string },
  businessDomain: string,
): Map<string, (req: IncomingMessage, res: ServerResponse) => void> {
  const routes = new Map<string, (req: IncomingMessage, res: ServerResponse) => void>();

  // GET /api/vega/catalogs — list catalogs with health
  routes.set("GET /api/vega/catalogs", async (_req, res) => {
    try {
      const [catalogsRaw, healthRaw] = await Promise.allSettled([
        with401RefreshRetry(token, () =>
          listVegaCatalogs({ baseUrl: token.baseUrl, accessToken: token.accessToken, businessDomain })),
        with401RefreshRetry(token, () =>
          vegaCatalogHealthStatus({ baseUrl: token.baseUrl, accessToken: token.accessToken, ids: "all", businessDomain })),
      ]);
      const catalogs = catalogsRaw.status === "fulfilled" ? JSON.parse(catalogsRaw.value) : { error: String(catalogsRaw.reason) };
      const health = healthRaw.status === "fulfilled" ? JSON.parse(healthRaw.value) : {};
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ catalogs, health }));
    } catch (err: any) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(err) }));
    }
  });

  // GET /api/vega/catalogs/:id/resources — list resources in a catalog
  // URL pattern: /api/vega/catalogs/CAT_ID/resources
  routes.set("GET /api/vega/catalog-resources", async (req, res) => {
    const url = new URL(req.url!, `http://localhost`);
    const catalogId = url.searchParams.get("catalogId") || "";
    try {
      const raw = await with401RefreshRetry(token, () =>
        listVegaCatalogResources({
          baseUrl: token.baseUrl,
          accessToken: token.accessToken,
          catalogId,
          businessDomain,
        }));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(raw);
    } catch (err: any) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(err) }));
    }
  });

  // POST /api/vega/query — preview resource data
  routes.set("POST /api/vega/query", async (req, res) => {
    const body = await readBody(req);
    const { resourceId, query } = JSON.parse(body);
    try {
      const raw = await with401RefreshRetry(token, () =>
        queryVegaResourceData({
          baseUrl: token.baseUrl,
          accessToken: token.accessToken,
          resourceId,
          body: query || {},
          businessDomain,
        }));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(raw);
    } catch (err: any) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(err) }));
    }
  });

  // GET /api/vega/tasks — list discover tasks
  routes.set("GET /api/vega/tasks", async (_req, res) => {
    try {
      const raw = await with401RefreshRetry(token, () =>
        listVegaDiscoverTasks({
          baseUrl: token.baseUrl,
          accessToken: token.accessToken,
          businessDomain,
        }));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(raw);
    } catch (err: any) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(err) }));
    }
  });

  return routes;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}
```

- [ ] **Step 2: Register vega routes in explore.ts**

```typescript
import { registerVegaRoutes } from "./explore-vega.js";

// In startServer(), after chat routes:
const vegaRoutes = registerVegaRoutes(token, businessDomain);
for (const [key, handler] of vegaRoutes) routes.set(key, handler);
```

- [ ] **Step 3: Create vega.js frontend**

```javascript
// packages/typescript/src/templates/explorer/vega.js

const vegaCache = {};

async function renderVega($el, parts, params) {
  const gen = navGeneration;
  const catalogId = parts[0] || null;
  const resourceId = parts[1] || null;

  if (resourceId) {
    return renderVegaResource($el, catalogId, resourceId, gen);
  }
  if (catalogId) {
    return renderVegaCatalog($el, catalogId, gen);
  }
  return renderVegaCatalogList($el, gen);
}

async function renderVegaCatalogList($el, gen) {
  $el.innerHTML = '<div class="loading">Loading catalogs...</div>';

  let data;
  try {
    data = await cachedFetch(vegaCache, "catalogs", () => api("GET", "/api/vega/catalogs"));
  } catch (err) {
    $el.innerHTML = '<div class="error-banner">Failed to load Vega catalogs</div>';
    return;
  }
  if (navGeneration !== gen) return;

  const catalogs = extractList(data.catalogs, "entries", "data");
  const healthMap = buildHealthMap(data.health);

  // Load discover tasks
  let tasks = [];
  try {
    const taskData = await cachedFetch(vegaCache, "tasks", () => api("GET", "/api/vega/tasks"));
    tasks = extractList(taskData, "entries", "data");
  } catch (_) { /* non-critical */ }
  if (navGeneration !== gen) return;

  const activeTasks = tasks.filter(t => t.status === "running" || t.status === "pending");

  $el.innerHTML = `
    <div class="vega-view">
      <h2>Vega Catalogs</h2>
      ${activeTasks.length ? `
        <details class="discover-tasks" open>
          <summary>Discover Tasks (${activeTasks.length} active)</summary>
          <div class="task-list">
            ${activeTasks.map(t => `
              <div class="task-item">
                <span class="task-status ${t.status}">${esc(t.status)}</span>
                <span class="task-name">${esc(t.name || t.id)}</span>
              </div>
            `).join("")}
          </div>
        </details>
      ` : ""}
      <div class="catalog-grid">
        ${catalogs.map(cat => {
          const id = cat.id || cat.catalog_id;
          const name = cat.name || cat.catalog_name || id;
          const health = healthMap[id];
          const indicator = health === "healthy" ? "🟢" : health === "unhealthy" ? "🔴" : "⚪";
          return `
            <a class="catalog-card" href="#/vega/${enc(id)}">
              <div class="catalog-card-header">
                <span class="health-indicator">${indicator}</span>
                <span class="catalog-name">${esc(name)}</span>
              </div>
              <div class="catalog-meta">${esc(cat.type || cat.connector_type || "")}</div>
            </a>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

async function renderVegaCatalog($el, catalogId, gen) {
  $el.innerHTML = '<div class="loading">Loading resources...</div>';

  let data;
  try {
    data = await cachedFetch(vegaCache, `resources-${catalogId}`,
      () => api("GET", `/api/vega/catalog-resources?catalogId=${enc(catalogId)}`));
  } catch (err) {
    $el.innerHTML = '<div class="error-banner">Failed to load resources</div>';
    return;
  }
  if (navGeneration !== gen) return;

  const resources = extractList(data, "entries", "data");

  $el.innerHTML = `
    <div class="vega-view">
      <div class="breadcrumb">
        <a href="#/vega">Catalogs</a> / <span>${esc(catalogId)}</span>
      </div>
      <h2>Resources</h2>
      <table class="data-table">
        <thead><tr><th>Name</th><th>Type</th><th>Fields</th></tr></thead>
        <tbody>
          ${resources.map(r => {
            const id = r.id || r.resource_id;
            const name = r.name || r.resource_name || id;
            const fieldCount = r.columns?.length || r.field_count || "—";
            return `<tr onclick="location.hash='#/vega/${enc(catalogId)}/${enc(id)}'">
              <td>${esc(name)}</td>
              <td>${esc(r.type || r.resource_type || "")}</td>
              <td>${esc(fieldCount)}</td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;
}

async function renderVegaResource($el, catalogId, resourceId, gen) {
  $el.innerHTML = '<div class="loading">Loading resource...</div>';

  let preview;
  try {
    preview = await cachedFetch(vegaCache, `preview-${resourceId}`,
      () => api("POST", "/api/vega/query", { resourceId, query: { limit: 20 } }));
  } catch (err) {
    $el.innerHTML = '<div class="error-banner">Failed to load resource data</div>';
    return;
  }
  if (navGeneration !== gen) return;

  const columns = preview.columns || preview.schema?.fields || [];
  const rows = preview.data || preview.rows || [];

  $el.innerHTML = `
    <div class="vega-view">
      <div class="breadcrumb">
        <a href="#/vega">Catalogs</a> /
        <a href="#/vega/${enc(catalogId)}">${esc(catalogId)}</a> /
        <span>${esc(resourceId)}</span>
      </div>
      <h2>Data Preview</h2>
      ${columns.length ? `
        <div class="schema-section">
          <h3>Schema (${columns.length} fields)</h3>
          <div class="schema-fields">
            ${columns.map(c => `<span class="schema-field">${esc(c.name || c)} <span class="field-type">${esc(c.type || "")}</span></span>`).join("")}
          </div>
        </div>
      ` : ""}
      ${rows.length ? `
        <div class="data-preview">
          <h3>Sample Data (${rows.length} rows)</h3>
          <div class="table-scroll">
            <table class="data-table">
              <thead><tr>${(columns.length ? columns : Object.keys(rows[0] || {})).map(c =>
                `<th>${esc(typeof c === "string" ? c : c.name || c)}</th>`).join("")}</tr></thead>
              <tbody>${rows.map(row => `<tr>${(columns.length ? columns : Object.keys(row)).map(c => {
                const key = typeof c === "string" ? c : c.name || c;
                return `<td>${formatValue(row[key])}</td>`;
              }).join("")}</tr>`).join("")}</tbody>
            </table>
          </div>
        </div>
      ` : '<div class="empty-state">No data available</div>'}
    </div>
  `;
}

function buildHealthMap(health) {
  const map = {};
  if (!health) return map;
  const items = Array.isArray(health) ? health : (health.entries || health.data || []);
  for (const h of items) {
    map[h.catalog_id || h.id] = h.status || h.health;
  }
  return map;
}
```

- [ ] **Step 4: Build and verify Vega tab works**

Run: `cd packages/typescript && npm run build && node dist/cli.js explore --no-open`
Open `http://localhost:3721/#/vega` — should see catalog list with health indicators.

- [ ] **Step 5: Commit**

```bash
git add packages/typescript/src/commands/explore-vega.ts \
       packages/typescript/src/templates/explorer/vega.js \
       packages/typescript/src/commands/explore.ts
git commit -m "feat(explore): implement Vega tab with catalog browsing and data preview"
```

---

### Task 10: Cleanup and integration test

**Files:**
- Modify: `packages/typescript/test/explore.test.ts` (add integration-level tests)
- Modify: `packages/typescript/package.json` (update build script if needed)

- [ ] **Step 1: Update build script for new template directory**

In `packages/typescript/package.json`, the build script already copies `src/templates` → `dist/templates`. Since we renamed `bkn-explorer/` to `explorer/`, no build script change is needed — the `cp -r src/templates dist/` command copies the whole directory.

Verify: `cd packages/typescript && npm run build && ls dist/templates/explorer/`
Expected: `index.html app.js dashboard.js bkn.js chat.js vega.js style.css`

- [ ] **Step 2: Add route dispatch tests**

```typescript
// Add to packages/typescript/test/explore.test.ts

describe("parseExploreArgs edge cases", () => {
  it("--kn and --agent together", () => {
    const opts = parseExploreArgs(["--kn", "kn-1", "--agent", "ag-2"]);
    expect(opts.knId).toBe("kn-1");
    expect(opts.agentId).toBe("ag-2");
  });

  it("all flags combined", () => {
    const opts = parseExploreArgs(["--kn", "kn-1", "--agent", "ag-2", "--port", "5000", "--no-open", "-bd", "test"]);
    expect(opts.knId).toBe("kn-1");
    expect(opts.agentId).toBe("ag-2");
    expect(opts.port).toBe(5000);
    expect(opts.open).toBe(false);
    expect(opts.businessDomain).toBe("test");
  });
});
```

- [ ] **Step 3: Run full test suite**

Run: `cd packages/typescript && npx vitest run`
Expected: ALL PASS

- [ ] **Step 4: Manual smoke test**

Run: `cd packages/typescript && npm run build && node dist/cli.js explore`

Verify:
1. Browser opens to Dashboard with summary cards
2. Click a KN → navigates to BKN tab, loads schema
3. Click Chat tab → see agent list, select agent, send message
4. Click Vega tab → see catalog list with health indicators
5. Tab highlighting follows navigation
6. Cross-tab links work (e.g. from dashboard card → tab)

- [ ] **Step 5: Commit**

```bash
git add packages/typescript/test/explore.test.ts
git commit -m "test(explore): add arg parsing edge case tests"
```

- [ ] **Step 6: Final cleanup commit**

Remove any remaining references to `bkn-explore` or `bkn-explorer` in the codebase (grep to verify).

```bash
git add -A
git commit -m "chore(explore): remove all bkn-explore references"
```
