"""HTTP /oauth2/signin login: GET signin page, RSA-encrypt password, POST signin,
follow redirects to /callback?code=..., exchange code for token. Aligned with TS
oauth2PasswordSigninLogin (client registration, RSA body, token exchange).
"""
from __future__ import annotations

import base64
import os
import re
import warnings
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import parse_qs, urljoin, urlparse

import httpx

from kweaver.auth._crypto import (
    STUDIOWEB_LOGIN_PUBLIC_KEY_PEM,
    encrypt_pkcs1_v15,
    rsa_modulus_hex_to_spki_pem,
)
from kweaver.auth._signin_html import parse_signin_page_html_props
from kweaver.auth.eacp import InitialPasswordChangeRequiredError, eacp_modify_password
from kweaver.config.store import PlatformStore

_DEFAULT_REDIRECT_PORT = 9010
_DEFAULT_SCOPE = "openid offline all"


class _NoAuthFallback(Exception):
    """Internal sentinel: caught by http_signin → save_no_auth_platform + warning."""


def _resolve_public_key_pem(explicit: str | None, page_material: str | None) -> str:
    """Public-key priority: arg > env file > page __NEXT_DATA__ > STUDIOWEB constant."""
    if explicit:
        return explicit
    env_path = os.environ.get("KWEAVER_SIGNIN_RSA_PUBLIC_KEY", "").strip()
    if env_path:
        with open(env_path, encoding="utf-8") as fh:
            return fh.read()
    if page_material:
        s = page_material.strip()
        if "BEGIN PUBLIC KEY" in s or "BEGIN RSA PUBLIC KEY" in s:
            return s
        hex_norm = re.sub(r"\s+", "", s)
        if (
            len(hex_norm) >= 128
            and len(hex_norm) % 2 == 0
            and re.fullmatch(r"[0-9a-fA-F]+", hex_norm) is not None
        ):
            return rsa_modulus_hex_to_spki_pem(hex_norm)
        b64 = re.sub(r"\s+", "", s)
        return f"-----BEGIN PUBLIC KEY-----\n{b64}\n-----END PUBLIC KEY-----"
    return STUDIOWEB_LOGIN_PUBLIC_KEY_PEM


def _build_signin_post_body(
    *,
    csrftoken: str,
    challenge: str,
    account: str,
    password_cipher: str,
    remember: bool,
) -> dict[str, Any]:
    return {
        "_csrf": csrftoken,
        "challenge": challenge,
        "account": account,
        "password": password_cipher,
        "vcode": {"id": "", "content": ""},
        "dualfactorauthinfo": {"validcode": {"vcode": ""}, "OTP": {"OTP": ""}},
        "remember": remember,
        "device": {
            "name": "",
            "description": "",
            "client_type": "console_web",
            "udids": [],
        },
    }


def _resolve_or_register_client(base: str, port: int, *, tls_insecure: bool) -> dict[str, Any]:
    """Reuse cached client.json if present and still valid; otherwise register."""
    store = PlatformStore()
    redirect_uri = f"http://127.0.0.1:{port}/callback"
    cached = store.load_client(base)
    if cached.get("clientId") and cached.get("redirectUri") == redirect_uri:
        try:
            r = httpx.get(
                f"{base}/oauth2/auth",
                params={
                    "client_id": cached["clientId"],
                    "response_type": "code",
                    "scope": "openid",
                    "redirect_uri": redirect_uri,
                    "state": "preflight",
                },
                follow_redirects=False,
                verify=not tls_insecure,
                timeout=30.0,
            )
            if r.status_code < 400:
                return cached
        except Exception:
            return cached
    resp = httpx.post(
        f"{base}/oauth2/clients",
        json={
            "client_name": "kweaver-sdk",
            "grant_types": ["authorization_code", "implicit", "refresh_token"],
            "response_types": ["token id_token", "code", "token"],
            "scope": "openid offline all",
            "redirect_uris": [redirect_uri],
            "post_logout_redirect_uris": [redirect_uri.rsplit("/", 1)[0] + "/successful-logout"],
            "metadata": {"device": {"name": "kweaver-sdk", "client_type": "web"}},
        },
        verify=not tls_insecure,
        timeout=30.0,
    )
    if resp.status_code == 404:
        raise _NoAuthFallback()
    resp.raise_for_status()
    data = resp.json()
    client: dict[str, Any] = {
        "baseUrl": base,
        "clientId": data["client_id"],
        "clientSecret": data["client_secret"],
        "redirectUri": redirect_uri,
        "scope": _DEFAULT_SCOPE,
        "lang": "zh-cn",
        "product": "adp",
    }
    store.save_client(base, client)
    return client


