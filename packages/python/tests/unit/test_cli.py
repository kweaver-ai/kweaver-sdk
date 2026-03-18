"""Unit tests for CLI commands using Click's CliRunner."""

from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import importlib.metadata

import pytest
from click.testing import CliRunner

from kweaver.cli.main import cli

_VERSION = importlib.metadata.version("kweaver-sdk")


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
    for cmd in ("auth", "bkn", "query", "action", "agent", "call", "ds"):
        assert cmd in result.output


def test_cli_version(runner):
    result = runner.invoke(cli, ["--version"])
    assert result.exit_code == 0
    assert _VERSION in result.output


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
        mock_kn.id = "kn1"
        mock_kn.name = "test"
        mock_kn.comment = ""
        mock_kn.model_dump.return_value = {"id": "kn1", "name": "test"}
        client.knowledge_networks.list.return_value = [mock_kn]
        mock_make.return_value = client

        result = runner.invoke(cli, ["bkn", "list"])
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

        result = runner.invoke(cli, ["bkn", "get", "kn1"])
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert data["id"] == "kn1"
        client.knowledge_networks.get.assert_called_once_with("kn1", include_statistics=False)


def test_kn_get_with_stats(runner):
    with patch("kweaver.cli.kn.make_client") as mock_make:
        client = _mock_client()
        mock_kn = MagicMock()
        mock_stats = MagicMock()
        mock_stats.model_dump.return_value = {"object_types_total": 5}
        mock_kn.statistics = mock_stats
        client.knowledge_networks.get.return_value = mock_kn
        mock_make.return_value = client

        result = runner.invoke(cli, ["bkn", "get", "kn1", "--stats"])
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert data["object_types_total"] == 5
        client.knowledge_networks.get.assert_called_once_with("kn1", include_statistics=True)


def test_kn_export(runner):
    with patch("kweaver.cli.kn.make_client") as mock_make:
        client = _mock_client()
        client.knowledge_networks.export.return_value = {"object_types": []}
        mock_make.return_value = client

        result = runner.invoke(cli, ["bkn", "export", "kn1"])
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert "object_types" in data


def test_kn_get_with_export(runner):
    with patch("kweaver.cli.kn.make_client") as mock_make:
        client = _mock_client()
        client.knowledge_networks.export.return_value = {"object_types": [], "relation_types": []}
        mock_make.return_value = client

        result = runner.invoke(cli, ["bkn", "get", "kn1", "--export"])
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert "object_types" in data
        assert "relation_types" in data
        client.knowledge_networks.export.assert_called_once_with("kn1")


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

        result = runner.invoke(cli, ["bkn", "build", "kn1"])
        assert result.exit_code == 0
        assert "completed" in result.output


def test_kn_build_no_wait(runner):
    with patch("kweaver.cli.kn.make_client") as mock_make:
        client = _mock_client()
        client.knowledge_networks.build.return_value = MagicMock()
        mock_make.return_value = client

        result = runner.invoke(cli, ["bkn", "build", "--no-wait", "kn1"])
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
        mock_agent.id = "a1"
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
        mock_a1.id = "a1"
        mock_a1.name = "supply-chain"
        mock_a1.description = "Supply chain assistant"
        mock_a1.model_dump.return_value = {"id": "a1", "name": "supply-chain"}
        # keyword is passed server-side; mock returns pre-filtered result
        client.agents.list.return_value = [mock_a1]
        mock_make.return_value = client

        result = runner.invoke(cli, ["agent", "list", "--keyword", "supply"])
        assert result.exit_code == 0
        client.agents.list.assert_called_once_with(keyword="supply", status=None, offset=0, limit=50)
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
        client._http.request.assert_called_once_with("POST", "/api/test", json={"key": "val"}, headers=None)


def test_call_empty_response(runner):
    with patch("kweaver.cli.call.make_client") as mock_make:
        client = _mock_client()
        client._http.request.return_value = None
        mock_make.return_value = client

        result = runner.invoke(cli, ["call", "/api/test", "-X", "DELETE"])
        assert result.exit_code == 0
        assert "empty response" in result.output


# ---------------------------------------------------------------------------
# Error handler
# ---------------------------------------------------------------------------


def test_handle_errors_adp_error(runner):
    from kweaver.cli._helpers import handle_errors

    @cli.command("_test_error")
    @handle_errors
    def _test_error():
        from kweaver._errors import KWeaverError
        raise KWeaverError("something broke", status_code=500)

    result = runner.invoke(cli, ["_test_error"])
    assert result.exit_code != 0
    assert "something broke" in result.output or "something broke" in (result.stderr or "")


