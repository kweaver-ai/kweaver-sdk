"""CLI: context-loader commands — MCP JSON-RPC 2.0 client.

Equivalent to TypeScript kweaverc context-loader command group.
"""

from __future__ import annotations

import json
import sys

import click

from kweaver.cli._helpers import pp
from kweaver.config.store import PlatformStore


MCP_NOT_CONFIGURED = (
    "Context-loader MCP is not configured. "
    "Run: kweaver context-loader config set --kn-id <kn-id>"
)


def _get_store() -> PlatformStore:
    return PlatformStore()


def _make_context_loader():
    """Build ContextLoaderResource from current store config."""
    from kweaver.resources.context_loader import ContextLoaderResource

    store = _get_store()
    result = store.get_current_context_loader_kn()
    if not result:
        click.echo(MCP_NOT_CONFIGURED, err=True)
        sys.exit(1)
    mcp_url_base, kn_id = result
    # mcp_url is the full MCP endpoint; base_url is the platform URL
    # We need the base URL to get the access token
    url = store.get_active()
    if not url:
        click.echo("No active platform. Run 'kweaver auth login' first.", err=True)
        sys.exit(1)

    token_data = store.load_token(url)
    access_token = token_data.get("accessToken", "")
    if not access_token:
        click.echo("No access token. Run 'kweaver auth login' first.", err=True)
        sys.exit(1)

    return ContextLoaderResource(url, access_token, kn_id)


@click.group("context-loader")
def context_loader_group() -> None:
    """Call context-loader MCP (kn-search, query instances, etc.)."""


# ── config subgroup ──────────────────────────────────────────────────────────

@context_loader_group.group("config")
def config_group() -> None:
    """Manage context-loader configuration."""


@config_group.command("set")
@click.option("--kn-id", required=True, help="Knowledge network ID.")
@click.option("--name", default=None, help="Config name (default: kn-id).")
def config_set(kn_id: str, name: str | None) -> None:
    """Add or update a context-loader KN config."""
    store = _get_store()
    url = store.get_active()
    if not url:
        click.echo("No active platform. Run 'kweaver auth login' first.", err=True)
        sys.exit(1)
    entry_name = name or kn_id
    store.add_context_loader_entry(url, entry_name, kn_id)
    click.echo(f"Context-loader config set: name={entry_name} kn_id={kn_id}")


@config_group.command("use")
@click.argument("name")
def config_use(name: str) -> None:
    """Switch the active context-loader config."""
    store = _get_store()
    url = store.get_active()
    if not url:
        click.echo("No active platform.", err=True)
        sys.exit(1)
    try:
        store.set_current_context_loader(url, name)
        click.echo(f"Current context-loader config: {name}")
    except RuntimeError as exc:
        click.echo(str(exc), err=True)
        sys.exit(1)


@config_group.command("list")
def config_list() -> None:
    """List all context-loader configs."""
    store = _get_store()
    url = store.get_active()
    if not url:
        click.echo("No active platform.", err=True)
        return
    config = store.load_context_loader_config(url)
    if not config:
        click.echo("No context-loader configs found.")
        return
    current = config.get("current", "")
    for entry in config.get("configs", []):
        marker = "*" if entry.get("name") == current else " "
        click.echo(f" {marker} {entry.get('name')}  kn_id={entry.get('knId')}")


@config_group.command("show")
def config_show() -> None:
    """Show current context-loader config (knId + mcpUrl)."""
    store = _get_store()
    url = store.get_active()
    if not url:
        click.echo("No active platform.", err=True)
        return
    result = store.get_current_context_loader_kn(url)
    if not result:
        click.echo("No context-loader config set.")
        return
    mcp_url, kn_id = result
    click.echo(f"kn_id:   {kn_id}")
    click.echo(f"mcp_url: {mcp_url}")


@config_group.command("remove")
@click.argument("name")
def config_remove(name: str) -> None:
    """Remove a context-loader config entry."""
    store = _get_store()
    url = store.get_active()
    if not url:
        click.echo("No active platform.", err=True)
        sys.exit(1)
    store.remove_context_loader_entry(url, name)
    click.echo(f"Removed context-loader config: {name}")


