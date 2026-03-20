# E2E Examples Design

## Goal

Organize 5~6 runnable TypeScript examples that demonstrate the SDK's full capabilities through a progressive narrative: from first search to complete data-to-intelligence pipeline.

## Audience

Three layers, served by progressive difficulty:

| Layer | Audience | Examples |
|-------|----------|----------|
| Beginner | SDK new users | 01, 02 |
| Developer | App builders | 03, 04, 05 |
| Advanced | Platform integrators | 06 |

## Structure

```
examples/
  README.md                    # Overview + narrative + one-line per example
  setup.ts                     # Shared helpers: init client, find BKN, find agent
  01-quick-start.ts            # Configure + discover + search
  02-explore-schema.ts         # Schema exploration (OT/RT/AT)
  03-query-and-traverse.ts     # Instance query + subgraph + Context Loader (MCP)
  04-actions.ts                # Action execution + polling + logs
  05-agent-conversation.ts     # Chat (single + stream) + sessions
  06-full-pipeline.ts          # Datasource → BKN → build → search → cleanup
```

## Constraints

- All examples run against a real KWeaver instance (no mocks)
- Credentials loaded from `~/.kweaver/` via `config: true` or `KWeaverClient` auto-detection
- Dynamic discovery: examples find available BKNs/agents at runtime, not hardcoded IDs
- Example 06 is destructive (creates/deletes resources), others are read-only
- A shared `examples/setup.ts` utility provides common helpers: init client, find first BKN with data, find accessible agent — reducing boilerplate across examples

## Example Designs

### 01: `quick-start.ts` — 5-Minute Onboarding

**~30-40 lines. Simple API.**

1. `kweaver.configure({ config: true })` — load credentials from `~/.kweaver/`
2. `kweaver.bkns()` — list all knowledge networks, print name + ID
3. Pick first BKN with data, call `kweaver.search("keyword")` for semantic search
4. Print search results

**Capabilities shown**: Simple API, auto-auth, BKN listing, semantic search.

### 02: `explore-schema.ts` — Discover Knowledge Graph Structure

**~50-60 lines. Client API.**

1. Initialize `KWeaverClient`
2. `knowledgeNetworks.get(knId, { include_statistics: true })` — BKN statistics
3. `knowledgeNetworks.listObjectTypes(knId)` — list all object types with properties
4. `knowledgeNetworks.listRelationTypes(knId)` — list relation types (source → target)
5. `knowledgeNetworks.listActionTypes(knId)` — list executable actions

**Capabilities shown**: Client API (contrast with 01's Simple API), schema trifecta (OT/RT/AT), BKN stats.

### 03: `query-and-traverse.ts` — Instance Query & Subgraph Traversal

**~80-90 lines. Client API + Context Loader.**

Note: `bkn.queryInstances`, `bkn.queryProperties`, `bkn.querySubgraph` all take a raw `body: Record<string, unknown>` as the request payload.

1. `bkn.queryInstances(knId, otId, body)` — conditional instance query (body contains conditions, limit, etc.)
2. `bkn.queryProperties(knId, otId, body)` — read property details (body contains instance identities)
3. `bkn.querySubgraph(knId, body)` — traverse from instance along relations (body contains start instances, path spec)
4. Print subgraph: start → relation → end

**Capabilities shown**: Conditional filtering, property reads, subgraph traversal (core graph value).

**Bonus section — Context Loader (MCP):**

5. `client.contextLoader(mcpUrl, knId)` — initialize Context Loader
6. `cl.schemaSearch({ query })` — schema-level search via MCP (Layer 1)
7. `cl.queryInstances({ otId, conditions })` — instance query via MCP (Layer 2)

This section shows the same query capabilities through the MCP protocol interface, demonstrating that external AI agents can access the same data via Context Loader.

### 04: `actions.ts` — Execute Actions & Track Results

**~60-70 lines. Client API.**

1. `knowledgeNetworks.listActionTypes(knId)` — find an executable action
2. `bkn.executeAction(knId, atId, { params })` — trigger execution
3. Poll `bkn.getExecution(knId, executionId)` until complete, print status changes
4. `bkn.listActionLogs(knId, { atId })` — view execution history
5. `bkn.getActionLog(knId, logId)` — get detailed result

**Capabilities shown**: Action execution, async polling pattern, execution logs.

### 05: `agent-conversation.ts` — Chat with an Agent

**~70-80 lines. Client API.**

1. `agents.list()` — list available agents with name + description
2. `agents.chat(agentId, "question")` — single-shot chat, print reply + `progress` (reasoning chain)
3. `agents.stream(agentId, "question", callbacks, opts)` — streaming chat; `callbacks` is a positional arg with `{ onTextDelta, onProgress }`, not part of opts
4. `conversations.list(agentId)` — list conversation sessions
5. `conversations.listMessages(conversationId)` — replay full message history

**Capabilities shown**: Agent discovery, single/streaming chat, progress chain, conversation management.

### 06: `full-pipeline.ts` — Data Source to Intelligent Q&A

**~100-120 lines. Mixed API layers. Destructive (creates/deletes resources).**

Note: Datasource and DataView operations use low-level API functions (not resource methods on `KWeaverClient`), imported directly from the API layer. Object type creation also uses the low-level API — `KWeaverClient` does not yet expose resource wrappers for these.

1. `testDatasource(opts)` — verify database connection (from `api/datasources`)
2. `createDatasource(opts)` — register MySQL datasource (from `api/datasources`)
3. `listTablesWithColumns(opts)` — inspect table structure (from `api/datasources`)
4. `createDataView(opts)` — create DataView mapping (from `api/dataviews`)
5. `knowledgeNetworks.create({ name, description })` — create new BKN (Client API)
6. Create object type linked to DataView (via low-level API, e.g. `createObjectTypes` from `api/knowledge-networks`)
7. `knowledgeNetworks.buildAndWait(bknId)` — build index and wait (Client API)
8. `bkn.semanticSearch(bknId, "business question")` — search the new graph (Client API)
9. Cleanup: delete all created resources

**Capabilities shown**: Low-level API functions, datasource management, DataView, BKN lifecycle, build + wait, search validation, resource cleanup.

## README.md Structure

```markdown
# KWeaver SDK Examples

End-to-end examples running against a real KWeaver instance.

## Prerequisites
- Node.js 18+
- `npm install @kweaver-ai/kweaver-sdk` (or run from the monorepo)
- `kweaver auth login <your-platform-url>` (credentials in ~/.kweaver/)
- A KWeaver instance with at least one BKN containing data

## Examples

| # | File | What you'll learn | ~Lines |
|---|------|-------------------|--------|
| 01 | quick-start.ts | Configure, discover, search | 30-40 |
| 02 | explore-schema.ts | Object types, relations, actions | 50-60 |
| 03 | query-and-traverse.ts | Instance queries, subgraph, Context Loader | 80-90 |
| 04 | actions.ts | Execute actions, track results | 60-70 |
| 05 | agent-conversation.ts | Chat with agents, streaming | 70-80 |
| 06 | full-pipeline.ts | Full data→knowledge→intelligence pipeline | 100-120 |

## Running

npx tsx examples/01-quick-start.ts

## Notes
- Examples 01-05 are read-only (safe to run anytime)
- Example 06 creates and deletes resources (datasource, BKN)
- All examples dynamically discover available BKNs/agents at runtime
```
