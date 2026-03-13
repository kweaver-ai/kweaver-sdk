"""CLI: generic API call — similar to curl with auth injection."""

from __future__ import annotations

import json

import click

from kweaver.cli._helpers import make_client, pp


@click.command("call")
@click.argument("path")
@click.option("-X", "--method", default="GET", help="HTTP method.")
@click.option("-d", "--data", "body", default=None, help="JSON request body.")
def call_cmd(path: str, method: str, body: str | None) -> None:
    """Make an authenticated API call (like curl).

    Example: kweaver call /api/ontology-manager/v1/knowledge-networks
    """
    client = make_client()
    json_body = json.loads(body) if body else None

    result = client._http.request(
        method.upper(),
        path,
        json=json_body,
    )
    if result is not None:
        pp(result)
    else:
        click.echo("(empty response)")
