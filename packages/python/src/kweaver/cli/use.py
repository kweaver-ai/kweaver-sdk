"""kweaver use — KN context management."""
from __future__ import annotations

import json
from pathlib import Path

import click


def _context_path() -> Path:
    return Path.home() / ".kweaver" / "context.json"


def _read_context() -> dict:
    path = _context_path()
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return {}


def _write_context(data: dict) -> None:
    path = _context_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2), encoding="utf-8", newline="\n")


@click.command("use")
@click.argument("kn_id", required=False)
@click.option("--clear", is_flag=True, help="Clear current context.")
def use_cmd(kn_id: str | None, clear: bool) -> None:
    """Set or show the current Knowledge Network context."""
    if clear:
        path = _context_path()
        if path.exists():
            path.unlink()
        click.echo("Context cleared.")
        return

    if kn_id:
        _write_context({"kn_id": kn_id})
        click.echo(f"Context set: kn_id = {kn_id}")
        return

    # Show current
    ctx = _read_context()
    if ctx.get("kn_id"):
        click.echo(f"Current context: kn_id = {ctx['kn_id']}")
    else:
        click.echo("No context set. Use: kweaver use <kn_id>")
