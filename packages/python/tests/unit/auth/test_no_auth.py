"""No-auth: explicit save + 404 auto-fallback during signin/oauth2/auth."""
from __future__ import annotations

import warnings

import httpx
import pytest
import respx

from kweaver.auth import (
    NO_AUTH_TOKEN,
    http_signin,
    is_no_auth,
    save_no_auth_platform,
)
from kweaver.config.store import PlatformStore


def test_save_no_auth_platform_writes_sentinel_and_activates(tmp_kweaver_home) -> None:
    token = save_no_auth_platform("https://x.example.com")
    assert token["accessToken"] == NO_AUTH_TOKEN
    assert is_no_auth(token["accessToken"])
    store = PlatformStore()
    assert store.get_active() == "https://x.example.com"


@respx.mock
def test_http_signin_falls_back_on_oauth2_clients_404(tmp_kweaver_home) -> None:
    base = "https://noauth.example.com"
    respx.post(f"{base}/oauth2/clients").mock(return_value=httpx.Response(404, text=""))

    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        token = http_signin(base, username="alice", password="x")

    assert token["accessToken"] == NO_AUTH_TOKEN
    assert any("no-auth" in str(w.message).lower() for w in caught)


@respx.mock
def test_http_signin_falls_back_on_oauth2_auth_404(tmp_kweaver_home) -> None:
    base = "https://noauth.example.com"
    respx.post(f"{base}/oauth2/clients").mock(
        return_value=httpx.Response(201, json={"client_id": "c", "client_secret": "s"})
    )
    respx.get(f"{base}/oauth2/auth").mock(return_value=httpx.Response(404, text=""))

    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        token = http_signin(base, username="alice", password="x")

    assert token["accessToken"] == NO_AUTH_TOKEN
    assert any("no-auth" in str(w.message).lower() for w in caught)


@respx.mock
def test_http_signin_does_not_fall_back_on_500(tmp_kweaver_home) -> None:
    base = "https://server-error.example.com"
    respx.post(f"{base}/oauth2/clients").mock(return_value=httpx.Response(500, text="oops"))
    with pytest.raises(httpx.HTTPStatusError):
        http_signin(base, username="alice", password="x")
