"""Unit tests: AgentTemplatesResource (agent-tpl)."""

from __future__ import annotations

import json

import httpx

from kweaver._errors import EndpointUnavailableError
from tests.conftest import make_client


def test_template_get_by_id():
    def handler(req: httpx.Request) -> httpx.Response:
        assert req.method == "GET"
        assert "/agent-tpl/tpl1" in str(req.url)
        assert "/by-key/" not in str(req.url)
        return httpx.Response(200, json={"tpl_id": "tpl1", "name": "n"})

    client = make_client(handler)
    assert client.agent_templates.get("tpl1")["name"] == "n"


def test_template_get_by_key_encoded():
    def handler(req: httpx.Request) -> httpx.Response:
        assert "/agent-tpl/by-key/a%2Fb" in str(req.url)
        return httpx.Response(200, json={"tpl_id": "x"})

    client = make_client(handler)
    client.agent_templates.get_by_key("a/b")


def test_template_update_put_json():
    sent: dict = {}

    def handler(req: httpx.Request) -> httpx.Response:
        sent["body"] = json.loads(req.content.decode("utf-8"))
        assert req.method == "PUT"
        return httpx.Response(200, json={})

    client = make_client(handler)
    client.agent_templates.update("t1", {"name": "x"})
    assert sent["body"]["name"] == "x"


def test_template_delete():
    def handler(req: httpx.Request) -> httpx.Response:
        assert req.method == "DELETE"
        return httpx.Response(200, json={})

    client = make_client(handler)
    client.agent_templates.delete("t1")


def test_template_copy_posts_empty_json():
    def handler(req: httpx.Request) -> httpx.Response:
        assert req.method == "POST"
        assert req.content.decode("utf-8") == "{}"
        assert "/copy" in str(req.url)
        return httpx.Response(200, json={"id": "c"})

    client = make_client(handler)
    assert client.agent_templates.copy("t1")["id"] == "c"


def test_template_publish_default_body():
    seen: dict = {}

    def handler(req: httpx.Request) -> httpx.Response:
        seen["j"] = json.loads(req.content.decode("utf-8"))
        return httpx.Response(200, json={"ok": True})

    client = make_client(handler)
    client.agent_templates.publish("t1")
    assert seen["j"]["business_domain_id"] == "bd_public"


def test_template_unpublish_put():
    def handler(req: httpx.Request) -> httpx.Response:
        assert req.method == "PUT"
        assert "/unpublish" in str(req.url)
        return httpx.Response(200, json={})

    client = make_client(handler)
    client.agent_templates.unpublish("t1")


def test_template_publish_info_get_put():
    calls: list[str] = []

    def handler(req: httpx.Request) -> httpx.Response:
        calls.append(f"{req.method}:{req.url.path}")
        if req.method == "GET":
            return httpx.Response(200, json={"desc": ""})
        return httpx.Response(200, json={"desc": "d"})

    client = make_client(handler)
    client.agent_templates.get_publish_info("t1")
    client.agent_templates.update_publish_info("t1", {"desc": "d"})
    assert any("publish-info" in c for c in calls)


def test_template_get_404_endpoint_unavailable():
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"message": "no"})

    client = make_client(handler)
    try:
        client.agent_templates.get("missing")
    except EndpointUnavailableError as exc:
        assert "/agent-tpl/missing" in exc.endpoint_path
    else:
        raise AssertionError("expected EndpointUnavailableError")
