# Python Dataflow SDK v2 Design

Last updated: 2026-04-10

## Summary

Add a new Python SDK resource for the document-oriented dataflow APIs used by the TypeScript `dataflow` command group.

This work adds a parallel Python SDK surface only. It does not add Python CLI commands.

The new resource must coexist with the existing lifecycle-style dataflow SDK resource and must not change the old behavior.

## Goals

- Add a new Python SDK resource for the document-style dataflow APIs.
- Keep the new resource separate from the existing `client.dataflows` lifecycle API.
- Align HTTP capability with the TypeScript `api/dataflow2.ts` implementation.
- Keep the Python package positioned as SDK-only.

## Non-goals

- Do not add Python CLI commands such as `kweaver dataflow ...`.
- Do not complete or refactor the existing Python CLI scaffolding.
- Do not migrate or rename the existing `resources/dataflows.py`.
- Do not embed CLI-only behaviors such as `--since` parsing or multi-call aggregation into the SDK resource.

## Why SDK-only

The current Python package is not set up as a supported CLI distribution:

- `packages/python/pyproject.toml` does not expose a CLI entry point
- the runtime dependencies do not include Click
- the Python README files explicitly describe the package as SDK-only
- the partial `packages/python/src/kweaver/cli/` code is not a complete runnable CLI surface

Because of that, the lowest-entropy implementation is to provide only the SDK wrapper for now.

## Architecture

### New resource module

Add a new resource module:

- `packages/python/src/kweaver/resources/dataflow_v2.py`

This module encapsulates the document-style automation APIs used by the newer dataflow workflow.

It must stay separate from:

- `packages/python/src/kweaver/resources/dataflows.py`

The old module remains responsible for lifecycle-style APIs such as create, run, poll, delete, and execute.

### Client wiring

Expose the new resource from the Python client using a distinct property name:

- `client.dataflow_v2`

This keeps the split obvious:

- `client.dataflows` = old lifecycle API
- `client.dataflow_v2` = newer document-style DAG listing / triggering / runs / logs API

## SDK contract

### `client.dataflow_v2.list_dataflows()`

Purpose:

- list all dataflow DAGs

HTTP:

- `GET /api/automation/v2/dags?type=data-flow&page=0&limit=-1`

Return value:

- raw parsed JSON response from the service

### `client.dataflow_v2.run_dataflow_with_file(...)`

Purpose:

- trigger a dataflow run using a local or already-loaded file

Recommended call shapes:

- `run_dataflow_with_file(dag_id, file_path="demo.pdf")`
- `run_dataflow_with_file(dag_id, file_name="demo.pdf", file_bytes=b"...")`

Behavior:

- if `file_path` is provided, the SDK reads the file locally
- if `file_name` and `file_bytes` are provided, the SDK uses them directly
- request is sent as multipart form upload

HTTP:

- `POST /api/automation/v2/dataflow-doc/trigger/{dag_id}`

Return value:

- raw parsed JSON response, including `dag_instance_id`

### `client.dataflow_v2.run_dataflow_with_remote_url(...)`

Purpose:

- trigger a dataflow run using a remote file URL

Signature:

- `run_dataflow_with_remote_url(dag_id, *, url, name)`

HTTP:

- `POST /api/automation/v2/dataflow-doc/trigger/{dag_id}`

Request body:

```json
{
  "source_from": "remote",
  "url": "<remote-url>",
  "name": "<filename>"
}
```

Return value:

- raw parsed JSON response, including `dag_instance_id`

### `client.dataflow_v2.list_dataflow_runs(...)`

Purpose:

- query run records for one DAG

Signature:

- `list_dataflow_runs(dag_id, *, page=0, limit=100, sort_by=None, order=None, start_time=None, end_time=None)`

HTTP:

- `GET /api/automation/v2/dag/{dag_id}/results`

Query parameters:

- `page`
- `limit`
- `sortBy`
- `order`
- `start_time`
- `end_time`

Design note:

- this remains a thin wrapper
- it does not implement TypeScript CLI policy such as:
  - default recent-20 behavior
  - `since` parsing
  - two-request merge logic

Those are CLI concerns, not SDK concerns.

### `client.dataflow_v2.get_dataflow_logs_page(...)`

Purpose:

- fetch one logs page for a DAG instance

Signature:

- `get_dataflow_logs_page(dag_id, instance_id, *, page=0, limit=10)`

HTTP:

- `GET /api/automation/v2/dag/{dag_id}/result/{instance_id}?page=<n>&limit=<n>`

Return value:

- raw parsed JSON response

Design note:

- this is intentionally page-based
- SDK callers can decide whether to fetch one page or iterate all pages

## Data modeling

Keep the resource lightweight.

Recommended approach:

- return parsed dictionaries rather than introducing a large new model hierarchy
- add only minimal helper typing when it improves readability

Rationale:

- the TypeScript API layer is also thin
- these endpoints are mostly passthrough wrappers
- the CLI-specific formatting logic does not belong in Python SDK types

## Error handling

- use the existing shared HTTP client and error translation behavior
- file-path helpers should raise normal Python file errors when the path is missing or unreadable
- do not swallow server errors or convert them into CLI-style messages

## Testing

Add a dedicated unit test module:

- `packages/python/tests/unit/test_dataflow_v2.py`

Cover at least:

- list DAGs endpoint path
- file-trigger multipart request shape
- remote-trigger JSON request shape
- run-record query parameter propagation
- logs page path and query parameter propagation
- local `file_path` convenience mode

Compatibility coverage:

- existing `packages/python/tests/unit/test_dataflows.py` must continue to pass unchanged

## Documentation

Update:

- `packages/python/README.md`
- `packages/python/README.zh.md`

Documentation changes:

- keep the statement that Python is SDK-only
- add `client.dataflow_v2` to the SDK resources table
- include a short example for:
  - list DAGs
  - trigger by file
  - trigger by remote URL
  - list runs
  - fetch one logs page

## File plan

Expected changes:

- `packages/python/src/kweaver/resources/dataflow_v2.py`
- `packages/python/src/kweaver/_client.py`
- `packages/python/src/kweaver/resources/__init__.py`
- `packages/python/tests/unit/test_dataflow_v2.py`
- `packages/python/README.md`
- `packages/python/README.zh.md`

## Acceptance criteria

- Python SDK exposes a new `client.dataflow_v2` resource.
- The new resource supports DAG list, file trigger, remote trigger, runs query, and logs page query.
- Existing `client.dataflows` lifecycle behavior remains unchanged.
- No Python CLI command is added.
- README files document the new SDK surface without changing the package’s SDK-only positioning.
