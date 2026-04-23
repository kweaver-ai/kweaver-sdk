# KWeaver Examples

## [`sdk/`](sdk/) — SDK Usage Examples

End-to-end scripts demonstrating the full SDK against a real KWeaver instance,
split by language so you can pick the SDK that matches your stack.

- [`sdk/typescript/`](sdk/typescript/) — TypeScript / Node.js
- [`sdk/python/`](sdk/python/)         — Python 3.10+

The two trees mirror each other one-to-one:

| #  | TypeScript                                                            | Python                                                              | What you'll learn                                                       | API Layer  |
|----|-----------------------------------------------------------------------|---------------------------------------------------------------------|-------------------------------------------------------------------------|------------|
| 01 | [01-quick-start.ts](sdk/typescript/01-quick-start.ts)                 | [01-quick-start.py](sdk/python/01-quick-start.py)                   | Configure, discover BKNs, semantic search                               | Simple API |
| 02 | [02-explore-schema.ts](sdk/typescript/02-explore-schema.ts)           | [02-explore-schema.py](sdk/python/02-explore-schema.py)             | Object types, relations, actions, statistics                            | Client API |
| 03 | [03-query-and-traverse.ts](sdk/typescript/03-query-and-traverse.ts)   | [03-query-and-traverse.py](sdk/python/03-query-and-traverse.py)     | Instance queries, subgraph traversal, Context Loader (MCP)              | Client API |
| 04 | [04-actions.ts](sdk/typescript/04-actions.ts)                         | [04-actions.py](sdk/python/04-actions.py)                           | Action discovery, execution logs, polling                               | Client API |
| 05 | [05-agent-conversation.ts](sdk/typescript/05-agent-conversation.ts)   | [05-agent-conversation.py](sdk/python/05-agent-conversation.py)     | Agent chat (single + streaming), conversation history                   | Client API |
| 06 | [06-full-pipeline.ts](sdk/typescript/06-full-pipeline.ts)             | [06-full-pipeline.py](sdk/python/06-full-pipeline.py)               | Full datasource → BKN → build → search pipeline                         | Mixed      |

### Prerequisites

**TypeScript**
- Node.js 22+
- `cd packages/typescript && npm install`
- `npx tsx packages/typescript/src/cli.ts auth login <your-platform-url>`

**Python**
- Python 3.10+
- `pip install -e packages/python` (or `pip install kweaver-sdk` once published)
- A populated `~/.kweaver/` — either run the TS CLI `kweaver auth login <url>`
  (the store is shared between both SDKs) or call
  `python -c "import kweaver; kweaver.login('<url>', username='...', password='...')"`.

A KWeaver instance with at least one BKN containing data is required for
examples 01–05.

### Running

```bash
# TypeScript
npx tsx examples/sdk/typescript/01-quick-start.ts

# Python
python examples/sdk/python/01-quick-start.py
```

### Notes

- **Examples 01–05 are read-only** — safe to run anytime.
- **Example 06 is destructive** — requires `RUN_DESTRUCTIVE=1` and database env vars.
- The Python `06-full-pipeline.py` shells out to the `kweaver` CLI for
  datasource registration / BKN scaffolding (the Python SDK has no
  `create_from_ds` shortcut yet) and uses the SDK directly for build /
  export / search / cleanup.
- All examples dynamically discover available BKNs/agents at runtime.
- TLS: `KWeaverClient(auth=ConfigAuth())` automatically honors the
  `tlsInsecure` flag saved by `kweaver auth login --insecure`, so self-signed
  deployments just work.

## [`bkn/`](bkn/) — BKN Format Examples

Sample `.bkn` files demonstrating different knowledge network definition layouts. See [`bkn/README.md`](bkn/README.md) for details.

- **k8s-topology/** — Single-file example
- **k8s-network/** — Multi-file layout
- **k8s-modular/** — Modular layout with subdirectories
