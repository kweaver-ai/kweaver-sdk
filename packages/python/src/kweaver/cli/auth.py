"""CLI: auth commands — login, logout, status, list, use."""

from __future__ import annotations

import click

from kweaver._auth import OAuth2BrowserAuth
from kweaver.config.store import PlatformStore


@click.group("auth")
def auth_group() -> None:
    """Manage authentication."""


@auth_group.command("login")
@click.argument("url")
@click.option("--alias", default=None, help="Short alias for this platform.")
@click.option("--port", default=9010, help="Local callback port.")
@click.option(
    "--insecure",
    "-k",
    is_flag=True,
    default=False,
    help="Skip TLS certificate verification (self-signed / dev HTTPS only).",
)
def login(url: str, alias: str | None, port: int, insecure: bool) -> None:
    """Login to a KWeaver platform via browser OAuth2 flow."""
    url = url.rstrip("/")
    click.echo(f"Logging in to {url} ...")

    auth = OAuth2BrowserAuth(url, redirect_port=port, tls_insecure=insecure)
    auth.login()

    if alias:
        store = PlatformStore()
        store.set_alias(alias, url)
        click.echo(f"Alias '{alias}' saved.")

    click.echo("Login successful.")


@auth_group.command("logout")
@click.argument("platform", default="")
def logout(platform: str) -> None:
    """Logout from a platform (default: active platform)."""
    store = PlatformStore()
    url = store.resolve(platform) if platform else store.get_active()
    if not url:
        click.echo("No active platform.", err=True)
        return

    auth = OAuth2BrowserAuth(url)
    auth.logout()
    click.echo(f"Logged out from {url}.")


@auth_group.command("status")
def status() -> None:
    """Show current authentication status."""
    store = PlatformStore()
    active = store.get_active()
    if not active:
        click.echo("No active platform. Run 'kweaver auth login <url>' first.")
        return

    click.echo(f"Active platform: {active}")
    token = store.load_token(active)
    if token:
        expires = token.get("expiresAt", "unknown")
        click.echo(f"Token expires: {expires}")
        click.echo(f"Scope: {token.get('scope', 'N/A')}")
        if token.get("tlsInsecure"):
            click.echo("TLS: certificate verification disabled (saved; dev only)")
    else:
        click.echo("No token stored.")


@auth_group.command("list")
def list_platforms() -> None:
    """List saved platforms."""
    store = PlatformStore()
    active = store.get_active()
    platforms = store.list_platforms()
    if not platforms:
        click.echo("No platforms saved.")
        return

    for p in platforms:
        marker = "*" if p.url == active else " "
        alias_str = f" ({p.alias})" if p.alias else ""
        token_str = "token" if p.has_token else "no-token"
        click.echo(f" {marker} {p.url}{alias_str}  [{token_str}]")


@auth_group.command("use")
@click.argument("platform")
def use(platform: str) -> None:
    """Switch active platform (URL or alias)."""
    store = PlatformStore()
    url = store.use(platform)
    click.echo(f"Active platform set to: {url}")


@auth_group.command("delete")
@click.argument("platform")
@click.option("--yes", "-y", is_flag=True, default=False, help="Skip confirmation.")
def delete(platform: str, yes: bool) -> None:
    """Delete a saved platform and its credentials."""
    store = PlatformStore()
    url = store.resolve(platform)
    if not yes:
        click.confirm(f"Delete platform {url}?", abort=True)
    store.delete(url)
    click.echo(f"Deleted platform: {url}")
