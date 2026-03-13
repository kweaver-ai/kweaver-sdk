"""CLI: query commands — search, instances."""

from __future__ import annotations

import json

import click

from kweaver.cli._helpers import error_exit, handle_errors, make_client, pp
from kweaver.types import Condition, PathNode, PathEdge, SubgraphPath


@click.group("query")
def query_group() -> None:
    """Query knowledge networks."""


@query_group.command("search")
@click.argument("kn_id")
@click.argument("query")
@click.option("--max-concepts", default=10, type=int)
def search(kn_id: str, query: str, max_concepts: int) -> None:
    """Semantic search within a knowledge network."""
    client = make_client()
    result = client.query.semantic_search(kn_id, query, max_concepts=max_concepts)
    pp(result.model_dump())


@query_group.command("instances")
@click.argument("kn_id")
@click.argument("ot_id")
@click.option("--condition", "condition_json", default=None, help="JSON condition filter.")
@click.option("--limit", default=20, type=int)
def instances(kn_id: str, ot_id: str, condition_json: str | None, limit: int) -> None:
    """Query object type instances."""
    client = make_client()
    condition = None
    if condition_json:
        try:
            cond_data = json.loads(condition_json)
            condition = Condition(**cond_data)
        except Exception as e:
            error_exit(f"Invalid condition JSON: {e}")

    result = client.query.instances(kn_id, ot_id, condition=condition, limit=limit)
    pp(result.model_dump())


@query_group.command("subgraph")
@click.argument("kn_id")
@click.option("--start-type", required=True, help="Starting object type name.")
@click.option("--start-condition", required=True, help="JSON condition for start nodes.")
@click.option("--path", required=True, help="Comma-separated relation type names.")
@handle_errors
def subgraph(kn_id: str, start_type: str, start_condition: str, path: str) -> None:
    """Query a subgraph by path traversal."""
    client = make_client()
    ots = client.object_types.list(kn_id)
    ot_map = {ot.name: ot.id for ot in ots}
    start_ot_id = ot_map.get(start_type)
    if not start_ot_id:
        error_exit(f"Object type '{start_type}' not found. Available: {list(ot_map.keys())}")
    cond = Condition(**json.loads(start_condition))
    rt_names = [n.strip() for n in path.split(",")]
    rts = client.relation_types.list(kn_id)
    rt_map = {rt.name: rt for rt in rts}
    nodes = [PathNode(id=start_ot_id, condition=cond)]
    edges = []
    for rt_name in rt_names:
        rt = rt_map.get(rt_name)
        if not rt:
            error_exit(f"Relation type '{rt_name}' not found. Available: {list(rt_map.keys())}")
        edges.append(PathEdge(id=rt.id, source=rt.source_ot_id, target=rt.target_ot_id))
        if rt.target_ot_id not in {n.id for n in nodes}:
            nodes.append(PathNode(id=rt.target_ot_id))
    paths = [SubgraphPath(object_types=nodes, relation_types=edges)]
    result = client.query.subgraph(kn_id, paths)
    pp(result.model_dump())


@query_group.command("kn-search")
@click.argument("kn_id")
@click.argument("query")
@click.option("--only-schema", is_flag=True, default=False)
def kn_search(kn_id: str, query: str, only_schema: bool) -> None:
    """Search KN schema (object types, relation types, action types)."""
    client = make_client()
    result = client.query.kn_search(kn_id, query, only_schema=only_schema)
    pp(result.model_dump())
