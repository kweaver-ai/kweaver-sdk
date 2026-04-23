"""SDK helpers over PlatformStore (whoami / list / users / export / no-auth)."""
from __future__ import annotations

import base64
import json
from typing import Any, TypedDict

from kweaver.auth.eacp import fetch_eacp_user_info
from kweaver.config.no_auth import NO_AUTH_TOKEN, is_no_auth
from kweaver.config.store import PlatformStore


class PlatformInfoDict(TypedDict):
    base_url: str
    alias: str | None
    active: bool
    user_count: int


class UserProfile(TypedDict):
    id: str
    display_name: str | None
    active: bool


class WhoamiInfo(TypedDict, total=False):
    sub: str | None
    account: str | None
    name: str | None
    type: str | None
    tenant: str | None
    base_url: str


class ExportedCredentials(TypedDict):
    base_url: str
    client_id: str
    client_secret: str
    refresh_token: str
    tls_insecure: bool


def save_no_auth_platform(
    base_url: str, *, tls_insecure: bool = False
) -> dict[str, Any]:
    """Mark a platform as no-auth. Writes token.json with NO_AUTH_TOKEN sentinel."""
    store = PlatformStore()
    return store.save_no_auth_platform(base_url, tls_insecure=tls_insecure)


def list_platforms() -> list[PlatformInfoDict]:
    store = PlatformStore()
    active = store.get_active()
    out: list[PlatformInfoDict] = []
    for p in store.list_platforms():
        out.append(
            PlatformInfoDict(
                base_url=p.url,
                alias=p.alias,
                active=(p.url == active),
                user_count=len(store.list_users(p.url)),
            )
        )
    return out


def list_users(base_url: str) -> list[UserProfile]:
    store = PlatformStore()
    active_uid = store.get_active_user(base_url)
    profiles = store.list_user_profiles(base_url)
    return [
        UserProfile(
            id=str(p["userId"]),
            display_name=p.get("username"),
            active=(p["userId"] == active_uid),
        )
        for p in profiles
    ]


def get_active_user(base_url: str) -> str | None:
    return PlatformStore().get_active_user(base_url)


def set_active_user(base_url: str, identifier: str) -> None:
    store = PlatformStore()
    user_id = store.resolve_user_id(base_url, identifier)
    if not user_id:
        raise ValueError(f"User {identifier!r} not found for {base_url}")
    store.set_active_user(base_url, user_id)


def whoami(base_url: str | None = None) -> WhoamiInfo:
    """Decode id_token sub/account + (best-effort) merge EACP userinfo."""
    store = PlatformStore()
    url = base_url or store.get_active()
    if not url:
        raise RuntimeError("No active platform. Pass base_url= or call kweaver.login first.")
    token = store.load_token(url)
    if not token:
        raise RuntimeError(f"No token for {url}.")
    info: WhoamiInfo = {"base_url": url, "sub": None, "account": None, "name": None, "type": None}
    id_token = token.get("idToken") or ""
    if id_token:
        try:
            payload = id_token.split(".")[1]
            payload += "=" * (-len(payload) % 4)
            data = json.loads(base64.urlsafe_b64decode(payload))
            info["sub"] = data.get("sub")
            info["account"] = data.get("account") or data.get("preferred_username")
            info["name"] = data.get("name")
        except Exception:
            pass
    access = token.get("accessToken", "")
    if access and not is_no_auth(access):
        eacp = fetch_eacp_user_info(
            url, access_token=access, tls_insecure=bool(token.get("tlsInsecure"))
        )
        if eacp:
            info["name"] = eacp.get("name") or info.get("name")
            info["type"] = eacp.get("type") or info.get("type")
            t = eacp.get("tenant")
            if t is not None:
                info["tenant"] = t
    return info


def export_credentials(base_url: str | None = None) -> ExportedCredentials:
    store = PlatformStore()
    url = base_url or store.get_active()
    if not url:
        raise RuntimeError("No active platform.")
    client = store.load_client(url)
    token = store.load_token(url)
    return ExportedCredentials(
        base_url=url,
        client_id=client.get("clientId", ""),
        client_secret=client.get("clientSecret", ""),
        refresh_token=token.get("refreshToken", ""),
        tls_insecure=bool(token.get("tlsInsecure")),
    )


__all__ = [
    "NO_AUTH_TOKEN",
    "ExportedCredentials",
    "PlatformInfoDict",
    "UserProfile",
    "WhoamiInfo",
    "export_credentials",
    "get_active_user",
    "is_no_auth",
    "list_platforms",
    "list_users",
    "save_no_auth_platform",
    "set_active_user",
    "whoami",
]
