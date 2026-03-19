"""L2: Schema management — object type and relation type CRUD.

Read-only tests use existing data. Write tests are marked destructive.
"""
from __future__ import annotations

import json

import pytest

from kweaver import KWeaverClient
from kweaver.cli.main import cli

pytestmark = pytest.mark.e2e


def test_object_type_list(kweaver_client: KWeaverClient, kn_with_data):
    """SDK: list object types."""
    kn = kn_with_data["kn"]
    ots = kweaver_client.object_types.list(kn.id)
    assert isinstance(ots, list)
    assert len(ots) > 0


def test_object_type_get(kweaver_client: KWeaverClient, kn_with_data):
    """SDK: get object type by ID."""
    kn = kn_with_data["kn"]
    ot = kn_with_data["ot"]
    result = kweaver_client.object_types.get(kn.id, ot.id)
    assert result.id == ot.id
    assert result.name == ot.name


def test_relation_type_list(kweaver_client: KWeaverClient, kn_with_data):
    """SDK: list relation types."""
    kn = kn_with_data["kn"]
    rts = kweaver_client.relation_types.list(kn.id)
    assert isinstance(rts, list)


def test_relation_type_get_if_exists(kweaver_client: KWeaverClient, kn_with_data):
    """SDK: get relation type by ID (if any exist)."""
    kn = kn_with_data["kn"]
    rts = kweaver_client.relation_types.list(kn.id)
    if not rts:
        pytest.skip("No relation types exist to test get")
    rt = kweaver_client.relation_types.get(kn.id, rts[0].id)
    assert rt.id == rts[0].id
    assert rt.name == rts[0].name


def test_cli_object_type_list(kn_with_data, cli_runner):
    """CLI: bkn object-type list."""
    kn = kn_with_data["kn"]
    result = cli_runner.invoke(cli, ["bkn", "object-type", "list", kn.id])
    assert result.exit_code == 0
    data = json.loads(result.output)
    assert isinstance(data, list)
    assert len(data) > 0


def test_cli_object_type_get(kn_with_data, cli_runner):
    """CLI: bkn object-type get."""
    kn = kn_with_data["kn"]
    ot = kn_with_data["ot"]
    result = cli_runner.invoke(cli, ["bkn", "object-type", "get", kn.id, ot.id])
    assert result.exit_code == 0
    data = json.loads(result.output)
    assert data["id"] == ot.id


def test_cli_relation_type_list(kn_with_data, cli_runner):
    """CLI: bkn relation-type list."""
    kn = kn_with_data["kn"]
    result = cli_runner.invoke(cli, ["bkn", "relation-type", "list", kn.id])
    assert result.exit_code == 0
    data = json.loads(result.output)
    assert isinstance(data, list)
