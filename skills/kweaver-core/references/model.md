# Model factory CLI (`model`)

Manage platform-registered **LLM** and **small models** (embedding / reranker) via **mf-model-manager**, and call **OpenAI-compatible chat** via **mf-model-api**. Paths are rooted on the same platform URL as other `kweaver` commands.

| Service | HTTP prefix | Role |
|---------|-------------|------|
| mf-model-manager | `/api/mf-model-manager/v1` | CRUD + connectivity `test` |
| mf-model-api     | `/api/mf-model-api/v1`     | `POST /chat/completions`, embedding / rerank |

## Environment overrides

- `KWEAVER_MF_MODEL_MANAGER_URL` — replace **origin** for manager calls (path `/api/mf-model-manager/v1` is still appended).
- `KWEAVER_MF_MODEL_API_URL` — replace **origin** for API calls (path `/api/mf-model-api/v1` is still appended).

CLI flags (highest priority for that run):

- `--mf-base-url <url>` — manager origin override.
- `--mf-api-base-url <url>` — model API origin override.

## Command overview

```bash
kweaver model llm   list [--keyword X] [--type llm|rlm|vu] [--series S] [--api-model M] [--page N] [--limit N] [--json] [-bd value]
kweaver model llm   get <model_id> [--json] [-bd value]
kweaver model llm   add --body-file <path.json> [--upstream-url <url>] [--api-model <id>] [--api-key <secret>|--api-key-file <path>] [--json] [-bd value]
kweaver model llm   edit [[<model_id>] --body-file <path.json> ...]  |  <model_id> [sparse flags]  [--json] [-bd value]
                      (`--body-file`: same as before; optional leading `model_id` overrides `body.model_id` after merge)
                      (sparse: `GET /llm/get` then merge only the flags you pass, e.g. `--name` or `--upstream-url`)
kweaver model llm   delete <model_id> [<model_id> ...] [-y] [-bd value]
kweaver model llm   test --body-file <path.json> [--upstream-url <url>] [--api-model <id>] [--api-key <secret>|--api-key-file <path>] [--json] [-bd value]
kweaver model llm   chat <model_id> (-m|--message) "text" [--stream] [--no-stream] [--verbose] [--temperature N] [--max-tokens N] [--mf-api-base-url url] [-bd value]
kweaver model llm   --template [--json]

kweaver model small list [--name X] [--type embedding|reranker] [--series S] [--page N] [--limit N] [--json] [-bd value]
kweaver model small get <model_id> [--json] [-bd value]
kweaver model small add --name N --type embedding|reranker --batch-size N \
    (--model-config-file <path.json> | --adapter --adapter-code-file <path.py>) \
    [--upstream-url <url>] [--api-model <id>] [--api-key <secret>|--api-key-file <path>] \
    [--max-tokens N] [--embedding-dim N] [--json] [-bd value]
kweaver model small edit <model_id> [--body-file <path.json> | sparse flags]
                      (without `--body-file`: CLI loads the model via `GET /small-model/get`, then sends `POST /small-model/edit` with only your flags merged in — e.g. rename with `--name` only)
kweaver model small delete <model_id> [<model_id> ...] [-y] [-bd value]
kweaver model small test <model_id> | --body-file <path.json> [--json] [-bd value]
kweaver model small embeddings <model_id> (-i|--input <text>) ... [--model-name <registry_model_name>] [--skip-model-name-resolve] [--mf-api-base-url url] [--json] [-bd value]
                        (runtime: `POST /api/mf-model-api/v1/small-model/embeddings` — batch vectors; mirrors **`model llm chat`** style smoke tests)
kweaver model small rerank <model_id> (-q|--query) <text> (-d|--document <text>) ... [--model-name <registry_model_name>] [--skip-model-name-resolve] [--mf-api-base-url url] [--json] [-bd value]
                        (runtime: `POST /api/mf-model-api/v1/small-model/reranker`)
kweaver model small --template [--json]
```

## LLM model types

mf-model-manager field **`model_type`** — used on **`model llm list --type`**, and inside **`add` / `edit` / `test`** bodies. The server accepts **exactly three** values (invalid values fail server-side validation; the CLI does not re-check this enum locally):

| Value | Meaning |
|-------|---------|
| **`llm`** | Standard text / chat-style large models. |
| **`rlm`** | Reasoning models — streaming may expose `reasoning_content` / thinking deltas; behaviour differs from plain `llm` on the server. |
| **`vu`** | Vision / multimodal side (abbreviated in the API as **`vu`**, not `vlm`). |

**CLI behaviour:** `model llm list --type` passes the string through to `/llm/list`; it does **not** re-validate the enum locally (unlike `model small` embedding vs reranker). Omit `--type` on `list` to skip filtering by type.

## Bundled templates (offline)

