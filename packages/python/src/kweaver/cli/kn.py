"""CLI: knowledge network commands."""

from __future__ import annotations

import json
import time
from typing import Any

import click

from kweaver.cli._helpers import error_exit, handle_errors, make_client, pp

# PK/display key heuristics (moved from BuildKnSkill)
_PK_CANDIDATES = {"id", "pk", "key"}
_PK_TYPES = {"integer", "unsigned integer", "string", "varchar", "bigint", "int"}
_DISPLAY_HINTS = {"name", "title", "label", "display_name", "description"}


def _detect_primary_key(table: Any) -> str:
    for col in table.columns:
        if col.name.lower() in _PK_CANDIDATES and col.type.lower() in _PK_TYPES:
            return col.name
    for col in table.columns:
        if col.type.lower() in _PK_TYPES:
            return col.name
    return table.columns[0].name if table.columns else "id"


def _detect_display_key(table: Any, primary_key: str) -> str:
    for col in table.columns:
        if any(hint in col.name.lower() for hint in _DISPLAY_HINTS):
            return col.name
    return primary_key


@click.group("bkn")
def kn_group() -> None:
    """Manage business knowledge networks."""


@kn_group.command("list")
@click.option("--name", default=None, help="Filter by name.")
@click.option("--name-pattern", default=None, help="Filter by name pattern (substring).")
@click.option("--tag", default=None, help="Filter by tag.")
@click.option("--sort", default="update_time", help="Sort field (default: update_time).")
@click.option("--direction", default="desc", type=click.Choice(["asc", "desc"]), help="Sort direction (default: desc).")
@click.option("--offset", default=0, type=int, help="Pagination offset (default: 0).")
@click.option("--limit", default=50, type=int, help="Max items to return (default: 50).")
@click.option("--verbose", "-v", is_flag=True, help="Show full JSON response.")
@handle_errors
def list_kns(
    name: str | None,
    name_pattern: str | None,
    tag: str | None,
    sort: str,
    direction: str,
    offset: int,
    limit: int,
    verbose: bool,
) -> None:
    """List knowledge networks."""
    client = make_client()
    kns = client.knowledge_networks.list(
        name=name,
        name_pattern=name_pattern,
        tag=tag,
        offset=offset,
        limit=limit,
        sort=sort,
        direction=direction,
    )
    if verbose:
        pp([kn.model_dump() for kn in kns])
    else:
        simplified = [
            {"name": kn.name, "id": kn.id, "description": kn.comment or ""}
            for kn in kns
        ]
        pp(simplified)


@kn_group.command("stats")
@click.argument("kn_id")
@handle_errors
def stats_kn(kn_id: str) -> None:
    """Show statistics for a knowledge network."""
    client = make_client()
    kn = client.knowledge_networks.get(kn_id, include_statistics=True)
    if kn.statistics:
        pp(kn.statistics.model_dump())
    else:
        pp({})


@kn_group.command("update")
@click.argument("kn_id")
@click.option("--name", default=None, help="New name.")
@click.option("--description", default=None, help="New description.")
@click.option("--tag", multiple=True, help="Tags (repeatable, replaces all tags).")
@handle_errors
def update_kn(kn_id: str, name: str | None, description: str | None, tag: tuple[str, ...]) -> None:
    """Update knowledge network metadata."""
    kwargs: dict[str, Any] = {}
    if name is not None:
        kwargs["name"] = name
    if description is not None:
        kwargs["description"] = description
    if tag:
        kwargs["tags"] = list(tag)
    if not kwargs:
        error_exit("No update fields provided. Use --name, --description, or --tag.")
    client = make_client()
    kn = client.knowledge_networks.update(kn_id, **kwargs)
    pp(kn.model_dump())


@kn_group.command("get")
@click.argument("kn_id")
@click.option("--stats", is_flag=True, help="Include statistics.")
@click.option("--export", "export_mode", is_flag=True, help="Export mode (full schema).")
@handle_errors
def get_kn(kn_id: str, stats: bool, export_mode: bool) -> None:
    """Get knowledge network details."""
    client = make_client()
    if export_mode:
        data = client.knowledge_networks.export(kn_id)
        pp(data)
    else:
        kn = client.knowledge_networks.get(kn_id, include_statistics=stats)
        if stats and kn.statistics:
            pp(kn.statistics.model_dump())
        else:
            pp(kn.model_dump())


