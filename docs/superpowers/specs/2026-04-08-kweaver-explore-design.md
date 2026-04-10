# KWeaver Explore — Design Spec

**Date:** 2026-04-08
**Status:** Draft
**Supersedes:** 2026-04-05-bkn-explorer-design.md

## Overview

Upgrade `bkn explore` from a BKN-only subcommand to `kweaver explore` — a top-level command that launches a unified Web UI for interactive exploration of the KWeaver platform. Covers BKN (knowledge networks), Agent chat, and Vega (data sources) in a single SPA with tab-based navigation.

**Approach:** Incremental refactor of the existing `bkn-explore` implementation. No rewrite.

## Scope

**In scope (explore — read-only + chat):**
- Dashboard overview of all resources
- BKN schema browsing, instance querying, semantic search, subgraph traversal
- Agent chat with streaming responses and structured card rendering
- Vega catalog/resource browsing, data preview, health status, discover task progress
- Cross-tab navigation where data has explicit relationships

**Out of scope (admin — future):**
- Create/update/delete operations on any resource
- Admin tab reserved in routing but not implemented
- Will be added behind `--admin` flag or permission-gated when ready

## CLI Interface

```
kweaver explore [--port 3721] [--no-open] [--kn <id>] [--agent <id>] [-bd <domain>]
```

| Flag | Behavior |
|------|----------|
| (no flags) | Open Dashboard overview |
| `--kn <id>` | Open directly to BKN tab with specified KN selected |
| `--agent <id>` | Open directly to Chat tab with specified Agent selected |
| `--port <n>` | HTTP server port (default: 3721) |
| `--no-open` | Don't auto-open browser |
| `-bd <domain>` | Business domain override |

The `bkn explore` subcommand is removed. Only `kweaver explore` exists.

## Server Architecture

Single process, single port. The HTTP server proxies API calls to the KWeaver backend with transparent token management.

```
HTTP Server (:3721)
├── GET  /                                → SPA (index.html)
├── GET  /static/*                        → CSS/JS static assets
│
├── GET  /api/dashboard                   → Aggregated: KN list + Agent list + Vega Catalogs
│
├── BKN endpoints (carried over from bkn-explore)
│   ├── GET  /api/bkn/meta                → KN schema metadata
│   ├── POST /api/bkn/instances           → Instance query
│   ├── POST /api/bkn/subgraph            → Subgraph traversal
│   ├── POST /api/bkn/search              → Semantic search
│   └── POST /api/bkn/properties          → Property query
│
├── Chat endpoints (new)
│   ├── GET  /api/chat/agents             → Agent list
│   └── POST /api/chat/send               → Send message (streaming SSE)
│   (Chat history managed in-memory on frontend, no backend endpoint)
│
└── Vega endpoints (new)
    ├── GET  /api/vega/catalogs           → Catalog list + health status
    ├── GET  /api/vega/catalog-resources?catalogId=<id> → Resource list
    └── POST /api/vega/query              → Data preview query
```

### Token Management

- All API handlers wrapped with `ensureValidToken()` + `with401RefreshRetry()`
- 401 responses trigger automatic token refresh and retry
- Frontend is unaware of token lifecycle

### Error Handling

| Scenario | Behavior |
|----------|----------|
| API call fails | Inline error banner in affected area, other tabs unaffected |
| Network disconnected | Global top bar: "连接已断开" |
| Service unavailable (e.g. Vega not deployed) | Tab shows "服务不可用", other tabs work normally |
| Bootstrap partial failure | Failed module shows "加载失败，点击重试", others load normally |

Retry policy: 300ms delay, max 2 attempts (carried over from bkn-explore).

## Frontend Architecture

### Tech Stack

Vanilla HTML/CSS/JS. Zero dependencies. No build tools. Hash-based SPA routing.

### Routing

```
#/                                    → Dashboard
#/chat                                → Chat tab (Agent list)
#/chat/:agentId                       → Chat with specific Agent
#/bkn                                 → BKN tab (KN list)
#/bkn/:knId                           → KN detail (schema overview)
#/bkn/:knId/ot/:otId                  → Object Type instance list
#/bkn/:knId/instance/:otId/:id        → Instance detail
#/bkn/:knId/search?q=                 → Semantic search
#/vega                                → Vega tab (Catalog list)
#/vega/:catalogId                     → Catalog resources
#/vega/:catalogId/:resourceId         → Resource data preview
```

