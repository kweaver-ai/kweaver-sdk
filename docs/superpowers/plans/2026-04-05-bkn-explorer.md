# BKN Explorer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `kweaver bkn explore` command that launches a local browser-based knowledge network viewer with list/card/crosslink navigation.

**Architecture:** CLI command starts a Node `http` server that serves static HTML/CSS/JS and proxies API requests to the real BKN backend via SDK functions. The frontend is a vanilla SPA using hash routing.

**Tech Stack:** Node `http` module, vanilla HTML/CSS/JS, existing API functions from `api/knowledge-networks.ts`, `api/ontology-query.ts`, `api/semantic-search.ts`.

**Spec:** `docs/superpowers/specs/2026-04-05-bkn-explorer-design.md`

---

## File Structure

```
packages/typescript/
  src/
    commands/bkn-explore.ts       — CLI command: arg parsing, KN selection, HTTP server, browser open
    templates/bkn-explorer/
      index.html                  — SPA entry point
      style.css                   — Global styles
      app.js                      — Router, API calls, rendering
  test/
    bkn-explore.test.ts           — Unit tests for arg parsing and server route handling
```

Build change: add `cp -r src/templates dist/` to the build script so static files land in `dist/templates/` alongside compiled JS.

---

### Task 1: Build pipeline — copy templates to dist

**Files:**
- Modify: `packages/typescript/package.json:27` (build script)

- [ ] **Step 1: Add template copy to build script**

In `packages/typescript/package.json`, change line 27:

```json
"build": "tsc -p tsconfig.json && cp -r src/templates dist/ 2>/dev/null || true",
```

The `2>/dev/null || true` prevents failure if templates dir doesn't exist yet (other devs building before templates are added).

- [ ] **Step 2: Add templates dir to package files**

In `packages/typescript/package.json`, change the `files` array (line 21-24):

```json
"files": [
  "bin",
  "dist"
],
```

No change needed — `dist` already covers `dist/templates/`.

- [ ] **Step 3: Create empty templates directory**

```bash
mkdir -p packages/typescript/src/templates/bkn-explorer
```

- [ ] **Step 4: Verify build works**

```bash
cd packages/typescript && npm run build
```

Expected: Build succeeds, `dist/templates/bkn-explorer/` is created (empty).

- [ ] **Step 5: Commit**

```bash
git add packages/typescript/package.json packages/typescript/src/templates/bkn-explorer
git commit -m "chore: add template copy step to build for bkn-explorer"
```

---

### Task 2: Arg parsing and KN selection — `bkn-explore.ts`

**Files:**
- Create: `packages/typescript/src/commands/bkn-explore.ts`
- Test: `packages/typescript/test/bkn-explore.test.ts`

- [ ] **Step 1: Write failing test for arg parsing**

Create `packages/typescript/test/bkn-explore.test.ts`:

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { parseKnExploreArgs } from "../src/commands/bkn-explore.js";

test("parseKnExploreArgs: kn-id only", () => {
  const opts = parseKnExploreArgs(["kn-abc123"]);
  assert.equal(opts.knId, "kn-abc123");
  assert.equal(opts.port, 3721);
  assert.equal(opts.open, true);
});

test("parseKnExploreArgs: --port and --no-open", () => {
  const opts = parseKnExploreArgs(["kn-abc123", "--port", "8080", "--no-open"]);
  assert.equal(opts.knId, "kn-abc123");
  assert.equal(opts.port, 8080);
  assert.equal(opts.open, false);
});

test("parseKnExploreArgs: no args returns empty knId", () => {
  const opts = parseKnExploreArgs([]);
  assert.equal(opts.knId, "");
  assert.equal(opts.port, 3721);
});

test("parseKnExploreArgs: --help throws", () => {
  assert.throws(() => parseKnExploreArgs(["--help"]), { message: "help" });
});