def test_handle_errors_auth_error(runner):
    from kweaver.cli._helpers import handle_errors

    @cli.command("_test_auth_error")
    @handle_errors
    def _test_auth_error():
        from kweaver._errors import AuthenticationError
        raise AuthenticationError("bad token")

    result = runner.invoke(cli, ["_test_auth_error"])
    assert result.exit_code != 0
    assert "认证失败" in result.output or "bad token" in result.output or "认证失败" in (result.stderr or "")


# ---------------------------------------------------------------------------
# DS subcommands
# ---------------------------------------------------------------------------


def test_ds_list(runner):
    with patch("kweaver.cli.ds.make_client") as mock_make:
        client = _mock_client()
        mock_ds = MagicMock()
        mock_ds.model_dump.return_value = {"id": "ds1", "name": "mydb", "type": "mysql"}
        client.datasources.list.return_value = [mock_ds]
        mock_make.return_value = client
        result = runner.invoke(cli, ["ds", "list"])
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert data[0]["id"] == "ds1"


def test_ds_list_with_filters(runner):
    with patch("kweaver.cli.ds.make_client") as mock_make:
        client = _mock_client()
        client.datasources.list.return_value = []
        mock_make.return_value = client
        result = runner.invoke(cli, ["ds", "list", "--keyword", "test", "--type", "mysql"])
        assert result.exit_code == 0
        client.datasources.list.assert_called_once_with(keyword="test", type="mysql")


def test_ds_get(runner):
    with patch("kweaver.cli.ds.make_client") as mock_make:
        client = _mock_client()
        mock_ds = MagicMock()
        mock_ds.model_dump.return_value = {"id": "ds1", "name": "mydb"}
        client.datasources.get.return_value = mock_ds
        mock_make.return_value = client
        result = runner.invoke(cli, ["ds", "get", "ds1"])
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert data["id"] == "ds1"


def test_ds_delete(runner):
    with patch("kweaver.cli.ds.make_client") as mock_make:
        client = _mock_client()
        mock_make.return_value = client
        result = runner.invoke(cli, ["ds", "delete", "ds1"], input="y\n")
        assert result.exit_code == 0
        client.datasources.delete.assert_called_once_with("ds1")


def test_ds_tables(runner):
    with patch("kweaver.cli.ds.make_client") as mock_make:
        client = _mock_client()
        mock_table = MagicMock()
        mock_col = MagicMock()
        mock_col.name = "id"
        mock_col.type = "integer"
        mock_col.comment = None
        mock_table.name = "users"
        mock_table.columns = [mock_col]
        client.datasources.list_tables.return_value = [mock_table]
        mock_make.return_value = client
        result = runner.invoke(cli, ["ds", "tables", "ds1"])
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert data[0]["name"] == "users"
        assert data[0]["columns"][0]["name"] == "id"


def test_ds_tables_with_keyword(runner):
    with patch("kweaver.cli.ds.make_client") as mock_make:
        client = _mock_client()
        client.datasources.list_tables.return_value = []
        mock_make.return_value = client
        result = runner.invoke(cli, ["ds", "tables", "ds1", "--keyword", "user"])
        assert result.exit_code == 0
        client.datasources.list_tables.assert_called_once_with("ds1", keyword="user")


def _extract_json(output: str):
    """Extract and parse the first JSON object/array from mixed output."""
    for i, ch in enumerate(output):
        if ch in ('{', '['):
            return json.loads(output[i:])
    raise ValueError("No JSON found in output")


def test_ds_connect(runner):
    with patch("kweaver.cli.ds.make_client") as mock_make:
        client = _mock_client()
        mock_ds = MagicMock()
        mock_ds.id = "ds1"
        client.datasources.test.return_value = True
        client.datasources.create.return_value = mock_ds
        mock_table = MagicMock()
        mock_col = MagicMock()
        mock_col.name = "id"
        mock_col.type = "integer"
        mock_col.comment = None
        mock_table.name = "users"
        mock_table.columns = [mock_col]
        client.datasources.list_tables.return_value = [mock_table]
        mock_make.return_value = client
        result = runner.invoke(cli, [
            "ds", "connect", "mysql", "localhost", "3306", "testdb",
            "--account", "root", "--password", "secret",
        ])
        assert result.exit_code == 0
        data = _extract_json(result.output)
        assert data["datasource_id"] == "ds1"
        assert data["tables"][0]["name"] == "users"


def test_ds_connect_with_schema_and_name(runner):
    with patch("kweaver.cli.ds.make_client") as mock_make:
        client = _mock_client()
        mock_ds = MagicMock()
        mock_ds.id = "ds2"
        client.datasources.test.return_value = True
        client.datasources.create.return_value = mock_ds
        client.datasources.list_tables.return_value = []
        mock_make.return_value = client
        result = runner.invoke(cli, [
            "ds", "connect", "postgresql", "db.host", "5432", "mydb",
            "--account", "admin", "--password", "pw",
            "--schema", "public", "--name", "my-datasource",
        ])
        assert result.exit_code == 0
        data = _extract_json(result.output)
        assert data["datasource_id"] == "ds2"


