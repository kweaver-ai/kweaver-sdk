"""CLI: query commands — search, instances."""

from __future__ import annotations

import json

import click

from kweaver.cli._helpers import error_exit, make_client, pp
from kweaver.types import Condition


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


@query_group.command("kn-search")
@click.argument("kn_id")
@click.argument("query")
@click.option("--only-schema", is_flag=True, default=False)
def kn_search(kn_id: str, query: str, only_schema: bool) -> None:
    """Search KN schema (object types, relation types, action types)."""
    client = make_client()
    result = client.query.kn_search(kn_id, query, only_schema=only_schema)
    pp(result.model_dump())
