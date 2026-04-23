"""Tests for http_signin (HTTP /oauth2/signin + RSA password + redirect chain)."""
from __future__ import annotations

import base64
import json

import httpx
import pytest
import respx

from kweaver.auth import InitialPasswordChangeRequiredError, http_signin


def _signin_html(csrf: str, challenge: str) -> str:
    return (
        '<script id="__NEXT_DATA__" type="application/json">'
        + json.dumps({"props": {"pageProps": {"challenge": challenge, "csrftoken": csrf}}})
        + "</script>"
    )


@respx.mock
def test_http_signin_happy_path(tmp_kweaver_home) -> None:
    base = "https://x.example.com"
    redirect_uri = "http://127.0.0.1:9010/callback"

    respx.post(f"{base}/oauth2/clients").mock(
        return_value=httpx.Response(201, json={"client_id": "cid", "client_secret": "csec"})
    )
    respx.get(f"{base}/oauth2/auth").mock(
        return_value=httpx.Response(
            302,
            headers={"location": f"{base}/oauth2/signin?login_challenge=xc"},
            text="",
        )
    )
    respx.get(f"{base}/oauth2/signin").mock(
        return_value=httpx.Response(200, text=_signin_html("csrf123", "xc"))
    )

    captured = {}

    def _on_signin_post(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.content)
        return httpx.Response(
            302, headers={"location": f"{redirect_uri}?code=AUTHCODE&state=STATE"}
        )

    respx.post(f"{base}/oauth2/signin").mock(side_effect=_on_signin_post)
    respx.post(f"{base}/oauth2/token").mock(
        return_value=httpx.Response(
            200,
            json={
                "access_token": "AT",
                "refresh_token": "RT",
                "id_token": "IT",
                "token_type": "Bearer",
                "expires_in": 3600,
                "scope": "openid offline all",
            },
        )
    )

    token = http_signin(base, username="alice", password="hunter2")

    assert token["accessToken"] == "AT"
    assert token["refreshToken"] == "RT"
    assert captured["body"]["account"] == "alice"
    assert captured["body"]["_csrf"] == "csrf123"
    assert captured["body"]["challenge"] == "xc"
    assert captured["body"]["device"]["client_type"] == "console_web"
    cipher = base64.b64decode(captured["body"]["password"])
    assert len(cipher) == 256


@respx.mock
def test_http_signin_raises_initial_password_required(tmp_kweaver_home) -> None:
    base = "https://x.example.com"
    respx.post(f"{base}/oauth2/clients").mock(
        return_value=httpx.Response(201, json={"client_id": "cid", "client_secret": "csec"})
    )
    respx.get(f"{base}/oauth2/auth").mock(
        return_value=httpx.Response(
            302, headers={"location": f"{base}/oauth2/signin?login_challenge=c"}
        )
    )
    respx.get(f"{base}/oauth2/signin").mock(
        return_value=httpx.Response(200, text=_signin_html("csrf", "c"))
    )
    respx.post(f"{base}/oauth2/signin").mock(
        return_value=httpx.Response(401, json={"code": 401001017, "message": "must change"})
    )

    with pytest.raises(InitialPasswordChangeRequiredError) as ei:
        http_signin(base, username="alice", password="oldpwd")
    assert ei.value.account == "alice"
    assert ei.value.base_url == base


@respx.mock
def test_http_signin_with_new_password_auto_retries_once(tmp_kweaver_home) -> None:
    base = "https://x.example.com"
    redirect_uri = "http://127.0.0.1:9010/callback"
    respx.post(f"{base}/oauth2/clients").mock(
        return_value=httpx.Response(201, json={"client_id": "cid", "client_secret": "csec"})
    )
    respx.get(f"{base}/oauth2/auth").mock(
        return_value=httpx.Response(
            302, headers={"location": f"{base}/oauth2/signin?login_challenge=c"}
        )
    )
    respx.get(f"{base}/oauth2/signin").mock(
        return_value=httpx.Response(200, text=_signin_html("csrf", "c"))
    )
    respx.post(f"{base}/api/eacp/v1/auth1/modifypassword").mock(
        return_value=httpx.Response(200, json={"code": 0})
    )

    call_count = {"n": 0}

    def _signin_post(req: httpx.Request) -> httpx.Response:
        call_count["n"] += 1
        if call_count["n"] == 1:
            return httpx.Response(401, json={"code": 401001017, "message": "must change"})
        return httpx.Response(
            302, headers={"location": f"{redirect_uri}?code=AUTHCODE&state=STATE"}
        )

    respx.post(f"{base}/oauth2/signin").mock(side_effect=_signin_post)
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

    token = http_signin(base, username="alice", password="oldpwd", new_password="NewPwd1!")
    assert token["accessToken"] == "AT"
    assert call_count["n"] == 2


@respx.mock
def test_http_signin_does_not_retry_more_than_once(tmp_kweaver_home) -> None:
    base = "https://x.example.com"
    respx.post(f"{base}/oauth2/clients").mock(
        return_value=httpx.Response(201, json={"client_id": "cid", "client_secret": "csec"})
    )
    respx.get(f"{base}/oauth2/auth").mock(
        return_value=httpx.Response(
            302, headers={"location": f"{base}/oauth2/signin?login_challenge=c"}
        )
    )
    respx.get(f"{base}/oauth2/signin").mock(
        return_value=httpx.Response(200, text=_signin_html("csrf", "c"))
    )
    respx.post(f"{base}/api/eacp/v1/auth1/modifypassword").mock(
        return_value=httpx.Response(200, json={"code": 0})
    )
    respx.post(f"{base}/oauth2/signin").mock(
        return_value=httpx.Response(401, json={"code": 401001017, "message": "still bad"})
    )

    with pytest.raises(InitialPasswordChangeRequiredError):
        http_signin(base, username="alice", password="oldpwd", new_password="NewPwd1!")