# ---------------------------------------------------------------------------
# KN create subcommand
# ---------------------------------------------------------------------------


def test_kn_create(runner):
    with patch("kweaver.cli.kn.make_client") as mock_make:
        client = _mock_client()
        mock_col_id = MagicMock(); mock_col_id.name = "id"; mock_col_id.type = "integer"
        mock_col_name = MagicMock(); mock_col_name.name = "name"; mock_col_name.type = "varchar"
        mock_table = MagicMock(); mock_table.name = "users"; mock_table.columns = [mock_col_id, mock_col_name]
        client.datasources.list_tables.return_value = [mock_table]
        mock_dv = MagicMock(); mock_dv.id = "dv1"
        client.dataviews.create.return_value = mock_dv
        mock_kn = MagicMock(); mock_kn.id = "kn1"; mock_kn.name = "test_kn"
        client.knowledge_networks.create.return_value = mock_kn
        mock_ot = MagicMock(); mock_ot.id = "ot1"; mock_ot.name = "users"
        client.object_types.create.return_value = mock_ot
        mock_job = MagicMock(); mock_status = MagicMock(); mock_status.state = "completed"
        mock_job.wait.return_value = mock_status
        client.knowledge_networks.build.return_value = mock_job
        mock_make.return_value = client
        result = runner.invoke(cli, ["bkn", "create", "ds1", "--name", "test_kn"])
        assert result.exit_code == 0
        data = _extract_json(result.output)
        assert data["kn_id"] == "kn1"
        assert data["status"] == "completed"
        assert len(data["object_types"]) == 1
        ot_call = client.object_types.create.call_args
        assert ot_call.kwargs["primary_keys"] == ["id"]
        assert ot_call.kwargs["display_key"] == "name"


def test_kn_create_no_build(runner):
    with patch("kweaver.cli.kn.make_client") as mock_make:
        client = _mock_client()
        mock_col = MagicMock(); mock_col.name = "key"; mock_col.type = "varchar"
        mock_table = MagicMock(); mock_table.name = "items"; mock_table.columns = [mock_col]
        client.datasources.list_tables.return_value = [mock_table]
        mock_dv = MagicMock(); mock_dv.id = "dv1"; client.dataviews.create.return_value = mock_dv
        mock_kn = MagicMock(); mock_kn.id = "kn2"; mock_kn.name = "no_build_kn"
        client.knowledge_networks.create.return_value = mock_kn
        mock_ot = MagicMock(); mock_ot.id = "ot1"; mock_ot.name = "items"
        client.object_types.create.return_value = mock_ot
        mock_make.return_value = client
        result = runner.invoke(cli, ["bkn", "create", "ds1", "--name", "no_build_kn", "--no-build"])
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert data["status"] == "skipped"
        client.knowledge_networks.build.assert_not_called()


def test_kn_create_with_tables_filter(runner):
    with patch("kweaver.cli.kn.make_client") as mock_make:
        client = _mock_client()
        mock_col = MagicMock(); mock_col.name = "id"; mock_col.type = "integer"
        mock_t1 = MagicMock(); mock_t1.name = "users"; mock_t1.columns = [mock_col]
        mock_t2 = MagicMock(); mock_t2.name = "orders"; mock_t2.columns = [mock_col]
        client.datasources.list_tables.return_value = [mock_t1, mock_t2]
        mock_dv = MagicMock(); mock_dv.id = "dv1"; client.dataviews.create.return_value = mock_dv
        mock_kn = MagicMock(); mock_kn.id = "kn3"; mock_kn.name = "filtered"
        client.knowledge_networks.create.return_value = mock_kn
        mock_ot = MagicMock(); mock_ot.id = "ot1"; mock_ot.name = "users"
        client.object_types.create.return_value = mock_ot
        mock_job = MagicMock(); mock_status = MagicMock(); mock_status.state = "completed"
        mock_job.wait.return_value = mock_status
        client.knowledge_networks.build.return_value = mock_job
        mock_make.return_value = client
        result = runner.invoke(cli, ["bkn", "create", "ds1", "--name", "filtered", "--tables", "users"])
        assert result.exit_code == 0
        assert client.object_types.create.call_count == 1


# ---------------------------------------------------------------------------
# Query subgraph
# ---------------------------------------------------------------------------


