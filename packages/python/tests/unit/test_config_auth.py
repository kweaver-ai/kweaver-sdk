"""Tests for ConfigAuth credential provider."""

from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from kweaver._auth import ConfigAuth
from kweaver.config.no_auth import NO_AUTH_TOKEN
from kweaver.config.store import PlatformStore


def _setup_store(tmp_path: Path, url: str, access_token: str) -> PlatformStore:
    """Create a PlatformStore with an active platform and valid token."""
    store = PlatformStore(root=tmp_path)
    store.use(url)
    expires_at = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
    store.save_token(url, {
        "baseUrl": url,
        "accessToken": access_token,
        "tokenType": "Bearer",
        "expiresAt": expires_at,
        "refreshToken": "ref_tok",
    })
    return store


def test_config_auth_reads_stored_token(tmp_path: Path, monkeypatch):
    """ConfigAuth returns Bearer token from the platform store."""
    url = "https://adp.example.com"
    store = _setup_store(tmp_path, url, "my_access_token_123")

    auth = ConfigAuth.__new__(ConfigAuth)
    # Manually set internal state instead of calling __init__
    # (which would create a default PlatformStore pointing to ~/.kweaver)
    import threading
    auth._store = store
    auth._platform = None
    auth._lock = threading.Lock()

    headers = auth.auth_headers()
    assert headers["Authorization"] == "Bearer my_access_token_123"


def test_save_no_auth_platform_tls_insecure(tmp_path: Path):
    url = "https://tls-noauth.dev"
    store = PlatformStore(root=tmp_path)
    data = store.save_no_auth_platform(url, tls_insecure=True)
    assert data.get("tlsInsecure") is True
    tok = store.load_token(url)
    assert tok is not None
    assert tok.get("tlsInsecure") is True


def test_config_auth_no_auth_returns_empty_headers(tmp_path: Path):
    """Stored __NO_AUTH__ token must not send Authorization (matches TS CLI)."""
    url = "https://local.dev"
    store = PlatformStore(root=tmp_path)
    store.save_no_auth_platform(url)

    import threading

    auth = ConfigAuth.__new__(ConfigAuth)
    auth._store = store
    auth._platform = None
    auth._lock = threading.Lock()

    assert auth.auth_headers() == {}
    tok = store.load_token(url)
    assert tok is not None
    assert tok["accessToken"] == NO_AUTH_TOKEN


def test_config_auth_raises_when_no_platform(tmp_path: Path, monkeypatch):
    """ConfigAuth raises RuntimeError when no active platform is set."""
    store = PlatformStore(root=tmp_path)

    auth = ConfigAuth.__new__(ConfigAuth)
    import threading
    auth._store = store
    auth._platform = None
    auth._lock = threading.Lock()

    with pytest.raises(RuntimeError, match="No active platform"):
        auth.auth_headers()
