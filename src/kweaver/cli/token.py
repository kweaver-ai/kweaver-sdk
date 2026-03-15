"""CLI: token — print the current access token."""

from __future__ import annotations

import sys

import click

from kweaver.config.store import PlatformStore


@click.command("token")
def token_cmd() -> None:
    """Print the current access token (from ~/.kweaver/)."""
    store = PlatformStore()
    url = store.get_active()
    if not url:
        click.echo("No active platform. Run 'kweaver auth login <url>' first.", err=True)
        sys.exit(1)

    token_data = store.load_token(url)
    access_token = token_data.get("accessToken") if token_data else None
    if not access_token:
        click.echo("No token stored for active platform. Run 'kweaver auth login' first.", err=True)
        sys.exit(1)

    click.echo(access_token)
