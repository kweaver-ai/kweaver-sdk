"""CLI: knowledge network commands."""

from __future__ import annotations

import click

from kweaver.cli._helpers import error_exit, make_client, pp


@click.group("kn")
def kn_group() -> None:
    """Manage knowledge networks."""


@kn_group.command("list")
@click.option("--name", default=None, help="Filter by name.")
def list_kns(name: str | None) -> None:
    """List knowledge networks."""
    client = make_client()
    kns = client.knowledge_networks.list(name=name)
    pp([kn.model_dump() for kn in kns])


@kn_group.command("get")
@click.argument("kn_id")
def get_kn(kn_id: str) -> None:
    """Get knowledge network details."""
    client = make_client()
    kn = client.knowledge_networks.get(kn_id)
    pp(kn.model_dump())


@kn_group.command("export")
@click.argument("kn_id")
def export_kn(kn_id: str) -> None:
    """Export full knowledge network definition."""
    client = make_client()
    data = client.knowledge_networks.export(kn_id)
    pp(data)


@kn_group.command("build")
@click.argument("kn_id")
@click.option("--wait/--no-wait", default=True, help="Wait for build to complete.")
@click.option("--timeout", default=300, type=int, help="Wait timeout in seconds.")
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
def delete_kn(kn_id: str) -> None:
    """Delete a knowledge network."""
    client = make_client()
    client.knowledge_networks.delete(kn_id)
    click.echo(f"Deleted {kn_id}")
