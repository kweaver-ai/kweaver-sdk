"""Business domain list API — compatible with kweaverc config.json."""

from __future__ import annotations

import os
import sys
from typing import Any

import httpx

from kweaver._auth import _env_tls_insecure
from kweaver.config.store import PlatformStore


def fetch_business_domains(
    base_url: str,
    access_token: str,
    *,
    verify: bool = True,
) -> list[dict[str, Any]]:
    """GET /api/business-system/v1/business-domain (no x-business-domain header)."""
    base = base_url.rstrip("/")
    url = f"{base}/api/business-system/v1/business-domain"
    headers = {
        "accept": "application/json, text/plain, */*",
        "authorization": f"Bearer {access_token}",
        "token": access_token,
    }
    with httpx.Client(verify=verify, timeout=30.0) as client:
        r = client.get(url, headers=headers)
        r.raise_for_status()
        data = r.json()
    if not isinstance(data, list):
        raise ValueError("Business domain list response was not a JSON array")
    return data


def auto_select_business_domain(
    store: PlatformStore,
    platform_url: str,
    access_token: str,
    *,
    tls_insecure: bool = False,
) -> str:
    """Pick and persist default business domain after login when none is configured."""
    if os.environ.get("KWEAVER_BUSINESS_DOMAIN"):
        return os.environ["KWEAVER_BUSINESS_DOMAIN"]
    existing = store.load_business_domain(platform_url)
    if existing:
        return existing
    verify = not tls_insecure and not _env_tls_insecure()
    try:
        rows = fetch_business_domains(platform_url, access_token, verify=verify)
        if any(isinstance(r, dict) and r.get("id") == "bd_public" for r in rows):
            selected = "bd_public"
        elif rows and isinstance(rows[0], dict) and rows[0].get("id"):
            selected = str(rows[0]["id"])
        else:
            return "bd_public"
        store.save_business_domain(platform_url, selected)
        return selected
    except Exception as e:
        print(
            f"Could not fetch business domains: {e}. Using bd_public.",
            file=sys.stderr,
        )
        return "bd_public"