@kn_group.command("export")
@click.argument("kn_id")
@handle_errors
def export_kn(kn_id: str) -> None:
    """Export full knowledge network definition."""
    client = make_client()
    data = client.knowledge_networks.export(kn_id)
    pp(data)


@kn_group.command("build")
@click.argument("kn_id")
@click.option("--wait/--no-wait", default=True, help="Wait for build to complete.")
@click.option("--timeout", default=300, type=int, help="Wait timeout in seconds.")
@handle_errors
def build_kn(kn_id: str, wait: bool, timeout: int) -> None:
    """Trigger a full build for a knowledge network."""
    client = make_client()
    job = client.knowledge_networks.build(kn_id)
    click.echo(f"Build started for {kn_id}")
    if wait:
        click.echo("Waiting for build to complete ...")
        status = job.wait(timeout=timeout)
        click.echo(f"Build {status.state}")
        if status.state_detail:
            click.echo(f"Detail: {status.state_detail}")
    else:
        click.echo("Build triggered (not waiting).")


@kn_group.command("delete")
@click.argument("kn_id")
@click.confirmation_option(prompt="Are you sure you want to delete this KN?")
@handle_errors
def delete_kn(kn_id: str) -> None:
    """Delete a knowledge network."""
    client = make_client()
    client.knowledge_networks.delete(kn_id)
    click.echo(f"Deleted {kn_id}")


@kn_group.command("create")
@click.argument("datasource_id")
@click.option("--name", required=True, help="Knowledge network name.")
@click.option("--tables", default=None, help="Comma-separated table names (default: all).")
@click.option("--build/--no-build", default=True, help="Build after creation.")
@click.option("--timeout", default=300, type=int, help="Build timeout in seconds.")
@handle_errors
def create_kn(
    datasource_id: str, name: str, tables: str | None, build: bool, timeout: int,
) -> None:
    """Create a knowledge network from a datasource."""
    client = make_client()
    all_tables = client.datasources.list_tables(datasource_id)
    table_map = {t.name: t for t in all_tables}
    if tables:
        target_names = [n.strip() for n in tables.split(",")]
        target_tables = [table_map[n] for n in target_names if n in table_map]
    else:
        target_tables = all_tables
    if not target_tables:
        error_exit("没有可用的表")
    view_map: dict[str, str] = {}
    for t in target_tables:
        dv = client.dataviews.create(
            name=t.name, datasource_id=datasource_id, table=t.name,
            columns=t.columns,
        )
        view_map[t.name] = dv.id
    kn = client.knowledge_networks.create(name=name)
    ot_results: list[dict[str, Any]] = []
    for t in target_tables:
        pk = _detect_primary_key(t)
        dk = _detect_display_key(t, pk)
        ot = client.object_types.create(
            kn.id,
            name=t.name,
            dataview_id=view_map[t.name],
            primary_keys=[pk],
            display_key=dk,
        )
        ot_results.append({
            "name": ot.name, "id": ot.id, "field_count": len(t.columns),
        })
    status_str = "skipped"
    if build:
        click.echo("Building ...", err=True)
        job = client.knowledge_networks.build(kn.id)
        status = job.wait(timeout=timeout)
        status_str = status.state
    pp({
        "kn_id": kn.id, "kn_name": kn.name,
        "object_types": ot_results, "status": status_str,
    })


# ── object-type, relation-type, action-type (schema list) ──────────────────────

@kn_group.group("object-type")
def object_type_group() -> None:
    """Object type (schema) commands."""


@object_type_group.command("list")
@click.argument("kn_id")
@handle_errors
def object_type_list(kn_id: str) -> None:
    """List object types for a knowledge network."""
    client = make_client()
    ots = client.object_types.list(kn_id)
    pp([ot.model_dump() for ot in ots])


@object_type_group.command("get")
@click.argument("kn_id")
@click.argument("ot_id")
@handle_errors
def object_type_get(kn_id: str, ot_id: str) -> None:
    """Get object type details."""
    client = make_client()
    ot = client.object_types.get(kn_id, ot_id)
    pp(ot.model_dump())


