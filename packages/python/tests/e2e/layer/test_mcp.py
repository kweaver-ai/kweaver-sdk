"""L5: MCP Context Loader — schema search, instance query, data consistency.

Tests the MCP JSON-RPC protocol path. Read-only.
"""
from __future__ import annotations

import pytest

from kweaver import KWeaverClient
from kweaver.types import Condition
from kweaver.cli.main import cli

pytestmark = pytest.mark.e2e


def test_mcp_kn_search_returns_schema(cl_context):
    """MCP kn_search should discover object types for the KN."""
    cl = cl_context["cl"]
    ot = cl_context["ot"]
    result = cl.kn_search(ot.name)
    assert isinstance(result, dict)
    raw = result.get("raw", "")
    assert "object_types" in raw, f"kn_search missing object_types: {raw[:200]}"


def test_mcp_kn_search_only_schema(cl_context):
    """MCP kn_search with only_schema should return schema."""
    cl = cl_context["cl"]
    ot = cl_context["ot"]
    result = cl.kn_search(ot.name, only_schema=True)
    assert isinstance(result, dict)
    raw = result.get("raw", "")
    assert raw, "kn_search only_schema returned empty"


def test_mcp_query_instance_eq(cl_context):
    """MCP query_object_instance with == returns matching instance."""
    cl = cl_context["cl"]
    ot = cl_context["ot"]
    sample = cl_context["sample"]
    identity = sample["_instance_identity"]
    pk_field = list(identity.keys())[0]
    pk_value = identity[pk_field]

    result = cl.query_object_instance(
        ot.id,
        condition={
            "operation": "and",
            "sub_conditions": [
                {"field": pk_field, "operation": "==", "value_from": "const", "value": pk_value},
            ],
        },
        limit=5,
    )
    raw = result.get("raw", "")
    assert "datas[#0]" not in raw, f"Expected results for {pk_field}=={pk_value}"
    assert str(pk_value) in raw


def test_mcp_query_instance_in(cl_context):
    """MCP query_object_instance with 'in' operator."""
    cl = cl_context["cl"]
    ot = cl_context["ot"]
    sample = cl_context["sample"]
    identity = sample["_instance_identity"]
    pk_field = list(identity.keys())[0]
    pk_value = identity[pk_field]

    result = cl.query_object_instance(
        ot.id,
        condition={
            "operation": "and",
            "sub_conditions": [
                {"field": pk_field, "operation": "in", "value_from": "const", "value": [pk_value]},
            ],
        },
        limit=5,
    )
    raw = result.get("raw", "")
    assert str(pk_value) in raw


def test_mcp_query_instance_match(cl_context):
    """MCP query_object_instance with 'match' (fulltext)."""
    cl = cl_context["cl"]
    ot = cl_context["ot"]
    sample = cl_context["sample"]
    display_value = sample.get("_display", "")
    if not display_value:
        pytest.skip("No _display value for match test")

    result = cl.query_object_instance(
        ot.id,
        condition={
            "operation": "and",
            "sub_conditions": [
                {"field": ot.display_key, "operation": "match", "value_from": "const", "value": display_value},
            ],
        },
        limit=5,
    )
    raw = result.get("raw", "")
    assert "datas[#0]" not in raw, f"Expected results for match '{display_value}'"


def test_mcp_rest_data_consistency(kweaver_client: KWeaverClient, cl_context):
    """Data from MCP and REST should be consistent for the same query."""
    ot = cl_context["ot"]
    kn = cl_context["kn"]
    cl = cl_context["cl"]
    sample = cl_context["sample"]

    identity = sample["_instance_identity"]
    pk_field = list(identity.keys())[0]
    pk_value = identity[pk_field]

    # REST
    rest_result = kweaver_client.query.instances(
        kn.id, ot.id,
        condition=Condition(field=pk_field, operation="==", value=pk_value),
        limit=1,
    )
    assert rest_result.data, f"REST no data for {pk_field}={pk_value}"
    rest_display = rest_result.data[0].get("_display", "")

    # MCP
    mcp_result = cl.query_object_instance(
        ot.id,
        condition={
            "operation": "and",
            "sub_conditions": [
                {"field": pk_field, "operation": "==", "value_from": "const", "value": pk_value},
            ],
        },
        limit=1,
    )
    mcp_raw = mcp_result.get("raw", "")
    assert "datas[#0]" not in mcp_raw, "MCP returned 0 results"
    if rest_display:
        assert rest_display in mcp_raw, f"REST _display='{rest_display}' not in MCP"
