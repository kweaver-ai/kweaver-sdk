"""Unit tests for CLI commands using Click's CliRunner."""

from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import pytest
from click.testing import CliRunner

from kweaver.cli.main import cli


@pytest.fixture
def runner():
    return CliRunner()


def _mock_client():
    return MagicMock()


# ---------------------------------------------------------------------------
# Top-level
# ---------------------------------------------------------------------------


def test_cli_help(runner):
    result = runner.invoke(cli, ["--help"])
    assert result.exit_code == 0
    for cmd in ("auth", "kn", "query", "action", "agent", "call"):
        assert cmd in result.output


def test_cli_version(runner):
    result = runner.invoke(cli, ["--version"])
    assert result.exit_code == 0
    assert "0.5.0" in result.output


# ---------------------------------------------------------------------------
# Auth subcommands
# ---------------------------------------------------------------------------


def test_auth_status_no_platform(runner):
    with patch("kweaver.cli.auth.PlatformStore") as MockStore:
        MockStore.return_value.get_active.return_value = None
        result = runner.invoke(cli, ["auth", "status"])
        assert result.exit_code == 0
        assert "No active platform" in result.output


def test_auth_status_with_platform(runner):
    with patch("kweaver.cli.auth.PlatformStore") as MockStore:
        store = MockStore.return_value
        store.get_active.return_value = "https://example.com"
        store.load_token.return_value = {
            "expiresAt": "2099-01-01T00:00:00Z",
            "scope": "openid offline all",
        }
        result = runner.invoke(cli, ["auth", "status"])
        assert result.exit_code == 0
        assert "https://example.com" in result.output


def test_auth_list_empty(runner):
    with patch("kweaver.cli.auth.PlatformStore") as MockStore:
        store = MockStore.return_value
        store.get_active.return_value = None
        store.list_platforms.return_value = []
        result = runner.invoke(cli, ["auth", "list"])
        assert result.exit_code == 0
        assert "No platforms" in result.output


def test_auth_use(runner):
    with patch("kweaver.cli.auth.PlatformStore") as MockStore:
        store = MockStore.return_value
        store.use.return_value = "https://resolved.com"
        result = runner.invoke(cli, ["auth", "use", "prod"])
        assert result.exit_code == 0
        assert "https://resolved.com" in result.output


# ---------------------------------------------------------------------------
# KN subcommands
# ---------------------------------------------------------------------------


def test_kn_list(runner):
    with patch("kweaver.cli.kn.make_client") as mock_make:
        client = _mock_client()
        mock_kn = MagicMock()
        mock_kn.model_dump.return_value = {"id": "kn1", "name": "test"}
        client.knowledge_networks.list.return_value = [mock_kn]
        mock_make.return_value = client

        result = runner.invoke(cli, ["kn", "list"])
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert data[0]["id"] == "kn1"


def test_kn_get(runner):
    with patch("kweaver.cli.kn.make_client") as mock_make:
        client = _mock_client()
        mock_kn = MagicMock()
        mock_kn.model_dump.return_value = {"id": "kn1", "name": "test"}
        client.knowledge_networks.get.return_value = mock_kn
        mock_make.return_value = client

        result = runner.invoke(cli, ["kn", "get", "kn1"])
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert data["id"] == "kn1"


def test_kn_export(runner):
    with patch("kweaver.cli.kn.make_client") as mock_make:
        client = _mock_client()
        client.knowledge_networks.export.return_value = {"object_types": []}
        mock_make.return_value = client

        result = runner.invoke(cli, ["kn", "export", "kn1"])
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert "object_types" in data


def test_kn_build_wait(runner):
    with patch("kweaver.cli.kn.make_client") as mock_make:
        client = _mock_client()
        mock_job = MagicMock()
        mock_status = MagicMock()
        mock_status.state = "completed"
        mock_status.state_detail = None
        mock_job.wait.return_value = mock_status
        client.knowledge_networks.build.return_value = mock_job
        mock_make.return_value = client

        result = runner.invoke(cli, ["kn", "build", "kn1"])
        assert result.exit_code == 0
        assert "completed" in result.output


def test_kn_build_no_wait(runner):
    with patch("kweaver.cli.kn.make_client") as mock_make:
        client = _mock_client()
        client.knowledge_networks.build.return_value = MagicMock()
        mock_make.return_value = client

        result = runner.invoke(cli, ["kn", "build", "--no-wait", "kn1"])
        assert result.exit_code == 0
        assert "not waiting" in result.output


# ---------------------------------------------------------------------------
# Query subcommands
# ---------------------------------------------------------------------------


def test_query_search(runner):
    with patch("kweaver.cli.query.make_client") as mock_make:
        client = _mock_client()
        mock_result = MagicMock()
        mock_result.model_dump.return_value = {"concepts": [], "hits_total": 0}
        client.query.semantic_search.return_value = mock_result
        mock_make.return_value = client

        result = runner.invoke(cli, ["query", "search", "kn1", "test query"])
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert "concepts" in data


def test_query_instances(runner):
    with patch("kweaver.cli.query.make_client") as mock_make:
        client = _mock_client()
        mock_result = MagicMock()
        mock_result.model_dump.return_value = {"data": [], "total_count": 0}
        client.query.instances.return_value = mock_result
        mock_make.return_value = client

        result = runner.invoke(cli, ["query", "instances", "kn1", "ot1"])
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert "data" in data