def _exchange_code(
    base: str,
    *,
    code: str,
    client_id: str,
    client_secret: str,
    redirect_uri: str,
    tls_insecure: bool,
) -> dict[str, Any]:
    creds = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
    resp = httpx.post(
        f"{base}/oauth2/token",
        data={"grant_type": "authorization_code", "code": code, "redirect_uri": redirect_uri},
        headers={
            "Authorization": f"Basic {creds}",
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
        },
        verify=not tls_insecure,
        timeout=30.0,
    )
    resp.raise_for_status()
    data = resp.json()
    now = datetime.now(timezone.utc)
    expires_in = int(data.get("expires_in", 3600))
    return {
        "baseUrl": base,
        "accessToken": data["access_token"],
        "tokenType": data.get("token_type", "Bearer"),
        "scope": data.get("scope", ""),
        "expiresIn": expires_in,
        "expiresAt": (now + timedelta(seconds=expires_in)).isoformat(),
        "refreshToken": data.get("refresh_token", ""),
        "idToken": data.get("id_token", ""),
        "obtainedAt": now.isoformat(),
    }


def _challenge_from_url(url: str) -> str | None:
    q = parse_qs(urlparse(url).query)
    v = q.get("login_challenge", [None])[0]
    return v if isinstance(v, str) and v else None


def _follow_to_signin_page(cx: httpx.Client, base: str) -> str:
    url = f"{base}/api/dip-hub/v1/login"
    for _ in range(20):
        r = cx.get(url, headers={"Accept": "text/html"}, timeout=30.0)
        if r.status_code == 404:
            raise _NoAuthFallback()
        if r.status_code in (302, 303, 307, 308):
            loc = r.headers.get("location")
            if not loc:
                raise RuntimeError("Redirect without Location header while resolving sign-in page.")
            url = urljoin(url, loc)
            if "/oauth2/signin" in url:
                return url
            continue
        if r.status_code == 200 and "/oauth2/signin" in str(r.url):
            return str(r.url)
        raise RuntimeError(f"Failed to reach signin page from {base}: HTTP {r.status_code}")
    raise RuntimeError("Too many redirects en route to /oauth2/signin")


def _follow_to_callback(
    cx: httpx.Client,
    post_request_url: str,
    start_location: str,
    redirect_uri: str,
) -> str:
    callback = urlparse(redirect_uri)
    url = urljoin(post_request_url, start_location)
    for _ in range(40):
        u = urlparse(url)
        if u.netloc == callback.netloc and u.path == callback.path:
            params = parse_qs(u.query)
            if "code" not in params or not params["code"]:
                raise RuntimeError("Callback URL missing authorization code.")
            return params["code"][0]
        r = cx.get(url, headers={"Accept": "text/html"}, timeout=30.0)
        if r.status_code in (302, 303, 307, 308):
            loc = r.headers.get("location")
            if not loc:
                raise RuntimeError("Redirect without Location during sign-in redirect chain.")
            url = urljoin(url, loc)
            continue
        raise RuntimeError(
            f"Unexpected status {r.status_code} during signin redirect chain at {url[:120]}"
        )
    raise RuntimeError("Too many OAuth redirects")


def _is_initial_password_code(code: Any) -> bool:
    return code == 401001017 or code == "401001017"


