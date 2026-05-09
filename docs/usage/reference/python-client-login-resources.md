# Python SDK — client constructor, `login()`, and core resources

This page complements generated docstrings (`make -C packages/python docs-python`) with tables aligned to **TypeScript** where applicable. It does not replace the narrative guide: see [Python SDK developer guide](../../guides/python-sdk-guide.md).

## `KWeaverClient(...)` parameters

Python (`kweaver.KWeaverClient.__init__`) vs TypeScript (`KWeaverClientOptions` from `kweaver-sdk`):

| Python parameter | TypeScript equivalent | Notes |
|------------------|----------------------|--------|
| `base_url` | `baseUrl` | Required unless `auth` is **`ConfigAuth`** (then taken from saved platform config). |
| `token` | `accessToken` | Shorthand for `auth=TokenAuth(...)`. Mutually exclusive with custom `auth=` except you always pass one of them: either `token` or `auth`. |
| `auth` | *(composite)* | Use **`TokenAuth`**, **`ConfigAuth`**, **`HttpSigninAuth`**, **`NoAuth`**, etc. TS folds this into `baseUrl` + `accessToken` / `config` / `auth: false`. |
| `account_id`, `account_type` | *(not exposed on TS options)* | Optional HTTP identity hints where the platform expects them. |
| `business_domain` | `businessDomain` | Default mirrors TS / CLI (`bd_public` or `KWEAVER_BUSINESS_DOMAIN`). |
| `timeout` | *(implicit on TS fetch)* | HTTP client timeout (seconds). |
| `transport` | *(not exposed)* | Custom **`httpx`** transport (tests / proxies). |
| `log_requests` | *(not exposed)* | Log outbound requests at HTTP layer. |
| `debug` | *(not exposed)* | Enables **`DebugMiddleware`** (also turns on request logging when off). |
| `dry_run` | *(not exposed)* | **`DryRunMiddleware`** — simulate writes without sending mutation payloads as executed (see middleware behaviour). |
| `vega_url` | *(implicit; Vega uses same base on TS)* | Vega gateway origin when different from platform `base_url`. |
| `tls_insecure` | *(TLS env / saved tokens on TS)* | Dev-only: disable TLS verification. |
| `mf_model_manager_base_url`, `mf_model_api_base_url` | CLI `--mf-base-url` / `--mf-api-base-url` | Overrides for mf-model-manager / mf-model-api when not under main `base_url`. |

TS credential modes (**from source `packages/typescript/src/client.ts`**):

- **`config: true`** — read **`~/.kweaver/`** only (same idea as **`ConfigAuth`** on Python).
- **`auth: false`** — no `Authorization` header (**`NoAuth`** analogue).
- Default — **`opts` / env (`KWEAVER_BASE_URL`, `KWEAVER_TOKEN`) / saved platform** precedence.

Python does **not** expose `config`/`auth` booleans on **`KWeaverClient`**; pass the matching **`AuthProvider`** instead.

## `kweaver.login(base_url, ...)`

Single helper that picks a strategy **by argument presence** (`packages/python/src/kweaver/__init__.py`). Mutually exclusive branches:

| Branch | Arguments | Behaviour |
|--------|-----------|-----------|
| **No-auth platform** | `no_auth=True` | Persist a “no token” platform profile. **Cannot** combine with `username`/`password`/`refresh_token`. |
| **Refresh token** | `refresh_token` + **`client_id` + `client_secret`** | OAuth refresh flow via **`OAuth2BrowserAuth`**, then read saved token from **`PlatformStore`**. |
| **HTTP sign-in** | `username` **and** `password` | RSA/username-password **`http_signin`** (optional `client_id`/`client_secret`/`new_password`). |
| **OAuth browser (default)** | neither refresh nor username/password | **`OAuth2BrowserAuth.login`**; **`open_browser`** (default `True`) controls **`no_browser`**. |

Common extras: **`tls_insecure`** (dev), **`new_password`** (forced rotation path on sign-in).

CLI parity: use **`kweaver auth`** from the TypeScript CLI for interactive flows; **`login()`** is for embedding programmatic setup. Design matrices may live in internal specs under `docs/design/` if present.

## Core resources — high-traffic methods

Defaults below are **from current Python source**; align CLI/SDK convention (**list/query defaults**) with [AGENTS.md](../../../AGENTS.md) where noted — resource methods may still use **50** historically on some list endpoints.

### `KnowledgeNetworksResource` (`client.knowledge_networks`)

