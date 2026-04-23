"""Tests for whoami / list_platforms / list_users / set_active_user / export_credentials."""
from __future__ import annotations

import base64
import json

import httpx
import respx

from kweaver.auth import (
    export_credentials,
    get_active_user,
    list_platforms,
    list_users,
    set_active_user,
    whoami,
)
from kweaver.config.store import PlatformStore


def _id_token(sub: str, account: str = "alice") -> str:
    payload = (
        base64.urlsafe_b64encode(json.dumps({"sub": sub, "account": account}).encode())
        .decode()
        .rstrip("=")
    )
    return f"hdr.{payload}.sig"


def test_list_platforms_empty(tmp_kweaver_home) -> None:
    assert list_platforms() == []


def test_list_platforms_after_save(tmp_kweaver_home) -> None:
    store = PlatformStore()
    store.save_token("https://a.example.com", {"accessToken": "AT", "idToken": _id_token("u1")})
    store.save_token("https://b.example.com", {"accessToken": "AT2", "idToken": _id_token("u2")})
    store.use("https://b.example.com")
    plats = list_platforms()
    urls = {p["base_url"] for p in plats}
    assert urls == {"https://a.example.com", "https://b.example.com"}
    active = [p for p in plats if p["active"]]
    assert len(active) == 1 and active[0]["base_url"] == "https://b.example.com"


def test_list_users_returns_users_for_platform(tmp_kweaver_home) -> None:
    store = PlatformStore()
    store.save_token("https://a.example.com", {"accessToken": "AT", "idToken": _id_token("u1", "alice")})
    store.save_token("https://a.example.com", {"accessToken": "AT2", "idToken": _id_token("u2", "bob")})
    users = list_users("https://a.example.com")
    ids = {u["id"] for u in users}
    assert ids == {"u1", "u2"}


def test_set_active_user_switches(tmp_kweaver_home) -> None:
    store = PlatformStore()
    store.save_token("https://a.example.com", {"accessToken": "AT", "idToken": _id_token("u1")})
    store.save_token("https://a.example.com", {"accessToken": "AT2", "idToken": _id_token("u2")})
    set_active_user("https://a.example.com", "u1")
    assert get_active_user("https://a.example.com") == "u1"
    set_active_user("https://a.example.com", "u2")
    assert get_active_user("https://a.example.com") == "u2"


@respx.mock
def test_whoami_combines_id_token_and_eacp(tmp_kweaver_home) -> None:
    store = PlatformStore()
    store.save_token(
        "https://a.example.com",
        {"accessToken": "AT", "idToken": _id_token("u1", "alice")},
    )
    store.use("https://a.example.com")
    respx.get("https://a.example.com/api/eacp/v1/user/get").mock(
        return_value=httpx.Response(
            200, json={"id": "u1", "name": "Alice", "type": "user", "tenant": "T"}
        )
    )
    info = whoami("https://a.example.com")
    assert info["sub"] == "u1"
    assert info["account"] == "alice"
    assert info["name"] == "Alice"
    assert info["type"] == "user"


def test_export_credentials_returns_dict(tmp_kweaver_home) -> None:
    store = PlatformStore()
    store.save_client("https://a.example.com", {"clientId": "cid", "clientSecret": "csec"})
    store.save_token(
        "https://a.example.com",
        {"accessToken": "AT", "refreshToken": "RT", "idToken": _id_token("u1")},
    )
    creds = export_credentials("https://a.example.com")
    assert creds["base_url"] == "https://a.example.com"
    assert creds["client_id"] == "cid"
    assert creds["client_secret"] == "csec"
    assert creds["refresh_token"] == "RT"
