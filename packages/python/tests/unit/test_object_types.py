"""Tests for object_types resource."""

import httpx

from kweaver.types import Property
from tests.conftest import RequestCapture, make_client

_OT_RESPONSE = {
    "id": "ot_01",
    "name": "产品",
    "data_source": {"type": "data_view", "id": "dv_01"},
    "primary_keys": ["material_number"],
    "display_key": "product_name",
    "data_properties": [
        {
            "name": "material_number",
            "display_name": "material_number",
            "type": "varchar",
            "index_config": {
                "keyword_config": {"enabled": True},
                "fulltext_config": {"enabled": False},
                "vector_config": {"enabled": False},
            },
        },
        {
            "name": "product_name",
            "display_name": "product_name",
            "type": "varchar",
            "index_config": {
                "keyword_config": {"enabled": False},
                "fulltext_config": {"enabled": True},
                "vector_config": {"enabled": True},
            },
        },
    ],
}


def test_create_wraps_in_entries(capture: RequestCapture):
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"entries": [_OT_RESPONSE]})

    client = make_client(handler, capture)
    ot = client.object_types.create(
        "kn_01",
        name="产品",
        dataview_id="dv_01",
        primary_keys=["material_number"],
        display_key="product_name",
        properties=[
            Property(name="material_number", indexed=True),
            Property(name="product_name", fulltext=True, vector=True),
        ],
    )

    body = capture.last_body()
    assert "entries" in body
    entry = body["entries"][0]
    assert entry["data_source"]["id"] == "dv_01"
    assert entry["primary_keys"] == ["material_number"]

    # Check index_config transform
    props = entry["data_properties"]
    assert props[0]["index_config"]["keyword_config"]["enabled"] is True
    assert props[1]["index_config"]["fulltext_config"]["enabled"] is True
    assert props[1]["index_config"]["vector_config"]["enabled"] is True

    assert ot.id == "ot_01"
    assert ot.dataview_id == "dv_01"


def test_primary_key_shortcut(capture: RequestCapture):
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"entries": [_OT_RESPONSE]})

    client = make_client(handler, capture)
    client.object_types.create(
        "kn_01",
        name="产品",
        dataview_id="dv_01",
        primary_key="material_number",
        display_key="product_name",
    )

    body = capture.last_body()
    assert body["entries"][0]["primary_keys"] == ["material_number"]


def test_response_parses_index_config():
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"data": [_OT_RESPONSE]})

    client = make_client(handler)
    ots = client.object_types.list("kn_01")
    assert len(ots) == 1
    ot = ots[0]
    assert ot.properties[0].indexed is True
    assert ot.properties[0].fulltext is False
    assert ot.properties[1].fulltext is True
    assert ot.properties[1].vector is True


def test_create_without_properties_sends_empty(capture: RequestCapture):
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"entries": [_OT_RESPONSE]})

    client = make_client(handler, capture)
    client.object_types.create(
        "kn_01", name="产品", dataview_id="dv_01",
        primary_keys=["id"], display_key="name",
    )
    body = capture.last_body()
    # Auto-generated from primary_keys + display_key
    prop_names = {p["name"] for p in body["entries"][0]["data_properties"]}
    assert "id" in prop_names
    assert "name" in prop_names


def test_get_object_type(capture: RequestCapture):
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=_OT_RESPONSE)

    client = make_client(handler, capture)
    ot = client.object_types.get("kn_01", "ot_01")
    assert ot.id == "ot_01"
    assert ot.name == "产品"
    assert "/knowledge-networks/kn_01/object-types/ot_01" in capture.last_url()


def test_update_object_type(capture: RequestCapture):
    updated = {**_OT_RESPONSE, "name": "新产品"}

    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=updated)

    client = make_client(handler, capture)
    ot = client.object_types.update("kn_01", "ot_01", name="新产品")
    assert ot.name == "新产品"
    body = capture.last_body()
    assert body["name"] == "新产品"


def test_delete_object_type(capture: RequestCapture):
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={})

    client = make_client(handler, capture)
    client.object_types.delete("kn_01", "ot_01")
    assert "/object-types/ot_01" in capture.last_url()


def test_delete_multiple_object_types(capture: RequestCapture):
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={})

    client = make_client(handler, capture)
    client.object_types.delete("kn_01", ["ot_01", "ot_02"])
    assert "/object-types/ot_01,ot_02" in capture.last_url()
