# KWeaver SDK Examples

End-to-end examples running against a real KWeaver instance. Each script is independent and demonstrates a progression of SDK capabilities.

## Prerequisites

- Node.js 22+
- `npm install` (from the repo root)
- `npx tsx packages/typescript/src/cli.ts auth login <your-platform-url>` — saves credentials to `~/.kweaver/`
- A KWeaver instance with at least one BKN containing data (for examples 01-05)

## Examples

| # | File | What you'll learn | API Layer |
|---|------|-------------------|-----------|
| 01 | [01-quick-start.ts](01-quick-start.ts) | Configure, discover BKNs, semantic search | Simple API |
| 02 | [02-explore-schema.ts](02-explore-schema.ts) | Object types, relations, actions, statistics | Client API |
| 03 | [03-query-and-traverse.ts](03-query-and-traverse.ts) | Instance queries, subgraph traversal, Context Loader | Client API |
| 04 | [04-actions.ts](04-actions.ts) | Action discovery, execution logs, polling | Client API |
| 05 | [05-agent-conversation.ts](05-agent-conversation.ts) | Agent chat (single + streaming), conversation history | Client API |
| 06 | [06-full-pipeline.ts](06-full-pipeline.ts) | Full datasource → BKN → build → search pipeline | Mixed |

## Running

```bash
npx tsx examples/01-quick-start.ts
```

## Notes

- **Examples 01-05 are read-only** — safe to run anytime against any instance
- **Example 06 is destructive** — creates and deletes resources (datasource, BKN). Requires `RUN_DESTRUCTIVE=1` and database env vars
- All examples dynamically discover available BKNs and agents at runtime — no hardcoded IDs
- Examples use two API styles:
  - **Simple API** (`import kweaver from "kweaver-sdk/kweaver"`) — minimal, opinionated
  - **Client API** (`new KWeaverClient()`) — full control over all resources
