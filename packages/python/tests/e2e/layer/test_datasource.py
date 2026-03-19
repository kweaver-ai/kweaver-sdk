"""L1: Datasource — connection, discovery, and CRUD."""

from __future__ import annotations

from typing import Any

import pytest

from kweaver import KWeaverClient

pytestmark = pytest.mark.e2e


def test_datasource_test_connectivity(kweaver_client: KWeaverClient, db_config: dict[str, Any]):
    """Verify that we can reach the configured test database."""
    result = kweaver_client.datasources.test(**db_config)
    assert result is True


def test_datasource_create_and_list(create_datasource, kweaver_client: KWeaverClient):
    """Create a datasource and verify it appears in list."""
    ds = create_datasource(name="e2e_ds_list_test")

    found = kweaver_client.datasources.list(keyword="e2e_ds_list_test")
    assert any(d.id == ds.id for d in found)


def test_datasource_get(create_datasource, kweaver_client: KWeaverClient):
    """Create a datasource and retrieve it by ID."""
    ds = create_datasource(name="e2e_ds_get_test")
    fetched = kweaver_client.datasources.get(ds.id)
    assert fetched.id == ds.id
    assert fetched.name == "e2e_ds_get_test"


def test_datasource_list_tables(create_datasource, kweaver_client: KWeaverClient):
    """Create a datasource and list its tables."""
    ds = create_datasource(name="e2e_ds_tables_test")
    tables = kweaver_client.datasources.list_tables(ds.id)
    assert len(tables) > 0
    # Every table should have a name and at least one column
    for t in tables:
        assert t.name
        assert len(t.columns) > 0