test("parseKnExploreArgs: -bd flag", () => {
  const opts = parseKnExploreArgs(["kn-abc123", "-bd", "my_domain"]);
  assert.equal(opts.businessDomain, "my_domain");
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/typescript && node --import tsx --test test/bkn-explore.test.ts
```

Expected: FAIL — module `../src/commands/bkn-explore.js` not found.

- [ ] **Step 3: Implement arg parsing and help text**

Create `packages/typescript/src/commands/bkn-explore.ts`:

```typescript
import { createInterface } from "node:readline";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";
import { execSync } from "node:child_process";
import { ensureValidToken, formatHttpError, with401RefreshRetry } from "../auth/oauth.js";
import {
  listKnowledgeNetworks,
  getKnowledgeNetwork,
  listObjectTypes,
  listRelationTypes,
  listActionTypes,
} from "../api/knowledge-networks.js";
import { objectTypeQuery, objectTypeProperties, subgraph } from "../api/ontology-query.js";
import { semanticSearch } from "../api/semantic-search.js";
import { resolveBusinessDomain } from "../config/store.js";

const KN_EXPLORE_HELP = `kweaver bkn explore [kn-id] [options]

Launch interactive knowledge network explorer in the browser.
If no kn-id is provided, you'll be prompted to select one.

Options:
  --port <n>           Port for local server (default: 3721)
  --no-open            Don't automatically open browser
  -bd, --biz-domain    Override x-business-domain`;

export interface KnExploreOptions {
  knId: string;
  port: number;
  open: boolean;
  businessDomain: string;
}

export function parseKnExploreArgs(args: string[]): KnExploreOptions {
  let knId = "";
  let port = 3721;
  let open = true;
  let businessDomain = "";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      throw new Error("help");
    } else if (arg === "--port" && i + 1 < args.length) {
      port = parseInt(args[++i], 10);
    } else if (arg === "--no-open") {
      open = false;
    } else if ((arg === "-bd" || arg === "--biz-domain") && i + 1 < args.length) {
      businessDomain = args[++i];
    } else if (!arg.startsWith("-") && !knId) {
      knId = arg;
    }
  }

  return { knId, port, open, businessDomain };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/typescript && node --import tsx --test test/bkn-explore.test.ts
```

Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/typescript/src/commands/bkn-explore.ts packages/typescript/test/bkn-explore.test.ts
git commit -m "feat(explore): add arg parsing for bkn explore command"
```

---

### Task 3: Interactive KN selection

**Files:**
- Modify: `packages/typescript/src/commands/bkn-explore.ts`

- [ ] **Step 1: Add interactive selection function**

Append to `bkn-explore.ts` after `parseKnExploreArgs`:

```typescript
interface KnListEntry {
  id: string;
  name: string;
}

async function selectKnInteractive(
  baseUrl: string,
  accessToken: string,
  businessDomain: string,
): Promise<string> {
  const raw = await listKnowledgeNetworks({
    baseUrl,
    accessToken,
    businessDomain,
    offset: 0,
    limit: 50,
    sort: "update_time",
    direction: "desc",
  });
  const parsed = JSON.parse(raw) as { entries?: Array<Record<string, unknown>> };
  const entries: KnListEntry[] = (parsed.entries ?? []).map((e) => ({
    id: typeof e.id === "string" ? e.id : "",
    name: typeof e.name === "string" ? e.name : "",
  })).filter((e) => e.id);

  if (entries.length === 0) {
    throw new Error("No knowledge networks found. Create one first with `kweaver bkn create`.");
  }

  console.log("\nAvailable knowledge networks:\n");
  entries.forEach((e, i) => {
    console.log(`  ${i + 1}) ${e.name} (${e.id})`);
  });
  console.log();

  return new Promise((resolve, reject) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question("Select a knowledge network (number): ", (answer) => {
      rl.close();
      const idx = parseInt(answer.trim(), 10) - 1;
      if (idx >= 0 && idx < entries.length) {
        resolve(entries[idx].id);
      } else {
        reject(new Error("Invalid selection"));
      }
    });
  });
}
```

- [ ] **Step 2: Verify build compiles**

```bash
cd packages/typescript && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add packages/typescript/src/commands/bkn-explore.ts
git commit -m "feat(explore): add interactive KN selection"
```

---

### Task 4: Local HTTP server with meta endpoint

**Files:**
- Modify: `packages/typescript/src/commands/bkn-explore.ts`
- Test: `packages/typescript/test/bkn-explore.test.ts`

- [ ] **Step 1: Write failing test for meta data loading**

Add to `test/bkn-explore.test.ts`:

```typescript
import { buildMeta } from "../src/commands/bkn-explore.js";

test("buildMeta: assembles schema from raw API responses", () => {
  const knRaw = JSON.stringify({
    id: "kn-1",
    name: "Test KN",
    statistics: { object_count: 10, relation_count: 5 },
  });
  const otRaw = JSON.stringify({
    object_types: [
      { id: "ot-1", name: "Person", display_key: "name", properties: [{ name: "a" }, { name: "b" }] },
    ],
  });
  const rtRaw = JSON.stringify({
    relation_types: [
      { id: "rt-1", name: "knows", source_object_type_id: "ot-1", target_object_type_id: "ot-1",
        source_object_type: { name: "Person" }, target_object_type: { name: "Person" } },
    ],
  });
  const atRaw = JSON.stringify({
    action_types: [{ id: "at-1", name: "Analyze" }],
  });

  const meta = buildMeta(knRaw, otRaw, rtRaw, atRaw);
  assert.equal(meta.bkn.id, "kn-1");
  assert.equal(meta.bkn.name, "Test KN");
  assert.equal(meta.objectTypes.length, 1);
  assert.equal(meta.objectTypes[0].name, "Person");
  assert.equal(meta.objectTypes[0].propertyCount, 2);
  assert.equal(meta.relationTypes.length, 1);
  assert.equal(meta.relationTypes[0].sourceOtName, "Person");
  assert.equal(meta.actionTypes.length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/typescript && node --import tsx --test test/bkn-explore.test.ts
```

Expected: FAIL — `buildMeta` not exported.

- [ ] **Step 3: Implement buildMeta**

Add to `bkn-explore.ts`:

