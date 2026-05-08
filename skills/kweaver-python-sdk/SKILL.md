---
name: kweaver-python-sdk
description: >-
  Use when editing or extending the Python SDK under packages/python in this monorepo:
  resource modules, KWeaverClient wiring, pytest unit tests, Makefile targets, or keeping
  defaults and HTTP behavior aligned with the TypeScript SDK. Not for end-user pip install
  tutorials — point users to docs/guides/python-sdk-guide.md instead.
---

# KWeaver Python SDK (maintainer)

## Overview

The PyPI package **`kweaver-sdk`** lives in [`packages/python`](../../packages/python). Platform HTTP, auth headers, retries, and resource split mirror the TypeScript client where practical. Repository rules (English comments/logs, default **limits**, UT without external services) are in [`AGENTS.md`](../../AGENTS.md).

## When to use

- Adding or changing a **resource** (`kweaver/resources/*.py`) or client constructor kwargs.
- Fixing bugs or extending tests under **`packages/python/tests/unit/`**.
- Aligning Python defaults or paths with **`packages/typescript`**.
- Running **`make -C packages/python test`** / **`ci`** before committing.

## Quick reference

| Topic | Command or location |
|-------|---------------------|
| Unit tests (mocked, no external deps) | `make -C packages/python test` |
| Lint (compile check) | `make -C packages/python lint` |
| CI-style (lint + coverage) | `make -C packages/python ci` |
| Root aggregate tests | `make test` (repo root) |
| UT vs E2E | `tests/unit/` vs `tests/e2e/` (E2E needs live env — see Makefile) |
| API HTML from docstrings | `make -C packages/python docs-python` or `make docs-python` (root) |
| Client + resource wiring | [`packages/python/src/kweaver/_client.py`](../../packages/python/src/kweaver/_client.py) |
| HTTP boundary (auth, headers, retries, errors) | [`packages/python/src/kweaver/_http.py`](../../packages/python/src/kweaver/_http.py) |

## Workflow

1. Read existing resource patterns and [`_client.py`](../../packages/python/src/kweaver/_client.py) registrations before adding APIs.
2. Implement changes with **English** docstrings and logs only.
3. Add or update tests under **`packages/python/tests/unit/`** using **`respx`** / mocks (no live HTTP in UT).
4. Run **`make -C packages/python test`**; for a full repo check run **`make test`** from the root.
5. If public surface changed, refresh generated docs locally: **`make -C packages/python docs-python`** (output is gitignored under **`docs/reference/python-api-html/`**).
6. Compare critical defaults with the TypeScript twin when behavior must stay aligned (see **references/parity-with-typescript.md**).

## References

- [`references/layout-and-resources.md`](references/layout-and-resources.md) — package layout and adding resources.
- [`references/testing-and-make.md`](references/testing-and-make.md) — pytest layout and Make targets.
- [`references/parity-with-typescript.md`](references/parity-with-typescript.md) — when to mirror TS.

End-user install and **`KWeaverClient`** usage narrative: [`docs/guides/python-sdk-guide.md`](../../docs/guides/python-sdk-guide.md).

## Common mistakes

- Skipping **`make -C packages/python test`** or root **`make test`** before claiming the change works.
- Diverging **list vs query default limits** from [`AGENTS.md`](../../AGENTS.md) / TS SDK without an intentional exception.
- Using **non-English** code comments or log messages (repository rule).
- Running **`pytest`** from arbitrary cwd instead of **`make -C packages/python test`** (ensures **`uv`** and **`tests/unit/`** scope).
- Putting heavy logic in **`_http.py`** — keep it transport; put endpoint semantics on **resources**.
