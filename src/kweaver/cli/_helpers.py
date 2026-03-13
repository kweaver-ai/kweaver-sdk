"""Shared helpers for CLI commands."""

from __future__ import annotations

import json
import os
import sys
from typing import Any

import click

from kweaver._auth import ConfigAuth, TokenAuth
from kweaver._client import ADPClient


def make_client() -> ADPClient:
    """Build an ADPClient from env vars or ~/.kweaver/ config."""
    token = os.environ.get("ADP_TOKEN")
    base_url = os.environ.get("ADP_BASE_URL")
    bd = os.environ.get("ADP_BUSINESS_DOMAIN")

    if token and base_url:
        return ADPClient(base_url=base_url, auth=TokenAuth(token), business_domain=bd)

    # Default: ConfigAuth reads ~/.kweaver/
    auth = ConfigAuth()
    return ADPClient(auth=auth, business_domain=bd)


def pp(data: Any) -> None:
    """Pretty-print JSON data."""
    click.echo(json.dumps(data, indent=2, ensure_ascii=False, default=str))


def error_exit(msg: str, code: int = 1) -> None:
    click.echo(f"Error: {msg}", err=True)
    sys.exit(code)