```typescript
export interface ExploreMeta {
  bkn: { id: string; name: string };
  statistics: { object_count: number; relation_count: number };
  objectTypes: Array<{
    id: string;
    name: string;
    displayKey: string;
    propertyCount: number;
    properties: Array<{ name: string; type?: string }>;
  }>;
  relationTypes: Array<{
    id: string;
    name: string;
    sourceOtId: string;
    targetOtId: string;
    sourceOtName: string;
    targetOtName: string;
  }>;
  actionTypes: Array<{ id: string; name: string }>;
}

export function buildMeta(
  knRaw: string,
  otRaw: string,
  rtRaw: string,
  atRaw: string,
): ExploreMeta {
  const kn = JSON.parse(knRaw) as Record<string, unknown>;
  const stats = (kn.statistics ?? {}) as Record<string, number>;

  const otParsed = JSON.parse(otRaw) as { object_types?: Array<Record<string, unknown>> };
  const objectTypes = (otParsed.object_types ?? []).map((ot) => ({
    id: String(ot.id ?? ""),
    name: String(ot.name ?? ""),
    displayKey: String(ot.display_key ?? ""),
    propertyCount: Array.isArray(ot.properties) ? ot.properties.length : 0,
    properties: Array.isArray(ot.properties)
      ? (ot.properties as Array<Record<string, unknown>>).map((p) => ({
          name: String(p.name ?? ""),
          type: typeof p.type === "string" ? p.type : undefined,
        }))
      : [],
  }));

  const rtParsed = JSON.parse(rtRaw) as { relation_types?: Array<Record<string, unknown>> };
  const relationTypes = (rtParsed.relation_types ?? []).map((rt) => {
    const src = (rt.source_object_type ?? {}) as Record<string, unknown>;
    const tgt = (rt.target_object_type ?? {}) as Record<string, unknown>;
    return {
      id: String(rt.id ?? ""),
      name: String(rt.name ?? ""),
      sourceOtId: String(rt.source_object_type_id ?? ""),
      targetOtId: String(rt.target_object_type_id ?? ""),
      sourceOtName: String(src.name ?? ""),
      targetOtName: String(tgt.name ?? ""),
    };
  });

  const atParsed = JSON.parse(atRaw) as { action_types?: Array<Record<string, unknown>> };
  const actionTypes = (atParsed.action_types ?? []).map((at) => ({
    id: String(at.id ?? ""),
    name: String(at.name ?? ""),
  }));

  return {
    bkn: { id: String(kn.id ?? ""), name: String(kn.name ?? "") },
    statistics: {
      object_count: stats.object_count ?? 0,
      relation_count: stats.relation_count ?? 0,
    },
    objectTypes,
    relationTypes,
    actionTypes,
  };
}
```

- [ ] **Step 4: Run tests**

```bash
cd packages/typescript && node --import tsx --test test/bkn-explore.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Implement HTTP server and API routes**

Add to `bkn-explore.ts`:

```typescript
const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
};

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

