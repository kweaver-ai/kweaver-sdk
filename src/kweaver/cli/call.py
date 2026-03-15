"""CLI: generic API call — similar to curl with auth injection."""

from __future__ import annotations

import json
import sys

import click

from kweaver.cli._helpers import handle_errors, make_client, pp


@click.command("call")
@click.argument("path")
@click.option("-X", "--method", default="GET", help="HTTP method.")
@click.option("-d", "--data", "body", default=None, help="JSON request body.")
@click.option(
    "-H", "--header", "headers",
    multiple=True,
    help='Extra header in "Name: Value" format (repeatable).',
)
@click.option(
    "-bd", "--biz-domain", "biz_domain",
    default=None,
    help="Business domain override (sets x-business-domain header).",
)
@click.option("--verbose", "-v", is_flag=True, default=False, help="Print request info to stderr.")
@handle_errors
def call_cmd(
    path: str,
    method: str,
    body: str | None,
    headers: tuple[str, ...],
    biz_domain: str | None,
    verbose: bool,
) -> None:
    """Make an authenticated API call (like curl).

    Example: kweaver call /api/ontology-manager/v1/knowledge-networks
    """
    client = make_client()
    json_body = json.loads(body) if body else None

    extra_headers: dict[str, str] = {}
    for h in headers:
        if ":" in h:
            name, _, value = h.partition(":")
            extra_headers[name.strip()] = value.strip()
        else:
            click.echo(f"Warning: ignoring malformed header: {h!r}", err=True)

    if biz_domain:
        extra_headers["x-business-domain"] = biz_domain

    if verbose:
        click.echo(f"> {method.upper()} {path}", err=True)
        if extra_headers:
            for k, v in extra_headers.items():
                click.echo(f"> {k}: {v}", err=True)
        if json_body is not None:
            click.echo(f"> body: {json.dumps(json_body)}", err=True)

    result = client._http.request(
        method.upper(),
        path,
        json=json_body,
        headers=extra_headers or None,
    )
    if result is not None:
        pp(result)
    else:
        click.echo("(empty response)")
