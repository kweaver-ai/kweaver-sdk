"""HttpSigninAuth: AuthProvider that calls http_signin on demand + caches token."""
from __future__ import annotations

import json

import httpx
import respx

from kweaver._auth import HttpSigninAuth
from kweaver.config.store import PlatformStore


def _signin_html(csrf: str, challenge: str) -> str:
    return (
        '<script id="__NEXT_DATA__" type="application/json">'
        + json.dumps({"props": {"pageProps": {"challenge": challenge, "csrftoken": csrf}}})
        + "</script>"
    )


def test_http_signin_auth_returns_empty_for_no_auth_token(tmp_kweaver_home) -> None:
    PlatformStore().save_no_auth_platform("https://x.example.com")
    auth = HttpSigninAuth("https://x.example.com", username="alice", password="x")
    assert auth.auth_headers() == {}


@respx.mock
def test_http_signin_auth_lazy_login_on_first_use(tmp_kweaver_home) -> None:
    base = "https://x.example.com"
    redirect = "http://127.0.0.1:9010/callback"
    respx.post(f"{base}/oauth2/clients").mock(
        return_value=httpx.Response(201, json={"client_id": "c", "client_secret": "s"})
    )
    respx.get(f"{base}/oauth2/auth").mock(return_value=httpx.Response(200, text="ok"))
    respx.get(f"{base}/api/dip-hub/v1/login").mock(
        return_value=httpx.Response(302, headers={"location": f"{base}/oauth2/signin?login_challenge=c"})
    )
    respx.get(f"{base}/oauth2/signin").mock(
        return_value=httpx.Response(200, text=_signin_html("csrf", "c"))
    )
    respx.post(f"{base}/oauth2/signin").mock(
        return_value=httpx.Response(302, headers={"location": f"{redirect}?code=AC&state=S"})
    )
    respx.post(f"{base}/oauth2/token").mock(
        return_value=httpx.Response(
            200,
            json={
                "access_token": "AT",
                "refresh_token": "RT",
                "id_token": "IT",
                "token_type": "Bearer",
                "expires_in": 3600,
                "scope": "openid",
            },
        )
    )

    auth = HttpSigninAuth(base, username="alice", password="hunter2")
    headers = auth.auth_headers()
    assert headers == {"Authorization": "Bearer AT"}
