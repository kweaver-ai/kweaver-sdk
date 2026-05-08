# Python SDK Agent Skill — execution checklist

> Use **superpowers:executing-plans** or **superpowers:subagent-driven-development** when ticking tasks below.

## Goal

1. **Agent Skill** [`skills/kweaver-python-sdk`](../../../skills/kweaver-python-sdk): help agents maintain [`packages/python`](../../../packages/python) in this monorepo (tests, resource modules, `AGENTS` conventions).
2. **Developer guides** [`docs/guides/python-sdk-guide.md`](../../../docs/guides/python-sdk-guide.md) / [`python-sdk-guide.zh.md`](../../../docs/guides/python-sdk-guide.zh.md): for consumers of PyPI `kweaver-sdk` — install, auth, `KWeaverClient`, typical calls, env vars, troubleshooting; complements [`docs/guides/ai-app-integration.md`](../../../docs/guides/ai-app-integration.md).
3. **Optional API HTML**: generated from docstrings via **pdoc** — [`packages/python/pyproject.toml`](../../../packages/python/pyproject.toml) optional `docs` extra, [`packages/python/Makefile`](../../../packages/python/Makefile) target `docs-python`; output [`docs/reference/python-api-html/`](../../../docs/reference/python-api-html/) is gitignored.

## Architecture

- Skill = layered Markdown + `references/` (maintainer-facing).
- Guides = handwritten narrative + copy-paste examples; API symbol index via generated HTML.
- Docstrings remain English; list/query **limit** defaults match TS — see repo [`AGENTS.md`](../../../AGENTS.md).

## Tech stack

Skill frontmatter ([agentskills.io/specification](https://agentskills.io/specification)), Markdown guides, [pdoc](https://pdoc.dev/), `uv` / Makefile, `pytest`; parity with [`packages/typescript`](../../../packages/typescript) where applicable.

---

## Tasks

### Task 0: Branch

- [ ] `git fetch origin main && git checkout main && git pull origin main`
- [ ] `git checkout -b feat/python-sdk-guide-skill` (or current feat branch)
- [ ] (Optional) `git push -u origin feat/python-sdk-guide-skill`

### Task 1: This plan file

- [x] Scaffold `docs/superpowers/plans/2026-05-07-python-sdk-agent-skill.md` with goal, architecture, tech stack, and checkbox tasks.

### Task 2: Pressure scenarios (documented)

Agents without this skill often:

- Change Python SDK code without running `make -C packages/python test` or root `make test`.
- Diverge **default limits** from TypeScript SDK / [`AGENTS.md`](../../../AGENTS.md).
- Add **Chinese** comments or log messages (repo rule: English only).
- Run `pytest` from the wrong directory instead of Makefile targets.

**Skill mitigation:** `SKILL.md` → **Common Mistakes** addresses these.

### Task 3: `skills/kweaver-python-sdk/SKILL.md`

- [x] YAML frontmatter: `name: kweaver-python-sdk`, `description` starts with **Use when…** (maintain Python SDK / pytest / TS parity — not end-user pip usage).
- [x] Sections: Overview, When to Use, Quick Reference (table), Workflow, References, Common Mistakes.

Verify: read frontmatter; skim Workflow matches Makefile targets.

### Task 4: `skills/kweaver-python-sdk/references/`

- [x] [`layout-and-resources.md`](../../../skills/kweaver-python-sdk/references/layout-and-resources.md): `resources/*.py`, `_client.py` registration, checklist for new resources.
- [x] [`testing-and-make.md`](../../../skills/kweaver-python-sdk/references/testing-and-make.md): UT all mock, `tests/unit/` vs `tests/e2e/`, `make test` / `make ci` contracts.

Verify: links resolve relative from skill folder.

### Task 5: Guides (Phase Doc-A)

- [x] [`docs/guides/python-sdk-guide.md`](../../../docs/guides/python-sdk-guide.md) — EN developer usage.
- [x] [`docs/guides/python-sdk-guide.zh.md`](../../../docs/guides/python-sdk-guide.zh.md) — ZH mirror.
- [x] Link from [`docs/guides/ai-app-integration.md`](../../../docs/guides/ai-app-integration.md).

### Task 6: pdoc + Makefile (Phase Doc-B)

- [x] [`packages/python/pyproject.toml`](../../../packages/python/pyproject.toml): `[project.optional-dependencies] docs = ["pdoc>=14.6,<16"]`.
- [x] [`packages/python/Makefile`](../../../packages/python/Makefile): `docs-python` target (`PYTHONPATH=src uv run --extra docs python -m pdoc …`).
- [x] [`.gitignore`](../../../.gitignore): `docs/reference/python-api-html/`.
- [x] Root [`Makefile`](../../../Makefile): forward `docs-python` → `packages/python`.
- [x] Guides § API reference: `make -C packages/python docs-python` (or root `make docs-python`); open `docs/reference/python-api-html/index.html`.

Verify:

```bash
make -C packages/python docs-python
```

### Task 7: Discovery links

- [x] Root [`README.md`](../../../README.md) / [`README.zh.md`](../../../README.zh.md): Guides → python-sdk-guide (+ zh / ai-app / docs index).
- [x] [`packages/python/README.md`](../../../packages/python/README.md) / [`README.zh.md`](../../../packages/python/README.zh.md): Developer guide + `docs-python` blurb.
- [x] [`docs/README.md`](../../../docs/README.md): lightweight index.
- [x] [`skills/kweaver-core/SKILL.md`](../../../skills/kweaver-core/SKILL.md): Python SDK usage row → guides.

### Task 8: Verify and commit (no PR required for this phase)

- [x] `make -C packages/python test` — PASS
- [x] `make test` (repo root) — PASS
- [x] On feat branch: `git add …`, `git commit`
- [ ] (Optional) `git push origin feat/python-sdk-guide-skill`
- [ ] Do **not** open a PR unless instructed separately.