def test_query_subgraph(runner):
    with patch("kweaver.cli.query.make_client") as mock_make:
        client = _mock_client()
        mock_ot = MagicMock(); mock_ot.id = "ot1"; mock_ot.name = "users"
        client.object_types.list.return_value = [mock_ot]
        mock_rt1 = MagicMock(); mock_rt1.id = "rt1"; mock_rt1.name = "has_order"
        mock_rt1.source_ot_id = "ot1"; mock_rt1.target_ot_id = "ot2"
        mock_rt2 = MagicMock(); mock_rt2.id = "rt2"; mock_rt2.name = "belongs_to"
        mock_rt2.source_ot_id = "ot2"; mock_rt2.target_ot_id = "ot3"
        client.relation_types.list.return_value = [mock_rt1, mock_rt2]
        mock_result = MagicMock()
        mock_result.model_dump.return_value = {"entries": [{"id": "n1"}]}
        client.query.subgraph.return_value = mock_result
        mock_make.return_value = client
        result = runner.invoke(cli, [
            "query", "subgraph", "kn1",
            "--start-type", "users",
            "--start-condition", '{"field":"id","operation":"eq","value":"1"}',
            "--path", "has_order,belongs_to",
        ])
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert "entries" in data


def test_query_subgraph_rt_not_found(runner):
    with patch("kweaver.cli.query.make_client") as mock_make:
        client = _mock_client()
        mock_ot = MagicMock(); mock_ot.id = "ot1"; mock_ot.name = "users"
        client.object_types.list.return_value = [mock_ot]
        client.relation_types.list.return_value = []
        mock_make.return_value = client
        result = runner.invoke(cli, [
            "query", "subgraph", "kn1",
            "--start-type", "users",
            "--start-condition", '{"field":"id","operation":"eq","value":"1"}',
            "--path", "nonexistent_rt",
        ])
        assert result.exit_code != 0


# ---------------------------------------------------------------------------
# Agent sessions + history
# ---------------------------------------------------------------------------


def test_agent_sessions(runner):
    with patch("kweaver.cli.agent.make_client") as mock_make:
        client = _mock_client()
        mock_conv = MagicMock()
        mock_conv.model_dump.return_value = {"id": "conv1", "agent_id": "a1", "title": "Test session"}
        client.conversations.list.return_value = [mock_conv]
        mock_make.return_value = client
        result = runner.invoke(cli, ["agent", "sessions", "a1"])
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert data[0]["id"] == "conv1"
        client.conversations.list.assert_called_once_with(agent_id="a1")


def test_agent_history(runner):
    with patch("kweaver.cli.agent.make_client") as mock_make:
        client = _mock_client()
        mock_msg = MagicMock()
        mock_msg.model_dump.return_value = {"id": "msg1", "role": "user", "content": "hello"}
        client.conversations.list_messages.return_value = [mock_msg]
        mock_make.return_value = client
        result = runner.invoke(cli, ["agent", "history", "conv1"])
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert data[0]["id"] == "msg1"
        client.conversations.list_messages.assert_called_once_with("conv1", limit=None)


def test_agent_history_with_limit(runner):
    with patch("kweaver.cli.agent.make_client") as mock_make:
        client = _mock_client()
        client.conversations.list_messages.return_value = []
        mock_make.return_value = client
        result = runner.invoke(cli, ["agent", "history", "conv1", "--limit", "10"])
        assert result.exit_code == 0
        client.conversations.list_messages.assert_called_once_with("conv1", limit=10)


# ---------------------------------------------------------------------------
# Action execute --action-name
# ---------------------------------------------------------------------------


def test_action_execute_by_name(runner):
    with patch("kweaver.cli.action.make_client") as mock_make:
        client = _mock_client()
        mock_search = MagicMock()
        mock_search.action_types = [{"id": "at_resolved", "name": "sync_data"}]
        client.query.kn_search.return_value = mock_search
        mock_exec = MagicMock(); mock_exec.execution_id = "exec1"
        mock_exec_done = MagicMock(); mock_exec_done.status = "completed"; mock_exec_done.result = {"ok": True}
        mock_exec.wait.return_value = mock_exec_done
        client.action_types.execute.return_value = mock_exec
        mock_make.return_value = client
        result = runner.invoke(cli, ["action", "execute", "kn1", "--action-name", "sync_data"])
        assert result.exit_code == 0
        assert "completed" in result.output
        client.query.kn_search.assert_called_once()


def test_action_execute_by_name_not_found(runner):
    with patch("kweaver.cli.action.make_client") as mock_make:
        client = _mock_client()
        mock_search = MagicMock()
        mock_search.action_types = []
        client.query.kn_search.return_value = mock_search
        mock_make.return_value = client
        result = runner.invoke(cli, ["action", "execute", "kn1", "--action-name", "nonexistent"])
        assert result.exit_code != 0


# ---------------------------------------------------------------------------
# auth delete
# ---------------------------------------------------------------------------