@object_type_group.command("create")
@click.argument("kn_id")
@click.option("--name", required=True, help="Object type name.")
@click.option("--dataview-id", required=True, help="Dataview ID.")
@click.option("--primary-key", required=True, help="Primary key column name.")
@click.option("--display-key", required=True, help="Display key column name.")
@click.option("--property", "properties", multiple=True, help="Property JSON (repeatable).")
@handle_errors
def object_type_create(
    kn_id: str,
    name: str,
    dataview_id: str,
    primary_key: str,
    display_key: str,
    properties: tuple[str, ...],
) -> None:
    """Create an object type."""
    from kweaver.types import Property

    parsed_props: list[Property] | None = None
    if properties:
        parsed_props = [Property(**json.loads(p)) for p in properties]
    client = make_client()
    ot = client.object_types.create(
        kn_id,
        name=name,
        dataview_id=dataview_id,
        primary_key=primary_key,
        display_key=display_key,
        properties=parsed_props,
    )
    pp(ot.model_dump())


@object_type_group.command("update")
@click.argument("kn_id")
@click.argument("ot_id")
@click.option("--name", default=None, help="New name.")
@click.option("--display-key", default=None, help="New display key.")
@handle_errors
def object_type_update(kn_id: str, ot_id: str, name: str | None, display_key: str | None) -> None:
    """Update an object type."""
    kwargs: dict[str, Any] = {}
    if name is not None:
        kwargs["name"] = name
    if display_key is not None:
        kwargs["display_key"] = display_key
    if not kwargs:
        error_exit("No update fields provided. Use --name or --display-key.")
    client = make_client()
    ot = client.object_types.update(kn_id, ot_id, **kwargs)
    pp(ot.model_dump())


@object_type_group.command("delete")
@click.argument("kn_id")
@click.argument("ot_ids")
@click.option("--yes", "-y", is_flag=True, default=False, help="Skip confirmation.")
@handle_errors
def object_type_delete(kn_id: str, ot_ids: str, yes: bool) -> None:
    """Delete object type(s)."""
    if not yes:
        click.confirm(f"Delete object type(s) {ot_ids}?", abort=True)
    client = make_client()
    client.object_types.delete(kn_id, ot_ids)
    click.echo(f"Deleted {ot_ids}")


@object_type_group.command("properties")
@click.argument("kn_id")
@click.argument("ot_id")
@click.argument("body_json", default=None, required=False)
@handle_errors
def object_type_properties(kn_id: str, ot_id: str, body_json: str | None) -> None:
    """Query instance property values.

    Requires a JSON body with _instance_identities and properties list.
    Example: '{"_instance_identities": [{"id": "123"}], "properties": ["name"]}'
    """
    body = json.loads(body_json) if body_json else None
    client = make_client()
    data = client.query.object_type_properties(kn_id, ot_id, body=body)
    pp(data)


@kn_group.group("relation-type")
def relation_type_group() -> None:
    """Relation type (schema) commands."""


@relation_type_group.command("list")
@click.argument("kn_id")
@handle_errors
def relation_type_list(kn_id: str) -> None:
    """List relation types for a knowledge network."""
    client = make_client()
    rts = client.relation_types.list(kn_id)
    pp([rt.model_dump() for rt in rts])


@relation_type_group.command("get")
@click.argument("kn_id")
@click.argument("rt_id")
@handle_errors
def relation_type_get(kn_id: str, rt_id: str) -> None:
    """Get relation type details."""
    client = make_client()
    rt = client.relation_types.get(kn_id, rt_id)
    pp(rt.model_dump())


@relation_type_group.command("create")
@click.argument("kn_id")
@click.option("--name", required=True, help="Relation type name.")
@click.option("--source", required=True, help="Source object type ID.")
@click.option("--target", required=True, help="Target object type ID.")
@click.option("--mapping", multiple=True, help="Property mapping source_prop:target_prop (repeatable).")
@handle_errors
def relation_type_create(
    kn_id: str, name: str, source: str, target: str, mapping: tuple[str, ...],
) -> None:
    """Create a relation type."""
    mappings: list[tuple[str, str]] | None = None
    if mapping:
        mappings = []
        for m in mapping:
            if ":" not in m:
                error_exit(f"Invalid mapping format '{m}'. Expected source_prop:target_prop.")
            src, tgt = m.split(":", 1)
            mappings.append((src, tgt))
    client = make_client()
    rt = client.relation_types.create(
        kn_id, name=name, source_ot_id=source, target_ot_id=target, mappings=mappings,
    )
    pp(rt.model_dump())