| Method | Purpose | Default `limit` / notable params |
|--------|---------|----------------------------------|
| `create(name, *, description, tags)` | Create KN (`branch="main"`); on duplicate name returns existing KN when API signals **Existed**. | — |
| `list(*, name, name_pattern, tag, offset, limit=50, sort, direction)` | Page KNs from ontology-manager. | **`limit=50`** |
| `get(id, *, include_statistics=False)` | Fetch KN by id; set **`include_statistics=True`** for counts in payload. | — |
| `update(id, **kwargs)` | PUT partial updates (caller-shaped JSON). | — |
| `export(id)` | Export definition snapshot (`mode=export`). | — |
| `delete(id)` | Delete KN. | — |
| `build(id)` | Trigger full build job; returns **`BuildJob`** with poll hook. | — |
| `inspect(kn_id, *, full=False)` | Aggregate KN + stats + active jobs (best-effort). | — |
| `build_status(id)` | Latest job-like row or **`completed`** if empty. | — |

### `QueryResource` (`client.query`)

| Method | Purpose | Default / notable params |
|--------|---------|---------------------------|
| `semantic_search(kn_id, query, *, mode="keyword_vector_retrieval", max_concepts=10)` | Agent-retrieval semantic search. | **`max_concepts=10`** |
| `kn_search(kn_id, query, *, only_schema=False)` | KN schema search (HTTP compat endpoint). | — |
| `kn_schema_search(...)` | Semantic search tuned for schema exploration. | **`max_concepts=10`**, same mode default |
| `instances(kn_id, ot_id, *, condition, limit=20, search_after, need_total=True)` | Object instances (**GET** override POST). Long timeout (**120s**). | **`limit=20`** |
| `instances_iter(..., limit=100)` | Cursor iteration over **`instances`**. | **`limit=100`** per page |
| `subgraph(kn_id, paths)` | MCP-backed subgraph via **`ContextLoaderResource`**. | — |
| `object_type_properties(kn_id, ot_id, body=None)` | Instance property projection for identities. | — |

### `AgentsResource` (`client.agents`)

| Method | Purpose | Default `limit` / notable params |
|--------|---------|----------------------------------|
| `list(*, keyword, status, offset=0, limit=50)` | **Published** agents (**POST** body; **`text/plain`** content-type quirk). | **`limit=50`** (`status` documented as ignored for published feed). |
| `list_personal(..., size=48)` | Personal-space agents. | **`size=48`** |
| `list_templates(..., size=48)` | Published templates. | **`size=48`** |
| `get_template(id)` | Template by id. | — |
| `list_categories()` | Template categories. | — |
| `get(id)` / `get_by_key(key)` | Agent detail. | — |
| `create(...)` | Create draft agent (see source for body shape). | — |
| `update(id, body)` / `delete(id)` | Mutations. | — |
| `publish` / `unpublish` | Lifecycle. | — |

### `ConversationsResource` (`client.conversations`)

| Method | Purpose | Default `limit` / notable params |
|--------|---------|----------------------------------|
| `create(agent_id, *, title=None)` | Client-side handle; real **`conversation_id`** arrives after first **`send_message`**. | — |
| `send_message(conversation_id, content, *, agent_id, agent_version="latest", stream=False, debug=False, history=None)` | Chat or debug completion; empty **`conversation_id`** omitted on first message for backend create. | **`timeout=120s`** |
| `terminate(agent_id, conversation_id)` | Terminate streaming/session. | — |
| `delete(id, *, agent_id=None)` | Best-effort (**terminate** when **`agent_id`** known). | — |
| `list(*, agent_id=None, limit=None)` | Lists conversations; **`404` → []**. No SDK default **`limit`** unless passed. | **`limit=None`** |
| `get(id)` | Lightweight placeholder object (deployment-dependent richness). | — |
| `list_messages(conversation_id, *, limit=None, offset=None)` | Message history; **`404` → []**. | **`limit=None`** |
| `get_traces_by_conversation(conversation_id)` | Observability traces by conversation id. | — |

## Related links

- [Python SDK developer guide](../../guides/python-sdk-guide.md) — workflows and troubleshooting.
- [packages/python/README.md](../../../../packages/python/README.md) — shortcuts **`configure`**, **`search`**, **`chat`**.
- TypeScript client reference — **`KWeaverClient`** / **`KWeaverClientOptions`**: `packages/typescript/src/client.ts` (also surfaced by **`npm run docs`** TypeDoc).
