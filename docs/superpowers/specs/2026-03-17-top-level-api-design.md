# Top-Level Module API Design

**Date:** 2026-03-17
**Branch:** feature/top-level-api

## Goal

Add a cognee-style module-level API so users can do:

```python
import kweaver

kweaver.configure(url="https://...", token="my-token", kn_id="abc123")

results = kweaver.search("KWeaver 能做什么？")
agents  = kweaver.agents()
reply   = kweaver.chat(agent_id="...", message="你好")
print(reply.content)
```

## Design

### Global State (in `__init__.py`)

```python
_default_client: KWeaverClient | None = None
_default_kn_id: str | None = None
_default_agent_id: str | None = None
```

### `configure()`

```python
def configure(
    url: str,
    *,
    token: str | None = None,
    username: str | None = None,
    password: str | None = None,
    config: bool = False,
    kn_id: str | None = None,
    agent_id: str | None = None,
) -> None
```

Auth priority: `token` > `username+password` > `config`.

### Top-Level Functions

| Function | Description |
|----------|-------------|
| `search(query, *, kn_id=None, ...)` | Semantic search on knowledge network |
| `agents(*, keyword=None, status=None)` | List agents |
| `chat(message, *, agent_id=None, stream=False)` | Chat with agent |
| `knowledge_networks(*, name=None)` | List knowledge networks |

All functions fall back to `_default_kn_id` / `_default_agent_id` if the respective parameter is not provided.

### Error Handling

Raise `RuntimeError("Call kweaver.configure() first")` if `_default_client` is None.

## Files Changed

- `packages/python/src/kweaver/__init__.py` — add global state + top-level functions
- `packages/python/tests/test_top_level_api.py` — new test file
