"""No-auth sentinel shared with the TypeScript CLI (~/.kweaver/ token.json)."""

from __future__ import annotations

NO_AUTH_TOKEN = "__NO_AUTH__"


def is_no_auth(access_token: str) -> bool:
    return access_token == NO_AUTH_TOKEN
