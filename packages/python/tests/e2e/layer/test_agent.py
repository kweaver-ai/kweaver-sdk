"""L6: Agent listing, detail, and conversation.

Tests against the real agent-factory and agent-app services.
"""

from __future__ import annotations

import json

import pytest

from kweaver import KWeaverClient
from kweaver.cli.main import cli

pytestmark = pytest.mark.e2e


def test_list_agents(kweaver_client: KWeaverClient):
    """List agents should return without error."""
    agents = kweaver_client.agents.list()
    assert isinstance(agents, list)


def test_list_agents_published(kweaver_client: KWeaverClient):
    """Published filter should only return published agents."""
    agents = kweaver_client.agents.list(status="published")
    assert isinstance(agents, list)
    for a in agents:
        assert a.status == "published"


@pytest.fixture(scope="module")
def any_agent(kweaver_client: KWeaverClient):
    """Find any agent for tests (published or not)."""
    agents = kweaver_client.agents.list()
    assert agents, "No agents found — cannot proceed"
    return agents[0]


def test_get_agent(kweaver_client: KWeaverClient, any_agent):
    """Get agent detail should return full config."""
    agent = kweaver_client.agents.get(any_agent.id)
    assert agent.id == any_agent.id
    assert agent.name == any_agent.name


def test_agent_has_fields(kweaver_client: KWeaverClient, any_agent):
    """Agent detail should contain key fields from agent-factory."""
    agent = kweaver_client.agents.get(any_agent.id)
    assert agent.id
    assert agent.name
    assert agent.status in ("published", "draft")
    # version and system_prompt come from detail endpoint
    assert agent.version is not None or agent.system_prompt is not None


@pytest.mark.destructive
def test_conversation_flow(kweaver_client: KWeaverClient):
    """Create conversation, send message, verify response.

    Tries all published agents until one responds successfully.
    Fails if no published agent can produce a valid response.
    """
    agents = kweaver_client.agents.list(status="published")
    assert agents, "No published agents found"

    errors: list[tuple[str, Exception]] = []
    for agent in agents:
        conv = kweaver_client.conversations.create(agent.id)
        assert conv.agent_id == agent.id

        try:
            reply = kweaver_client.conversations.send_message(
                conv.id,
                content="你好",
                agent_id=agent.id,
                agent_version=agent.version or "latest",
            )
            assert reply.content
            assert reply.role == "assistant"
            return  # success — at least one agent works
        except Exception as e:
            errors.append((agent.name, e))
            continue  # try next agent

    error_details = "; ".join(f"[{name}] {e}" for name, e in errors)
    pytest.fail(
        f"All {len(agents)} published agents failed: {error_details}"
    )


def test_cli_agent_get(kweaver_client: KWeaverClient, any_agent, cli_runner):
    """CLI agent get should return agent details."""
    result = cli_runner.invoke(cli, ["agent", "get", any_agent.id])
    assert result.exit_code == 0, f"agent get failed: {result.output}"
    data = json.loads(result.output)
    assert data["id"] == any_agent.id
    assert data["name"] == any_agent.name


def test_cli_agent_get_verbose(kweaver_client: KWeaverClient, any_agent, cli_runner):
    """CLI agent get --verbose should return full details."""
    result = cli_runner.invoke(cli, ["agent", "get", any_agent.id, "--verbose"])
    assert result.exit_code == 0, f"agent get --verbose failed: {result.output}"
    data = json.loads(result.output)
    assert data["id"] == any_agent.id
    # verbose output should have more fields
    assert "status" in data
