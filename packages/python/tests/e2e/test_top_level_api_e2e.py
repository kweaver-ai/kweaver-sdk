"""E2E: top-level simple API (kweaver.configure / search / chat / agents / bkns / weaver).

Validates the zero-config path: configure(config=True) reads ~/.kweaver/
and all subsequent calls hit the real KWeaver deployment.
"""

from __future__ import annotations

import os

import pytest

import kweaver as kw

pytestmark = pytest.mark.e2e


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _reset_global_state():
    """Reset module-level state before each test."""
    kw._default_client = None
    kw._default_bkn_id = None
    kw._default_agent_id = None
    yield
    kw._default_client = None
    kw._default_bkn_id = None
    kw._default_agent_id = None


@pytest.fixture(scope="module")
def bkn_with_data(kweaver_client):
    """Find a BKN with indexed data for search tests."""
    kns = kweaver_client.knowledge_networks.list()
    for kn in kns:
        try:
            ots = kweaver_client.object_types.list(kn.id)
        except Exception:
            continue
        for ot in ots:
            if ot.status and ot.status.doc_count > 0:
                return {"kn_id": kn.id, "ot_name": ot.name}
    pytest.skip("No BKN with indexed data found")


@pytest.fixture(scope="module")
def published_agent_id(kweaver_client):
    """Find a published agent for chat tests."""
    agents = kweaver_client.agents.list(status="published")
    if not agents:
        pytest.skip("No published agents found")
    return agents[0].id


# ---------------------------------------------------------------------------
# configure()
# ---------------------------------------------------------------------------

def test_configure_config_true():
    """configure(config=True) should work without passing url or token."""
    bd = os.environ.get("KWEAVER_BUSINESS_DOMAIN")
    kw.configure(config=True, business_domain=bd)
    client = kw._default_client
    assert client is not None


# ---------------------------------------------------------------------------
# bkns()
# ---------------------------------------------------------------------------

def test_bkns_returns_list():
    bd = os.environ.get("KWEAVER_BUSINESS_DOMAIN")
    kw.configure(config=True, business_domain=bd)
    result = kw.bkns()
    assert isinstance(result, list)
    assert len(result) > 0


# ---------------------------------------------------------------------------
# agents()
# ---------------------------------------------------------------------------

def test_agents_returns_list():
    bd = os.environ.get("KWEAVER_BUSINESS_DOMAIN")
    kw.configure(config=True, business_domain=bd)
    result = kw.agents()
    assert isinstance(result, list)
    assert len(result) > 0


# ---------------------------------------------------------------------------
# search()
# ---------------------------------------------------------------------------

def test_search_returns_result(bkn_with_data):
    from kweaver._errors import ServerError

    bd = os.environ.get("KWEAVER_BUSINESS_DOMAIN")
    kw.configure(config=True, bkn_id=bkn_with_data["kn_id"], business_domain=bd)
    try:
        result = kw.search(bkn_with_data["ot_name"])
    except ServerError:
        pytest.skip("Semantic search backend unavailable (500)")
    assert result is not None
    assert isinstance(result.concepts, list)


# ---------------------------------------------------------------------------
# chat()
# ---------------------------------------------------------------------------

@pytest.mark.destructive
def test_chat_returns_reply(published_agent_id):
    from kweaver._errors import ServerError

    bd = os.environ.get("KWEAVER_BUSINESS_DOMAIN")
    kw.configure(config=True, agent_id=published_agent_id, business_domain=bd)
    try:
        reply = kw.chat("你好")
    except ServerError:
        pytest.skip("Agent returned 500 — likely broken config, SDK path OK")
    assert reply is not None
    assert reply.content
