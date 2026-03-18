"""KWeaver CLI entry point."""

from __future__ import annotations

import click

from kweaver.cli.auth import auth_group
from kweaver.cli.ds import ds_group
from kweaver.cli.kn import kn_group
from kweaver.cli.query import query_group
from kweaver.cli.action import action_group
from kweaver.cli.agent import agent_group
from kweaver.cli.call import call_cmd
from kweaver.cli.context_loader import context_loader_group
from kweaver.cli.token_cmd import token_cmd


@click.group()
@click.version_option(package_name="kweaver-sdk")
def cli() -> None:
    """KWeaver CLI — manage KWeaver knowledge networks, agents, and more."""


cli.add_command(auth_group, "auth")
cli.add_command(ds_group, "ds")
cli.add_command(kn_group, "bkn")
cli.add_command(query_group, "query")
cli.add_command(action_group, "action")
cli.add_command(agent_group, "agent")
cli.add_command(call_cmd, "call")
cli.add_command(context_loader_group, "context-loader")
cli.add_command(token_cmd, "token")


def main() -> None:
    cli()


if __name__ == "__main__":
    main()
