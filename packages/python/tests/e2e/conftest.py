"""E2E test configuration for KWeaver SDK against a real KWeaver environment.

Follows the Alfred testing pattern:
  - pytest CLI options for environment selection
  - Environment registry for multiple KWeaver deployments
  - Session-scoped fixtures for expensive setup (client, datasource)
  - Destructive marker for state-mutating tests (build/delete KN)
  - Factory fixtures for common operations
  - Automatic token refresh via Playwright browser login
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import pytest


from kweaver import KWeaverClient, PasswordAuth

# ---------------------------------------------------------------------------
# Auto-load secrets: local .env.e2e first, then ~/.env.secrets as fallback
# ---------------------------------------------------------------------------

# Walk up from this file to find the repo root (contains .git)
def _find_repo_root() -> Path | None:
    d = Path(__file__).resolve().parent
    for _ in range(10):
        if (d / ".git").exists():
            return d
        d = d.parent
    return None

_REPO_ROOT = _find_repo_root()
_LOCAL_ENV_PATH = _REPO_ROOT / ".env.e2e" if _REPO_ROOT else None
_GLOBAL_ENV_PATH = Path.home() / ".env.secrets"

def _load_env_file(path: Path) -> None:
    """Source KEY=VALUE lines from an env file into os.environ.

    Handles ``export KEY="VALUE"`` and ``KEY=VALUE`` formats.
    Skips comments and blank lines. Does NOT override existing env vars.
    """
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        line = line.removeprefix("export ")
        if "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        # Don't override — explicit env vars take precedence
        if key not in os.environ:
            os.environ[key] = value

# Local .env.e2e takes priority, then global ~/.env.secrets as fallback
if _LOCAL_ENV_PATH:
    _load_env_file(_LOCAL_ENV_PATH)
_load_env_file(_GLOBAL_ENV_PATH)


# ---------------------------------------------------------------------------
# Default environment registry
# ---------------------------------------------------------------------------

E2E_ENV: dict[str, dict[str, str]] = {
    "dev": {
        "base_url": os.getenv("KWEAVER_BASE_URL", ""),
        "token": os.getenv("KWEAVER_TOKEN", ""),
        "account_id": os.getenv("KWEAVER_ACCOUNT_ID", "test"),
        "business_domain": os.getenv("KWEAVER_BUSINESS_DOMAIN", ""),
        "vega_url": os.getenv("KWEAVER_VEGA_URL", ""),
        # Database credentials for datasource tests
        "db_type": os.getenv("KWEAVER_TEST_DB_TYPE", "mysql"),
        "db_host": os.getenv("KWEAVER_TEST_DB_HOST", ""),
        "db_port": os.getenv("KWEAVER_TEST_DB_PORT", "3306"),
        "db_name": os.getenv("KWEAVER_TEST_DB_NAME", ""),
        "db_user": os.getenv("KWEAVER_TEST_DB_USER", ""),
        "db_pass": os.getenv("KWEAVER_TEST_DB_PASS", ""),
        "db_schema": os.getenv("KWEAVER_TEST_DB_SCHEMA", ""),
    },
}


# ---------------------------------------------------------------------------
# pytest CLI options
# ---------------------------------------------------------------------------


def pytest_addoption(parser: pytest.Parser) -> None:
    parser.addoption(
        "--e2e-env",
        default="dev",
        help="E2E environment name from registry (default: dev)",
    )
    parser.addoption(
        "--e2e-base-url",
        default=None,
        help="Override KWeaver base URL",
    )
    parser.addoption(
        "--e2e-token",
        default=None,
        help="Override KWeaver bearer token",
    )
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
def e2e_env(request: pytest.FixtureRequest) -> dict[str, str]:
    """Resolve and validate the E2E environment config.

    Returns a dict with connection parameters.
    Skips the entire session if the environment is not available.
    """
    env_name = request.config.getoption("--e2e-env")
    env_cfg = E2E_ENV.get(env_name, E2E_ENV["dev"]).copy()

    # CLI overrides take precedence
    base_url_override = request.config.getoption("--e2e-base-url")
    if base_url_override:
        env_cfg["base_url"] = base_url_override

    token_override = request.config.getoption("--e2e-token")
    if token_override:
        env_cfg["token"] = token_override

    if not env_cfg.get("base_url"):
        pytest.skip("E2E environment not available: KWEAVER_BASE_URL not set")

    # Auto-refresh token if credentials are available
    username = os.getenv("KWEAVER_USERNAME", "")
    password = os.getenv("KWEAVER_PASSWORD", "")
    if username and password:
        try:
            auth = PasswordAuth(env_cfg["base_url"], username, password)
            fresh_token = auth.refresh()
            env_cfg["token"] = f"Bearer {fresh_token}"
            env_cfg["_auth"] = auth
        except Exception as exc:
            # Fall back to static token if auto-login fails
            if not env_cfg.get("token"):
                pytest.skip(f"Token refresh failed and no static KWEAVER_TOKEN: {exc}")
    elif not env_cfg.get("token"):
        pytest.skip("E2E environment not available: KWEAVER_TOKEN not set and no KWEAVER_USERNAME/KWEAVER_PASSWORD")

    return env_cfg


@pytest.fixture(scope="session")
def kweaver_client(e2e_env: dict[str, str]) -> KWeaverClient:
    """Session-scoped KWeaverClient connected to the E2E environment."""
    # Prefer PasswordAuth (auto-refresh) over static token
    auth = e2e_env.get("_auth")
    vega_url = e2e_env.get("vega_url") or None
    if auth:
        client = KWeaverClient(
            base_url=e2e_env["base_url"],
            auth=auth,
            account_id=e2e_env.get("account_id", "test"),
            business_domain=e2e_env.get("business_domain") or None,
            vega_url=vega_url,
        )
    else:
        client = KWeaverClient(
            base_url=e2e_env["base_url"],
            token=e2e_env["token"],
            account_id=e2e_env.get("account_id", "test"),
            business_domain=e2e_env.get("business_domain") or None,
            vega_url=vega_url,
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
def kweaver_client_factory(e2e_env: dict[str, str]):
    """Factory: create KWeaverClient with custom observability options."""
    clients: list[KWeaverClient] = []

    def _make(**kwargs: Any) -> KWeaverClient:
        auth = e2e_env.get("_auth")
        vega_url = e2e_env.get("vega_url") or None
        if auth:
            c = KWeaverClient(
                base_url=e2e_env["base_url"],
                auth=auth,
                business_domain=e2e_env.get("business_domain") or None,
                vega_url=vega_url,
                **kwargs,
            )
        else:
            c = KWeaverClient(
                base_url=e2e_env["base_url"],
                token=e2e_env["token"],
                business_domain=e2e_env.get("business_domain") or None,
                vega_url=vega_url,
                **kwargs,
            )
        clients.append(c)
        return c

    yield _make

    for c in clients:
        try:
            c.close()
        except Exception:
            pass
