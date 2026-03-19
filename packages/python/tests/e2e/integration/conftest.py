"""Fixtures for integration tests — full lifecycle from empty environment."""
from __future__ import annotations

from typing import Any

import pytest

from kweaver import KWeaverClient


@pytest.fixture(scope="module")
def lifecycle_env(
    kweaver_client: KWeaverClient,
    db_config: dict[str, Any],
):
    """Build a complete knowledge network from scratch for integration testing.

    Creates: datasource -> dataview -> KN -> object type -> build -> wait.
    Yields a dict with all created resources.
    Cleans up everything at the end.
    """
    client = kweaver_client
    created: dict[str, Any] = {}

    # 1. Datasource
    ds = client.datasources.create(name="e2e_integration_ds", **db_config)
    created["ds"] = ds

    # 2. Discover tables
    tables = client.datasources.list_tables(ds.id)
    assert tables, "No tables found in test database"
    table = tables[0]
    created["table"] = table

    # 3. Dataview
    dv = client.dataviews.create(
        name=f"e2e_integ_{table.name}",
        datasource_id=ds.id,
        table=table.name,
        columns=table.columns,
    )
    created["dv"] = dv

    # 4. Knowledge network
    kn = client.knowledge_networks.create(name="e2e_integration_kn")
    created["kn"] = kn

    # 5. Object type
    pk_col = table.columns[0].name
    display_col = table.columns[1].name if len(table.columns) > 1 else pk_col
    ot = client.object_types.create(
        kn.id,
        name=f"e2e_integ_{table.name}",
        dataview_id=dv.id,
        primary_keys=[pk_col],
        display_key=display_col,
    )
    created["ot"] = ot
    created["pk_col"] = pk_col

    # 6. Build and wait
    try:
        job = client.knowledge_networks.build(kn.id)
        status = job.wait(timeout=300)
        created["build_status"] = status.state
    except Exception as exc:
        created["build_status"] = f"error: {exc}"

    yield created

    # Cleanup (reverse order)
    for resource, delete_fn in [
        ("kn", lambda: client.knowledge_networks.delete(created["kn"].id)),
        ("ds", lambda: client.datasources.delete(created["ds"].id)),
    ]:
        try:
            delete_fn()
        except Exception:
            pass