`kweaver model llm --template` / `kweaver model small --template` print the bundled **`basic`** JSON skeleton — no login and no HTTP to mf-model-manager. The LLM stub matches **`/llm/add`** (`model_config` nested); the small stub is **`model_config` fragment only** for `--model-config-file`. Extend for your deployment.

## Cloud upstream URL + API key (third-party models)

When the **actual inference** runs on an external vendor (OpenAI-compatible, DashScope, etc.), register **credentials on the platform** using either:

1. **`--model-config-file`** (small models) — JSON parsed into **`model_config`**; typical keys **`api_url`**, **`api_model`**, **`api_key`**.
2. **CLI convenience flags** — merged into **`model_config`** (creating it for LLM `--body-file` bodies when missing):
   - `--upstream-url` / `--api-url` → `model_config.api_url`
   - `--api-model` → `model_config.api_model`
   - `--api-key` or `--api-key-file` → `model_config.api_key` (prefer **file**; inline key is visible in shell history)

You can combine **`--model-config-file`** (small) or **`--body-file`** (LLM) with these flags: later flags **override** the same keys in **model_config**.

**LLM** `add` / `edit` / `test`: mf-model-manager reads upstream URL/model/key from **`model_config`** inside the POST body.

**LLM `edit` without `--body-file`:** the CLI calls **`GET /llm/get`**, merges your flags into the returned registration JSON, then posts **`/llm/edit`** — you can change e.g. display name or upstream URL without rebuilding a full body file. Some backends omit **`quota`** on **`GET /llm/get`**; the CLI normalizes missing **`quota`** to **`false`** before **`POST /llm/edit`** so sparse edits do not hit server **`KeyError`** on that field.

**Not compatible with `--adapter`** (small models): adapter uploads Python source only; put URL/key **inside** the script / runtime env, or use **`model_config`** + flags instead.

**List default `--limit`:** `30` (maps to backend `size`).

## LLM chat

- Sends `POST /api/mf-model-api/v1/chat/completions` with OpenAI-style JSON.
- **`model_id`** is always the platform registration id (snowflake).
- **`model`** in the body should match what your gateway expects (often the registry **`model_name`**). By default the CLI calls **`GET /llm/get`** for `<model_id>` and fills **`model`** from **`model_name`** when found — so you usually **do not** need **`--model-name`**. Override with **`--model-name`** when needed; disable lookup with **`--skip-model-name-resolve`** (then **`model`** defaults to **`model_id`**).
- **Default:** `--stream` (SSE). Use `--no-stream` for a single JSON completion.
- Streaming output is printed to stdout (delta text concatenated).

Example:

```bash
kweaver model llm chat 1234567890123456789 -m "Hello" --no-stream
```

## Small embeddings / rerank (mf-model-api)

- **`POST /small-model/embeddings`** and **`POST /small-model/reranker`** use the same OpenAI-style **`model`** + **`model_id`** pairing as **`chat/completions`**: **`model_id`** is always the platform registration id; **`model`** is the registry **`model_name`** when the CLI resolves it or when you pass **`--model-name`**. With **`--skip-model-name-resolve`** and no **`--model-name`**, the SDK sets **`model`** to **`model_id`** so the gateway still receives a **`model`** field (matches **`model llm chat`** behaviour).

## Small model adapter (`adapter_code`)

The SDK **does not execute or type-check** `adapter_code`: it uploads Python source to **mf-model-manager**; **runtime validation** (async **`main`** signature, return JSON shape, vector dimensions, etc.) is enforced **server-side** when the platform invokes your adapter. Examples below are operator-facing conventions; exact checks live in the model-factory / sandbox implementation.

Registration uses **Python source** stored by the platform. At runtime the service looks up an async **`main`** function:

- **embedding:** `async def main(texts)` — return a payload compatible with the platform validator (OpenAI-like `object` / `data` / `model` / `usage`).

Do **not** combine `model_config` (non-empty) with `adapter` + `adapter_code`; the CLI mirrors backend mutual-exclusion rules.

Example `adapter_code` file (illustrative — adjust to your upstream HTTP API):

```python
import json
import os
import aiohttp

URL = os.environ.get("MY_EMBED_URL", "https://api.example.com/v1/embeddings")
API_KEY = os.environ.get("MY_EMBED_KEY", "")

async def main(texts):
    headers = {"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"}
    async with aiohttp.ClientSession() as session:
        async with session.post(URL, headers=headers, json={"model": "text-embedding-3-small", "input": texts}) as resp:
            body = await resp.text()
            if resp.status != 200:
                raise RuntimeError(body[:500])
    return json.loads(body)
```

Register:

```bash
kweaver model small add --name my-emb --type embedding --batch-size 8 --max-tokens 512 --embedding-dim 1536 \
  --adapter --adapter-code-file ./adapter.py
```

## See also

- `kweaver --help` — matches the installed CLI.