def test_auth_delete_with_yes(runner):
    with patch("kweaver.cli.auth.PlatformStore") as MockStore:
        store = MockStore.return_value
        store.resolve.return_value = "https://example.com"
        result = runner.invoke(cli, ["auth", "delete", "https://example.com", "--yes"])
        assert result.exit_code == 0
        store.delete.assert_called_once_with("https://example.com")
        assert "Deleted" in result.output


def test_auth_delete_aborted(runner):
    with patch("kweaver.cli.auth.PlatformStore") as MockStore:
        store = MockStore.return_value
        store.resolve.return_value = "https://example.com"
        result = runner.invoke(cli, ["auth", "delete", "https://example.com"], input="n\n")
        assert result.exit_code != 0
        store.delete.assert_not_called()


# ---------------------------------------------------------------------------
# token
# ---------------------------------------------------------------------------


def test_token_prints_access_token(runner):
    with patch("kweaver.cli.token_cmd.PlatformStore") as MockStore:
        store = MockStore.return_value
        store.get_active.return_value = "https://example.com"
        store.load_token.return_value = {"accessToken": "tok-abc123"}
        result = runner.invoke(cli, ["token"])
        assert result.exit_code == 0
        assert "tok-abc123" in result.output


def test_token_no_platform(runner):
    with patch("kweaver.cli.token_cmd.PlatformStore") as MockStore:
        store = MockStore.return_value
        store.get_active.return_value = None
        result = runner.invoke(cli, ["token"])
        assert result.exit_code != 0


def test_token_no_token_stored(runner):
    with patch("kweaver.cli.token_cmd.PlatformStore") as MockStore:
        store = MockStore.return_value
        store.get_active.return_value = "https://example.com"
        store.load_token.return_value = {}
        result = runner.invoke(cli, ["token"])
        assert result.exit_code != 0


# ---------------------------------------------------------------------------
# kn stats, update
# ---------------------------------------------------------------------------


def test_kn_stats(runner):
    with patch("kweaver.cli.kn.make_client") as mock_make:
        client = _mock_client()
        mock_kn = MagicMock()
        mock_stats = MagicMock()
        mock_stats.model_dump.return_value = {
            "object_types_total": 3,
            "relation_types_total": 1,
            "action_types_total": 0,
            "concept_groups_total": 0,
        }
        mock_kn.statistics = mock_stats
        client.knowledge_networks.get.return_value = mock_kn
        mock_make.return_value = client
        result = runner.invoke(cli, ["bkn", "stats", "kn1"])
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert data["object_types_total"] == 3
        client.knowledge_networks.get.assert_called_once_with("kn1", include_statistics=True)


def test_kn_update(runner):
    with patch("kweaver.cli.kn.make_client") as mock_make:
        client = _mock_client()
        mock_kn = MagicMock()
        mock_kn.model_dump.return_value = {"id": "kn1", "name": "new-name"}
        client.knowledge_networks.update.return_value = mock_kn
        mock_make.return_value = client
        result = runner.invoke(cli, ["bkn", "update", "kn1", "--name", "new-name"])
        assert result.exit_code == 0
        client.knowledge_networks.update.assert_called_once_with("kn1", name="new-name")


def test_kn_list_with_pagination(runner):
    with patch("kweaver.cli.kn.make_client") as mock_make:
        client = _mock_client()
        mock_kn = MagicMock()
        mock_kn.id = "kn1"
        mock_kn.name = "alpha"
        mock_kn.comment = ""
        mock_kn.model_dump.return_value = {"id": "kn1", "name": "alpha", "tags": ["demo"]}
        client.knowledge_networks.list.return_value = [mock_kn]
        mock_make.return_value = client
        result = runner.invoke(cli, ["bkn", "list", "--limit", "5", "--offset", "0"])
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert data[0]["id"] == "kn1"


# ---------------------------------------------------------------------------
# kn action-log cancel
# ---------------------------------------------------------------------------


def test_kn_action_log_cancel_with_yes(runner):
    with patch("kweaver.cli.kn.make_client") as mock_make:
        client = _mock_client()
        mock_make.return_value = client
        result = runner.invoke(cli, ["bkn", "action-log", "cancel", "kn1", "log1", "--yes"])
        assert result.exit_code == 0
        client.action_types.cancel.assert_called_once_with("kn1", "log1")
        assert "Cancelled" in result.output


# ---------------------------------------------------------------------------
# agent list with pagination
# ---------------------------------------------------------------------------


def test_agent_list_with_offset_limit(runner):
    with patch("kweaver.cli.agent.make_client") as mock_make:
        client = _mock_client()
        mock_agent = MagicMock()
        mock_agent.id = "a1"
        mock_agent.name = "MyAgent"
        mock_agent.description = ""
        mock_agent.model_dump.return_value = {"id": "a1", "name": "MyAgent"}
        client.agents.list.return_value = [mock_agent]
        mock_make.return_value = client
        result = runner.invoke(cli, ["agent", "list", "--offset", "10", "--limit", "20"])
        assert result.exit_code == 0
        client.agents.list.assert_called_once_with(
            keyword=None, status=None, offset=10, limit=20
        )


