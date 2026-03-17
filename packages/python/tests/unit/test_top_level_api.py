"""Tests for the module-level top-level API (kweaver.configure / search / chat / agents / weaver)."""

from __future__ import annotations

import httpx
import pytest

import kweaver


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_transport(responses: dict[str, object]):
    def handler(req: httpx.Request) -> httpx.Response:
        path = req.url.path
        for pattern, body in responses.items():
            if pattern in path:
                return httpx.Response(200, json=body)
        return httpx.Response(404, json={"error": "not found"})
    return httpx.MockTransport(handler)


def _configure(responses: dict[str, object], bkn_id: str = "kn1", agent_id: str = "agent1") -> None:
    transport = _make_transport(responses)
    kweaver.configure("https://mock", token="test-token", bkn_id=bkn_id, agent_id=agent_id)
    kweaver._default_client._http._client = httpx.Client(
        base_url="https://mock",
        transport=transport,
    )


# ---------------------------------------------------------------------------
# configure()
# ---------------------------------------------------------------------------

class TestConfigure:
    def setup_method(self):
        kweaver._default_client = None
        kweaver._default_bkn_id = None
        kweaver._default_agent_id = None

    def test_token_auth(self):
        kweaver.configure("https://example.com", token="tok123")
        assert kweaver._default_client is not None

    def test_username_password_auth(self):
        kweaver.configure("https://example.com", username="user", password="pass")
        assert kweaver._default_client is not None

    def test_sets_defaults(self):
        kweaver.configure("https://example.com", token="tok", bkn_id="kn99", agent_id="ag99")
        assert kweaver._default_bkn_id == "kn99"
        assert kweaver._default_agent_id == "ag99"

    def test_no_auth_raises(self):
        with pytest.raises(ValueError, match="Provide token="):
            kweaver.configure("https://example.com")

    def test_require_client_before_configure(self):
        with pytest.raises(RuntimeError, match="kweaver.configure()"):
            kweaver._require_client()


# ---------------------------------------------------------------------------
# search()
# ---------------------------------------------------------------------------

class TestSearch:
    def setup_method(self):
        kweaver._default_client = None
        kweaver._default_bkn_id = None
        kweaver._default_agent_id = None

    def test_search_with_default_bkn_id(self):
        semantic_response = {
            "concepts": [
                {
                    "concept_type": "产品",
                    "concept_id": "c1",
                    "concept_name": "KWeaver",
                    "intent_score": 0.9,
                    "match_score": 0.8,
                    "rerank_score": 0.85,
                }
            ],
            "hits_total": 1,
        }
        _configure({"/semantic-search": semantic_response}, bkn_id="kn1")
        result = kweaver.search("KWeaver 能做什么？")
        assert result.hits_total == 1
        assert result.concepts[0].concept_name == "KWeaver"

    def test_search_with_explicit_bkn_id(self):
        semantic_response = {"concepts": [], "hits_total": 0}
        _configure({"/semantic-search": semantic_response}, bkn_id="kn1")
        result = kweaver.search("test", bkn_id="kn_other")
        assert result.hits_total == 0

    def test_search_no_bkn_id_raises(self):
        kweaver.configure("https://mock", token="tok")
        with pytest.raises(ValueError, match="No bkn_id"):
            kweaver.search("query without bkn_id")

    def test_search_not_configured_raises(self):
        with pytest.raises(RuntimeError, match="kweaver.configure()"):
            kweaver.search("query")


# ---------------------------------------------------------------------------
# agents()
# ---------------------------------------------------------------------------

class TestAgents:
    def setup_method(self):
        kweaver._default_client = None
        kweaver._default_bkn_id = None
        kweaver._default_agent_id = None

    def test_list_agents(self):
        agent_response = [
            {"id": "a1", "name": "助手A", "status": "published"},
            {"id": "a2", "name": "助手B", "status": "published"},
        ]
        _configure({"/agent-list": agent_response})
        result = kweaver.agents()
        assert len(result) == 2
        assert result[0].name == "助手A"

    def test_agents_not_configured_raises(self):
        with pytest.raises(RuntimeError, match="kweaver.configure()"):
            kweaver.agents()


# ---------------------------------------------------------------------------
# chat()
# ---------------------------------------------------------------------------

