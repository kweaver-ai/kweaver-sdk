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