# ---------------------------------------------------------------------------
# call -H/--header, --verbose, -bd
# ---------------------------------------------------------------------------


def test_call_with_header(runner):
    with patch("kweaver.cli.call.make_client") as mock_make:
        client = _mock_client()
        client._http.request.return_value = {"ok": True}
        mock_make.return_value = client
        result = runner.invoke(cli, [
            "call", "/api/test",
            "-H", "X-Custom: value",
        ])
        assert result.exit_code == 0
        call_kwargs = client._http.request.call_args
        headers = call_kwargs[1]["headers"]
        assert headers.get("X-Custom") == "value"


def test_call_with_biz_domain(runner):
    with patch("kweaver.cli.call.make_client") as mock_make:
        client = _mock_client()
        client._http.request.return_value = {"ok": True}
        mock_make.return_value = client
        result = runner.invoke(cli, [
            "call", "/api/test",
            "-bd", "my_domain",
        ])
        assert result.exit_code == 0
        headers = client._http.request.call_args[1]["headers"]
        assert headers.get("x-business-domain") == "my_domain"


def test_call_verbose_prints_to_stderr(runner):
    with patch("kweaver.cli.call.make_client") as mock_make:
        client = _mock_client()
        client._http.request.return_value = {"ok": True}
        mock_make.return_value = client
        result = runner.invoke(cli, [
            "call", "/api/test", "--verbose",
        ], catch_exceptions=False)
        assert result.exit_code == 0


# ---------------------------------------------------------------------------
# context-loader config set/list/show/use/remove
# ---------------------------------------------------------------------------


def test_context_loader_config_set(runner):
    with patch("kweaver.cli.context_loader.PlatformStore") as MockStore:
        store = MockStore.return_value
        store.get_active.return_value = "https://example.com"
        result = runner.invoke(cli, [
            "context-loader", "config", "set",
            "--kn-id", "kn_abc",
            "--name", "myconfig",
        ])
        assert result.exit_code == 0
        store.add_context_loader_entry.assert_called_once_with(
            "https://example.com", "myconfig", "kn_abc"
        )


def test_context_loader_config_list(runner):
    with patch("kweaver.cli.context_loader.PlatformStore") as MockStore:
        store = MockStore.return_value
        store.get_active.return_value = "https://example.com"
        store.load_context_loader_config.return_value = {
            "configs": [{"name": "myconfig", "knId": "kn_abc"}],
            "current": "myconfig",
        }
        result = runner.invoke(cli, ["context-loader", "config", "list"])
        assert result.exit_code == 0
        assert "myconfig" in result.output
        assert "kn_abc" in result.output


def test_context_loader_config_show(runner):
    with patch("kweaver.cli.context_loader.PlatformStore") as MockStore:
        store = MockStore.return_value
        store.get_active.return_value = "https://example.com"
        store.get_current_context_loader_kn.return_value = (
            "https://example.com/api/agent-retrieval/v1/mcp",
            "kn_abc",
        )
        result = runner.invoke(cli, ["context-loader", "config", "show"])
        assert result.exit_code == 0
        assert "kn_abc" in result.output


# ---------------------------------------------------------------------------
# Object-type CRUD subcommands
# ---------------------------------------------------------------------------


def test_object_type_get(runner):
    with patch("kweaver.cli.kn.make_client") as mock_make:
        client = _mock_client()
        mock_ot = MagicMock()
        mock_ot.model_dump.return_value = {
            "id": "ot1", "name": "products", "kn_id": "kn1",
            "primary_keys": ["id"], "display_key": "name",
        }
        client.object_types.get.return_value = mock_ot
        mock_make.return_value = client
        result = runner.invoke(cli, ["bkn", "object-type", "get", "kn1", "ot1"])
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert data["id"] == "ot1"
        client.object_types.get.assert_called_once_with("kn1", "ot1")


def test_object_type_create(runner):
    with patch("kweaver.cli.kn.make_client") as mock_make:
        client = _mock_client()
        mock_ot = MagicMock()
        mock_ot.model_dump.return_value = {"id": "ot1", "name": "products"}
        client.object_types.create.return_value = mock_ot
        mock_make.return_value = client
        result = runner.invoke(cli, [
            "bkn", "object-type", "create", "kn1",
            "--name", "products",
            "--dataview-id", "dv1",
            "--primary-key", "id",
            "--display-key", "name",
        ])
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert data["name"] == "products"
        client.object_types.create.assert_called_once_with(
            "kn1", name="products", dataview_id="dv1",
            primary_key="id", display_key="name", properties=None,
        )


