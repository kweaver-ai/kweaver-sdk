# Parity with TypeScript SDK

Use this when changing behavior that also exists under **`packages/typescript/src`**.

## Default limits

List-style APIs default to **30**; query/preview-style defaults to **50** unless the API defines otherwise — see [`AGENTS.md`](../../../AGENTS.md). Mirror any TS change in Python kwargs and docstrings.

## Headers and auth

`HttpClient` applies the same conceptual headers as the TS client (e.g. business domain default aligned with CLI). When TS behavior changes (header names, defaults), verify `_http.py` and resource callers.

## Error mapping

Typed errors in **`kweaver._errors`** should correspond to user-visible TS/`HttpClient` outcomes (401 → authentication class, 404 → not found, etc.). Prefer mapping inside **`raise_for_status`** flows rather than ad hoc checks in each resource.

## File hints (non-exhaustive)

Browse these alongside your Python edit:

- [`packages/typescript/src/client.ts`](../../../packages/typescript/src/client.ts)
- [`packages/typescript/src/resources/*.ts`](../../../packages/typescript/src/resources/)

Do **not** duplicate large TS snippets into Python docs — link paths and summarize deltas instead.