def test_query_instances_with_condition(runner):
    with patch("kweaver.cli.query.make_client") as mock_make:
        client = _mock_client()
        mock_result = MagicMock()
        mock_result.model_dump.return_value = {"data": [], "total_count": 5}
        client.query.instances.return_value = mock_result
        mock_make.return_value = client

        cond = '{"field":"status","operation":"eq","value":"active"}'
        result = runner.invoke(cli, ["query", "instances", "kn1", "ot1", "--condition", cond])
        assert result.exit_code == 0


def test_query_kn_search(runner):
    with patch("kweaver.cli.query.make_client") as mock_make:
        client = _mock_client()
        mock_result = MagicMock()
        mock_result.model_dump.return_value = {"object_types": [], "relation_types": []}
        client.query.kn_search.return_value = mock_result
        mock_make.return_value = client

        result = runner.invoke(cli, ["query", "kn-search", "kn1", "products"])
        assert result.exit_code == 0


# ---------------------------------------------------------------------------
# Action subcommands
# ---------------------------------------------------------------------------


def test_action_query(runner):
    with patch("kweaver.cli.action.make_client") as mock_make:
        client = _mock_client()
        client.action_types.query.return_value = {"id": "at1", "name": "sync"}
        mock_make.return_value = client

        result = runner.invoke(cli, ["action", "query", "kn1", "at1"])
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert data["id"] == "at1"


def test_action_execute_wait(runner):
    with patch("kweaver.cli.action.make_client") as mock_make:
        client = _mock_client()
        mock_exec = MagicMock()
        mock_exec.execution_id = "exec1"
        mock_exec_done = MagicMock()
        mock_exec_done.status = "completed"
        mock_exec_done.result = {"rows": 42}
        mock_exec.wait.return_value = mock_exec_done
        client.action_types.execute.return_value = mock_exec
        mock_make.return_value = client

        result = runner.invoke(cli, ["action", "execute", "kn1", "at1"])
        assert result.exit_code == 0
        assert "completed" in result.output


def test_action_execute_no_wait(runner):
    with patch("kweaver.cli.action.make_client") as mock_make:
        client = _mock_client()
        mock_exec = MagicMock()
        mock_exec.execution_id = "exec1"
        mock_exec.status = "pending"
        client.action_types.execute.return_value = mock_exec
        mock_make.return_value = client

        result = runner.invoke(cli, ["action", "execute", "--no-wait", "kn1", "at1"])
        assert result.exit_code == 0
        assert "pending" in result.output


def test_action_logs(runner):
    with patch("kweaver.cli.action.make_client") as mock_make:
        client = _mock_client()
        client.action_types.list_logs.return_value = [{"id": "log1"}]
        mock_make.return_value = client

        result = runner.invoke(cli, ["action", "logs", "kn1"])
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert data[0]["id"] == "log1"


def test_action_log_detail(runner):
    with patch("kweaver.cli.action.make_client") as mock_make:
        client = _mock_client()
        client.action_types.get_log.return_value = {"id": "log1", "status": "completed"}
        mock_make.return_value = client

        result = runner.invoke(cli, ["action", "log", "kn1", "log1"])
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert data["status"] == "completed"


# ---------------------------------------------------------------------------
# Agent subcommands
# ---------------------------------------------------------------------------


def test_agent_list(runner):
    with patch("kweaver.cli.agent.make_client") as mock_make:
        client = _mock_client()
        mock_agent = MagicMock()
        mock_agent.name = "assistant"
        mock_agent.description = "test"
        mock_agent.model_dump.return_value = {"id": "a1", "name": "assistant"}
        client.agents.list.return_value = [mock_agent]
        mock_make.return_value = client

        result = runner.invoke(cli, ["agent", "list"])
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert data[0]["name"] == "assistant"


def test_agent_list_keyword(runner):
    with patch("kweaver.cli.agent.make_client") as mock_make:
        client = _mock_client()
        mock_a1 = MagicMock()
        mock_a1.name = "supply-chain"
        mock_a1.description = "Supply chain assistant"
        mock_a1.model_dump.return_value = {"id": "a1", "name": "supply-chain"}
        mock_a2 = MagicMock()
        mock_a2.name = "hr-bot"
        mock_a2.description = "HR helper"
        mock_a2.model_dump.return_value = {"id": "a2", "name": "hr-bot"}
        client.agents.list.return_value = [mock_a1, mock_a2]
        mock_make.return_value = client

        result = runner.invoke(cli, ["agent", "list", "--keyword", "supply"])
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert len(data) == 1
        assert data[0]["name"] == "supply-chain"


# ---------------------------------------------------------------------------
# Call command
# ---------------------------------------------------------------------------


def test_call_get(runner):
    with patch("kweaver.cli.call.make_client") as mock_make:
        client = _mock_client()
        client._http.request.return_value = {"entries": []}
        mock_make.return_value = client

        result = runner.invoke(cli, ["call", "/api/test"])
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert "entries" in data


def test_call_post_with_body(runner):
    with patch("kweaver.cli.call.make_client") as mock_make:
        client = _mock_client()
        client._http.request.return_value = {"ok": True}
        mock_make.return_value = client

        result = runner.invoke(cli, ["call", "/api/test", "-X", "POST", "-d", '{"key":"val"}'])
        assert result.exit_code == 0
        client._http.request.assert_called_once_with("POST", "/api/test", json={"key": "val"})


def test_call_empty_response(runner):
    with patch("kweaver.cli.call.make_client") as mock_make:
        client = _mock_client()
        client._http.request.return_value = None
        mock_make.return_value = client

        result = runner.invoke(cli, ["call", "/api/test", "-X", "DELETE"])
        assert result.exit_code == 0
        assert "empty response" in result.output