def test_object_type_create_with_properties(runner):
    with patch("kweaver.cli.kn.make_client") as mock_make:
        client = _mock_client()
        mock_ot = MagicMock()
        mock_ot.model_dump.return_value = {"id": "ot1", "name": "products"}
        client.object_types.create.return_value = mock_ot
        mock_make.return_value = client
        prop_json = '{"name":"age","type":"integer","indexed":true}'
        result = runner.invoke(cli, [
            "bkn", "object-type", "create", "kn1",
            "--name", "products",
            "--dataview-id", "dv1",
            "--primary-key", "id",
            "--display-key", "name",
            "--property", prop_json,
        ])
        assert result.exit_code == 0
        call_kwargs = client.object_types.create.call_args[1]
        assert len(call_kwargs["properties"]) == 1
        assert call_kwargs["properties"][0].name == "age"


def test_object_type_update(runner):
    with patch("kweaver.cli.kn.make_client") as mock_make:
        client = _mock_client()
        mock_ot = MagicMock()
        mock_ot.model_dump.return_value = {"id": "ot1", "name": "new-name"}
        client.object_types.update.return_value = mock_ot
        mock_make.return_value = client
        result = runner.invoke(cli, [
            "bkn", "object-type", "update", "kn1", "ot1",
            "--name", "new-name",
        ])
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert data["name"] == "new-name"
        client.object_types.update.assert_called_once_with("kn1", "ot1", name="new-name")


def test_object_type_update_no_fields(runner):
    with patch("kweaver.cli.kn.make_client") as mock_make:
        client = _mock_client()
        mock_make.return_value = client
        result = runner.invoke(cli, [
            "bkn", "object-type", "update", "kn1", "ot1",
        ])
        assert result.exit_code != 0
        client.object_types.update.assert_not_called()


def test_object_type_delete(runner):
    with patch("kweaver.cli.kn.make_client") as mock_make:
        client = _mock_client()
        mock_make.return_value = client
        result = runner.invoke(cli, [
            "bkn", "object-type", "delete", "kn1", "ot1", "--yes",
        ])
        assert result.exit_code == 0
        client.object_types.delete.assert_called_once_with("kn1", "ot1")
        assert "Deleted" in result.output


def test_object_type_delete_aborted(runner):
    with patch("kweaver.cli.kn.make_client") as mock_make:
        client = _mock_client()
        mock_make.return_value = client
        result = runner.invoke(cli, [
            "bkn", "object-type", "delete", "kn1", "ot1",
        ], input="n\n")
        assert result.exit_code != 0
        client.object_types.delete.assert_not_called()


def test_relation_type_get(runner):
    with patch("kweaver.cli.kn.make_client") as mock_make:
        client = _mock_client()
        mock_rt = MagicMock()
        mock_rt.model_dump.return_value = {
            "id": "rt1", "name": "has_order", "kn_id": "kn1",
            "source_ot_id": "ot1", "target_ot_id": "ot2",
        }
        client.relation_types.get.return_value = mock_rt
        mock_make.return_value = client
        result = runner.invoke(cli, ["bkn", "relation-type", "get", "kn1", "rt1"])
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert data["id"] == "rt1"
        client.relation_types.get.assert_called_once_with("kn1", "rt1")


def test_relation_type_create(runner):
    with patch("kweaver.cli.kn.make_client") as mock_make:
        client = _mock_client()
        mock_rt = MagicMock()
        mock_rt.model_dump.return_value = {"id": "rt1", "name": "has_order"}
        client.relation_types.create.return_value = mock_rt
        mock_make.return_value = client
        result = runner.invoke(cli, [
            "bkn", "relation-type", "create", "kn1",
            "--name", "has_order",
            "--source", "ot1",
            "--target", "ot2",
            "--mapping", "user_id:id",
        ])
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert data["name"] == "has_order"
        call_kwargs = client.relation_types.create.call_args[1]
        assert call_kwargs["source_ot_id"] == "ot1"
        assert call_kwargs["target_ot_id"] == "ot2"
        assert call_kwargs["mappings"] == [("user_id", "id")]


def test_relation_type_create_no_mapping(runner):
    with patch("kweaver.cli.kn.make_client") as mock_make:
        client = _mock_client()
        mock_rt = MagicMock()
        mock_rt.model_dump.return_value = {"id": "rt1", "name": "linked_to"}
        client.relation_types.create.return_value = mock_rt
        mock_make.return_value = client
        result = runner.invoke(cli, [
            "bkn", "relation-type", "create", "kn1",
            "--name", "linked_to",
            "--source", "ot1",
            "--target", "ot2",
        ])
        assert result.exit_code == 0
        call_kwargs = client.relation_types.create.call_args[1]
        assert call_kwargs["mappings"] is None


