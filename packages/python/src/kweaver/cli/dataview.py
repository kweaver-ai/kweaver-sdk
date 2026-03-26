"""CLI: data view commands (mdl-data-model + mdl-uniquery query)."""

from __future__ import annotations

import click

from kweaver.cli._helpers import handle_errors, make_client, pp


@click.group("dataview")
def dataview_group() -> None:
    """Manage and query data views."""


@dataview_group.command("query")
@click.argument("view_id")
@click.option("--sql", "-s", default=None, help="SQL to run; omit to use the view's default SQL.")
@click.option("--limit", default=50, type=int, help="Max rows (default 50).")
@click.option("--offset", default=0, type=int, help="Row offset for pagination.")
@click.option("--need-total", is_flag=True, default=False, help="Request total row count.")
@handle_errors
def dataview_query(
    view_id: str,
    sql: str | None,
    limit: int,
    offset: int,
    need_total: bool,
) -> None:
    """Query rows from a data view via mdl-uniquery (SQL)."""
    client = make_client()
    result = client.dataviews.query(
        view_id,
        sql=sql,
        offset=offset,
        limit=limit,
        need_total=need_total,
    )
    pp(result)
