# Python Dataflow SDK v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new Python SDK resource `client.dataflow_v2` that wraps the document-style dataflow APIs while keeping the existing `client.dataflows` lifecycle API unchanged.

**Architecture:** Add one new thin resource module for the v2 endpoints, wire it into `KWeaverClient` under a distinct property name, and cover it with unit tests that verify paths, query parameters, multipart upload behavior, and convenience file loading. Update the Python README files to document the new SDK surface while preserving the package’s SDK-only positioning.

**Tech Stack:** Python 3.10+, httpx, existing shared `HttpClient`, pytest

---

## File map

- Create: `packages/python/src/kweaver/resources/dataflow_v2.py`
- Modify: `packages/python/src/kweaver/_client.py`
- Modify: `packages/python/src/kweaver/resources/__init__.py`
- Create: `packages/python/tests/unit/test_dataflow_v2.py`
- Modify: `packages/python/README.md`
- Modify: `packages/python/README.zh.md`

## Task 1: Add failing tests for the new resource surface

**Files:**
- Create: `packages/python/tests/unit/test_dataflow_v2.py`
- Reference: `packages/python/tests/conftest.py`
- Reference: `packages/python/tests/unit/test_dataflows.py`

- [ ] **Step 1: Write the failing tests for the new resource**

Add tests that cover:

- `client.dataflow_v2` exists
- `list_dataflows()` hits `/api/automation/v2/dags?type=data-flow&page=0&limit=-1`
- `run_dataflow_with_file(..., file_name=..., file_bytes=...)` posts multipart to `/api/automation/v2/dataflow-doc/trigger/<dag_id>`
- `run_dataflow_with_remote_url(...)` posts JSON with `source_from`, `url`, and `name`
- `list_dataflow_runs(...)` forwards `page`, `limit`, `sortBy`, `order`, `start_time`, `end_time`
- `get_dataflow_logs_page(...)` uses `/api/automation/v2/dag/<dag_id>/result/<instance_id>?page=<n>&limit=<n>`
- `run_dataflow_with_file(..., file_path=...)` reads bytes from disk and uses the basename as the multipart filename

Suggested test names:

```python
def test_client_exposes_dataflow_v2():
    ...

def test_list_dataflows_uses_v2_dags_endpoint(capture: RequestCapture):
    ...

def test_run_dataflow_with_file_posts_multipart(capture: RequestCapture):
    ...

def test_run_dataflow_with_remote_url_posts_json(capture: RequestCapture):
    ...

def test_list_dataflow_runs_forwards_query_parameters(capture: RequestCapture):
    ...

def test_get_dataflow_logs_page_uses_v2_logs_endpoint(capture: RequestCapture):
    ...

def test_run_dataflow_with_file_supports_file_path(tmp_path: Path, capture: RequestCapture):
    ...
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run:

```bash
cd packages/python && pytest tests/unit/test_dataflow_v2.py -q
```

Expected:

- failure because `client.dataflow_v2` and `kweaver.resources.dataflow_v2` do not exist yet

- [ ] **Step 3: Commit the failing test scaffold**

```bash
git add -- packages/python/tests/unit/test_dataflow_v2.py
git commit -m "test(python): add dataflow v2 resource coverage"
```

## Task 2: Implement the new `dataflow_v2` resource

**Files:**
- Create: `packages/python/src/kweaver/resources/dataflow_v2.py`
- Reference: `packages/python/src/kweaver/resources/dataflows.py`
- Reference: `packages/python/src/kweaver/_http.py`

- [ ] **Step 1: Implement the new resource class**

Create `DataflowV2Resource` with thin wrappers:

```python
class DataflowV2Resource:
    def list_dataflows(self) -> dict[str, Any]:
        ...

    def run_dataflow_with_file(
        self,
        dag_id: str,
        *,
        file_path: str | Path | None = None,
        file_name: str | None = None,
        file_bytes: bytes | None = None,
    ) -> dict[str, Any]:
        ...

    def run_dataflow_with_remote_url(
        self,
        dag_id: str,
        *,
        url: str,
        name: str,
    ) -> dict[str, Any]:
        ...

    def list_dataflow_runs(
        self,
        dag_id: str,
        *,
        page: int = 0,
        limit: int = 100,
        sort_by: str | None = None,
        order: str | None = None,
        start_time: int | None = None,
        end_time: int | None = None,
    ) -> dict[str, Any]:
        ...

    def get_dataflow_logs_page(
        self,
        dag_id: str,
        instance_id: str,
        *,
        page: int = 0,
        limit: int = 10,
    ) -> dict[str, Any]:
        ...
