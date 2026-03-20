# Infra Phase 1: Middleware Chain + Debug + DryRun + CLI Foundations

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor `HttpClient._request()` into a middleware chain, add Debug and DryRun middleware, add CLI global flags (`--debug`, `--dry-run`, `--format`), `kweaver use` context, and `output()` multi-format formatter.

**Architecture:** The flat `HttpClient.request()` method (186 lines, hardcoded retry) is refactored into a composable middleware chain. Each middleware wraps the next handler, forming an onion-style pipeline. `KWeaverClient` auto-assembles the chain from constructor params. CLI gains global flags that pass through to `make_client()`.

**Tech Stack:** Python 3.10+, httpx, pydantic, click. Zero new dependencies (stdlib only for middleware).

**Spec:** `docs/superpowers/specs/2026-03-20-sdk-observability-infra.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `src/kweaver/_middleware/__init__.py` | `Middleware` protocol, `RequestContext` dataclass, `RequestHandler` type alias |
| `src/kweaver/_middleware/debug.py` | `DebugMiddleware` — full request/response diagnostic output to stderr |
| `src/kweaver/_middleware/dry_run.py` | `DryRunMiddleware` + `DryRunIntercepted` exception — intercept write ops |
| `src/kweaver/cli/use.py` | `kweaver use <kn_id>` context commands |
| `tests/unit/test_middleware_chain.py` | Middleware chain wiring, ordering, composition |
| `tests/unit/test_middleware_debug.py` | DebugMiddleware output format, token masking |
| `tests/unit/test_middleware_dry_run.py` | DryRun intercept writes, pass reads |
| `tests/unit/test_cli_use.py` | `kweaver use` context set/clear/show |
| `tests/unit/test_cli_format.py` | `output()` md/json/yaml formatting |

### Modified Files

| File | Changes |
|------|---------|
| `src/kweaver/_http.py` | Extract retry into existing flow, add middleware chain dispatch in `request()` |
| `src/kweaver/_client.py` | Add `debug`, `dry_run` constructor params, auto-assemble middleware list |
| `src/kweaver/_errors.py` | Add `DryRunIntercepted(KWeaverError)` |
| `src/kweaver/cli/main.py` | Add `--debug`, `--dry-run`, `--format` global flags + `use` command + `click.pass_context` |
| `src/kweaver/cli/_helpers.py` | Extend `make_client()` with debug/dry_run params, add `output()` formatter, add `resolve_kn_id()`, add `handle_errors` for `DryRunIntercepted` |
| `tests/conftest.py` | Extend `make_client()` to accept `debug`/`dry_run` kwargs |

---

## Task 1: Middleware Protocol & RequestContext

**Files:**
- Create: `packages/python/src/kweaver/_middleware/__init__.py`
- Test: `packages/python/tests/unit/test_middleware_chain.py`

- [ ] **Step 1: Write failing test — middleware chain composes handlers**

```python
# tests/unit/test_middleware_chain.py
"""Tests for middleware chain composition."""
from __future__ import annotations
from kweaver._middleware import Middleware, RequestContext, RequestHandler


class AppendMiddleware:
    """Test middleware that appends a tag to a list in kwargs."""
    def __init__(self, tag: str) -> None:
        self._tag = tag

    def wrap(self, handler: RequestHandler) -> RequestHandler:
        def wrapper(ctx: RequestContext) -> dict:
            ctx.kwargs.setdefault("tags", []).append(self._tag)
            return handler(ctx)
        return wrapper


def test_middleware_chain_ordering():
    """Middlewares wrap from outer to inner: first in list = outermost."""
    def inner_handler(ctx: RequestContext) -> dict:
        return {"method": ctx.method, "path": ctx.path, "tags": ctx.kwargs.get("tags", [])}

    middlewares = [AppendMiddleware("A"), AppendMiddleware("B")]

    handler = inner_handler
    for mw in reversed(middlewares):
        handler = mw.wrap(handler)

    ctx = RequestContext(method="GET", path="/test", kwargs={})
    result = handler(ctx)
    # A wraps B wraps inner, so A runs first, then B
    assert result["tags"] == ["A", "B"]


def test_empty_middleware_chain():
    """No middleware — handler called directly."""
    def inner_handler(ctx: RequestContext) -> dict:
        return {"ok": True}

    ctx = RequestContext(method="GET", path="/test", kwargs={})
    assert inner_handler(ctx) == {"ok": True}


