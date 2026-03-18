"""Tests for knowledge_networks resource."""

import httpx

from tests.conftest import RequestCapture, make_client


def test_create_knowledge_network(capture: RequestCapture):
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={
            "id": "kn_01", "name": "test_kn", "tags": [],
        })

    client = make_client(handler, capture)
    kn = client.knowledge_networks.create(name="test_kn", tags=["demo"])

    body = capture.last_body()
    assert body["name"] == "test_kn"
    assert body["tags"] == ["demo"]
    assert kn.id == "kn_01"


def test_get_knowledge_network_with_statistics(capture: RequestCapture):
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={
            "id": "kn_01", "name": "test_kn", "tags": [],
            "statistics": {
                "object_types_total": 5,
                "relation_types_total": 2,
                "action_types_total": 1,
                "concept_groups_total": 0,
            },
        })

    client = make_client(handler, capture)
    kn = client.knowledge_networks.get("kn_01", include_statistics=True)
    assert kn.id == "kn_01"
    assert kn.statistics is not None
    assert kn.statistics.object_types_total == 5
    assert "include_statistics=true" in capture.last_url()


def test_list_knowledge_networks():
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"data": [
            {"id": "kn_01", "name": "erp", "statistics": {
                "object_types_total": 3,
                "relation_types_total": 1,
                "action_types_total": 0,
                "concept_groups_total": 0,
            }},
        ]})

    client = make_client(handler)
    kns = client.knowledge_networks.list()
    assert len(kns) == 1
    assert kns[0].statistics.object_types_total == 3


def test_build_returns_build_job(capture: RequestCapture):
    def handler(req: httpx.Request) -> httpx.Response:
        url = str(req.url)
        if "/jobs" in url and req.method == "POST":
            return httpx.Response(200, json={})
        if "/jobs" in url and req.method == "GET":
            return httpx.Response(200, json={
                "entries": [{"state": "completed"}],
            })
        return httpx.Response(200, json={})

    client = make_client(handler, capture)
    job = client.knowledge_networks.build("kn_01")
    assert job.kn_id == "kn_01"

    status = job.poll()
    assert status.state == "completed"
