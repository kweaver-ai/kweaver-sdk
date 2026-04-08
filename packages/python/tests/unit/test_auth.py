"""Tests for authentication providers."""

from __future__ import annotations

import json
import threading
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from kweaver._auth import ConfigAuth, OAuth2Auth, OAuth2BrowserAuth, PasswordAuth, TokenAuth


# ── TokenAuth ────────────────────────────────────────────────────────────────


def test_token_auth_headers():
    auth = TokenAuth("Bearer eyJ...")
    headers = auth.auth_headers()
    assert headers["Authorization"] == "Bearer eyJ..."


def test_token_auth_repr_hides_token():
    auth = TokenAuth("Bearer secret-token")
    assert "secret-token" not in repr(auth)
    assert "***" in repr(auth)


def test_token_auth_raw_token():
    """TokenAuth uses the token as-is (caller should include Bearer prefix)."""
    auth = TokenAuth("my-raw-token")
    assert auth.auth_headers()["Authorization"] == "my-raw-token"


# ── ConfigAuth ───────────────────────────────────────────────────────────────


def test_config_auth_no_platform_raises(tmp_path: Path):
    """ConfigAuth raises if no active platform is configured."""
    with patch("kweaver._auth.ConfigAuth.__init__", return_value=None):
        auth = ConfigAuth.__new__(ConfigAuth)
        store = MagicMock()
        store.get_active.return_value = None
        store.resolve.return_value = None
        auth._store = store
        auth._platform = None
        auth._lock = threading.Lock()

    with pytest.raises(RuntimeError, match="No active platform"):
        auth.auth_headers()


def test_config_auth_no_token_raises(tmp_path: Path):
    """ConfigAuth raises if platform has no token."""
    with patch("kweaver._auth.ConfigAuth.__init__", return_value=None):
        auth = ConfigAuth.__new__(ConfigAuth)
        store = MagicMock()
        store.get_active.return_value = "https://example.com"
        store.load_token.return_value = {}
        auth._store = store
        auth._platform = None
        auth._lock = threading.Lock()

    with pytest.raises(RuntimeError, match="No token found"):
        auth.auth_headers()


def test_config_auth_returns_valid_token(tmp_path: Path):
    """ConfigAuth returns Bearer token from stored data."""
    future = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
    token_data = {
        "accessToken": "test-access-token-123",
        "expiresAt": future,
    }

    with patch("kweaver._auth.ConfigAuth.__init__", return_value=None):
        auth = ConfigAuth.__new__(ConfigAuth)
        store = MagicMock()
        store.get_active.return_value = "https://example.com"
        store.load_token.return_value = token_data
        auth._store = store
        auth._platform = None
        auth._lock = threading.Lock()

    headers = auth.auth_headers()
    assert headers["Authorization"] == "Bearer test-access-token-123"


