"""Tests for ConceptGroupsResource."""
import httpx
import pytest
from tests.conftest import RequestCapture, make_client


def test_list_concept_groups(capture: RequestCapture):
    def handler(req):
        return httpx.Response(200, json={"entries": [
            {"id": "cg-1", "name": "compute", "kn_id": "kn-1", "object_type_ids": ["ot-1"]},
        ]})
    client = make_client(handler, capture)
    cgs = client.concept_groups.list("kn-1")
    assert len(cgs) == 1
    assert cgs[0].name == "compute"
    assert "/knowledge-networks/kn-1/concept-groups" in capture.last_url()


def test_get_concept_group(capture: RequestCapture):
    def handler(req):
        return httpx.Response(200, json={
            "id": "cg-1", "name": "compute", "kn_id": "kn-1",
            "object_type_ids": ["ot-1", "ot-2"],
        })
    client = make_client(handler, capture)
    cg = client.concept_groups.get("kn-1", "cg-1")
    assert cg.id == "cg-1"
    assert len(cg.object_type_ids) == 2


def test_create_concept_group(capture: RequestCapture):
    def handler(req):
        return httpx.Response(200, json={
            "id": "cg-new", "name": "network", "kn_id": "kn-1",
        })
    client = make_client(handler, capture)
    cg = client.concept_groups.create("kn-1", name="network")
    assert cg.id == "cg-new"
    body = capture.last_body()
    assert body["name"] == "network"


def test_delete_concept_group(capture: RequestCapture):
    def handler(req):
        return httpx.Response(204)
    client = make_client(handler, capture)
    client.concept_groups.delete("kn-1", ["cg-1", "cg-2"])
    assert "cg-1,cg-2" in capture.last_url() or "cg-1" in capture.last_url()


def test_add_members(capture: RequestCapture):
    def handler(req):
        return httpx.Response(200, json={})
    client = make_client(handler, capture)
    client.concept_groups.add_members("kn-1", "cg-1", object_type_ids=["ot-1", "ot-2"])
    body = capture.last_body()
    assert "ot-1" in str(body)
