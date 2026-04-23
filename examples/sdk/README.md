# SDK Usage Examples

End-to-end scripts demonstrating the full KWeaver SDK against a real instance,
split by language so you can pick the SDK that matches your stack.

- [`typescript/`](typescript/) — TypeScript / Node.js
- [`python/`](python/)         — Python 3.10+

See [`../README.md`](../README.md) for the full list, prerequisites, and
running instructions for both languages.

## Quick start

```bash
# TypeScript
npx tsx examples/sdk/typescript/01-quick-start.ts

# Python
python examples/sdk/python/01-quick-start.py
```

## Learning Path

| #  | TypeScript                                                          | Python                                                          | What you'll learn                                                       | API Layer  |
|----|---------------------------------------------------------------------|-----------------------------------------------------------------|-------------------------------------------------------------------------|------------|
| 01 | [01-quick-start.ts](typescript/01-quick-start.ts)                   | [01-quick-start.py](python/01-quick-start.py)                   | Configure, discover BKNs, semantic search                               | Simple API |
| 02 | [02-explore-schema.ts](typescript/02-explore-schema.ts)             | [02-explore-schema.py](python/02-explore-schema.py)             | Object types, relations, actions, statistics                            | Client API |
| 03 | [03-query-and-traverse.ts](typescript/03-query-and-traverse.ts)     | [03-query-and-traverse.py](python/03-query-and-traverse.py)     | Instance queries, subgraph traversal, Context Loader (MCP)              | Client API |
| 04 | [04-actions.ts](typescript/04-actions.ts)                           | [04-actions.py](python/04-actions.py)                           | Action discovery, execution logs, polling                               | Client API |
| 05 | [05-agent-conversation.ts](typescript/05-agent-conversation.ts)     | [05-agent-conversation.py](python/05-agent-conversation.py)     | Agent chat (single + streaming), conversation history                   | Client API |
| 06 | [06-full-pipeline.ts](typescript/06-full-pipeline.ts)               | [06-full-pipeline.py](python/06-full-pipeline.py)               | Full datasource → BKN → build → search pipeline                         | Mixed      |

**Start with 01** and work your way up. Each example builds on concepts from the previous ones.

## Notes

- **Examples 01–05 are read-only** — safe to run anytime.
- **Example 06 is destructive** — creates and deletes resources; requires `RUN_DESTRUCTIVE=1` and database env vars (see file header for details).
- All examples auto-discover available BKNs and agents at runtime.
- Search queries use Chinese ("数据") because the demo BKN data is in Chinese — adjust to match your data.

## Troubleshooting

**401 Unauthorized** — If you see `oauth info is not active`:

- Token expired (1-hour TTL). Re-run `auth login`.
- If `KWEAVER_TOKEN` / `KWEAVER_BASE_URL` env vars are set (e.g. in `~/.env.secrets`), example 01 (Simple API) ignores them, but they may shadow `~/.kweaver/` credentials for other tooling. Either `unset KWEAVER_TOKEN KWEAVER_BASE_URL` or update them.

## Imports

Examples use monorepo-relative imports. Published SDK users would use:

```typescript
import kweaver from "@kweaver-ai/kweaver-sdk/kweaver";           // Simple API
import { KWeaverClient } from "@kweaver-ai/kweaver-sdk";          // Client API
import type { ProgressItem } from "@kweaver-ai/kweaver-sdk";      // Types
```

```python
import kweaver                                # Simple API + login()
from kweaver import KWeaverClient, ConfigAuth # Client API
```
