# Testing and Make targets

## Contract

- **`make test`** at the **repository root** runs Python + TypeScript unit tests (no external services).
- **`make -C packages/python test`** runs **only** `pytest tests/unit/` via **`uv run python -m pytest`** — avoids picking up the wrong global `pytest`.

Always run at least **`make -C packages/python test`** before committing Python changes; use root **`make test`** before pushing broader changes.

## Layout

| Path | Purpose |
|------|---------|
| `packages/python/tests/unit/` | Default UT suite — fully mocked (`respx`, stubs). |
| `packages/python/tests/e2e/` | Live integration tests; gated by env / pytest markers; **not** run by `make test`. |

Naming: mirror module paths where helpful (`test_models.py` next to `resources/models.py` patterns).

## Targets (`packages/python/Makefile`)

| Target | What it does |
|--------|----------------|
| `test` | `pytest tests/unit/` |
| `test-cover` | UT + coverage XML under `test-result/coverage.xml` |
| `lint` | `python -m compileall` on `src/kweaver` |
| `ci` | `lint` + `test-cover` |
| `test-e2e` | `pytest tests/e2e/` (destructive / live — optional) |
| `docs-python` | **`pdoc`** HTML → `docs/reference/python-api-html/` (gitignored) |

## Dependencies

Use **`uv`** as in the Makefile: **`uv run`** picks the project lockfile. Optional docs deps: **`uv run --extra docs ...`** (see **`docs-python`** target).

## Related

- Repo-wide rules: [`AGENTS.md`](../../../AGENTS.md).
- Maintainer skill entrypoint: [`../SKILL.md`](../SKILL.md).