```

Implementation requirements:

- use the shared `HttpClient`
- do not add CLI formatting behavior
- for `file_path`, read bytes locally and derive `file_name` from the basename
- if neither `file_path` nor `file_name + file_bytes` is supplied, raise `ValueError`
- if both `file_path` and explicit bytes/name are supplied, raise `ValueError`

- [ ] **Step 2: Wire the resource into the client**

In `packages/python/src/kweaver/_client.py`:

- import `DataflowV2Resource`
- instantiate `self.dataflow_v2 = DataflowV2Resource(self._http)`
- keep `self.dataflows = DataflowsResource(self._http)` unchanged

In `packages/python/src/kweaver/resources/__init__.py`:

- export the new resource alongside the existing ones

- [ ] **Step 3: Run the focused tests to verify the implementation passes**

Run:

```bash
cd packages/python && pytest tests/unit/test_dataflow_v2.py -q
```

Expected:

- all tests in `test_dataflow_v2.py` pass

- [ ] **Step 4: Commit the resource implementation**

```bash
git add -- packages/python/src/kweaver/resources/dataflow_v2.py packages/python/src/kweaver/_client.py packages/python/src/kweaver/resources/__init__.py packages/python/tests/unit/test_dataflow_v2.py
git commit -m "feat(python): add dataflow v2 sdk resource"
```

## Task 3: Verify compatibility with the old lifecycle API

**Files:**
- Reference: `packages/python/tests/unit/test_dataflows.py`
- Reference: `packages/python/src/kweaver/resources/dataflows.py`

- [ ] **Step 1: Run the existing lifecycle dataflow tests**

Run:

```bash
cd packages/python && pytest tests/unit/test_dataflows.py -q
```

Expected:

- existing `client.dataflows` tests still pass unchanged

- [ ] **Step 2: Run the focused combined dataflow unit suite**

Run:

```bash
cd packages/python && pytest tests/unit/test_dataflows.py tests/unit/test_dataflow_v2.py -q
```

Expected:

- both old and new dataflow resource tests pass together

- [ ] **Step 3: Commit only if a compatibility fix was required**

```bash
git add -- packages/python/src/kweaver/_client.py packages/python/src/kweaver/resources/dataflows.py packages/python/tests/unit/test_dataflows.py
git commit -m "fix(python): preserve dataflow lifecycle compatibility"
```

Only do this commit if the previous task exposed and required an actual compatibility fix.

## Task 4: Update Python SDK documentation

**Files:**
- Modify: `packages/python/README.md`
- Modify: `packages/python/README.zh.md`

- [ ] **Step 1: Add the new SDK surface to the resource tables**

Update both README files to include:

- `client.dataflow_v2`
- a short method list:
  - `list_dataflows`
  - `run_dataflow_with_file`
  - `run_dataflow_with_remote_url`
  - `list_dataflow_runs`
  - `get_dataflow_logs_page`

Keep the current “SDK-only” statement intact.

- [ ] **Step 2: Add a minimal usage example**

Include a short example in both languages that demonstrates:

```python
flows = client.dataflow_v2.list_dataflows()
result = client.dataflow_v2.run_dataflow_with_remote_url(
    "dag-id",
    url="https://example.com/demo.pdf",
    name="demo.pdf",
)
runs = client.dataflow_v2.list_dataflow_runs("dag-id", limit=20, sort_by="started_at", order="desc")
logs = client.dataflow_v2.get_dataflow_logs_page("dag-id", result["dag_instance_id"], page=0, limit=10)
```

- [ ] **Step 3: Commit the documentation update**

```bash
git add -- packages/python/README.md packages/python/README.zh.md
git commit -m "docs(python): document dataflow v2 sdk resource"
```

## Task 5: Run package-level verification

**Files:**
- Reference only

- [ ] **Step 1: Run the full relevant unit tests**

Run:

```bash
cd packages/python && pytest tests/unit/test_dataflow_v2.py tests/unit/test_dataflows.py tests/unit/test_top_level_api.py -q
```

Expected:

- all selected tests pass

- [ ] **Step 2: Run the package lint-equivalent and test entry**

Run:

```bash
cd packages/python && make test
```

Expected:

- unit test suite passes without external services

- [ ] **Step 3: Optionally run coverage entry if time allows**

Run:

```bash
cd packages/python && make test-cover
```

Expected:

- coverage run completes successfully

- [ ] **Step 4: Commit any final verification-driven adjustments**

```bash
git add -- packages/python/src/kweaver/resources/dataflow_v2.py packages/python/src/kweaver/_client.py packages/python/src/kweaver/resources/__init__.py packages/python/tests/unit/test_dataflow_v2.py packages/python/README.md packages/python/README.zh.md
git commit -m "test(python): finalize dataflow v2 verification"
```

Only do this commit if verification required a real code or doc adjustment.