def test_request_context_fields():
    """RequestContext exposes method, path, kwargs."""
    ctx = RequestContext(method="POST", path="/api/test", kwargs={"json": {"a": 1}})
    assert ctx.method == "POST"
    assert ctx.path == "/api/test"
    assert ctx.kwargs["json"] == {"a": 1}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/python && python -m pytest tests/unit/test_middleware_chain.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'kweaver._middleware'`

- [ ] **Step 3: Write implementation**

```python
# src/kweaver/_middleware/__init__.py
"""Middleware chain infrastructure for HttpClient."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Protocol


@dataclass
class RequestContext:
    """Encapsulates a single HTTP request flowing through the middleware chain."""
    method: str
    path: str
    kwargs: dict[str, Any] = field(default_factory=dict)
    # kwargs keys: json, data, params, headers, timeout, retry


RequestHandler = Callable[[RequestContext], Any]


class Middleware(Protocol):
    """Protocol for middleware components."""
    def wrap(self, handler: RequestHandler) -> RequestHandler: ...
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/python && python -m pytest tests/unit/test_middleware_chain.py -v`
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add packages/python/src/kweaver/_middleware/__init__.py packages/python/tests/unit/test_middleware_chain.py
git commit -m "feat: add middleware protocol and RequestContext dataclass"
```

---

## Task 2: DryRunIntercepted Exception

**Files:**
- Modify: `packages/python/src/kweaver/_errors.py`
- Test: `packages/python/tests/unit/test_middleware_dry_run.py` (partial — exception only)

- [ ] **Step 1: Write failing test**

```python
# tests/unit/test_middleware_dry_run.py
"""Tests for DryRun middleware."""
from __future__ import annotations

import pytest
from kweaver._errors import DryRunIntercepted, KWeaverError


def test_dry_run_intercepted_is_kweaver_error():
    exc = DryRunIntercepted(method="POST", url="/api/test", body={"name": "foo"})
    assert isinstance(exc, KWeaverError)
    assert exc.method == "POST"
    assert exc.url == "/api/test"
    assert exc.body == {"name": "foo"}
    assert "[DRY RUN]" in str(exc)


def test_dry_run_intercepted_no_body():
    exc = DryRunIntercepted(method="DELETE", url="/api/test/1")
    assert exc.body is None
    assert "DELETE" in str(exc)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/python && python -m pytest tests/unit/test_middleware_dry_run.py::test_dry_run_intercepted_is_kweaver_error -v`
Expected: FAIL — `ImportError: cannot import name 'DryRunIntercepted'`

- [ ] **Step 3: Add DryRunIntercepted to _errors.py**

Add after the `NetworkError` class (before `_STATUS_MAP`):

```python
class DryRunIntercepted(KWeaverError):
    """Raised when a write request is intercepted by dry-run mode."""

    def __init__(self, method: str, url: str, body: Any = None) -> None:
        self.method = method
        self.url = url
        self.body = body
        super().__init__(f"[DRY RUN] {method} {url}")
```

Also add `from typing import Any` to the imports at top of `_errors.py`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/python && python -m pytest tests/unit/test_middleware_dry_run.py -v`
Expected: 2 passed

- [ ] **Step 5: Commit**

```bash
git add packages/python/src/kweaver/_errors.py packages/python/tests/unit/test_middleware_dry_run.py
git commit -m "feat: add DryRunIntercepted exception type"
```

---

## Task 3: DryRunMiddleware

**Files:**
- Create: `packages/python/src/kweaver/_middleware/dry_run.py`
- Modify: `packages/python/tests/unit/test_middleware_dry_run.py`

- [ ] **Step 1: Write failing tests — append to existing test file**

```python
# append to tests/unit/test_middleware_dry_run.py

from kweaver._middleware import RequestContext
from kweaver._middleware.dry_run import DryRunMiddleware


def test_dry_run_passes_get():
    """GET requests should pass through normally."""
    def handler(ctx: RequestContext) -> dict:
        return {"data": "ok"}

    mw = DryRunMiddleware()
    wrapped = mw.wrap(handler)
    ctx = RequestContext(method="GET", path="/api/test", kwargs={})
    result = wrapped(ctx)
    assert result == {"data": "ok"}


def test_dry_run_passes_head():
    """HEAD requests should pass through."""
    def handler(ctx: RequestContext) -> dict:
        return {"ok": True}

    mw = DryRunMiddleware()
    wrapped = mw.wrap(handler)
    ctx = RequestContext(method="HEAD", path="/api/test", kwargs={})
    assert wrapped(ctx) == {"ok": True}


def test_dry_run_intercepts_post():
    """POST should raise DryRunIntercepted."""
    def handler(ctx: RequestContext) -> dict:
        return {"should": "not reach"}

    mw = DryRunMiddleware()
    wrapped = mw.wrap(handler)
    ctx = RequestContext(method="POST", path="/api/objects", kwargs={"json": {"name": "Pod"}})
    with pytest.raises(DryRunIntercepted) as exc_info:
        wrapped(ctx)
    assert exc_info.value.method == "POST"
    assert exc_info.value.body == {"name": "Pod"}


def test_dry_run_intercepts_put():
    """PUT should raise DryRunIntercepted."""
    mw = DryRunMiddleware()
    wrapped = mw.wrap(lambda ctx: None)
    ctx = RequestContext(method="PUT", path="/api/objects/1", kwargs={"json": {"name": "new"}})
    with pytest.raises(DryRunIntercepted):
        wrapped(ctx)


def test_dry_run_intercepts_delete():
    """DELETE should raise DryRunIntercepted."""
    mw = DryRunMiddleware()
    wrapped = mw.wrap(lambda ctx: None)
    ctx = RequestContext(method="DELETE", path="/api/objects/1", kwargs={})
    with pytest.raises(DryRunIntercepted):
        wrapped(ctx)


def test_dry_run_intercepts_patch():
    """PATCH should raise DryRunIntercepted (not in _READ_METHODS allowlist)."""
    mw = DryRunMiddleware()
    wrapped = mw.wrap(lambda ctx: None)
    ctx = RequestContext(method="PATCH", path="/api/objects/1", kwargs={"json": {"name": "upd"}})
    with pytest.raises(DryRunIntercepted):
        wrapped(ctx)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/python && python -m pytest tests/unit/test_middleware_dry_run.py -v`
Expected: 5 new tests FAIL — `ModuleNotFoundError: No module named 'kweaver._middleware.dry_run'`

- [ ] **Step 3: Write implementation**

```python
# src/kweaver/_middleware/dry_run.py
"""DryRun middleware — intercepts write operations."""
from __future__ import annotations

import sys
from typing import Any

from kweaver._errors import DryRunIntercepted
from kweaver._middleware import RequestContext, RequestHandler

_READ_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


class DryRunMiddleware:
    """Intercept write requests (POST/PUT/DELETE), let reads pass through."""

    def wrap(self, handler: RequestHandler) -> RequestHandler:
        def wrapper(ctx: RequestContext) -> Any:
            if ctx.method.upper() in _READ_METHODS:
                return handler(ctx)
            body = ctx.kwargs.get("json") or ctx.kwargs.get("data")
            raise DryRunIntercepted(method=ctx.method, url=ctx.path, body=body)
        return wrapper
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/python && python -m pytest tests/unit/test_middleware_dry_run.py -v`
Expected: 8 passed

- [ ] **Step 5: Commit**

```bash
git add packages/python/src/kweaver/_middleware/dry_run.py packages/python/tests/unit/test_middleware_dry_run.py
git commit -m "feat: add DryRunMiddleware — intercepts write operations"
```

---

## Task 4: DebugMiddleware

**Files:**
- Create: `packages/python/src/kweaver/_middleware/debug.py`
- Create: `packages/python/tests/unit/test_middleware_debug.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/unit/test_middleware_debug.py
"""Tests for Debug middleware."""
from __future__ import annotations

import io

from kweaver._middleware import RequestContext
from kweaver._middleware.debug import DebugMiddleware


def _make_response(status: int = 200, body: dict | None = None, headers: dict | None = None):
    """Create a mock response dict for testing."""
    return {
        "_debug_status": status,
        "_debug_headers": headers or {},
        "_debug_body": body,
        "_debug_duration_ms": 42.5,
        "data": body or {},
    }


def test_debug_prints_request_line(capsys):
    """Should print method + path to stderr."""
    def handler(ctx: RequestContext) -> dict:
        return {"ok": True}

    mw = DebugMiddleware()
    wrapped = mw.wrap(handler)
    ctx = RequestContext(method="GET", path="/api/kn/list", kwargs={})
    wrapped(ctx)
    err = capsys.readouterr().err
    assert "GET" in err
    assert "/api/kn/list" in err


def test_debug_masks_authorization(capsys):
    """Authorization header value should be masked."""
    def handler(ctx: RequestContext) -> dict:
        return {"ok": True}

    mw = DebugMiddleware()
    wrapped = mw.wrap(handler)
    ctx = RequestContext(
        method="GET", path="/api/test",
        kwargs={"headers": {"Authorization": "Bearer eyJhbGciOiJSUzI1NiJ9.longtoken"}}
    )
    wrapped(ctx)
    err = capsys.readouterr().err
    assert "eyJhbGciOiJSUzI1NiJ9.longtoken" not in err
    assert "***" in err


def test_debug_shows_timing(capsys):
    """Should include request duration."""
    def handler(ctx: RequestContext) -> dict:
        return {"ok": True}

    mw = DebugMiddleware()
    wrapped = mw.wrap(handler)
    ctx = RequestContext(method="GET", path="/api/test", kwargs={})
    wrapped(ctx)
    err = capsys.readouterr().err
    assert "ms" in err.lower() or "RESPONSE" in err


def test_debug_generates_curl(capsys):
    """Should output a curl equivalent command."""
    def handler(ctx: RequestContext) -> dict:
        return {"ok": True}

    mw = DebugMiddleware()
    wrapped = mw.wrap(handler)
    ctx = RequestContext(
        method="POST", path="/api/test",
        kwargs={"json": {"name": "foo"}, "headers": {"Authorization": "Bearer tok123"}}
    )
    wrapped(ctx)
    err = capsys.readouterr().err
    assert "curl" in err.lower()
    assert "-X POST" in err or "-X 'POST'" in err
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/python && python -m pytest tests/unit/test_middleware_debug.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'kweaver._middleware.debug'`

- [ ] **Step 3: Write implementation**

```python
# src/kweaver/_middleware/debug.py
"""Debug middleware — prints full request/response diagnostics to stderr."""
from __future__ import annotations

import json
import sys
import time
from typing import Any

from kweaver._middleware import RequestContext, RequestHandler


def _mask_auth(headers: dict[str, str]) -> dict[str, str]:
    """Mask Authorization header value."""
    out = dict(headers)
    for key in list(out):
        if key.lower() == "authorization":
            val = out[key]
            if len(val) > 20:
                out[key] = val[:10] + "***"
            else:
                out[key] = "***"
    return out


class DebugMiddleware:
    """Print full request/response diagnostics to stderr."""

    def wrap(self, handler: RequestHandler) -> RequestHandler:
        def wrapper(ctx: RequestContext) -> Any:
            headers = ctx.kwargs.get("headers") or {}
            body = ctx.kwargs.get("json") or ctx.kwargs.get("data")

            # Request
            print(f"\n──── REQUEST ────────────────────────────────────", file=sys.stderr)
            print(f"{ctx.method} {ctx.path}", file=sys.stderr)
            if headers:
                print("Headers:", file=sys.stderr)
                for k, v in _mask_auth(headers).items():
                    print(f"  {k}: {v}", file=sys.stderr)
            if body:
                body_str = json.dumps(body, indent=2, ensure_ascii=False, default=str)
                if len(body_str) > 4096:
                    body_str = body_str[:4096] + "\n  ... (truncated)"
                print(f"Body:\n  {body_str}", file=sys.stderr)

            # Execute
            start = time.monotonic()
            result = handler(ctx)
            elapsed_ms = (time.monotonic() - start) * 1000

            # Response
            print(f"\n──── RESPONSE ({elapsed_ms:.1f}ms) ───────────────────", file=sys.stderr)
            if isinstance(result, dict):
                resp_str = json.dumps(result, indent=2, ensure_ascii=False, default=str)
                if len(resp_str) > 4096:
                    resp_str = resp_str[:4096] + "\n  ... (truncated)"
                print(resp_str, file=sys.stderr)

            # Curl equivalent
            print(f"\n──── CURL ──────────────────────────────────────", file=sys.stderr)
            curl_parts = [f"curl -X {ctx.method} '{ctx.path}'"]
            for k, v in _mask_auth(headers).items():
                curl_parts.append(f"  -H '{k}: {v}'")
            if body:
                curl_parts.append(f"  -d '{json.dumps(body, ensure_ascii=False, default=str)}'")
            print(" \\\n".join(curl_parts), file=sys.stderr)

            return result
        return wrapper
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/python && python -m pytest tests/unit/test_middleware_debug.py -v`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add packages/python/src/kweaver/_middleware/debug.py packages/python/tests/unit/test_middleware_debug.py
git commit -m "feat: add DebugMiddleware — request/response diagnostics + curl to stderr"
```

---

## Task 5: Wire Middleware Chain into HttpClient

**Files:**
- Modify: `packages/python/src/kweaver/_http.py`
- Modify: `packages/python/tests/unit/test_middleware_chain.py` (add integration test)
- Modify: `packages/python/tests/unit/test_http.py` (verify existing tests still pass)

- [ ] **Step 1: Write failing integration test**

```python
# append to tests/unit/test_middleware_chain.py
from unittest.mock import patch

import httpx
from kweaver._auth import TokenAuth
from kweaver._http import HttpClient
from kweaver._middleware.dry_run import DryRunMiddleware
from kweaver._errors import DryRunIntercepted
import pytest


def _make_http_client(handler, middlewares=None):
    transport = httpx.MockTransport(handler)
    return HttpClient(
        base_url="https://mock",
        auth=TokenAuth("tok"),
        transport=transport,
        middlewares=middlewares,
    )


def test_http_client_with_dry_run_middleware():
    """DryRunMiddleware should intercept POST via HttpClient."""
    def handler(req):
        return httpx.Response(200, json={"created": True})

    client = _make_http_client(handler, middlewares=[DryRunMiddleware()])

    # GET should pass
    result = client.get("/api/test")
    assert result == {"created": True}

    # POST should raise
    with pytest.raises(DryRunIntercepted):
        client.post("/api/test", json={"name": "foo"})


def test_http_client_no_middleware():
    """Without middleware, HttpClient works as before."""
    def handler(req):
        return httpx.Response(200, json={"ok": True})

    client = _make_http_client(handler)
    assert client.get("/api/test") == {"ok": True}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/python && python -m pytest tests/unit/test_middleware_chain.py::test_http_client_with_dry_run_middleware -v`
Expected: FAIL — `TypeError: HttpClient.__init__() got an unexpected keyword argument 'middlewares'`

- [ ] **Step 3: Refactor HttpClient to support middleware chain**

Modify `packages/python/src/kweaver/_http.py`:

1. Add `middlewares` parameter to `__init__`:
```python
def __init__(
    self,
    base_url: str,
    auth: AuthProvider,
    *,
    # ... existing params ...
    middlewares: list | None = None,  # NEW
) -> None:
    # ... existing init ...
    self._middlewares = middlewares or []
```

2. Refactor `request()` to dispatch through middleware chain. Extract the actual httpx call into `_do_request()`:

```python
def _do_request(self, ctx: RequestContext) -> Any:
    """Inner handler: actual httpx call with retry logic."""
    method = ctx.method
    path = ctx.path
    json_body = ctx.kwargs.get("json")
    params = ctx.kwargs.get("params")
    timeout = ctx.kwargs.get("timeout")
    retry = ctx.kwargs.get("retry", True)
    merged_headers = self._build_headers(ctx.kwargs.get("headers"))
    self._log(method, path, json_body)

    last_exc: Exception | None = None
    attempts = _MAX_RETRIES if retry else 1

    for attempt in range(attempts):
        try:
            resp = self._client.request(
                method, path,
                json=json_body, params=params,
                headers=merged_headers, timeout=timeout,
            )
        except httpx.HTTPError as exc:
            last_exc = exc
            if attempt < attempts - 1:
                time.sleep(_BACKOFF_BASE * (2 ** attempt))
                continue
            raise NetworkError(str(exc), status_code=None, error_code=None) from exc

        if resp.status_code >= 500 and attempt < attempts - 1:
            last_exc = None
            time.sleep(_BACKOFF_BASE * (2 ** attempt))
            continue

        if resp.status_code >= 400:
            logger.warning("HTTP %d %s %s -> %s", resp.status_code, method, path, resp.text[:500])
        raise_for_status(resp)

        if resp.status_code == 204 or not resp.content:
            return None
        return resp.json()

    if last_exc:
        raise NetworkError(str(last_exc), status_code=None, error_code=None) from last_exc
    return None  # pragma: no cover

def request(
    self,
    method: str,
    path: str,
    *,
    json: Any = None,
    params: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    retry: bool = True,
    timeout: float | None = None,
) -> Any:
    from kweaver._middleware import RequestContext
    ctx = RequestContext(
        method=method,
        path=path,
        kwargs={"json": json, "params": params, "headers": headers, "retry": retry, "timeout": timeout},
    )
    handler = self._do_request
    for mw in reversed(self._middlewares):
        handler = mw.wrap(handler)
    return handler(ctx)
```

> **Known limitation:** `stream_post()` is not routed through the middleware chain (it uses `self._client.stream()` directly). This means `--debug` and `--dry-run` do not apply to streaming calls (agent conversations). This is acceptable for Phase 1 — streaming middleware support is deferred. Add a `# TODO: route stream_post through middleware chain` comment above `stream_post()`.

- [ ] **Step 4: Run ALL tests to verify nothing breaks**

Run: `cd packages/python && python -m pytest tests/unit/ -v`
Expected: All existing tests pass + new tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/python/src/kweaver/_http.py packages/python/tests/unit/test_middleware_chain.py
git commit -m "refactor: wire middleware chain into HttpClient.request()"
```

---

## Task 6: KWeaverClient Constructor — debug/dry_run params

**Files:**
- Modify: `packages/python/src/kweaver/_client.py`
- Modify: `packages/python/tests/conftest.py`
- Test: Add test in `packages/python/tests/unit/test_middleware_chain.py`

- [ ] **Step 1: Write failing test**

```python
# append to tests/unit/test_middleware_chain.py
from kweaver import KWeaverClient
from kweaver._errors import DryRunIntercepted


def test_client_dry_run_param():
    """KWeaverClient(dry_run=True) should intercept POST via _http."""
    def handler(req):
        return httpx.Response(200, json={"ok": True})

    transport = httpx.MockTransport(handler)
    client = KWeaverClient(base_url="https://mock", token="tok", transport=transport, dry_run=True)

    # GET passes through middleware to actual handler
    result = client._http.get("/api/test")
    assert result == {"ok": True}

    # POST raises DryRunIntercepted before reaching handler
    with pytest.raises(DryRunIntercepted):
        client._http.post("/api/test", json={"name": "test"})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/python && python -m pytest tests/unit/test_middleware_chain.py::test_client_dry_run_param -v`
Expected: FAIL — `TypeError: KWeaverClient.__init__() got an unexpected keyword argument 'dry_run'`

- [ ] **Step 3: Add debug/dry_run params to KWeaverClient**

Modify `packages/python/src/kweaver/_client.py`:

```python
from kweaver._middleware import Middleware
from kweaver._middleware.debug import DebugMiddleware
from kweaver._middleware.dry_run import DryRunMiddleware

class KWeaverClient:
    def __init__(
        self,
        base_url: str | None = None,
        *,
        token: str | None = None,
        auth: AuthProvider | None = None,
        account_id: str | None = None,
        account_type: str | None = None,
        business_domain: str | None = None,
        timeout: float = 30.0,
        transport: httpx.BaseTransport | None = None,
        log_requests: bool = False,
        # Observability (new)
        debug: bool = False,
        dry_run: bool = False,
    ) -> None:
        # ... existing auth/base_url validation ...

        # Build middleware chain
        middlewares: list[Middleware] = []
        if debug:
            middlewares.append(DebugMiddleware())
        if dry_run:
            middlewares.append(DryRunMiddleware())

        self._http = HttpClient(
            base_url=base_url,
            auth=auth,
            account_id=account_id,
            account_type=account_type,
            business_domain=business_domain,
            timeout=timeout,
            transport=transport,
            log_requests=log_requests or debug,
            middlewares=middlewares,
        )
        # ... existing resource init ...
```

Also update `tests/conftest.py`'s `make_client()` to accept `**kwargs`:

```python
def make_client(
    handler: Callable[[httpx.Request], httpx.Response],
    capture: RequestCapture | None = None,
    **kwargs,
) -> KWeaverClient:
    transport = make_mock_transport(handler, capture)
    return KWeaverClient(base_url="https://mock", token="test-token", transport=transport, **kwargs)
```

- [ ] **Step 4: Run ALL tests**

Run: `cd packages/python && python -m pytest tests/unit/ -v`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add packages/python/src/kweaver/_client.py packages/python/tests/conftest.py packages/python/tests/unit/test_middleware_chain.py
git commit -m "feat: add debug/dry_run params to KWeaverClient constructor"
```

---

## Task 7: CLI output() formatter — md/json/yaml

**Files:**
- Modify: `packages/python/src/kweaver/cli/_helpers.py`
- Create: `packages/python/tests/unit/test_cli_format.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/unit/test_cli_format.py
"""Tests for CLI output formatting."""
from __future__ import annotations

import json

from click.testing import CliRunner
from kweaver.cli._helpers import output


def test_output_json(capsys):
    """--format json outputs valid JSON."""
    data = [{"id": "kn-1", "name": "test"}]
    output(data, format="json")
    captured = capsys.readouterr().out
    parsed = json.loads(captured)
    assert parsed == data


def test_output_md_list(capsys):
    """--format md outputs a markdown table for list data."""
    data = [{"id": "kn-1", "name": "test"}, {"id": "kn-2", "name": "demo"}]
    output(data, format="md")
    captured = capsys.readouterr().out
    assert "|" in captured
    assert "kn-1" in captured
    assert "kn-2" in captured


def test_output_md_dict(capsys):
    """--format md outputs key-value pairs for dict data."""
    data = {"id": "kn-1", "name": "test", "status": "active"}
    output(data, format="md")
    captured = capsys.readouterr().out
    assert "kn-1" in captured


def test_output_yaml_raises_without_pyyaml():
    """--format yaml without PyYAML should raise UsageError."""
    import unittest.mock as mock
    import click
    with mock.patch.dict("sys.modules", {"yaml": None}):
        with pytest.raises(click.UsageError, match="yaml"):
            output({"a": 1}, format="yaml")


def test_output_default_is_md(capsys):
    """Default format should be md."""
    data = [{"id": "1", "name": "x"}]
    output(data)
    captured = capsys.readouterr().out
    assert "|" in captured  # markdown table
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/python && python -m pytest tests/unit/test_cli_format.py -v`
Expected: FAIL — `ImportError: cannot import name 'output' from 'kweaver.cli._helpers'`

- [ ] **Step 3: Add output() function to _helpers.py**

Add to `packages/python/src/kweaver/cli/_helpers.py`:

```python
def output(data: Any, *, format: str = "md") -> None:
    """Output data in the requested format."""
    if format == "json":
        click.echo(json.dumps(data, indent=2, ensure_ascii=False, default=str))
    elif format == "yaml":
        try:
            import yaml
        except ImportError:
            raise click.UsageError("YAML output requires: pip install kweaver[yaml]")
        click.echo(yaml.dump(data, allow_unicode=True, default_flow_style=False))
    else:  # md
        click.echo(_to_markdown(data))


def _to_markdown(data: Any) -> str:
    """Convert data to markdown table or key-value display."""
    if isinstance(data, list) and data and isinstance(data[0], dict):
        keys = list(data[0].keys())
        lines = []
        lines.append("| " + " | ".join(keys) + " |")
        lines.append("| " + " | ".join("---" for _ in keys) + " |")
        for row in data:
            lines.append("| " + " | ".join(str(row.get(k, "")) for k in keys) + " |")
        return "\n".join(lines)
    elif isinstance(data, dict):
        lines = []
        for k, v in data.items():
            lines.append(f"**{k}:** {v}")
        return "\n".join(lines)
    else:
        return json.dumps(data, indent=2, ensure_ascii=False, default=str)
```

- [ ] **Step 4: Run tests**

Run: `cd packages/python && python -m pytest tests/unit/test_cli_format.py -v`
Expected: 5 passed

- [ ] **Step 5: Commit**

```bash
git add packages/python/src/kweaver/cli/_helpers.py packages/python/tests/unit/test_cli_format.py
git commit -m "feat: add output() multi-format formatter (md/json/yaml)"
```

---

## Task 8: CLI Global Flags (--debug, --dry-run, --format)

**Files:**
- Modify: `packages/python/src/kweaver/cli/main.py`
- Modify: `packages/python/src/kweaver/cli/_helpers.py`
- Test: `packages/python/tests/unit/test_cli_format.py` (extend)

- [ ] **Step 1: Write failing test**

```python
# append to tests/unit/test_cli_format.py
from click.testing import CliRunner
from kweaver.cli.main import cli


def test_cli_debug_flag_registered():
    """--debug should be a valid global flag."""
    runner = CliRunner()
    result = runner.invoke(cli, ["--debug", "--help"])
    assert result.exit_code == 0


def test_cli_handle_errors_catches_dry_run():
    """handle_errors should catch DryRunIntercepted and exit with code 0."""
    from kweaver.cli._helpers import handle_errors
    from kweaver._errors import DryRunIntercepted

    @handle_errors
    def fake_cmd():
        raise DryRunIntercepted(method="POST", url="/api/test")

    # Should not raise, should print to stderr
    fake_cmd()  # exits normally (no sys.exit)


def test_cli_dry_run_flag_registered():
    """--dry-run should be a valid global flag."""
    runner = CliRunner()
    result = runner.invoke(cli, ["--dry-run", "--help"])
    assert result.exit_code == 0


def test_cli_format_flag_registered():
    """--format should be a valid global flag."""
    runner = CliRunner()
    result = runner.invoke(cli, ["--format", "json", "--help"])
    assert result.exit_code == 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/python && python -m pytest tests/unit/test_cli_format.py::test_cli_debug_flag_registered -v`
Expected: FAIL — `Error: No such option: --debug`

- [ ] **Step 3: Add global flags to cli/main.py**

```python
# cli/main.py — replace the @click.group decorator and function
@click.group()
@click.version_option(package_name="kweaver-sdk")
@click.option("--debug", is_flag=True, default=False, envvar="KWEAVER_DEBUG",
              help="Print full request/response diagnostics.")
@click.option("--dry-run", is_flag=True, default=False,
              help="Show write operations without executing them.")
@click.option("--format", "output_format", type=click.Choice(["md", "json", "yaml"]),
              default="md", envvar="KWEAVER_FORMAT",
              help="Output format (default: md).")
@click.pass_context
def cli(ctx: click.Context, debug: bool, dry_run: bool, output_format: str) -> None:
    """KWeaver CLI — manage KWeaver knowledge networks, agents, and more."""
    ctx.ensure_object(dict)
    ctx.obj["debug"] = debug
    ctx.obj["dry_run"] = dry_run
    ctx.obj["output_format"] = output_format
```

Also update `make_client()` in `cli/_helpers.py` to accept these params:

```python
def make_client(
    *,
    debug: bool = False,
    dry_run: bool = False,
) -> KWeaverClient:
    """Build KWeaverClient from env vars or ~/.kweaver/ config."""
    base_url = os.environ.get("KWEAVER_BASE_URL")
    bd = os.environ.get("KWEAVER_BUSINESS_DOMAIN") or "bd_public"

    username = os.environ.get("KWEAVER_USERNAME")
    password = os.environ.get("KWEAVER_PASSWORD")
    if username and password and base_url:
        auth = PasswordAuth(base_url=base_url, username=username, password=password)
        return KWeaverClient(base_url=base_url, auth=auth, business_domain=bd,
                             debug=debug, dry_run=dry_run)

    token = os.environ.get("KWEAVER_TOKEN")
    if token and base_url:
        return KWeaverClient(base_url=base_url, auth=TokenAuth(token), business_domain=bd,
                             debug=debug, dry_run=dry_run)

    auth = ConfigAuth()
    return KWeaverClient(auth=auth, business_domain=bd,
                         debug=debug, dry_run=dry_run)
```

And update `handle_errors` to catch `DryRunIntercepted`:

```python
from kweaver._errors import KWeaverError, AuthenticationError, AuthorizationError, NotFoundError, DryRunIntercepted

def handle_errors(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except DryRunIntercepted as e:
            click.echo(str(e), err=True)
        except AuthenticationError as e:
            error_exit(f"认证失败: {e.message}")
        except AuthorizationError as e:
            error_exit(f"无权限: {e.message}")
        except NotFoundError as e:
            error_exit(f"未找到: {e.message}")
        except KWeaverError as e:
            error_exit(f"错误: {e.message}")
    return wrapper
```

- [ ] **Step 4: Run ALL tests**

Run: `cd packages/python && python -m pytest tests/unit/ -v`
Expected: All pass (existing CLI tests may need `ctx.obj` — verify no regressions)

- [ ] **Step 5: Commit**

```bash
git add packages/python/src/kweaver/cli/main.py packages/python/src/kweaver/cli/_helpers.py packages/python/tests/unit/test_cli_format.py
git commit -m "feat: add --debug, --dry-run, --format global CLI flags"
```

---

## Task 9: `kweaver use` Context Command

**Files:**
- Create: `packages/python/src/kweaver/cli/use.py`
- Modify: `packages/python/src/kweaver/cli/main.py` (register command)
- Modify: `packages/python/src/kweaver/cli/_helpers.py` (add `resolve_kn_id()`)
- Create: `packages/python/tests/unit/test_cli_use.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/unit/test_cli_use.py
"""Tests for kweaver use context command."""
from __future__ import annotations

import json

from click.testing import CliRunner
from kweaver.cli.main import cli


def test_use_set(tmp_path, monkeypatch):
    """kweaver use <kn_id> saves context."""
    monkeypatch.setenv("HOME", str(tmp_path))
    runner = CliRunner()
    result = runner.invoke(cli, ["use", "kn-abc123"])
    assert result.exit_code == 0
    assert "kn-abc123" in result.output

    # Verify file written
    ctx_file = tmp_path / ".kweaver" / "context.json"
    assert ctx_file.exists()
    data = json.loads(ctx_file.read_text())
    assert data["kn_id"] == "kn-abc123"


def test_use_show(tmp_path, monkeypatch):
    """kweaver use (no args) shows current context."""
    monkeypatch.setenv("HOME", str(tmp_path))
    ctx_dir = tmp_path / ".kweaver"
    ctx_dir.mkdir()
    (ctx_dir / "context.json").write_text(json.dumps({"kn_id": "kn-abc123"}))

    runner = CliRunner()
    result = runner.invoke(cli, ["use"])
    assert result.exit_code == 0
    assert "kn-abc123" in result.output


def test_use_clear(tmp_path, monkeypatch):
    """kweaver use --clear removes context."""
    monkeypatch.setenv("HOME", str(tmp_path))
    ctx_dir = tmp_path / ".kweaver"
    ctx_dir.mkdir()
    (ctx_dir / "context.json").write_text(json.dumps({"kn_id": "kn-abc123"}))

    runner = CliRunner()
    result = runner.invoke(cli, ["use", "--clear"])
    assert result.exit_code == 0
    assert not (ctx_dir / "context.json").exists() or "kn_id" not in (ctx_dir / "context.json").read_text()


def test_use_show_no_context(tmp_path, monkeypatch):
    """kweaver use with no saved context shows helpful message."""
    monkeypatch.setenv("HOME", str(tmp_path))
    runner = CliRunner()
    result = runner.invoke(cli, ["use"])
    assert result.exit_code == 0
    # Should indicate no context set


# --- resolve_kn_id tests ---

from kweaver.cli._helpers import resolve_kn_id
import click


def test_resolve_kn_id_explicit_arg():
    """Explicit arg takes priority over context."""
    assert resolve_kn_id("kn-explicit") == "kn-explicit"


def test_resolve_kn_id_from_context(tmp_path, monkeypatch):
    """Falls back to context file when no arg given."""
    monkeypatch.setenv("HOME", str(tmp_path))
    ctx_dir = tmp_path / ".kweaver"
    ctx_dir.mkdir()
    (ctx_dir / "context.json").write_text(json.dumps({"kn_id": "kn-from-ctx"}))
    assert resolve_kn_id(None) == "kn-from-ctx"


def test_resolve_kn_id_raises_when_neither(tmp_path, monkeypatch):
    """Raises UsageError when no arg and no context."""
    monkeypatch.setenv("HOME", str(tmp_path))
    with pytest.raises(click.UsageError, match="kn_id"):
        resolve_kn_id(None)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/python && python -m pytest tests/unit/test_cli_use.py -v`
Expected: FAIL — `Error: No such command 'use'`

- [ ] **Step 3: Implement use command**

```python
# src/kweaver/cli/use.py
"""kweaver use — KN context management."""
from __future__ import annotations

import json
from pathlib import Path

import click


def _context_path() -> Path:
    return Path.home() / ".kweaver" / "context.json"


def _read_context() -> dict:
    path = _context_path()
    if path.exists():
        return json.loads(path.read_text())
    return {}


def _write_context(data: dict) -> None:
    path = _context_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2))


@click.command("use")
@click.argument("kn_id", required=False)
@click.option("--clear", is_flag=True, help="Clear current context.")
def use_cmd(kn_id: str | None, clear: bool) -> None:
    """Set or show the current Knowledge Network context."""
    if clear:
        path = _context_path()
        if path.exists():
            path.unlink()
        click.echo("Context cleared.")
        return

    if kn_id:
        _write_context({"kn_id": kn_id})
        click.echo(f"Context set: kn_id = {kn_id}")
        return

    # Show current
    ctx = _read_context()
    if ctx.get("kn_id"):
        click.echo(f"Current context: kn_id = {ctx['kn_id']}")
    else:
        click.echo("No context set. Use: kweaver use <kn_id>")
```

Register in `cli/main.py`:

```python
from kweaver.cli.use import use_cmd
cli.add_command(use_cmd, "use")
```

Add `resolve_kn_id()` to `cli/_helpers.py`:

```python
def resolve_kn_id(kn_id: str | None) -> str:
    """Resolve kn_id from argument or context. Raises click.UsageError if neither available."""
    if kn_id:
        return kn_id
    from kweaver.cli.use import _read_context
    ctx = _read_context()
    if ctx.get("kn_id"):
        return ctx["kn_id"]
    raise click.UsageError(
        "kn_id required. Provide as argument or set context with: kweaver use <kn_id>"
    )
```

- [ ] **Step 4: Run tests**

Run: `cd packages/python && python -m pytest tests/unit/test_cli_use.py -v`
Expected: 7 passed

- [ ] **Step 5: Run ALL tests for regression**

Run: `cd packages/python && python -m pytest tests/unit/ -v`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add packages/python/src/kweaver/cli/use.py packages/python/src/kweaver/cli/main.py packages/python/src/kweaver/cli/_helpers.py packages/python/tests/unit/test_cli_use.py
git commit -m "feat: add 'kweaver use' context command + resolve_kn_id()"
```

---

## Task 10: Final Regression + Push

- [ ] **Step 1: Run full test suite**

Run: `cd packages/python && python -m pytest tests/unit/ -v --tb=short`
Expected: All tests pass

- [ ] **Step 2: Run coverage check**

Run: `cd packages/python && python -m pytest tests/unit/ --cov=kweaver --cov-report=term-missing`
Expected: Coverage ≥ 65% (existing threshold)

- [ ] **Step 3: Verify imports work**

Run: `cd packages/python && python -c "from kweaver._middleware import Middleware, RequestContext; from kweaver._middleware.debug import DebugMiddleware; from kweaver._middleware.dry_run import DryRunMiddleware; from kweaver._errors import DryRunIntercepted; print('All imports OK')"`
Expected: "All imports OK"

- [ ] **Step 4: Push branch**

```bash
git push -u origin feature/5-sdk-observability-and-read-ops
```