def test_config_auth_triggers_refresh_when_expired(tmp_path: Path):
    """ConfigAuth refreshes token when it's about to expire."""
    past = (datetime.now(timezone.utc) - timedelta(seconds=10)).isoformat()
    token_data = {
        "accessToken": "old-token",
        "expiresAt": past,
        "refreshToken": "refresh-123",
    }
    new_token = {
        "accessToken": "new-token",
        "expiresAt": (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(),
    }

    with patch("kweaver._auth.ConfigAuth.__init__", return_value=None):
        auth = ConfigAuth.__new__(ConfigAuth)
        store = MagicMock()
        store.get_active.return_value = "https://example.com"
        store.load_token.return_value = token_data
        store.load_client.return_value = {"clientId": "cid", "clientSecret": "csec"}
        auth._store = store
        auth._platform = None
        auth._lock = threading.Lock()

    with patch.object(auth, "_refresh", return_value=new_token) as mock_refresh:
        auth.auth_headers()
        mock_refresh.assert_called_once()


def test_config_auth_repr():
    with patch("kweaver._auth.ConfigAuth.__init__", return_value=None):
        auth = ConfigAuth.__new__(ConfigAuth)
        auth._platform = "https://example.com"
    assert "example.com" in repr(auth)


# ── OAuth2Auth ───────────────────────────────────────────────────────────────


def test_oauth2_auth_fetches_token():
    """OAuth2Auth calls token endpoint and caches result."""
    mock_resp = MagicMock()
    mock_resp.json.return_value = {
        "access_token": "oauth-token-abc",
        "expires_in": 3600,
    }
    mock_resp.raise_for_status = MagicMock()

    with patch("httpx.post", return_value=mock_resp) as mock_post:
        auth = OAuth2Auth(
            client_id="my-client",
            client_secret="my-secret",
            token_endpoint="https://auth.example.com/token",
        )
        headers = auth.auth_headers()
        assert headers["Authorization"] == "Bearer oauth-token-abc"
        mock_post.assert_called_once()


def test_oauth2_auth_caches_token():
    """OAuth2Auth doesn't call endpoint again when token is still valid."""
    mock_resp = MagicMock()
    mock_resp.json.return_value = {
        "access_token": "oauth-token-abc",
        "expires_in": 3600,
    }
    mock_resp.raise_for_status = MagicMock()

    with patch("httpx.post", return_value=mock_resp) as mock_post:
        auth = OAuth2Auth(
            client_id="c",
            client_secret="s",
            token_endpoint="https://auth.example.com/token",
        )
        auth.auth_headers()
        auth.auth_headers()
        # Only one call — second uses cache
        assert mock_post.call_count == 1


def test_oauth2_auth_refreshes_expired_token():
    """OAuth2Auth refreshes when token is near expiry."""
    mock_resp = MagicMock()
    mock_resp.json.return_value = {
        "access_token": "first-token",
        "expires_in": 1,  # Expires in 1 second
    }
    mock_resp.raise_for_status = MagicMock()

    with patch("httpx.post", return_value=mock_resp) as mock_post:
        auth = OAuth2Auth(
            client_id="c",
            client_secret="s",
            token_endpoint="https://auth.example.com/token",
        )
        auth.auth_headers()
        # Force expiry
        auth._expires_at = time.time() - 1
        mock_resp.json.return_value = {
            "access_token": "second-token",
            "expires_in": 3600,
        }
        headers = auth.auth_headers()
        assert headers["Authorization"] == "Bearer second-token"
        assert mock_post.call_count == 2


def test_oauth2_auth_repr():
    auth = OAuth2Auth(
        client_id="my-client",
        client_secret="secret",
        token_endpoint="https://auth.example.com/token",
    )
    r = repr(auth)
    assert "my-client" in r
    assert "secret" not in r


# ── PasswordAuth ─────────────────────────────────────────────────────────────


def test_password_auth_repr():
    with patch("kweaver._auth.PasswordAuth.__init__", return_value=None):
        auth = PasswordAuth.__new__(PasswordAuth)
        auth._username = "user@example.com"
    assert "user@example.com" in repr(auth)


def test_password_auth_refresh_interval():
    """PasswordAuth has a 240-second refresh interval."""
    assert PasswordAuth._REFRESH_INTERVAL == 240


# ── TLS insecure ─────────────────────────────────────────────────────────────


def test_oauth2_browser_auth_register_client_tls_insecure():
    """OAuth2BrowserAuth passes verify=False to httpx.post when tls_insecure=True."""
    mock_resp = MagicMock()
    mock_resp.json.return_value = {"client_id": "cid", "client_secret": "csec"}
    mock_resp.raise_for_status = MagicMock()

    with patch("httpx.post", return_value=mock_resp) as mock_post:
        auth = OAuth2BrowserAuth.__new__(OAuth2BrowserAuth)
        auth._base_url = "https://example.com"
        auth._redirect_port = 9010
        auth._redirect_uri = None
        auth._scope = "openid offline all"
        auth._lang = "zh-cn"
        auth._tls_insecure = True
        auth._lock = threading.Lock()
        auth._store = MagicMock()

        auth._register_client()

        _args, kwargs = mock_post.call_args
        assert kwargs.get("verify") is False


def test_config_auth_refresh_tls_insecure():
    """ConfigAuth._refresh passes verify=False when token has tlsInsecure."""
    token_data = {
        "accessToken": "old",
        "refreshToken": "rt",
        "tlsInsecure": True,
    }

    mock_resp = MagicMock()
    mock_resp.json.return_value = {
        "access_token": "new",
        "expires_in": 3600,
        "refresh_token": "rt2",
    }
    mock_resp.raise_for_status = MagicMock()

    with patch("kweaver._auth.ConfigAuth.__init__", return_value=None):
        auth = ConfigAuth.__new__(ConfigAuth)
        store = MagicMock()
        store.load_client.return_value = {"clientId": "c", "clientSecret": "s"}
        auth._store = store
        auth._platform = None
        auth._lock = threading.Lock()

    with patch("httpx.post", return_value=mock_resp) as mock_post:
        auth._refresh("https://example.com", token_data)
        _args, kwargs = mock_post.call_args
        assert kwargs.get("verify") is False


def test_config_auth_refresh_preserves_tls_insecure():
    """ConfigAuth._refresh includes tlsInsecure in the refreshed token dict."""
    token_data = {
        "accessToken": "old",
        "refreshToken": "rt",
        "tlsInsecure": True,
    }

    mock_resp = MagicMock()
    mock_resp.json.return_value = {
        "access_token": "new",
        "expires_in": 3600,
    }
    mock_resp.raise_for_status = MagicMock()

    with patch("kweaver._auth.ConfigAuth.__init__", return_value=None):
        auth = ConfigAuth.__new__(ConfigAuth)
        store = MagicMock()
        store.load_client.return_value = {"clientId": "c", "clientSecret": "s"}
        auth._store = store
        auth._platform = None
        auth._lock = threading.Lock()

    with patch("httpx.post", return_value=mock_resp):
        result = auth._refresh("https://example.com", token_data)
        assert result.get("tlsInsecure") is True


def test_config_auth_refresh_no_tls_insecure_when_absent():
    """ConfigAuth._refresh omits tlsInsecure when original token lacks it."""
    token_data = {
        "accessToken": "old",
        "refreshToken": "rt",
    }

    mock_resp = MagicMock()
    mock_resp.json.return_value = {
        "access_token": "new",
        "expires_in": 3600,
    }
    mock_resp.raise_for_status = MagicMock()

    with patch("kweaver._auth.ConfigAuth.__init__", return_value=None):
        auth = ConfigAuth.__new__(ConfigAuth)
        store = MagicMock()
        store.load_client.return_value = {"clientId": "c", "clientSecret": "s"}
        auth._store = store
        auth._platform = None
        auth._lock = threading.Lock()

    with patch("httpx.post", return_value=mock_resp):
        result = auth._refresh("https://example.com", token_data)
        assert "tlsInsecure" not in result


# ── Thread safety ────────────────────────────────────────────────────────────


def test_token_auth_thread_safe():
    """TokenAuth is safe to use across threads (stateless)."""
    auth = TokenAuth("Bearer test")
    results = []

    def worker():
        results.append(auth.auth_headers()["Authorization"])

    threads = [threading.Thread(target=worker) for _ in range(10)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert all(r == "Bearer test" for r in results)
    assert len(results) == 10
