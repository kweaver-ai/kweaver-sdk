# Documentation

English-first usage notes live under `docs/` together with internal specs and plans.

## Guides

| Document | Audience |
|----------|----------|
| [guides/python-sdk-guide.md](guides/python-sdk-guide.md) | Developers using **PyPI `kweaver-sdk`** from Python (`KWeaverClient`, auth). |
| [guides/python-sdk-guide.zh.md](guides/python-sdk-guide.zh.md) | 中文版（与英文版对照）。 |
| [guides/ai-app-integration.md](guides/ai-app-integration.md) | AI applications — MCP, CLI, integration scenarios. |

## Usage reference (English)

| Document | Audience |
|----------|----------|
| [usage/reference/python-client-login-resources.md](usage/reference/python-client-login-resources.md) | **`KWeaverClient`** constructor vs TS options, **`login()`** branches, **`knowledge_networks` / `query` / `agents` / `conversations`** method cheat sheet. |

## Generated Python API HTML

From the repository root:

```bash
make -C packages/python docs-python
```

Output: `docs/reference/python-api-html/` (ignored by git by default).

## Generated TypeScript API HTML

From `packages/typescript`:

```bash
npm run docs             # English UI (default)
npm run docs:zh          # Chinese UI chrome (--lang zh), separate output folder
npm run docs:all         # both
```

Output: `docs/reference/typescript-api-html/` (English UI), optionally `docs/reference/typescript-api-html-zh/` (Chinese UI strings). Ignored by git by default. TypeDoc does not provide an in-site language toggle; open each `index.html` or use `docs:serve` / `docs:serve:zh` on ports **8766** / **8767**. The `gitRevision` for "Defined in" links comes from `TYPEDOC_GIT_REVISION` (or `GITHUB_SHA`), defaulting to **`main`**, so GitHub URLs stay valid when docs were generated from unpublished commits; in CI set `TYPEDOC_GIT_REVISION=$GITHUB_SHA` to pin links to the exact build.

> **Important**: anything under `docs/reference/**` is regenerated from sources (Python docstrings, TypeScript TSDoc, and `packages/typescript/README*.md`). Do not edit files inside those folders — your changes will be overwritten on the next build.

## Other

- [cli_conventions.md](cli_conventions.md) — CLI naming conventions.
- [integration_kweaver_caller.md](integration_kweaver_caller.md) — caller integration notes.
- `superpowers/plans/` — implementation plans for agents.
