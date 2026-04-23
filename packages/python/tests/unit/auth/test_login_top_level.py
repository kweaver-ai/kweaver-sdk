"""Tests for top-level kweaver.login() strategy dispatch."""
from __future__ import annotations

from unittest.mock import patch

import pytest

import kweaver


def test_login_no_auth_writes_sentinel(tmp_kweaver_home) -> None:
    token = kweaver.login("https://x.example.com", no_auth=True)
    from kweaver.auth import NO_AUTH_TOKEN

    assert token["accessToken"] == NO_AUTH_TOKEN


def test_login_no_auth_with_username_raises(tmp_kweaver_home) -> None:
    with pytest.raises(ValueError, match="mutually exclusive"):
        kweaver.login("https://x", no_auth=True, username="alice", password="x")


def test_login_username_password_dispatches_to_http_signin(tmp_kweaver_home) -> None:
    with patch("kweaver.auth.http_signin") as m:
        m.return_value = {"accessToken": "AT"}
        kweaver.login("https://x", username="alice", password="pwd")
        m.assert_called_once()
        args, kwargs = m.call_args
        assert args[0] == "https://x"
        assert kwargs["username"] == "alice"
        assert kwargs["password"] == "pwd"


def test_login_refresh_token_dispatches_to_login_with_refresh_token(tmp_kweaver_home) -> None:
    with patch("kweaver._auth.OAuth2BrowserAuth.login_with_refresh_token") as m:
        kweaver.login(
            "https://x", client_id="cid", client_secret="csec", refresh_token="RT"
        )
        m.assert_called_once_with(client_id="cid", client_secret="csec", refresh_token="RT")


def test_login_default_dispatches_to_browser_login(tmp_kweaver_home) -> None:
    with patch("kweaver._auth.OAuth2BrowserAuth.login") as m:
        kweaver.login("https://x")
        m.assert_called_once_with(no_browser=False)


def test_login_no_browser_paste_flow(tmp_kweaver_home) -> None:
    with patch("kweaver._auth.OAuth2BrowserAuth.login") as m:
        kweaver.login("https://x", open_browser=False)
        m.assert_called_once_with(no_browser=True)
