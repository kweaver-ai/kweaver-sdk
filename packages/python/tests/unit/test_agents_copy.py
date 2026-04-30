"""Unit tests: agent copy endpoints (agent-factory v3)."""

from __future__ import annotations

import httpx

from kweaver._errors import EndpointUnavailableError
from tests.conftest import make_client


def test_copy_posts_personal_copy():
    def handler(req: httpx.Request) -> httpx.Response:
        assert req.method == "POST"
        assert "/agent/a1/copy" in str(req.url)
        return httpx.Response(200, json={"id": "new"})

    client = make_client(handler)
    out = client.agents.copy("a1")
    assert out["id"] == "new"


def test_copy_to_template_posts_copy2tpl():
    def handler(req: httpx.Request) -> httpx.Response:
        assert "/copy2tpl" in str(req.url)
        return httpx.Response(200, json={"tpl_id": "t"})

    client = make_client(handler)
    assert client.agents.copy_to_template("z")["tpl_id"] == "t"


def test_copy_maps_404_to_endpoint_unavailable():
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"message": "missing"})

    client = make_client(handler)
    try:
        client.agents.copy("nope")
    except EndpointUnavailableError as exc:
        assert exc.status_code == 404
        assert "/agent/nope/copy" in exc.endpoint_path
    else:
        raise AssertionError("expected EndpointUnavailableError")
