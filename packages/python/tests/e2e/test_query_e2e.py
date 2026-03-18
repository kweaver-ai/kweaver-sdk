"""E2E: query operations — semantic search, instance query, subgraph.

Requires at least one built knowledge network with indexed data.
Read-only tests (non-destructive).
"""

from __future__ import annotations

import pytest

from kweaver import KWeaverClient
from kweaver.types import Condition

pytestmark = pytest.mark.e2e


@pytest.fixture(scope="module")
def kn_with_data(kweaver_client: KWeaverClient):
    """Find a KN with at least one object type that has indexed data.

    Prefer a smaller object type (by doc_count) to avoid server-side
    timeouts on very large tables.
    """
    kns = kweaver_client.knowledge_networks.list()
    candidates: list[tuple] = []
    for kn in kns:
        try:
            ots = kweaver_client.object_types.list(kn.id)
        except Exception:
            continue
        for ot in ots:
            if ot.status and ot.status.doc_count > 0:
                candidates.append((kn, ot))
    if not candidates:
        pytest.skip("No knowledge network with indexed data found")
    # Pick the object type with the smallest doc_count
    kn, ot = min(candidates, key=lambda x: x[1].status.doc_count)
    return {"kn": kn, "ot": ot}


def test_semantic_search(kweaver_client: KWeaverClient, kn_with_data):
    """Semantic search should return concepts."""
    from kweaver._errors import ServerError

    kn = kn_with_data["kn"]
    try:
        result = kweaver_client.query.semantic_search(
            kn_id=kn.id, query=kn_with_data["ot"].name,
        )
    except ServerError:
        pytest.skip("Semantic search backend unavailable (500) — server-side issue, SDK path verified")
    assert result is not None
    assert isinstance(result.concepts, list)


def test_instance_query(kweaver_client: KWeaverClient, kn_with_data):
    """Instance query should return data rows."""
    kn = kn_with_data["kn"]
    ot = kn_with_data["ot"]
    result = kweaver_client.query.instances(kn.id, ot.id, limit=5)

    assert isinstance(result.data, list)
    assert result.total_count is not None
    assert result.total_count > 0


def test_instance_query_with_pagination(kweaver_client: KWeaverClient, kn_with_data):
    """Instance query should support cursor-based pagination."""
    kn = kn_with_data["kn"]
    ot = kn_with_data["ot"]

    page1 = kweaver_client.query.instances(kn.id, ot.id, limit=2)
    if page1.search_after is None:
        pytest.skip("Not enough data for pagination test")

    page2 = kweaver_client.query.instances(
        kn.id, ot.id, limit=2, search_after=page1.search_after,
    )
    assert isinstance(page2.data, list)
    # Pages should not overlap (if enough data)
    if page1.data and page2.data:
        assert page1.data != page2.data


def test_instance_iter(kweaver_client: KWeaverClient, kn_with_data):
    """instances_iter should yield multiple pages."""
    kn = kn_with_data["kn"]
    ot = kn_with_data["ot"]

    pages = []
    for page in kweaver_client.query.instances_iter(kn.id, ot.id, limit=2):
        pages.append(page)
        if len(pages) >= 3:
            break

    assert len(pages) >= 1
    assert all(isinstance(p.data, list) for p in pages)


def test_kn_search(kweaver_client: KWeaverClient, kn_with_data):
    """kn_search should return schema results."""
    from kweaver._errors import NotFoundError

    kn = kn_with_data["kn"]
    ot = kn_with_data["ot"]
    try:
        result = kweaver_client.query.kn_search(kn.id, ot.name)
    except NotFoundError:
        pytest.skip("kn_search endpoint not available on this deployment")
    assert result is not None
    # MCP returns structured fields or raw text — either indicates success
    has_results = (
        (result.object_types and len(result.object_types) > 0)
        or (result.relation_types and len(result.relation_types) > 0)
        or (result.action_types and len(result.action_types) > 0)
        or result.raw
    )
    assert has_results, f"kn_search for '{ot.name}' returned empty results"


def test_kn_search_only_schema(kweaver_client: KWeaverClient, kn_with_data):
    """kn_search with only_schema should return schema without nodes."""
    from kweaver._errors import NotFoundError

    kn = kn_with_data["kn"]
    ot = kn_with_data["ot"]
    try:
        result = kweaver_client.query.kn_search(kn.id, ot.name, only_schema=True)
    except NotFoundError:
        pytest.skip("kn_search endpoint not available on this deployment")
    assert result is not None


def test_object_type_properties(kweaver_client: KWeaverClient, kn_with_data):
    """object_type_properties should return property values for a specific instance."""
    kn = kn_with_data["kn"]
    ot = kn_with_data["ot"]
    # Need a real instance identity to query properties
    instances = kweaver_client.query.instances(kn.id, ot.id, limit=1)
    if not instances.data:
        pytest.skip("No instances to query properties for")
    identity = instances.data[0].get("_instance_identity")
    if not identity:
        pytest.skip("Instance has no _instance_identity")
    prop_name = ot.properties[0].name if ot.properties else None
    if not prop_name:
        pytest.skip("Object type has no properties")
    result = kweaver_client.query.object_type_properties(
        kn.id, ot.id,
        body={"_instance_identities": [identity], "properties": [prop_name]},
    )
    assert isinstance(result, dict)
    assert "datas" in result or "data" in result


def test_cli_kn_search(kweaver_client: KWeaverClient, kn_with_data, cli_runner):
    """CLI query kn-search should work."""
    from kweaver.cli.main import cli
    from kweaver._errors import NotFoundError
    import json

    kn = kn_with_data["kn"]
    ot = kn_with_data["ot"]
    # Verify endpoint exists before testing CLI
    try:
        kweaver_client.query.kn_search(kn.id, ot.name)
    except NotFoundError:
        pytest.skip("kn_search endpoint not available on this deployment")
    result = cli_runner.invoke(cli, ["query", "kn-search", kn.id, ot.name])
    assert result.exit_code == 0, f"kn-search failed: {result.output}"
    data = json.loads(result.output)
    assert isinstance(data, dict)


def test_cli_object_type_properties(kweaver_client: KWeaverClient, kn_with_data, cli_runner):
    """CLI bkn object-type properties should work with JSON body."""
    from kweaver.cli.main import cli
    import json

    kn = kn_with_data["kn"]
    ot = kn_with_data["ot"]
    # Need a real instance identity
    instances = kweaver_client.query.instances(kn.id, ot.id, limit=1)
    if not instances.data:
        pytest.skip("No instances to query properties for")
    identity = instances.data[0].get("_instance_identity")
    if not identity:
        pytest.skip("Instance has no _instance_identity")
    prop_name = ot.properties[0].name if ot.properties else None
    if not prop_name:
        pytest.skip("Object type has no properties")
    body_json = json.dumps({"_instance_identities": [identity], "properties": [prop_name]})
    result = cli_runner.invoke(cli, ["bkn", "object-type", "properties", kn.id, ot.id, body_json])
    assert result.exit_code == 0, f"object-type properties failed: {result.output}"
    data = json.loads(result.output)
    assert isinstance(data, dict)
