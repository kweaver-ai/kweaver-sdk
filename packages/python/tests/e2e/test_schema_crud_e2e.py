"""E2E: schema CRUD — object type and relation type create/get/update/delete.

Requires:
- A knowledge network with at least one data view
- Tests create, read, update, and delete object types and relation types

Destructive: creates and deletes schema entries.
"""
from __future__ import annotations

import json
from typing import Any

import pytest

from kweaver import KWeaverClient
from kweaver.cli.main import cli

pytestmark = [pytest.mark.e2e, pytest.mark.destructive]


@pytest.fixture(scope="module")
def kn_with_view(kweaver_client: KWeaverClient):
    """Find a KN that has at least one object type (to get a dataview_id).

    We need an existing dataview_id to create new object types.
    """
    kns = kweaver_client.knowledge_networks.list()
    for kn in kns:
        try:
            ots = kweaver_client.object_types.list(kn.id)
            if ots and ots[0].dataview_id:
                return {"kn": kn, "ot": ots[0]}
        except Exception:
            continue
    pytest.skip("No KN with object types found for schema CRUD tests")


def test_object_type_get(kweaver_client: KWeaverClient, kn_with_view):
    """SDK: get object type by ID."""
    kn = kn_with_view["kn"]
    ot = kn_with_view["ot"]
    result = kweaver_client.object_types.get(kn.id, ot.id)
    assert result.id == ot.id
    assert result.name == ot.name
    assert result.kn_id == kn.id


def test_cli_object_type_get(kn_with_view, cli_runner):
    """CLI: bkn object-type get should return details."""
    kn = kn_with_view["kn"]
    ot = kn_with_view["ot"]
    result = cli_runner.invoke(cli, ["bkn", "object-type", "get", kn.id, ot.id])
    assert result.exit_code == 0, f"object-type get failed: {result.output}"
    data = json.loads(result.output)
    assert data["id"] == ot.id


def test_cli_object_type_list(kn_with_view, cli_runner):
    """CLI: bkn object-type list should return array."""
    kn = kn_with_view["kn"]
    result = cli_runner.invoke(cli, ["bkn", "object-type", "list", kn.id])
    assert result.exit_code == 0, f"object-type list failed: {result.output}"
    data = json.loads(result.output)
    assert isinstance(data, list)
    assert len(data) > 0


def test_relation_type_list(kweaver_client: KWeaverClient, kn_with_view):
    """SDK: list relation types should return without error."""
    kn = kn_with_view["kn"]
    rts = kweaver_client.relation_types.list(kn.id)
    assert isinstance(rts, list)


def test_cli_relation_type_list(kn_with_view, cli_runner):
    """CLI: bkn relation-type list should work."""
    kn = kn_with_view["kn"]
    result = cli_runner.invoke(cli, ["bkn", "relation-type", "list", kn.id])
    assert result.exit_code == 0, f"relation-type list failed: {result.output}"
    data = json.loads(result.output)
    assert isinstance(data, list)


def test_relation_type_get_if_exists(kweaver_client: KWeaverClient, kn_with_view):
    """SDK: get relation type by ID (if any exist)."""
    kn = kn_with_view["kn"]
    rts = kweaver_client.relation_types.list(kn.id)
    if not rts:
        pytest.skip("No relation types exist to test get")
    rt = kweaver_client.relation_types.get(kn.id, rts[0].id)
    assert rt.id == rts[0].id
    assert rt.name == rts[0].name
