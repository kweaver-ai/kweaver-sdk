"""E2E test configuration for KWeaver SDK against a real KWeaver environment.

Auth is read from ~/.kweaver/ (saved by `kweaver auth login`), the same
path the SDK's ConfigAuth and the CLI use.  This means e2e tests exercise
the real credential path users take — no separate secrets file needed for
auth.

Non-auth test config (database connection strings, etc.) is still loaded
from environment variables or ~/.env.secrets as a convenience.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import pytest

from click.testing import CliRunner

from kweaver import KWeaverClient
from kweaver._auth import ConfigAuth

# ---------------------------------------------------------------------------
# Auto-load non-auth test config from ~/.env.secrets
# ---------------------------------------------------------------------------

_SECRETS_PATH = Path.home() / ".env.secrets"


def _load_env_secrets() -> None:
    """Source KEY=VALUE lines from ~/.env.secrets into os.environ.

    Handles ``export KEY="VALUE"`` and ``KEY=VALUE`` formats.
    Skips comments and blank lines. Does NOT override existing env vars.
    """
    if not _SECRETS_PATH.exists():
        return
    for line in _SECRETS_PATH.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        line = line.removeprefix("export ")
        if "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key not in os.environ:
            os.environ[key] = value


_load_env_secrets()


# ---------------------------------------------------------------------------
# pytest CLI options
# ---------------------------------------------------------------------------


def pytest_addoption(parser: pytest.Parser) -> None:
    parser.addoption(
        "--run-destructive",
        action="store_true",
        default=False,
        help="Enable destructive tests that create/delete knowledge networks",
    )


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line(
        "markers",
        "destructive: marks tests that mutate KWeaver state (create/build/delete KN)",
    )


def pytest_collection_modifyitems(
    config: pytest.Config, items: list[pytest.Item]
) -> None:
    if config.getoption("--run-destructive"):
        return
    skip = pytest.mark.skip(reason="needs --run-destructive option to run")
    for item in items:
        if "destructive" in item.keywords:
            item.add_marker(skip)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
def e2e_env() -> dict[str, str]:
    """Non-auth test config (database connections, business_domain, etc.).

    Auth credentials come from ~/.kweaver/ via ConfigAuth, NOT from here.
    """
    return {
        "business_domain": os.getenv("KWEAVER_BUSINESS_DOMAIN", ""),
        # Database credentials for datasource tests
        "db_type": os.getenv("KWEAVER_TEST_DB_TYPE", "mysql"),
        "db_host": os.getenv("KWEAVER_TEST_DB_HOST", ""),
        "db_port": os.getenv("KWEAVER_TEST_DB_PORT", "3306"),
        "db_name": os.getenv("KWEAVER_TEST_DB_NAME", ""),
        "db_user": os.getenv("KWEAVER_TEST_DB_USER", ""),
        "db_pass": os.getenv("KWEAVER_TEST_DB_PASS", ""),
        "db_schema": os.getenv("KWEAVER_TEST_DB_SCHEMA", ""),
    }


@pytest.fixture(scope="session")
def kweaver_client(e2e_env: dict[str, str]) -> KWeaverClient:
    """Session-scoped KWeaverClient using ConfigAuth (~/.kweaver/).

    Requires `kweaver auth login` to have been run beforehand.
    """
    try:
        auth = ConfigAuth()
        # Verify credentials are present before proceeding
        _ = auth.base_url
    except RuntimeError as exc:
        pytest.skip(f"No saved credentials: {exc}. Run `kweaver auth login` first.")

    client = KWeaverClient(
        auth=auth,
        business_domain=e2e_env.get("business_domain") or None,
    )
    yield client
    client.close()


@pytest.fixture(scope="session")
def db_config(e2e_env: dict[str, str]) -> dict[str, Any]:
    """Database connection config for datasource tests.

    Skips if db_host is not configured.
    """
    if not e2e_env.get("db_host"):
        pytest.skip("E2E database not configured: KWEAVER_TEST_DB_HOST not set")

    cfg = {
        "type": e2e_env["db_type"],
        "host": e2e_env["db_host"],
        "port": int(e2e_env["db_port"]),
        "database": e2e_env["db_name"],
        "account": e2e_env["db_user"],
        "password": e2e_env["db_pass"],
    }
    if e2e_env.get("db_schema"):
        cfg["schema"] = e2e_env["db_schema"]
    return cfg


# ---------------------------------------------------------------------------
# Factory fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
def create_datasource(kweaver_client: KWeaverClient, db_config: dict[str, Any]):
    """Factory: create a datasource and track it for cleanup.

    Returns a callable that creates datasources. All created datasources
    are deleted at session teardown.
    """
    created_ids: list[str] = []

    def _create(name: str = "e2e_test_ds", **overrides: Any) -> Any:
        params = {**db_config, **overrides}
        ds = kweaver_client.datasources.create(name=name, **params)
        created_ids.append(ds.id)
        return ds

    yield _create

    for ds_id in reversed(created_ids):
        try:
            kweaver_client.datasources.delete(ds_id)
        except Exception:
            pass


@pytest.fixture(scope="session")
def create_knowledge_network(kweaver_client: KWeaverClient):
    """Factory: create a knowledge network and track it for cleanup.

    All created KNs are deleted at session teardown (reverse order).
    """
    created_ids: list[str] = []

    def _create(name: str = "e2e_test_kn", **kwargs: Any) -> Any:
        kn = kweaver_client.knowledge_networks.create(name=name, **kwargs)
        created_ids.append(kn.id)
        return kn

    yield _create

    for kn_id in reversed(created_ids):
        try:
            kweaver_client.knowledge_networks.delete(kn_id)
        except Exception:
            pass


@pytest.fixture(scope="session")
def cli_runner() -> CliRunner:
    """CliRunner — CLI reads ~/.kweaver/ directly, no env vars needed for auth."""
    return CliRunner()