# ── MCP introspection ─────────────────────────────────────────────────────────

@context_loader_group.command("tools")
def list_tools() -> None:
    """tools/list — list available MCP tools."""
    cl = _make_context_loader()
    result = cl.list_tools()
    pp(result)


@context_loader_group.command("resources")
def list_resources() -> None:
    """resources/list — list available MCP resources."""
    cl = _make_context_loader()
    result = cl.list_resources()
    pp(result)


@context_loader_group.command("resource")
@click.argument("uri")
def read_resource(uri: str) -> None:
    """resources/read — read resource by URI."""
    cl = _make_context_loader()
    result = cl.read_resource(uri)
    pp(result)


@context_loader_group.command("templates")
def list_templates() -> None:
    """resources/templates/list — list resource templates."""
    cl = _make_context_loader()
    result = cl.list_resource_templates()
    pp(result)


@context_loader_group.command("prompts")
def list_prompts() -> None:
    """prompts/list — list available prompts."""
    cl = _make_context_loader()
    result = cl.list_prompts()
    pp(result)


@context_loader_group.command("prompt")
@click.argument("name")
@click.option("--args", "args_json", default=None, help="Prompt arguments as JSON.")
def get_prompt(name: str, args_json: str | None) -> None:
    """prompts/get — get prompt by name."""
    cl = _make_context_loader()
    args = json.loads(args_json) if args_json else None
    result = cl.get_prompt(name, args)
    pp(result)


# ── Layer 1 ──────────────────────────────────────────────────────────────────

@context_loader_group.command("kn-search")
@click.argument("query")
@click.option("--only-schema", is_flag=True, default=False, help="Return schema only.")
def kn_search(query: str, only_schema: bool) -> None:
    """Layer 1: Search schema (object_types, relation_types, action_types)."""
    cl = _make_context_loader()
    result = cl.kn_search(query, only_schema=only_schema)
    pp(result)


@context_loader_group.command("kn-schema-search")
@click.argument("query")
@click.option("--max", "max_concepts", default=10, type=int, help="Max concepts to return.")
def kn_schema_search(query: str, max_concepts: int) -> None:
    """Layer 1: Discover candidate concepts."""
    cl = _make_context_loader()
    result = cl.kn_schema_search(query, max_concepts=max_concepts)
    pp(result)


# ── Layer 2 ──────────────────────────────────────────────────────────────────

@context_loader_group.command("query-object-instance")
@click.argument("args_json")
def query_object_instance(args_json: str) -> None:
    """Layer 2: Query instances (args as JSON with ot_id, condition, limit)."""
    args = json.loads(args_json)
    cl = _make_context_loader()
    result = cl.query_object_instance(
        args["ot_id"],
        args["condition"],
        limit=args.get("limit", 20),
    )
    pp(result)


@context_loader_group.command("query-instance-subgraph")
@click.argument("args_json")
def query_instance_subgraph(args_json: str) -> None:
    """Layer 2: Query subgraph (args as JSON with relation_type_paths)."""
    args = json.loads(args_json)
    cl = _make_context_loader()
    result = cl.query_instance_subgraph(args["relation_type_paths"])
    pp(result)


# ── Layer 3 ──────────────────────────────────────────────────────────────────

@context_loader_group.command("get-logic-properties")
@click.argument("args_json")
def get_logic_properties(args_json: str) -> None:
    """Layer 3: Get logic property values (args as JSON)."""
    args = json.loads(args_json)
    cl = _make_context_loader()
    result = cl.get_logic_properties_values(
        args["ot_id"],
        args["query"],
        args["_instance_identities"],
        args["properties"],
        args.get("additional_context"),
    )
    pp(result)


@context_loader_group.command("get-action-info")
@click.argument("args_json")
def get_action_info(args_json: str) -> None:
    """Layer 3: Get action info (args as JSON with at_id, _instance_identity)."""
    args = json.loads(args_json)
    cl = _make_context_loader()
    result = cl.get_action_info(args["at_id"], args["_instance_identity"])
    pp(result)