Tab highlight follows hash prefix automatically.

### Page Descriptions

**Dashboard (`#/`)**
- Three summary cards: KN count, Agent count, Vega Catalog count
- Resource lists below cards: clickable items navigate to respective tabs
- Parallel bootstrap: requests KN list, Agent list, Vega Catalogs concurrently; partial failure does not block

**Chat Tab (`#/chat`)**
- Left sidebar: Agent list, click to select
- Main area: conversation view with message bubbles
- Input bar at bottom with send button
- Streaming: `fetch` + `ReadableStream` for chunked response rendering
- Markdown rendering: minimal built-in md→html (headings, bold, lists, code blocks, links). No external library.
- Structured cards: when Agent response contains identifiable entity references (patterns like `ot-xxx`, `kn-xxx`, or structured JSON with `object_type_id` + `primary_key`), render as clickable cards with `↗ 在 BKN 中查看` link
- Conversation state: cached in memory per agent, not persisted. Closing page loses history.
- `conversationId` passed to API for multi-turn continuity

**BKN Tab (`#/bkn`)**
- Carried over from existing bkn-explorer with minimal changes
- Added KN selection list at `#/bkn` (previously handled by CLI interactive prompt)
- Views: KN home (stats + OT grid), OT instance list (with field picker, pagination), instance detail (properties + relations), relation type detail, semantic search
- Caches: instanceListCache, instanceDetailCache, subgraphCache, searchCache, rtDetailCache (5-min TTL)
- Concurrency: relation queries batch in groups of 3 with stale generation check

**Vega Tab (`#/vega`)**
- Catalog list with cards: name, type, connection status (🟢/🔴), resource count
- Discover Tasks section (collapsible): in-progress tasks with status
- Catalog detail (`#/vega/:catalogId`): resource table (name, type, field count)
- Resource detail (`#/vega/:catalogId/:resourceId`): schema info (field names, types) + data preview (first 20 rows, simple query support)

### Cross-Tab Navigation

Links appear only where data has explicit relationships:

| Context | Link | Target |
|---------|------|--------|
| Chat: Agent returns KN instance | `↗ 在 BKN 中查看` | `#/bkn/:knId/instance/:otId/:id` |
| BKN: data source reference | `↗ 在 Vega 中查看` | `#/vega/:catalogId/:resourceId` |
| Dashboard: resource count cards | Click count | Corresponding tab |

All navigation via unified `navigate(hash)` function.

### Tab Relationship

Tabs are loosely coupled. Each tab manages its own state and cache independently. Cross-tab jumps are implemented as hash navigation — no shared state, no event bus.

## File Structure

### Backend

```
src/commands/
├── explore.ts            ← Main entry: CLI args, server startup, static file serving
├── explore-bkn.ts        ← BKN API handlers (extracted from bkn-explore.ts)
├── explore-chat.ts       ← Chat API handlers (new)
├── explore-vega.ts       ← Vega API handlers (new)
```

Removed:
- `bkn-explore.ts` — replaced by explore.ts + explore-bkn.ts
- `bkn.ts` explore subcommand dispatch — removed

Changed:
- `cli.ts` — add `explore` as top-level command

### Frontend

```
src/templates/explorer/
├── index.html            ← Shell: top nav with tabs + content container
├── app.js                ← Router, tab switching, shared utilities (esc, enc, cache)
├── dashboard.js          ← Dashboard view
├── bkn.js                ← BKN views (extracted from existing app.js)
├── chat.js               ← Chat views (agent list, conversation, streaming, cards)
├── vega.js               ← Vega views (catalogs, resources, data preview, health)
└── style.css             ← Styles (extended from existing)
```

Removed:
- `src/templates/bkn-explorer/` — replaced by `src/templates/explorer/`

### Preserved

- Zero-dependency Vanilla JS principle
- Hash-based SPA routing pattern
- 5-minute TTL cache strategy
- Retry mechanism (300ms, 2 attempts)
- HTML escaping (`esc()`) for XSS prevention

## Future: Admin Tab

Architecture supports adding an Admin tab later:
- Route: `#/admin`
- Activation: `--admin` CLI flag or permission-based visibility
- Same SPA, same server, additional endpoints
- Not implemented in this iteration
