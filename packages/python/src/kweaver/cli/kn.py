"""CLI: knowledge network commands."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

import click

from kweaver.cli._helpers import error_exit, handle_errors, make_client, pp

# Object-type PUT: strip read-only fields from GET before merge/re-PUT
_OBJECT_TYPE_PUT_STRIP_KEYS = frozenset(
    {"status", "creator", "updater", "create_time", "update_time", "module_type", "kn_id"}
)
_PREFIX_OT = "/api/ontology-manager/v1/knowledge-networks"


def _strip_object_type_for_put(entry: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in entry.items() if k not in _OBJECT_TYPE_PUT_STRIP_KEYS}


def _apply_object_type_merge(
    target: dict[str, Any],
    *,
    name: str | None,
    display_key: str | None,
    add_properties: list[dict[str, Any]],
    remove_properties: tuple[str, ...],
    tags: list[str] | None,
    comment: str | None,
    icon: str | None,
    color: str | None,
) -> None:
    if name is not None:
        target["name"] = name
    if display_key is not None:
        target["display_key"] = display_key
    if comment is not None:
        target["comment"] = comment
    if icon is not None:
        target["icon"] = icon
    if color is not None:
        target["color"] = color
    if tags is not None:
        target["tags"] = tags

    props = target.get("data_properties")
    if not isinstance(props, list):
        props = []
    else:
        props = [dict(p) if isinstance(p, dict) else p for p in props]
    plist: list[dict[str, Any]] = [p for p in props if isinstance(p, dict)]

    for rm in remove_properties:
        plist = [p for p in plist if p.get("name") != rm]

    for add in add_properties:
        nm = add.get("name")
        if not isinstance(nm, str) or not nm:
            error_exit(
                '--add-property / --update-property JSON must include a non-empty string "name" field.'
            )
        idx = next((i for i, p in enumerate(plist) if p.get("name") == nm), -1)
        if idx >= 0:
            plist[idx] = add
        else:
            plist.append(add)

    target["data_properties"] = plist


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


# ── push / pull (BKN tar import/export) ────────────────────────────────────────


def _pack_bkn_directory_to_tar_bytes(abs_dir: Path) -> bytes:
    """Pack directory to tar bytes (no ``./`` prefix), aligned with TS ``kweaver bkn push``."""
    entries = sorted(os.listdir(abs_dir))
    if not entries:
        raise ValueError("BKN directory is empty")
    env = os.environ.copy()
    if sys.platform == "darwin":
        env["COPYFILE_DISABLE"] = "1"
    proc = subprocess.run(
        ["tar", "cf", "-", "-C", str(abs_dir), *entries],
        capture_output=True,
        env=env,
        check=False,
    )
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or b"").decode(errors="replace").strip()
        raise RuntimeError(f"tar pack failed (exit {proc.returncode}): {err}")
    return proc.stdout


@kn_group.command("validate")
@click.argument("directory")
@handle_errors
def validate_bkn(directory: str) -> None:
    """Validate a local BKN directory without uploading."""
    from bkn import load_network, validate_network_data

    dir_path = Path(directory).resolve()
    if not dir_path.is_dir():
        error_exit(f"Not a directory: {directory}")

    network = load_network(str(dir_path))
    result = validate_network_data(network)
    if not result.ok:
        for e in result.errors:
            click.echo(f"  - {e}", err=True)
        error_exit(f"BKN validation failed: {len(result.errors)} error(s)")

    n_obj = len(network.all_objects)
    n_rel = len(network.all_relations)
    n_act = len(network.all_actions)
    click.echo(
        f"Valid: {n_obj} object types, {n_rel} relation types, {n_act} action types"
    )


@kn_group.command("push")
@click.argument("directory")
@click.option("--branch", default="main", help="Branch name (default: main).")
@handle_errors
def push_bkn(directory: str, branch: str) -> None:
    """Validate, generate checksum, pack, and upload a BKN directory.

    Uses **kweaver-bkn** for validation/checksum only; tar is produced via system ``tar``
    (same layout as the TypeScript CLI) so the platform can find ``network.bkn`` at top level.
    """
    from bkn import generate_checksum_file, load_network

    dir_path = Path(directory).resolve()
    if not dir_path.is_dir():
        error_exit(f"Not a directory: {directory}")

    network = load_network(str(dir_path))
    n_obj = len(network.all_objects)
    n_rel = len(network.all_relations)
    n_act = len(network.all_actions)
    click.echo(
        f"Validated: {n_obj} object types, {n_rel} relation types, {n_act} action types",
        err=True,
    )

    generate_checksum_file(str(dir_path))
    click.echo("Checksum generated", err=True)

    tar_data = _pack_bkn_directory_to_tar_bytes(dir_path)

    client = make_client()
    status, body = client._http.post_multipart(
        "api/bkn-backend/v1/bkns",
        files={"file": ("bkn.tar", tar_data, "application/octet-stream")},
        params={"branch": branch},
        timeout=60.0,
    )
    if status >= 400:
        error_exit(f"HTTP {status}: {body.decode(errors='replace')}")
    pp(json.loads(body.decode()))


@kn_group.command("pull")
@click.argument("kn_id")
@click.argument("directory", default="")
@click.option("--branch", default="main", help="Branch name (default: main).")
@handle_errors
def pull_bkn(kn_id: str, directory: str, branch: str) -> None:
    """Download a BKN tar and extract to a local directory."""
    import tarfile, io

    out_dir = Path(directory or kn_id).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    client = make_client()
    status, body = client._http.get_bytes(
        f"api/bkn-backend/v1/bkns/{kn_id}",
        params={"branch": branch},
        timeout=60.0,
    )
    if status >= 400:
        error_exit(f"HTTP {status}: {body.decode(errors='replace')}")

    with tarfile.open(fileobj=io.BytesIO(body), mode="r:*") as tf:
        if sys.version_info >= (3, 12):
            tf.extractall(path=str(out_dir), filter="data")
        else:
            tf.extractall(path=str(out_dir))
    click.echo(f"Extracted to {out_dir}")


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
@click.argument("body_positional", required=False, default=None)
@click.option("--name", default=None, help="New name.")
@click.option("--display-key", default=None, help="New display key.")
@click.option(
    "--add-property",
    "add_properties_raw",
    multiple=True,
    help="Add a data property as JSON (repeatable). Same name replaces existing (update).",
)
@click.option(
    "--update-property",
    "update_properties_raw",
    multiple=True,
    help="Alias for --add-property: replace property by name (GET-merge-PUT).",
)
@click.option(
    "--remove-property",
    "remove_properties",
    multiple=True,
    help="Remove data property by name (repeatable).",
)
@click.option("--tags", default=None, help='JSON array of strings, e.g. \'["足球","球员"]\'')
@click.option("--comment", default=None, help="Replace object type comment.")
@click.option("--icon", default=None, help="Replace icon id.")
@click.option("--color", default=None, help="Replace color (e.g. #0e5fc5).")
@click.option("--branch", default="main", show_default=True, help="Branch for GET/PUT.")
@click.option(
    "--body",
    "body_opt",
    default=None,
    help="Full JSON body for PUT (alternative to optional third positional arg).",
)
@handle_errors
def object_type_update(
    kn_id: str,
    ot_id: str,
    body_positional: str | None,
    name: str | None,
    display_key: str | None,
    add_properties_raw: tuple[str, ...],
    update_properties_raw: tuple[str, ...],
    remove_properties: tuple[str, ...],
    tags: str | None,
    comment: str | None,
    icon: str | None,
    color: str | None,
    branch: str,
    body_opt: str | None,
) -> None:
    """Update an object type (merge flags fetch current schema then PUT, or pass full JSON)."""
    if body_opt is not None and body_positional is not None:
        error_exit("Use either --body or the optional third argument for full JSON, not both.")

    raw_body = body_opt if body_opt is not None else body_positional

    add_properties: list[dict[str, Any]] = []
    for raw in add_properties_raw + update_properties_raw:
        try:
            obj = json.loads(raw)
        except json.JSONDecodeError as e:
            error_exit(f"Invalid --add-property / --update-property JSON: {e}")
        if not isinstance(obj, dict):
            error_exit("--add-property / --update-property must be a JSON object.")
        add_properties.append(obj)

    tags_list: list[str] | None = None
    if tags is not None:
        try:
            t = json.loads(tags)
        except json.JSONDecodeError as e:
            error_exit(f"Invalid --tags JSON: {e}")
        if not isinstance(t, list) or not all(isinstance(x, str) for x in t):
            error_exit('--tags must be a JSON array of strings, e.g. \'["a","b"]\'')
        tags_list = t

    has_merge = (
        name is not None
        or display_key is not None
        or len(add_properties) > 0
        or len(remove_properties) > 0
        or tags is not None
        or comment is not None
        or icon is not None
        or color is not None
    )

    if raw_body is not None:
        s = raw_body.strip()
        if not s.startswith("{"):
            error_exit("Full JSON body must be a JSON object starting with '{'.")

        if has_merge:
            error_exit(
                "Do not combine --body / third-arg JSON with --name, --add-property, --update-property, "
                "--remove-property, and other merge flags."
            )

        client = make_client()
        data = json.loads(s)
        ot = client.object_types.update(kn_id, ot_id, **data)
        pp(ot.model_dump())
        return

    if not has_merge:
        error_exit(
            "No update fields. Use --name, --display-key, --add-property (add), --update-property (same as add), "
            "--remove-property (delete), --tags, --comment, --icon, --color, or full JSON as third arg or --body."
        )

    client = make_client()
    path = f"{_PREFIX_OT}/{kn_id}/object-types/{ot_id}"
    raw_get = client._http.get(path, params={"branch": branch})
    if isinstance(raw_get, dict) and "entries" in raw_get:
        entries = raw_get.get("entries")
        entry = entries[0] if isinstance(entries, list) and entries else raw_get
    else:
        entry = raw_get
    if not isinstance(entry, dict):
        error_exit("Unexpected object-type GET response.")

    stripped = _strip_object_type_for_put(entry)
    _apply_object_type_merge(
        stripped,
        name=name,
        display_key=display_key,
        add_properties=add_properties,
        remove_properties=remove_properties,
        tags=tags_list,
        comment=comment,
        icon=icon,
        color=color,
    )
    ot = client.object_types.update(kn_id, ot_id, **stripped)
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
