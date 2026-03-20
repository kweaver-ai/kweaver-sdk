"""Shared helpers for CLI commands."""

from __future__ import annotations

import json
import os
import sys
from functools import wraps
from typing import Any

import click

from kweaver._auth import ConfigAuth, PasswordAuth, TokenAuth
from kweaver._client import KWeaverClient
from kweaver._errors import KWeaverError, AuthenticationError, AuthorizationError, NotFoundError, DryRunIntercepted


def make_client(*, debug: bool = False, dry_run: bool = False) -> KWeaverClient:
    """Build an KWeaverClient from env vars or ~/.kweaver/ config.

    Priority:
      1. KWEAVER_USERNAME + KWEAVER_PASSWORD + KWEAVER_BASE_URL  → PasswordAuth (browser OAuth2, auto-refresh)
      2. KWEAVER_TOKEN + KWEAVER_BASE_URL  → TokenAuth (static, no auto-refresh)
      3. ~/.kweaver/ config  → ConfigAuth
    PasswordAuth is preferred over TokenAuth because it auto-refreshes expired tokens.
    """
    base_url = os.environ.get("KWEAVER_BASE_URL")
    bd = os.environ.get("KWEAVER_BUSINESS_DOMAIN") or "bd_public"

    username = os.environ.get("KWEAVER_USERNAME")
    password = os.environ.get("KWEAVER_PASSWORD")
    if username and password and base_url:
        auth = PasswordAuth(base_url=base_url, username=username, password=password)
        return KWeaverClient(base_url=base_url, auth=auth, business_domain=bd, debug=debug, dry_run=dry_run)

    token = os.environ.get("KWEAVER_TOKEN")
    if token and base_url:
        return KWeaverClient(base_url=base_url, auth=TokenAuth(token), business_domain=bd, debug=debug, dry_run=dry_run)

    # Default: ConfigAuth reads ~/.kweaver/
    auth = ConfigAuth()
    return KWeaverClient(auth=auth, business_domain=bd, debug=debug, dry_run=dry_run)


def pp(data: Any) -> None:
    """Pretty-print JSON data."""
    click.echo(json.dumps(data, indent=2, ensure_ascii=False, default=str))


def error_exit(msg: str, code: int = 1) -> None:
    click.echo(f"Error: {msg}", err=True)
    sys.exit(code)


def handle_errors(fn):
    """Decorator: catch SDK errors and exit with a user-friendly message."""
    @wraps(fn)
    def wrapper(*args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except DryRunIntercepted as e:
            click.echo(str(e), err=True)
        except AuthenticationError as e:
            error_exit(f"认证失败: {e.message}")
        except AuthorizationError as e:
            error_exit(f"无权限: {e.message}")
        except NotFoundError as e:
            error_exit(f"未找到: {e.message}")
        except KWeaverError as e:
            error_exit(f"错误: {e.message}")
    return wrapper


def resolve_kn_id(kn_id: str | None) -> str:
    """Resolve kn_id from argument or context. Raises click.UsageError if neither available."""
    if kn_id:
        return kn_id
    from kweaver.cli.use import _read_context
    ctx = _read_context()
    if ctx.get("kn_id"):
        return ctx["kn_id"]
    raise click.UsageError(
        "kn_id required. Provide as argument or set context with: kweaver use <kn_id>"
    )


def output(data: Any, *, format: str = "md") -> None:
    """Output data in the requested format."""
    if format == "json":
        click.echo(json.dumps(data, indent=2, ensure_ascii=False, default=str))
    elif format == "yaml":
        try:
            import yaml
        except ImportError:
            raise click.UsageError("YAML output requires: pip install kweaver[yaml]")
        click.echo(yaml.dump(data, allow_unicode=True, default_flow_style=False))
    else:  # md
        click.echo(_to_markdown(data))


def _to_markdown(data: Any) -> str:
    """Convert data to markdown table or key-value display."""
    if isinstance(data, list) and data and isinstance(data[0], dict):
        keys = list(data[0].keys())
        lines = []
        lines.append("| " + " | ".join(keys) + " |")
        lines.append("| " + " | ".join("---" for _ in keys) + " |")
        for row in data:
            lines.append("| " + " | ".join(str(row.get(k, "")) for k in keys) + " |")
        return "\n".join(lines)
    elif isinstance(data, dict):
        lines = []
        for k, v in data.items():
            lines.append(f"**{k}:** {v}")
        return "\n".join(lines)
    else:
        return json.dumps(data, indent=2, ensure_ascii=False, default=str)
