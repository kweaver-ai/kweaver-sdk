"""CLI: dataview commands."""
from __future__ import annotations

import click

from kweaver.cli._helpers import handle_errors, make_client, pp


@click.group("dv")
def dv_group() -> None:
    """Manage data views."""


@dv_group.command("list")
@click.option("--datasource-id", default=None, help="Filter by datasource ID.")
@click.option("--name", default=None, help="Filter by name (keyword search).")
@click.option("--type", "dv_type", default=None, help="Filter by type (atomic/custom).")
@handle_errors
def list_dv(datasource_id: str | None, name: str | None, dv_type: str | None) -> None:
    """List data views."""
    client = make_client()
    views = client.dataviews.list(datasource_id=datasource_id, name=name, type=dv_type)
    pp([dv.model_dump() for dv in views])


@dv_group.command("get")
@click.argument("dataview_id")
@handle_errors
def get_dv(dataview_id: str) -> None:
    """Get data view details."""
    client = make_client()
    dv = client.dataviews.get(dataview_id)
    pp(dv.model_dump())


@dv_group.command("find")
@click.argument("datasource_id")
@click.argument("table_name")
@click.option("--wait/--no-wait", default=True, help="Wait for async view creation.")
@click.option("--timeout", default=30, type=float, help="Timeout in seconds (default: 30).")
@handle_errors
def find_dv(datasource_id: str, table_name: str, wait: bool, timeout: float) -> None:
    """Find the atomic view for a table in a datasource."""
    client = make_client()
    dv = client.dataviews.find_by_table(datasource_id, table_name, wait=wait, timeout=timeout)
    if dv is None:
        click.echo(f"No atomic view found for table '{table_name}'", err=True)
        raise SystemExit(1)
    pp(dv.model_dump())


@dv_group.command("delete")
@click.argument("dataview_id")
@click.confirmation_option(prompt="Are you sure you want to delete this data view?")
@handle_errors
def delete_dv(dataview_id: str) -> None:
    """Delete a data view."""
    client = make_client()
    client.dataviews.delete(dataview_id)
    click.echo(f"Deleted {dataview_id}")