function jsonResponse(res: ServerResponse, data: unknown, status = 200): void {
  const body = JSON.stringify(data);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

function errorResponse(res: ServerResponse, error: unknown, status = 500): void {
  const message = error instanceof Error ? error.message : String(error);
  jsonResponse(res, { error: message }, status);
}

interface ServerContext {
  meta: ExploreMeta;
  baseUrl: string;
  accessToken: string;
  knId: string;
  businessDomain: string;
  templateDir: string;
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const path = url.pathname;

  // API routes
  if (path === "/api/meta" && req.method === "GET") {
    jsonResponse(res, ctx.meta);
    return;
  }

  if (path === "/api/instances" && req.method === "POST") {
    const body = JSON.parse(await readBody(req)) as {
      otId: string;
      page?: number;
      limit?: number;
      condition?: unknown;
      search_after?: unknown[];
    };
    const queryBody: Record<string, unknown> = {};
    if (body.condition) queryBody.condition = body.condition;
    if (body.search_after) queryBody.search_after = body.search_after;
    if (body.limit) queryBody.limit = body.limit;
    const raw = await objectTypeQuery({
      baseUrl: ctx.baseUrl,
      accessToken: ctx.accessToken,
      knId: ctx.knId,
      otId: body.otId,
      body: JSON.stringify(queryBody),
      businessDomain: ctx.businessDomain,
    });
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(raw);
    return;
  }

  if (path === "/api/subgraph" && req.method === "POST") {
    const body = await readBody(req);
    const raw = await subgraph({
      baseUrl: ctx.baseUrl,
      accessToken: ctx.accessToken,
      knId: ctx.knId,
      body,
      businessDomain: ctx.businessDomain,
    });
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(raw);
    return;
  }

  if (path === "/api/search" && req.method === "POST") {
    const body = JSON.parse(await readBody(req)) as {
      query: string;
      maxConcepts?: number;
    };
    const raw = await semanticSearch({
      baseUrl: ctx.baseUrl,
      accessToken: ctx.accessToken,
      knId: ctx.knId,
      query: body.query,
      businessDomain: ctx.businessDomain,
      maxConcepts: body.maxConcepts ?? 20,
    });
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(raw);
    return;
  }

  if (path === "/api/properties" && req.method === "POST") {
    const body = await readBody(req);
    const parsed = JSON.parse(body) as { otId: string };
    const raw = await objectTypeProperties({
      baseUrl: ctx.baseUrl,
      accessToken: ctx.accessToken,
      knId: ctx.knId,
      otId: parsed.otId,
      body,
      businessDomain: ctx.businessDomain,
    });
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(raw);
    return;
  }

  // Static files
  let filePath = path === "/" ? "/index.html" : path;
  const ext = extname(filePath);
  const mime = MIME_TYPES[ext];
  if (!mime) {
    // SPA fallback: serve index.html for unknown paths (hash routing handles it)
    filePath = "/index.html";
  }
  try {
    const content = readFileSync(join(ctx.templateDir, filePath), "utf-8");
    res.writeHead(200, { "Content-Type": MIME_TYPES[extname(filePath)] ?? "text/html; charset=utf-8" });
    res.end(content);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  }
}
```

- [ ] **Step 6: Implement main command function**

Add to `bkn-explore.ts`:

```typescript
export async function runKnExploreCommand(args: string[]): Promise<number> {
  let options: KnExploreOptions;
  try {
    options = parseKnExploreArgs(args);
  } catch (error) {
    if (error instanceof Error && error.message === "help") {
      console.log(KN_EXPLORE_HELP);
      return 0;
    }
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  try {
    const token = await ensureValidToken();
    const businessDomain = options.businessDomain || resolveBusinessDomain();

    let knId = options.knId;
    if (!knId) {
      knId = await selectKnInteractive(token.baseUrl, token.accessToken, businessDomain);
    }

    console.log("Loading schema...");
    const [knRaw, otRaw, rtRaw, atRaw] = await Promise.all([
      getKnowledgeNetwork({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        knId,
        businessDomain,
        include_statistics: true,
      }),
      listObjectTypes({ baseUrl: token.baseUrl, accessToken: token.accessToken, knId, businessDomain }),
      listRelationTypes({ baseUrl: token.baseUrl, accessToken: token.accessToken, knId, businessDomain }),
      listActionTypes({ baseUrl: token.baseUrl, accessToken: token.accessToken, knId, businessDomain }),
    ]);

    const meta = buildMeta(knRaw, otRaw, rtRaw, atRaw);

    // Resolve template directory
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const templateDir = join(__dirname, "templates", "bkn-explorer");

    const ctx: ServerContext = {
      meta,
      baseUrl: token.baseUrl,
      accessToken: token.accessToken,
      knId,
      businessDomain,
      templateDir,
    };

    const server = createServer(async (req, res) => {
      try {
        await handleRequest(req, res, ctx);
      } catch (error) {
        errorResponse(res, error);
      }
    });

    return new Promise((resolve) => {
      server.listen(options.port, () => {
        const url = `http://localhost:${options.port}`;
        console.log(`\n  BKN Explorer: ${meta.bkn.name}`);
        console.log(`  ${url}\n`);
        console.log("  Press Ctrl+C to stop\n");

        if (options.open) {
          const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
          try {
            execSync(`${cmd} ${url}`, { stdio: "ignore" });
          } catch {
            // Ignore — user can open manually
          }
        }
      });

      process.on("SIGINT", () => {
        console.log("\nStopping...");
        server.close(() => resolve(0));
      });
    });
  } catch (error) {
    console.error(formatHttpError(error));
    return 1;
  }
}
```

- [ ] **Step 7: Verify build compiles**

```bash
cd packages/typescript && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 8: Commit**

```bash
git add packages/typescript/src/commands/bkn-explore.ts packages/typescript/test/bkn-explore.test.ts
git commit -m "feat(explore): add HTTP server, API routes, and main command"
```

---

### Task 5: Wire explore into CLI dispatch

**Files:**
- Modify: `packages/typescript/src/commands/bkn.ts:0-610`

- [ ] **Step 1: Add import**

At the top of `packages/typescript/src/commands/bkn.ts`, after line 36 (`} from "./bkn-ops.js";`), add:

```typescript
import { runKnExploreCommand } from "./bkn-explore.js";
```

- [ ] **Step 2: Add to help text**

In the `KN_HELP` string, after the `resources` line (line 571), add:

```
  explore [kn-id] [--port n] [--no-open]   Launch browser-based KN explorer
```

- [ ] **Step 3: Add dispatch case**

After line 610 (`if (subcommand === "resources") return runKnResourcesCommand(rest);`), add:

```typescript
    if (subcommand === "explore") return runKnExploreCommand(rest);
```

- [ ] **Step 4: Verify build compiles**

```bash
cd packages/typescript && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add packages/typescript/src/commands/bkn.ts
git commit -m "feat(explore): wire explore subcommand into bkn dispatch"
```

---

### Task 6: Frontend — index.html

**Files:**
- Create: `packages/typescript/src/templates/bkn-explorer/index.html`

- [ ] **Step 1: Create index.html**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>BKN Explorer</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <div id="app">
    <header>
      <div class="header-inner">
        <a href="#/" class="logo">BKN Explorer</a>
        <div class="search-box">
          <input type="text" id="search-input" placeholder="语义搜索..." />
          <button id="search-btn">搜索</button>
        </div>
      </div>
    </header>

    <nav id="sidebar">
      <div class="nav-section">
        <h3>对象类</h3>
        <ul id="nav-ot-list"></ul>
      </div>
      <div class="nav-section">
        <h3>关系类</h3>
        <ul id="nav-rt-list"></ul>
      </div>
    </nav>

    <main id="content">
      <div id="loading">加载中...</div>
    </main>
  </div>

  <script src="/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add packages/typescript/src/templates/bkn-explorer/index.html
git commit -m "feat(explore): add index.html template"
```

---

### Task 7: Frontend — style.css

**Files:**
- Create: `packages/typescript/src/templates/bkn-explorer/style.css`

- [ ] **Step 1: Create style.css**

```css
* { margin: 0; padding: 0; box-sizing: border-box; }

:root {
  --bg: #fafafa;
  --surface: #fff;
  --text: #1a1a1a;
  --text-secondary: #666;
  --border: #e5e5e5;
  --accent: #2563eb;
  --accent-light: #eff6ff;
  --sidebar-width: 240px;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: var(--bg);
  color: var(--text);
  line-height: 1.6;
}

/* Header */
header {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 56px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  z-index: 100;
}

.header-inner {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 24px;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.logo {
  font-size: 18px;
  font-weight: 700;
  color: var(--text);
  text-decoration: none;
}

.search-box {
  display: flex;
  gap: 8px;
}

.search-box input {
  width: 300px;
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 14px;
  outline: none;
}

.search-box input:focus {
  border-color: var(--accent);
}

.search-box button {
  padding: 6px 16px;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
}

/* Sidebar */
#sidebar {
  position: fixed;
  top: 56px;
  left: 0;
  bottom: 0;
  width: var(--sidebar-width);
  background: var(--surface);
  border-right: 1px solid var(--border);
  padding: 16px;
  overflow-y: auto;
}

.nav-section { margin-bottom: 24px; }

.nav-section h3 {
  font-size: 12px;
  text-transform: uppercase;
  color: var(--text-secondary);
  margin-bottom: 8px;
  letter-spacing: 0.5px;
}

.nav-section ul { list-style: none; }

.nav-section li a {
  display: block;
  padding: 4px 8px;
  color: var(--text);
  text-decoration: none;
  font-size: 14px;
  border-radius: 4px;
}

.nav-section li a:hover {
  background: var(--accent-light);
  color: var(--accent);
}

/* Main content */
main {
  margin-top: 56px;
  margin-left: var(--sidebar-width);
  padding: 32px;
  max-width: 900px;
}

/* Home page */
.stats-row {
  display: flex;
  gap: 16px;
  margin-bottom: 32px;
}

.stat-card {
  flex: 1;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 20px;
  text-align: center;
}

.stat-card .number {
  font-size: 32px;
  font-weight: 700;
  color: var(--accent);
}

.stat-card .label {
  font-size: 13px;
  color: var(--text-secondary);
  margin-top: 4px;
}

/* OT cards */
.ot-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 16px;
}

.ot-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 20px;
  cursor: pointer;
  transition: border-color 0.15s;
}

