"""CLI: agent commands — list, chat."""

from __future__ import annotations

import click

from kweaver.cli._helpers import handle_errors, make_client, pp


@click.group("agent")
def agent_group() -> None:
    """Manage Decision Agents."""


@agent_group.command("list")
@click.option("--keyword", default=None, help="Filter by keyword.")
@click.option("--offset", default=0, type=int, help="Pagination offset (default: 0).")
@click.option("--limit", default=50, type=int, help="Max items to return (default: 50).")
@click.option("--category-id", default=None, help="Filter by category ID.")
@click.option("--status", default=None, help="Filter by status (e.g. published, draft).")
@click.option("--verbose", "-v", is_flag=True, help="Show full JSON response.")
@handle_errors
def list_agents(
    keyword: str | None,
    offset: int,
    limit: int,
    category_id: str | None,
    status: str | None,
    verbose: bool,
) -> None:
    """List published agents."""
    client = make_client()
    agents = client.agents.list(keyword=keyword, status=status, offset=offset, limit=limit)
    if category_id:
        agents = [a for a in agents if category_id in getattr(a, "category_ids", [])]
    if verbose:
        pp([a.model_dump() for a in agents])
    else:
        simplified = [
            {"name": a.name, "id": a.id, "description": a.description or ""}
            for a in agents
        ]
        pp(simplified)


@agent_group.command("get")
@click.argument("agent_id")
@click.option("--verbose", "-v", is_flag=True, help="Show full JSON response.")
@handle_errors
def get_agent(agent_id: str, verbose: bool) -> None:
    """Get agent details."""
    client = make_client()
    agent = client.agents.get(agent_id)
    if verbose:
        pp(agent.model_dump())
    else:
        simplified = {
            "id": agent.id,
            "name": agent.name,
            "description": agent.description or "",
            "status": agent.status,
            "kn_ids": agent.kn_ids,
        }
        pp(simplified)


@agent_group.command("chat")
@click.argument("agent_id")
@click.option("-m", "--message", required=True, help="Message to send.")
@click.option("--conversation-id", default=None, help="Continue a conversation.")
@handle_errors
def chat(agent_id: str, message: str, conversation_id: str | None) -> None:
    """Chat with a Decision Agent."""
    client = make_client()

    msg = client.conversations.send_message(
        agent_id=agent_id,
        conversation_id=conversation_id or "",
        content=message,
    )

    click.echo(f"\n{msg.content}")

    if msg.references:
        click.echo("\nReferences:")
        for ref in msg.references:
            click.echo(f"  - [{ref.score:.2f}] {ref.source}: {ref.content[:100]}")

    if msg.conversation_id:
        click.echo("", err=True)
        click.echo(
            "To continue this conversation, rerun the command with --conversation-id:",
            err=True,
        )
        click.echo(
            f'kweaver agent chat {agent_id} -m "{{你的下一轮问题}}" --conversation-id {msg.conversation_id}',
            err=True,
        )


@agent_group.command("sessions")
@click.argument("agent_id")
@handle_errors
def sessions(agent_id: str) -> None:
    """List all conversations for an agent."""
    client = make_client()
    convs = client.conversations.list(agent_id=agent_id)
    pp([c.model_dump() for c in convs])


@agent_group.command("history")
@click.argument("conversation_id")
@click.option("--limit", default=None, type=int, help="Max messages to return.")
@handle_errors
def history(conversation_id: str, limit: int | None) -> None:
    """Show message history for a conversation."""
    client = make_client()
    messages = client.conversations.list_messages(conversation_id, limit=limit)
    pp([m.model_dump() for m in messages])
