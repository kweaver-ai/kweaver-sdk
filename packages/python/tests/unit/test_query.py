"""Tests for query resource."""

import httpx

from kweaver.types import Condition
from tests.conftest import RequestCapture, make_client


def test_semantic_search_defaults(capture: RequestCapture):
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={
            "concepts": [
                {"concept_type": "object_type", "concept_id": "ot_01",
                 "concept_name": "产品"},
            ],
            "hits_total": 1,
        })

    client = make_client(handler, capture)
    result = client.query.semantic_search(kn_id="kn_01", query="产品库存")

    body = capture.last_body()
    assert body["mode"] == "keyword_vector_retrieval"
    assert body["rerank_action"] == "default"
    assert body["max_concepts"] == 10
    assert body["return_query_understanding"] is False
    assert result.hits_total == 1
    assert result.concepts[0].concept_name == "产品"


def test_instances_sends_method_override_header(capture: RequestCapture):
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={
            "data": [{"id": 1, "name": "test"}],
            "total_count": 100,
            "search_after": [1],
        })

    client = make_client(handler, capture)
    result = client.query.instances("kn_01", "ot_01")

    assert capture.last_headers()["x-http-method-override"] == "GET"
    assert result.total_count == 100
    assert result.search_after == [1]


def test_instances_with_condition(capture: RequestCapture):
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"data": [], "total_count": 0})

    client = make_client(handler, capture)
    cond = Condition(field="status", operation="==", value="active")
    client.query.instances("kn_01", "ot_01", condition=cond)

    body = capture.last_body()
    assert body["condition"]["field"] == "status"
    assert body["condition"]["operation"] == "=="
    assert body["condition"]["value_from"] == "const"


def test_instances_with_compound_condition(capture: RequestCapture):
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"data": [], "total_count": 0})

    client = make_client(handler, capture)
    cond = Condition(
        operation="and",
        sub_conditions=[
            Condition(field="status", operation="==", value="active"),
            Condition(field="qty", operation=">", value=0),
        ],
    )
    client.query.instances("kn_01", "ot_01", condition=cond)

    body = capture.last_body()
    assert body["condition"]["operation"] == "and"
    assert len(body["condition"]["sub_conditions"]) == 2


def test_instances_iter():
    page = 0

    def handler(req: httpx.Request) -> httpx.Response:
        nonlocal page
        page += 1
        if page <= 2:
            return httpx.Response(200, json={
                "data": [{"id": page}],
                "total_count": 3,
                "search_after": [page],
            })
        return httpx.Response(200, json={
            "data": [{"id": page}],
            "total_count": 3,
            "search_after": None,
        })

    client = make_client(handler)
    pages = list(client.query.instances_iter("kn_01", "ot_01", limit=1))
    assert len(pages) == 3


def test_kn_search(capture: RequestCapture):
    from unittest.mock import patch, MagicMock

    mock_cl = MagicMock()
    mock_cl.kn_search.return_value = {
        "object_types": [{"id": "ot_01", "name": "产品"}],
        "relation_types": [],
        "action_types": [],
    }

    with patch("kweaver.resources.context_loader.ContextLoaderResource", return_value=mock_cl):
        client = make_client(lambda req: httpx.Response(200, json={}), capture)
        result = client.query.kn_search("kn_01", "产品")
        assert result.object_types is not None
        assert len(result.object_types) == 1
        mock_cl.kn_search.assert_called_once_with("产品", only_schema=False)


def test_kn_search_only_schema(capture: RequestCapture):
    from unittest.mock import patch, MagicMock

    mock_cl = MagicMock()
    mock_cl.kn_search.return_value = {
        "object_types": [],
        "relation_types": [],
        "action_types": [],
    }

    with patch("kweaver.resources.context_loader.ContextLoaderResource", return_value=mock_cl):
        client = make_client(lambda req: httpx.Response(200, json={}), capture)
        client.query.kn_search("kn_01", "产品", only_schema=True)
        mock_cl.kn_search.assert_called_once_with("产品", only_schema=True)


def test_object_type_properties(capture: RequestCapture):
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={
            "properties": [{"name": "id", "type": "integer"}],
        })

    client = make_client(handler, capture)
    result = client.query.object_type_properties("kn_01", "ot_01")
    assert "properties" in result
    assert capture.last_headers()["x-http-method-override"] == "GET"
