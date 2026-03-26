"""CLI: config — per-platform settings (business domain)."""

from __future__ import annotations

import json
import os

import click

from kweaver._auth import ConfigAuth, _env_tls_insecure
from kweaver.business_domains import fetch_business_domains
from kweaver.config.store import PlatformStore


@click.group("config")
def config_group() -> None:
    """Per-platform configuration (business domain)."""


@config_group.command("show")
def config_show() -> None:
    """Show current platform and resolved business domain."""
    store = PlatformStore()
    platform = store.get_active()
    if not platform:
        click.echo("No active platform. Run 'kweaver auth login <url>' first.", err=True)
        raise SystemExit(1)
    bd = store.resolve_business_domain(platform)
    if os.environ.get("KWEAVER_BUSINESS_DOMAIN"):
        source = "env"
    elif store.load_business_domain(platform):
        source = "config"
    else:
        source = "default"
    click.echo(f"Platform:        {platform}")
    click.echo(f"Business Domain: {bd} ({source})")


@config_group.command("set-bd")
@click.argument("value")
def config_set_bd(value: str) -> None:
    """Set the default business domain for the current platform."""
    store = PlatformStore()
    platform = store.get_active()
    if not platform:
        click.echo("No active platform. Run 'kweaver auth login <url>' first.", err=True)
        raise SystemExit(1)
    store.save_business_domain(platform, value)
    click.echo(f"Business domain set to: {value}")


@config_group.command("list-bd")
def config_list_bd() -> None:
    """List business domains as JSON (requires login)."""
    store = PlatformStore()
    platform = store.get_active()
    if not platform:
        click.echo("No active platform. Run 'kweaver auth login <url>' first.", err=True)
        raise SystemExit(1)
    try:
        # Same refresh path as HttpClient / kweaver token — avoids 401 when access token expired.
        ConfigAuth().auth_headers()
    except RuntimeError as e:
        click.echo(str(e), err=True)
        raise SystemExit(1)
    tok = store.load_token(platform)
    at = tok.get("accessToken", "")
    if not at:
        click.echo("No access token. Run 'kweaver auth login <url>' first.", err=True)
        raise SystemExit(1)
    verify = not bool(tok.get("tlsInsecure")) and not _env_tls_insecure()
    try:
        rows = fetch_business_domains(platform, at, verify=verify)
    except Exception as e:
        click.echo(f"Failed to list business domains: {e}", err=True)
        raise SystemExit(1)
    current_id = store.resolve_business_domain(platform)
    domains: list[dict] = []
    for r in rows:
        if not isinstance(r, dict):
            continue
        rid = str(r.get("id", ""))
        entry = dict(r)
        entry["current"] = rid == current_id
        domains.append(entry)
    payload = {"currentId": current_id, "domains": domains}
    click.echo(json.dumps(payload, indent=2, ensure_ascii=False))
