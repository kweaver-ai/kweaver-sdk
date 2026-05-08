# Python SDK developer guide

Use this guide when you integrate **PyPI [`kweaver-sdk`](https://pypi.org/project/kweaver-sdk/)** into your application or automation. For AI-app scenarios (MCP, CLI, Cursor), see [AI application integration](./ai-app-integration.md).

## Table of contents

- [Who this is for](#who-this-is-for)
- [Installation](#installation)
- [Authentication](#authentication)
- [Creating a client](#creating-a-client)
- [Common operations](#common-operations)
- [Pagination and limits](#pagination-and-limits)
- [Errors and troubleshooting](#errors-and-troubleshooting)
- [API reference (generated)](#api-reference-generated)
- [Related docs](#related-docs)

## Who this is for

- Python **3.10+**
- Developers calling KWeaver platform HTTP APIs from code (not only from the Node-based CLI).

The Node/TypeScript CLI remains the primary packaged CLI; this SDK exposes the same platform surface programmatically. See [packages/python/README.md](../../packages/python/README.md) for extra shortcuts (`configure`, `search`, `chat`).

## Installation

```bash
pip install kweaver-sdk
```

Optional CLI helpers shipped in the same package:

```bash
pip install "kweaver-sdk[cli]"
```

With **uv** (from your app repo):

```bash
uv add kweaver-sdk
```

## Authentication

Pick one pattern:

| Pattern | When to use |
|---------|-------------|
| **`TokenAuth`** | You already have an access token string. |
| **`ConfigAuth`** | Credentials live under `~/.kweaver/` (same store as `kweaver auth login` from the TS CLI). |
| **`HttpSigninAuth`** | Username/password sign-in over HTTP (RSA); similar to TS `--http-signin`. Use `kweaver.login(...)` or `configure(..., username=..., password=...)` for convenience. |
| **`OAuth2BrowserAuth`** | Interactive browser OAuth (advanced). |
| **`NoAuth`** | Dev servers with no API auth. |

Environment variables (optional; align with other KWeaver tooling):

- `KWEAVER_BASE_URL` — platform origin.
- `KWEAVER_TOKEN` — static token when using env-based flows.

Always set **`business_domain`** (or rely on `ConfigAuth` metadata) when your deployment requires `X-Business-Domain` — otherwise list endpoints may appear empty. Confirm with `kweaver config show` when you use shared CLI config.

## Creating a client

Minimal example with an explicit token:

```python
from kweaver import KWeaverClient, TokenAuth

client = KWeaverClient(
    base_url="https://your-kweaver.example.com",
    auth=TokenAuth("your-access-token"),
    business_domain="your-bd-uuid-or-slug",
)

with client:
    kns = client.knowledge_networks.list(limit=30)
    print(len(kns))
```

Use **`ConfigAuth`** when you already logged in with the CLI:

```python
from kweaver import KWeaverClient, ConfigAuth

with KWeaverClient(auth=ConfigAuth(), debug=False) as client:
    print(client.knowledge_networks.list(limit=10))
```

Optional overrides on `KWeaverClient`:

- **`vega_url`** — Vega gateway when different from `base_url`.
- **`mf_model_manager_base_url`** / **`mf_model_api_base_url`** — model-factory origins (see TS `--mf-base-url` / `--mf-api-base-url`).
- **`tls_insecure=True`** — dev-only TLS skip (not for production).

Close the client when done (`with` statement or `client.close()`).

## Common operations

### Knowledge networks

```python
kns = client.knowledge_networks.list(limit=30)
kn = client.knowledge_networks.get(kns[0].id)
stats = client.knowledge_networks.statistics(kn.id)
```

### Published agents

```python
agents = client.agents.list(keyword="", limit=30)
agent = client.agents.get(agents[0].id)
```

### Model factory (LLM / small models)

Requires manager + API URLs if they differ from `base_url`:

```python
from kweaver import KWeaverClient, TokenAuth

with KWeaverClient(
    base_url="https://platform.example.com",
    auth=TokenAuth("..."),
    business_domain="bd_public",
    mf_model_manager_base_url="https://manager.example.com",
    mf_model_api_base_url="https://api.example.com",
) as client:
    llms = client.models.llm.list(limit=30)
    out = client.models.invocation.chat(
        model_id="2052386262094057472",
        messages=[{"role": "user", "content": "Hello"}],
        stream=False,
    )
    print(out["text"])
```

### Vega namespace

```python
health = client.vega.health()
catalogs = client.vega.catalogs.list(limit=30)
```

### Top-level helpers

For quick demos, `import kweaver` supports `configure`, `search`, `chat`, `login` — see [packages/python/README.md](../../packages/python/README.md).

## Pagination and limits

- Many list methods accept **`limit`** / **`offset`**; defaults are **per method** (often **50** where the backend expects pagination).
- Platform CLI defaults for list vs query commands are documented in the repo [**AGENTS.md**](../../AGENTS.md). When mirroring CLI behaviour from Python, pass explicit `limit`/`offset` instead of relying on defaults alone.

## Errors and troubleshooting

The SDK raises typed errors from **`kweaver._errors`** (for example `AuthenticationError`, `NotFoundError`, `ValidationError`, `NetworkError`). Catch `KWeaverError` as a common base.

Typical issues:

| Symptom | Check |
|---------|--------|
| HTTP 401 | Token expired or wrong env; refresh via CLI login or renew `TokenAuth`. |
| Empty lists | Wrong **`business_domain`**; verify with platform config / `kweaver config show`. |
| TLS errors | Corporate proxy or dev certs — avoid `tls_insecure` in production; fix trust store. |

## API reference (generated)

Full module and class documentation is generated from **English docstrings** in `packages/python/src/kweaver`.

From the repo root (after dependencies are installed):

```bash
make -C packages/python docs-python
```

You can also run **`make docs-python`** from the repository root (forwards to the same target).

Open the HTML tree under **`docs/reference/python-api-html/`** (gitignored). Re-run after API changes to refresh.

## Related docs

- [AI application integration](./ai-app-integration.md) — MCP, CLI, end-user flows.
- [packages/python/README.md](../../packages/python/README.md) — package quick start (English).
- [packages/python/README.zh.md](../../packages/python/README.zh.md) — 中文说明。
- [AGENTS.md](../../AGENTS.md) — repository conventions (CLI/SDK limits, tests).