@relation_type_group.command("update")
@click.argument("kn_id")
@click.argument("rt_id")
@click.option("--name", default=None, help="New name.")
@handle_errors
def relation_type_update(kn_id: str, rt_id: str, name: str | None) -> None:
    """Update a relation type."""
    kwargs: dict[str, Any] = {}
    if name is not None:
        kwargs["name"] = name
    if not kwargs:
        error_exit("No update fields provided. Use --name.")
    client = make_client()
    rt = client.relation_types.update(kn_id, rt_id, **kwargs)
    pp(rt.model_dump())


@relation_type_group.command("delete")
@click.argument("kn_id")
@click.argument("rt_ids")
@click.option("--yes", "-y", is_flag=True, default=False, help="Skip confirmation.")
@handle_errors
def relation_type_delete(kn_id: str, rt_ids: str, yes: bool) -> None:
    """Delete relation type(s)."""
    if not yes:
        click.confirm(f"Delete relation type(s) {rt_ids}?", abort=True)
    client = make_client()
    client.relation_types.delete(kn_id, rt_ids)
    click.echo(f"Deleted {rt_ids}")


@kn_group.group("action-type")
def action_type_group() -> None:
    """Action type (schema) commands."""


@action_type_group.command("list")
@click.argument("kn_id")
@handle_errors
def action_type_list(kn_id: str) -> None:
    """List action types for a knowledge network."""
    client = make_client()
    ats = client.action_types.list(kn_id)
    pp(ats)


# ── action-log subgroup ───────────────────────────────────────────────────────

@kn_group.group("action-log")
def action_log_group() -> None:
    """Manage action execution logs."""


@action_log_group.command("list")
@click.argument("kn_id")
@click.option("--offset", default=0, type=int, help="Pagination offset.")
@click.option("--limit", default=20, type=int, help="Max items to return.")
@click.option("--sort", default="create_time", help="Sort field.")
@click.option("--direction", default="desc", type=click.Choice(["asc", "desc"]), help="Sort direction.")
@handle_errors
def action_log_list(kn_id: str, offset: int, limit: int, sort: str, direction: str) -> None:
    """List action execution logs for a knowledge network."""
    client = make_client()
    logs = client.action_types.list_logs(kn_id, offset=offset, limit=limit, sort=sort, direction=direction)
    pp(logs)


@action_log_group.command("get")
@click.argument("kn_id")
@click.argument("log_id")
@handle_errors
def action_log_get(kn_id: str, log_id: str) -> None:
    """Get a single action execution log."""
    client = make_client()
    log = client.action_types.get_log(kn_id, log_id)
    pp(log)


@action_log_group.command("cancel")
@click.argument("kn_id")
@click.argument("log_id")
@click.option("--yes", "-y", is_flag=True, default=False, help="Skip confirmation.")
@handle_errors
def action_log_cancel(kn_id: str, log_id: str, yes: bool) -> None:
    """Cancel a running action execution log."""
    if not yes:
        click.confirm(f"Cancel action log {log_id}?", abort=True)
    client = make_client()
    client.action_types.cancel(kn_id, log_id)
    click.echo(f"Cancelled action log: {log_id}")


# ── action-execution subgroup ─────────────────────────────────────────────────

@kn_group.group("action-execution")
def action_execution_group() -> None:
    """Query action execution status."""


@action_execution_group.command("get")
@click.argument("kn_id")
@click.argument("execution_id")
@click.option("--wait/--no-wait", default=False, help="Poll until terminal status.")
@click.option("--timeout", default=300, type=int, help="Wait timeout in seconds.")
@handle_errors
def action_execution_get(kn_id: str, execution_id: str, wait: bool, timeout: int) -> None:
    """Get status of an action execution."""
    client = make_client()

    if not wait:
        data = client.action_types.get_execution(kn_id, execution_id)
        pp(data)
        return

    _TERMINAL = {"success", "failed", "cancelled", "completed"}
    deadline = time.time() + timeout
    while True:
        data = client.action_types.get_execution(kn_id, execution_id)
        status = (data.get("status") or "").lower()
        if status in _TERMINAL:
            pp(data)
            return
        if time.time() >= deadline:
            error_exit(f"Execution did not complete within {timeout}s")
        time.sleep(2)
