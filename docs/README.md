# Documentation

English-first usage notes live under `docs/` together with internal specs and plans.

## Guides

| Document | Audience |
|----------|----------|
| [guides/python-sdk-guide.md](guides/python-sdk-guide.md) | Developers using **PyPI `kweaver-sdk`** from Python (`KWeaverClient`, auth). |
| [guides/python-sdk-guide.zh.md](guides/python-sdk-guide.zh.md) | 中文版（与英文版对照）。 |
| [guides/ai-app-integration.md](guides/ai-app-integration.md) | AI applications — MCP, CLI, integration scenarios. |

## Generated Python API HTML

From the repository root:

```bash
make -C packages/python docs-python
```

Output: `docs/reference/python-api-html/` (ignored by git by default).

## Other

- [cli_conventions.md](cli_conventions.md) — CLI naming conventions.
- [integration_kweaver_caller.md](integration_kweaver_caller.md) — caller integration notes.
- `superpowers/plans/` — implementation plans for agents.