.ot-card:hover {
  border-color: var(--accent);
}

.ot-card h3 {
  font-size: 16px;
  margin-bottom: 8px;
}

.ot-card .meta {
  font-size: 13px;
  color: var(--text-secondary);
}

/* Instance list */
.instance-list {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
}

.instance-item {
  padding: 12px 20px;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
}

.instance-item:last-child { border-bottom: none; }
.instance-item:hover { background: var(--accent-light); }

.instance-item .name {
  font-weight: 500;
}

/* Instance detail */
.detail-section {
  margin-bottom: 32px;
}

.detail-section h2 {
  font-size: 18px;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border);
}

.props-table {
  width: 100%;
  border-collapse: collapse;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}

.props-table td {
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
  font-size: 14px;
}

.props-table td:first-child {
  width: 180px;
  font-weight: 500;
  color: var(--text-secondary);
  background: #fafafa;
}

/* Links */
.relation-group {
  margin-bottom: 16px;
}

.relation-group h4 {
  font-size: 14px;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.link-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.link-tag {
  display: inline-block;
  padding: 4px 12px;
  background: var(--accent-light);
  color: var(--accent);
  border-radius: 999px;
  font-size: 13px;
  text-decoration: none;
}

.link-tag:hover {
  background: var(--accent);
  color: #fff;
}

/* Search results */
.search-result {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 16px 20px;
  margin-bottom: 12px;
  cursor: pointer;
}

.search-result:hover { border-color: var(--accent); }

.search-result .type-badge {
  display: inline-block;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  background: #f0f0f0;
  color: var(--text-secondary);
  margin-right: 8px;
}

.search-result .score {
  float: right;
  font-size: 12px;
  color: var(--text-secondary);
}

/* Pagination */
.pagination {
  display: flex;
  justify-content: center;
  gap: 8px;
  margin-top: 24px;
}

.pagination button {
  padding: 8px 16px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  cursor: pointer;
  font-size: 14px;
}

.pagination button:hover { border-color: var(--accent); color: var(--accent); }
.pagination button:disabled { opacity: 0.4; cursor: default; }

/* Page title */
.page-title {
  font-size: 24px;
  font-weight: 700;
  margin-bottom: 8px;
}

.page-subtitle {
  font-size: 14px;
  color: var(--text-secondary);
  margin-bottom: 24px;
}

/* Breadcrumb */
.breadcrumb {
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 16px;
}

.breadcrumb a {
  color: var(--accent);
  text-decoration: none;
}

#loading {
  text-align: center;
  padding: 80px 0;
  color: var(--text-secondary);
  font-size: 16px;
}

