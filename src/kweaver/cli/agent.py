"""CLI: agent commands — list, chat."""

from __future__ import annotations

import click

from kweaver.cli._helpers import handle_errors, make_client, pp


@click.group("agent")
def agent_group() -> None:
    """Manage Decision Agents."""


@agent_group.command("list")
@click.option("--keyword", default=None, help="Filter by keyword.")
def list_agents(keyword: str | None) -> None:
    """List published agents."""
    client = make_client()
    agents = client.agents.list()
    if keyword:
        keyword_lower = keyword.lower()
        agents = [a for a in agents if keyword_lower in (a.name or "").lower()
                  or keyword_lower in (a.description or "").lower()]
    pp([a.model_dump() for a in agents])


@agent_group.command("chat")
@click.argument("agent_id")
@click.option("-m", "--message", required=True, help="Message to send.")
@click.option("--conversation-id", default=None, help="Continue a conversation.")
def chat(agent_id: str, message: str, conversation_id: str | None) -> None:
    """Chat with a Decision Agent."""
    client = make_client()

    if not conversation_id:
        conv = client.conversations.create(agent_id)
        conversation_id = conv.id
        click.echo(f"Conversation: {conversation_id}")

    msg = client.conversations.send_message(
        agent_id=agent_id,
        conversation_id=conversation_id,
        content=message,
    )
    click.echo(f"\n{msg.content}")

    if msg.references:
        click.echo("\nReferences:")
        for ref in msg.references:
            click.echo(f"  - [{ref.score:.2f}] {ref.source}: {ref.content[:100]}")


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