def test_relation_type_create_invalid_mapping(runner):
    with patch("kweaver.cli.kn.make_client") as mock_make:
        client = _mock_client()
        mock_make.return_value = client
        result = runner.invoke(cli, [
            "bkn", "relation-type", "create", "kn1",
            "--name", "bad",
            "--source", "ot1",
            "--target", "ot2",
            "--mapping", "no_colon_here",
        ])
        assert result.exit_code != 0


def test_relation_type_update(runner):
    with patch("kweaver.cli.kn.make_client") as mock_make:
        client = _mock_client()
        mock_rt = MagicMock()
        mock_rt.model_dump.return_value = {"id": "rt1", "name": "new-name"}
        client.relation_types.update.return_value = mock_rt
        mock_make.return_value = client
        result = runner.invoke(cli, [
            "bkn", "relation-type", "update", "kn1", "rt1",
            "--name", "new-name",
        ])
        assert result.exit_code == 0
        client.relation_types.update.assert_called_once_with("kn1", "rt1", name="new-name")


def test_relation_type_update_no_fields(runner):
    with patch("kweaver.cli.kn.make_client") as mock_make:
        client = _mock_client()
        mock_make.return_value = client
        result = runner.invoke(cli, [
            "bkn", "relation-type", "update", "kn1", "rt1",
        ])
        assert result.exit_code != 0
        client.relation_types.update.assert_not_called()


def test_relation_type_delete(runner):
    with patch("kweaver.cli.kn.make_client") as mock_make:
        client = _mock_client()
        mock_make.return_value = client
        result = runner.invoke(cli, [
            "bkn", "relation-type", "delete", "kn1", "rt1", "--yes",
        ])
        assert result.exit_code == 0
        client.relation_types.delete.assert_called_once_with("kn1", "rt1")
        assert "Deleted" in result.output


def test_relation_type_delete_aborted(runner):
    with patch("kweaver.cli.kn.make_client") as mock_make:
        client = _mock_client()
        mock_make.return_value = client
        result = runner.invoke(cli, [
            "bkn", "relation-type", "delete", "kn1", "rt1",
        ], input="n\n")
        assert result.exit_code != 0
        client.relation_types.delete.assert_not_called()


# ---------------------------------------------------------------------------
# agent get
# ---------------------------------------------------------------------------


def test_agent_get(runner):
    with patch("kweaver.cli.agent.make_client") as mock_make:
        client = _mock_client()
        mock_agent = MagicMock()
        mock_agent.id = "a1"
        mock_agent.name = "assistant"
        mock_agent.description = "test agent"
        mock_agent.status = "published"
        mock_agent.kn_ids = ["kn1"]
        mock_agent.model_dump.return_value = {
            "id": "a1", "name": "assistant", "description": "test agent",
            "status": "published", "kn_ids": ["kn1"],
        }
        client.agents.get.return_value = mock_agent
        mock_make.return_value = client
        result = runner.invoke(cli, ["agent", "get", "a1"])
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert data["id"] == "a1"
        assert data["name"] == "assistant"
        client.agents.get.assert_called_once_with("a1")


def test_agent_get_verbose(runner):
    with patch("kweaver.cli.agent.make_client") as mock_make:
        client = _mock_client()
        mock_agent = MagicMock()
        mock_agent.model_dump.return_value = {
            "id": "a1", "name": "assistant", "system_prompt": "你是专家",
            "capabilities": ["search"], "model_config_data": {"name": "gpt"},
        }
        client.agents.get.return_value = mock_agent
        mock_make.return_value = client
        result = runner.invoke(cli, ["agent", "get", "a1", "--verbose"])
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert "system_prompt" in data


# ---------------------------------------------------------------------------
# object-type properties
# ---------------------------------------------------------------------------


def test_object_type_properties(runner):
    with patch("kweaver.cli.kn.make_client") as mock_make:
        client = _mock_client()
        client.query.object_type_properties.return_value = {
            "properties": [
                {"name": "id", "type": "integer"},
                {"name": "name", "type": "varchar"},
            ],
        }
        mock_make.return_value = client
        result = runner.invoke(cli, ["bkn", "object-type", "properties", "kn1", "ot1"])
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert "properties" in data
        client.query.object_type_properties.assert_called_once_with("kn1", "ot1", body=None)


def test_context_loader_config_set_no_active_platform(runner):
    with patch("kweaver.cli.context_loader.PlatformStore") as MockStore:
        store = MockStore.return_value
        store.get_active.return_value = None
        result = runner.invoke(cli, [
            "context-loader", "config", "set",
            "--kn-id", "kn_abc",
        ])
        assert result.exit_code != 0
