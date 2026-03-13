"""CLI: action type commands."""

from __future__ import annotations

import json

import click

from kweaver.cli._helpers import error_exit, make_client, pp


@click.group("action")
def action_group() -> None:
    """Manage action types."""


@action_group.command("query")
@click.argument("kn_id")
@click.argument("action_type_id")
def query_action(kn_id: str, action_type_id: str) -> None:
    """Query an action type definition."""
    client = make_client()
    data = client.action_types.query(kn_id, action_type_id)
    pp(data)


@action_group.command("execute")
@click.argument("kn_id")
@click.argument("action_type_id")
@click.option("--params", "params_json", default=None, help="JSON execution parameters.")
@click.option("--wait/--no-wait", default=True)
@click.option("--timeout", default=300, type=int)
def execute_action(kn_id: str, action_type_id: str, params_json: str | None, wait: bool, timeout: int) -> None:
    """Execute an action type."""
    client = make_client()
    params = json.loads(params_json) if params_json else None

    execution = client.action_types.execute(kn_id, action_type_id, params=params)
    click.echo(f"Execution started: {execution.execution_id}")

    if wait:
        click.echo("Waiting for completion ...")
        result = execution.wait(timeout=timeout)
        click.echo(f"Status: {result.status}")
        if result.result:
            pp(result.result)
    else:
        click.echo(f"Status: {execution.status}")


@action_group.command("logs")
@click.argument("kn_id")
@click.option("--limit", default=20, type=int)
def list_logs(kn_id: str, limit: int) -> None:
    """List action execution logs."""
    client = make_client()
    logs = client.action_types.list_logs(kn_id, limit=limit)
    pp(logs)


@action_group.command("log")
@click.argument("kn_id")
@click.argument("log_id")
def get_log(kn_id: str, log_id: str) -> None:
    """Get a single execution log."""
    client = make_client()
    data = client.action_types.get_log(kn_id, log_id)
    pp(data)