class TestChat:
    def setup_method(self):
        kweaver._default_client = None
        kweaver._default_bkn_id = None
        kweaver._default_agent_id = None

    def test_chat_with_default_agent_id(self):
        chat_response = {
            "message": {
                "id": "msg1",
                "role": "assistant",
                "content": "KWeaver 是一个知识网络平台。",
                "timestamp": "2026-03-17T00:00:00Z",
            },
            "conversation_id": "conv1",
        }
        _configure({"/chat/completion": chat_response}, agent_id="agent1")
        reply = kweaver.chat("KWeaver 是什么？")
        assert "KWeaver" in reply.content

    def test_chat_with_explicit_agent_id(self):
        chat_response = {
            "message": {
                "id": "msg2",
                "role": "assistant",
                "content": "你好！",
                "timestamp": "2026-03-17T00:00:00Z",
            },
            "conversation_id": "conv2",
        }
        _configure({"/chat/completion": chat_response})
        reply = kweaver.chat("你好", agent_id="agent_explicit")
        assert reply.content == "你好！"

    def test_chat_no_agent_id_raises(self):
        kweaver.configure("https://mock", token="tok")
        with pytest.raises(ValueError, match="No agent_id"):
            kweaver.chat("hello without agent")

    def test_chat_not_configured_raises(self):
        with pytest.raises(RuntimeError, match="kweaver.configure()"):
            kweaver.chat("hello")


# ---------------------------------------------------------------------------
# bkns()
# ---------------------------------------------------------------------------

class TestBkns:
    def setup_method(self):
        kweaver._default_client = None
        kweaver._default_bkn_id = None
        kweaver._default_agent_id = None

    def test_list_bkns(self):
        kn_response = [
            {"id": "kn1", "name": "供应链BKN", "tags": []},
            {"id": "kn2", "name": "人力资源BKN", "tags": []},
        ]
        _configure({"/knowledge-networks": kn_response})
        result = kweaver.bkns()
        assert len(result) == 2
        assert result[0].name == "供应链BKN"

    def test_bkns_not_configured_raises(self):
        with pytest.raises(RuntimeError, match="kweaver.configure()"):
            kweaver.bkns()


# ---------------------------------------------------------------------------
# weaver()
# ---------------------------------------------------------------------------

class TestWeaver:
    def setup_method(self):
        kweaver._default_client = None
        kweaver._default_bkn_id = None
        kweaver._default_agent_id = None

    def test_weaver_triggers_build(self):
        build_response = {"state": "running"}
        _configure({"/full_build_ontology": build_response}, bkn_id="kn1")
        job = kweaver.weaver()
        assert job.kn_id == "kn1"

    def test_weaver_with_explicit_bkn_id(self):
        build_response = {"state": "running"}
        _configure({"/full_build_ontology": build_response})
        job = kweaver.weaver(bkn_id="kn_other")
        assert job.kn_id == "kn_other"

    def test_weaver_no_bkn_id_raises(self):
        kweaver.configure("https://mock", token="tok")
        with pytest.raises(ValueError, match="No bkn_id"):
            kweaver.weaver()

    def test_weaver_not_configured_raises(self):
        with pytest.raises(RuntimeError, match="kweaver.configure()"):
            kweaver.weaver()

    def test_weaver_wait_raises_on_failed_build(self):
        call_count = {"n": 0}

        def handler(req: httpx.Request) -> httpx.Response:
            path = req.url.path
            if "/full_build_ontology" in path and req.method == "POST":
                return httpx.Response(200, json={"state": "running"})
            if "/full_ontology_building_status" in path:
                call_count["n"] += 1
                return httpx.Response(200, json={"state": "failed", "state_detail": "index error"})
            return httpx.Response(404, json={})

        kweaver.configure("https://mock", token="tok", bkn_id="kn1")
        kweaver._default_client._http._client = httpx.Client(
            base_url="https://mock",
            transport=httpx.MockTransport(handler),
        )
        with pytest.raises(RuntimeError, match="BKN build failed"):
            kweaver.weaver(wait=True, timeout=10)

    def test_weaver_wait_blocks_until_complete(self):
        call_count = {"n": 0}

        def handler(req: httpx.Request) -> httpx.Response:
            path = req.url.path
            if "/full_build_ontology" in path and req.method == "POST":
                return httpx.Response(200, json={"state": "running"})
            if "/full_ontology_building_status" in path:
                call_count["n"] += 1
                state = "completed" if call_count["n"] >= 2 else "running"
                return httpx.Response(200, json={"state": state})
            return httpx.Response(404, json={})

        kweaver.configure("https://mock", token="tok", bkn_id="kn1")
        kweaver._default_client._http._client = httpx.Client(
            base_url="https://mock",
            transport=httpx.MockTransport(handler),
        )
        job = kweaver.weaver(wait=True, timeout=10)
        assert job.kn_id == "kn1"
        assert call_count["n"] >= 2