/* Responsive */
@media (max-width: 768px) {
  #sidebar { display: none; }
  main { margin-left: 0; }
  .search-box input { width: 180px; }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/typescript/src/templates/bkn-explorer/style.css
git commit -m "feat(explore): add style.css template"
```

---

### Task 8: Frontend — app.js (router + API client + renderers)

**Files:**
- Create: `packages/typescript/src/templates/bkn-explorer/app.js`

- [ ] **Step 1: Create app.js**

```javascript
// ── State ────────────────────────────────────────────────────────────────────
let META = null;
const PAGE_SIZE = 30;

// ── API ──────────────────────────────────────────────────────────────────────
async function api(path, body) {
  const opts = body != null
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    : { method: "GET" };
  const res = await fetch(path, opts);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

async function loadMeta() {
  META = await api("/api/meta");
  return META;
}

async function queryInstances(otId, opts = {}) {
  return api("/api/instances", { otId, limit: opts.limit ?? PAGE_SIZE, search_after: opts.searchAfter, condition: opts.condition });
}

async function querySubgraph(body) {
  return api("/api/subgraph", body);
}

async function search(query) {
  return api("/api/search", { query, maxConcepts: 30 });
}

// ── Router ───────────────────────────────────────────────────────────────────
function getRoute() {
  const hash = location.hash.slice(1) || "/";
  if (hash === "/") return { view: "home" };
  const otMatch = hash.match(/^\/ot\/(.+)$/);
  if (otMatch) return { view: "ot", otId: decodeURIComponent(otMatch[1]) };
  const instanceMatch = hash.match(/^\/instance\/([^/]+)\/(.+)$/);
  if (instanceMatch) return { view: "instance", otId: decodeURIComponent(instanceMatch[1]), instanceId: decodeURIComponent(instanceMatch[2]) };
  const searchMatch = hash.match(/^\/search\?q=(.+)$/);
  if (searchMatch) return { view: "search", query: decodeURIComponent(searchMatch[1]) };
  return { view: "home" };
}

async function navigate() {
  const route = getRoute();
  const content = document.getElementById("content");
  content.innerHTML = '<div id="loading">加载中...</div>';
  try {
    if (route.view === "home") await renderHome(content);
    else if (route.view === "ot") await renderOtList(content, route.otId);
    else if (route.view === "instance") await renderInstance(content, route.otId, route.instanceId);
    else if (route.view === "search") await renderSearch(content, route.query);
  } catch (err) {
    content.innerHTML = `<div class="page-title">Error</div><p>${err.message}</p>`;
  }
}

// ── Renderers ────────────────────────────────────────────────────────────────
function renderHome(el) {
  const m = META;
  const otCount = m.objectTypes.length;
  const rtCount = m.relationTypes.length;

  el.innerHTML = `
    <h1 class="page-title">${esc(m.bkn.name)}</h1>
    <p class="page-subtitle">知识网络浏览器</p>

    <div class="stats-row">
      <div class="stat-card">
        <div class="number">${otCount}</div>
        <div class="label">对象类</div>
      </div>
      <div class="stat-card">
        <div class="number">${m.statistics.object_count || "—"}</div>
        <div class="label">实例总数</div>
      </div>
      <div class="stat-card">
        <div class="number">${rtCount}</div>
        <div class="label">关系类</div>
      </div>
      <div class="stat-card">
        <div class="number">${m.statistics.relation_count || "—"}</div>
        <div class="label">关系总数</div>
      </div>
    </div>

    <h2 style="font-size:18px; margin-bottom:16px;">对象类</h2>
    <div class="ot-grid">
      ${m.objectTypes.map(ot => `
        <a href="#/ot/${enc(ot.id)}" class="ot-card" style="text-decoration:none;color:inherit;">
          <h3>${esc(ot.name)}</h3>
          <div class="meta">${ot.propertyCount} 个属性</div>
        </a>
      `).join("")}
    </div>
  `;
}

async function renderOtList(el, otId) {
  const ot = META.objectTypes.find(o => o.id === otId);
  if (!ot) { el.innerHTML = "<p>未找到对象类</p>"; return; }

  el.innerHTML = `
    <div class="breadcrumb"><a href="#/">首页</a> / ${esc(ot.name)}</div>
    <h1 class="page-title">${esc(ot.name)}</h1>
    <p class="page-subtitle">显示键: ${esc(ot.displayKey)} · ${ot.propertyCount} 个属性</p>
    <div id="instance-container"><div id="loading">加载实例...</div></div>
    <div id="pagination-container"></div>
  `;

  await loadInstances(otId, ot.displayKey);
}

async function loadInstances(otId, displayKey, searchAfter) {
  const data = await queryInstances(otId, { searchAfter });
  const container = document.getElementById("instance-container");
  const items = data.datas ?? data.entries ?? [];

  if (items.length === 0) {
    container.innerHTML = "<p style='padding:20px;color:#666;'>暂无实例</p>";
    return;
  }

  container.innerHTML = `<div class="instance-list">
    ${items.map(item => {
      const identity = item._instance_identity ?? {};
      const pk = Object.entries(identity).map(([k,v]) => `${k}=${v}`).join("&");
      const name = item[displayKey] ?? Object.values(identity)[0] ?? "—";
      return `<a href="#/instance/${enc(otId)}/${enc(pk)}" class="instance-item" style="display:block;text-decoration:none;color:inherit;">
        <div class="name">${esc(String(name))}</div>
      </a>`;
    }).join("")}
  </div>`;

  // Pagination
  const pag = document.getElementById("pagination-container");
  if (items.length >= PAGE_SIZE && data.search_after) {
    pag.innerHTML = `<div class="pagination"><button id="next-page">下一页</button></div>`;
    document.getElementById("next-page").onclick = () => loadInstances(otId, displayKey, data.search_after);
  } else {
    pag.innerHTML = "";
  }
}

async function renderInstance(el, otId, instanceId) {
  const ot = META.objectTypes.find(o => o.id === otId);
  if (!ot) { el.innerHTML = "<p>未找到对象类</p>"; return; }

  // Parse instance identity from "key=val&key2=val2"
  const identity = {};
  instanceId.split("&").forEach(pair => {
    const [k, ...rest] = pair.split("=");
    identity[decodeURIComponent(k)] = decodeURIComponent(rest.join("="));
  });

  // Query this specific instance
  const condition = {
    operation: "and",
    sub_conditions: Object.entries(identity).map(([field, value]) => ({
      field, operation: "eq", value_from: "const", value,
    })),
  };

  const data = await queryInstances(otId, { condition, limit: 1 });
  const items = data.datas ?? data.entries ?? [];
  const instance = items[0];

  if (!instance) {
    el.innerHTML = `<div class="breadcrumb"><a href="#/">首页</a> / <a href="#/ot/${enc(otId)}">${esc(ot.name)}</a></div><p>未找到实例</p>`;
    return;
  }

  const displayName = instance[ot.displayKey] ?? Object.values(identity)[0] ?? "—";

  // Properties table
  const props = Object.entries(instance).filter(([k]) => !k.startsWith("_"));
  const propsHtml = props.map(([k, v]) =>
    `<tr><td>${esc(k)}</td><td>${esc(formatValue(v))}</td></tr>`
  ).join("");

  el.innerHTML = `
    <div class="breadcrumb"><a href="#/">首页</a> / <a href="#/ot/${enc(otId)}">${esc(ot.name)}</a> / ${esc(String(displayName))}</div>
    <h1 class="page-title">${esc(String(displayName))}</h1>
    <p class="page-subtitle">${esc(ot.name)}</p>

    <div class="detail-section">
      <h2>属性</h2>
      <table class="props-table">${propsHtml}</table>
    </div>

    <div class="detail-section" id="relations-section">
      <h2>关联</h2>
      <div id="relations-loading">加载关联...</div>
    </div>
  `;

  // Load relations
  loadRelations(otId, identity);
}

async function loadRelations(otId, identity) {
  const container = document.getElementById("relations-loading");
  const relatedRts = META.relationTypes.filter(
    rt => rt.sourceOtId === otId || rt.targetOtId === otId
  );

  if (relatedRts.length === 0) {
    container.innerHTML = "<p style='color:#666;'>无关联关系</p>";
    return;
  }

  let html = "";
  for (const rt of relatedRts) {
    const isSource = rt.sourceOtId === otId;
    const targetOtId = isSource ? rt.targetOtId : rt.sourceOtId;
    const targetOt = META.objectTypes.find(o => o.id === targetOtId);
    if (!targetOt) continue;

    try {
      const body = {
        relation_type_paths: [{
          object_types: [
            { id: otId, condition: { operation: "and", sub_conditions: Object.entries(identity).map(([field, value]) => ({ field, operation: "eq", value_from: "const", value })) }, limit: 1 },
            { id: targetOtId, limit: 10 },
          ],
          relation_types: [{
            relation_type_id: rt.id,
            source_object_type_id: rt.sourceOtId,
            target_object_type_id: rt.targetOtId,
          }],
        }],
      };

      const result = await querySubgraph(body);
      const entries = result.entries ?? result.datas ?? [];

      if (entries.length === 0) continue;

      // Extract linked instances from subgraph result
      const links = extractLinkedInstances(entries, targetOtId, targetOt.displayKey);
      if (links.length === 0) continue;

      html += `<div class="relation-group">
        <h4>${esc(rt.name)} → ${esc(targetOt.name)}</h4>
        <div class="link-list">
          ${links.map(link =>
            `<a href="#/instance/${enc(targetOtId)}/${enc(link.pk)}" class="link-tag">${esc(link.name)}</a>`
          ).join("")}
        </div>
      </div>`;
    } catch {
      // Skip failed relation queries
    }
  }

  container.innerHTML = html || "<p style='color:#666;'>无关联实例</p>";
}

function extractLinkedInstances(entries, targetOtId, displayKey) {
  const results = [];
  const seen = new Set();

  function walk(obj) {
    if (!obj || typeof obj !== "object") return;
    if (Array.isArray(obj)) { obj.forEach(walk); return; }

    // Check if this is an instance of the target OT
    if (obj._instance_identity) {
      const identity = obj._instance_identity;
      const pk = Object.entries(identity).map(([k,v]) => `${k}=${v}`).join("&");
      if (!seen.has(pk)) {
        seen.add(pk);
        const name = obj[displayKey] ?? Object.values(identity)[0] ?? "—";
        results.push({ pk, name: String(name) });
      }
    }

    // Recurse into nested structures
    for (const val of Object.values(obj)) {
      walk(val);
    }
  }

  walk(entries);
  return results;
}

async function renderSearch(el, query) {
  el.innerHTML = `
    <div class="breadcrumb"><a href="#/">首页</a> / 搜索</div>
    <h1 class="page-title">搜索: ${esc(query)}</h1>
    <div id="search-results"><div id="loading">搜索中...</div></div>
  `;

  try {
    const data = await search(query);
    const concepts = data.concepts ?? [];
    const container = document.getElementById("search-results");

    if (concepts.length === 0) {
      container.innerHTML = "<p style='color:#666;'>未找到结果</p>";
      return;
    }

    container.innerHTML = concepts.map(c => {
      const ot = META.objectTypes.find(o => o.id === c.concept_type || o.name === c.concept_type);
      const otId = ot ? ot.id : c.concept_type;
      const otName = ot ? ot.name : c.concept_type;
      // Build a link using concept_id as primary key if possible
      const pk = c.concept_id ? `id=${c.concept_id}` : "";
      const href = pk ? `#/instance/${enc(otId)}/${enc(pk)}` : `#/ot/${enc(otId)}`;
      const score = (c.rerank_score ?? c.match_score ?? 0).toFixed(3);

      return `<a href="${href}" class="search-result" style="display:block;text-decoration:none;color:inherit;">
        <span class="score">${score}</span>
        <span class="type-badge">${esc(otName)}</span>
        <strong>${esc(c.concept_name)}</strong>
      </a>`;
    }).join("");
  } catch (err) {
    document.getElementById("search-results").innerHTML = `<p>搜索出错: ${esc(err.message)}</p>`;
  }
}

// ── Utilities ────────────────────────────────────────────────────────────────
function esc(s) {
  const div = document.createElement("div");
  div.textContent = s ?? "";
  return div.innerHTML;
}

function enc(s) {
  return encodeURIComponent(s);
}

function formatValue(v) {
  if (v == null) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

// ── Sidebar ──────────────────────────────────────────────────────────────────
function renderSidebar() {
  const otList = document.getElementById("nav-ot-list");
  otList.innerHTML = META.objectTypes.map(ot =>
    `<li><a href="#/ot/${enc(ot.id)}">${esc(ot.name)}</a></li>`
  ).join("");

  const rtList = document.getElementById("nav-rt-list");
  rtList.innerHTML = META.relationTypes.map(rt =>
    `<li><a href="#" style="cursor:default;color:var(--text-secondary);">${esc(rt.name)}<br><small>${esc(rt.sourceOtName)} → ${esc(rt.targetOtName)}</small></a></li>`
  ).join("");
}

// ── Search binding ───────────────────────────────────────────────────────────
function bindSearch() {
  const input = document.getElementById("search-input");
  const btn = document.getElementById("search-btn");

  function doSearch() {
    const q = input.value.trim();
    if (q) location.hash = `/search?q=${encodeURIComponent(q)}`;
  }

  btn.addEventListener("click", doSearch);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") doSearch(); });
}

// ── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  await loadMeta();
  document.title = `${META.bkn.name} — BKN Explorer`;
  renderSidebar();
  bindSearch();
  window.addEventListener("hashchange", navigate);
  navigate();
}

init();
```

- [ ] **Step 2: Verify build copies templates**

```bash
cd packages/typescript && npm run build && ls dist/templates/bkn-explorer/
```

Expected: `app.js  index.html  style.css`

- [ ] **Step 3: Commit**

```bash
git add packages/typescript/src/templates/bkn-explorer/app.js
git commit -m "feat(explore): add frontend SPA with router, API client, and renderers"
```

---

### Task 9: End-to-end manual test

**Files:** None (manual verification)

- [ ] **Step 1: Build the project**

```bash
cd packages/typescript && npm run build
```

Expected: Builds without errors, `dist/templates/bkn-explorer/` contains all 3 files.

- [ ] **Step 2: Test help output**

```bash
cd packages/typescript && node --import tsx src/cli.ts bkn explore --help
```

Expected: Prints the help text with usage, options.

- [ ] **Step 3: Test with a real BKN (if available)**

```bash
cd packages/typescript && node --import tsx src/cli.ts bkn explore
```

Expected: Lists available KNs, lets you pick one, opens browser with the explorer UI.

- [ ] **Step 4: Verify all pages work**

In the browser:
1. Home page: shows stats + OT cards
2. Click an OT card: shows instance list
3. Click an instance: shows properties + relations
4. Search box: returns results with scores
5. Cross-links: clicking relation links navigates to related instances

- [ ] **Step 5: Run all existing tests to check no regressions**

```bash
cd packages/typescript && npm test
```

Expected: All tests pass.

- [ ] **Step 6: Commit any fixes from manual testing**

```bash
git add -A && git commit -m "fix(explore): fixes from manual testing"
```

(Only if fixes were needed.)

---

### Task 10: Final commit and cleanup

- [ ] **Step 1: Run lint**

```bash
cd packages/typescript && npx tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 2: Run all tests**

```bash
cd packages/typescript && npm test
```

Expected: All pass.

- [ ] **Step 3: Verify clean git state**

```bash
git status
```

Expected: Clean working tree, all changes committed.