def http_signin(
    base_url: str,
    *,
    username: str,
    password: str,
    client_id: str | None = None,
    client_secret: str | None = None,
    new_password: str | None = None,
    signin_public_key_pem: str | None = None,
    tls_insecure: bool = False,
    lang: str = "zh-cn",
    redirect_port: int = _DEFAULT_REDIRECT_PORT,
    _retry_count: int = 0,
) -> dict[str, Any]:
    """HTTP /oauth2/signin login. See design spec for full semantics."""
    if not isinstance(username, str) or not username:
        raise ValueError("username must be a non-empty string")
    if not isinstance(password, str) or not password:
        raise ValueError("password must be a non-empty string")

    base = base_url.rstrip("/")

    try:
        if client_id and client_secret:
            client: dict[str, Any] = {
                "baseUrl": base,
                "clientId": client_id,
                "clientSecret": client_secret,
                "redirectUri": f"http://127.0.0.1:{redirect_port}/callback",
            }
        else:
            client = _resolve_or_register_client(base, redirect_port, tls_insecure=tls_insecure)

        cookies = httpx.Cookies()
        with httpx.Client(
            cookies=cookies, verify=not tls_insecure, follow_redirects=False, timeout=30.0
        ) as cx:
            signin_url = _follow_to_signin_page(cx, base)
            page_resp = cx.get(
                signin_url,
                headers={
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                },
            )
            page_resp.raise_for_status()
            page = parse_signin_page_html_props(page_resp.text)
            challenge = page.get("challenge") or _challenge_from_url(signin_url) or ""
            if not challenge:
                raise RuntimeError("Sign-in page did not expose login_challenge.")

            pem = _resolve_public_key_pem(signin_public_key_pem, page.get("rsa_public_key_material"))
            cipher = encrypt_pkcs1_v15(password, pem)

            body = _build_signin_post_body(
                csrftoken=page["csrftoken"],
                challenge=challenge,
                account=username,
                password_cipher=cipher,
                remember=bool(page.get("remember") or False),
            )

            post_url = f"{base}/oauth2/signin"
            _origin = urlparse(base)
            post_resp = cx.post(
                post_url,
                json=body,
                headers={
                    "Accept": "application/json, text/plain, */*",
                    "Content-Type": "application/json",
                    "Origin": f"{_origin.scheme}://{_origin.netloc}",
                    "Referer": signin_url,
                },
            )
            if post_resp.status_code == 401:
                try:
                    err_json = post_resp.json()
                except Exception:
                    err_json = {}
                err_code = err_json.get("code")
                if _is_initial_password_code(err_code):
                    if new_password and _retry_count < 1:
                        res = eacp_modify_password(
                            base,
                            account=username,
                            old_password=password,
                            new_password=new_password,
                            tls_insecure=tls_insecure,
                        )
                        if not res["ok"]:
                            raise RuntimeError(
                                f"Auto change-password failed: {res['status']} {res['body'][:300]}"
                            )
                        return http_signin(
                            base_url,
                            username=username,
                            password=new_password,
                            client_id=client_id,
                            client_secret=client_secret,
                            new_password=None,
                            signin_public_key_pem=signin_public_key_pem,
                            tls_insecure=tls_insecure,
                            lang=lang,
                            redirect_port=redirect_port,
                            _retry_count=_retry_count + 1,
                        )
                    raise InitialPasswordChangeRequiredError(
                        account=username,
                        base_url=base,
                        server_message=str(err_json.get("message", "")),
                    )
                raise RuntimeError(f"OAuth2 sign-in failed: 401 {post_resp.text[:500]}")
            if post_resp.status_code not in (302, 303, 307, 308):
                raise RuntimeError(
                    f"OAuth2 sign-in failed: {post_resp.status_code} {post_resp.text[:500]}"
                )
            loc = post_resp.headers.get("location")
            if not loc:
                raise RuntimeError("OAuth2 sign-in redirect missing Location header.")
            code = _follow_to_callback(cx, post_url, loc, client["redirectUri"])

        token = _exchange_code(
            base,
            code=code,
            client_id=client["clientId"],
            client_secret=client["clientSecret"],
            redirect_uri=client["redirectUri"],
            tls_insecure=tls_insecure,
        )
        if tls_insecure:
            token["tlsInsecure"] = True

        store = PlatformStore()
        store.save_token(base, token)
        store.use(base)
        return token
    except _NoAuthFallback:
        warnings.warn(
            "OAuth2 endpoint not found (404). Saving platform in no-auth mode.",
            RuntimeWarning,
            stacklevel=2,
        )
        from kweaver.auth.store_helpers import save_no_auth_platform

        return save_no_auth_platform(base, tls_insecure=tls_insecure)
