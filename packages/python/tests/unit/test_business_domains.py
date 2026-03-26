"""Tests for business domain API helpers."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from kweaver.business_domains import auto_select_business_domain, fetch_business_domains
from kweaver.config.store import PlatformStore


def _make_store(tmp_path: Path) -> PlatformStore:
    return PlatformStore(root=tmp_path / ".kweaver")


def test_fetch_business_domains_parses_array():
    mock_resp = MagicMock()
    mock_resp.raise_for_status = MagicMock()
    mock_resp.json.return_value = [{"id": "bd-1", "name": "n1"}]
    mock_client_inst = MagicMock()
    mock_client_inst.get.return_value = mock_resp
    mock_cm = MagicMock()
    mock_cm.__enter__.return_value = mock_client_inst
    mock_cm.__exit__.return_value = None

    with patch("kweaver.business_domains.httpx.Client", return_value=mock_cm):
        rows = fetch_business_domains("https://dip.example.com", "tok", verify=True)
    assert len(rows) == 1
    assert rows[0]["id"] == "bd-1"
    assert "/api/business-system/v1/business-domain" in mock_client_inst.get.call_args[0][0]


def test_auto_select_prefers_bd_public(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("KWEAVER_BUSINESS_DOMAIN", raising=False)
    store = _make_store(tmp_path)
    url = "https://dip.example.com"
    store.use(url)

    with patch("kweaver.business_domains.fetch_business_domains") as fetch:
        fetch.return_value = [{"id": "other"}, {"id": "bd_public", "name": "pub"}]
        picked = auto_select_business_domain(store, url, "tok", tls_insecure=False)
    assert picked == "bd_public"
    assert store.load_business_domain(url) == "bd_public"


def test_auto_select_skips_when_env_set(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("KWEAVER_BUSINESS_DOMAIN", "from-env")
    store = _make_store(tmp_path)
    url = "https://dip.example.com"
    store.use(url)

    with patch("kweaver.business_domains.fetch_business_domains") as fetch:
        picked = auto_select_business_domain(store, url, "tok", tls_insecure=False)
    assert picked == "from-env"
    fetch.assert_not_called()


def test_resolve_business_domain_chain(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("KWEAVER_BUSINESS_DOMAIN", raising=False)
    store = _make_store(tmp_path)
    url = "https://dip.example.com"
    store.use(url)
    assert store.resolve_business_domain(url) == "bd_public"

    store.save_business_domain(url, "uuid-1")
    assert store.resolve_business_domain(url) == "uuid-1"

    monkeypatch.setenv("KWEAVER_BUSINESS_DOMAIN", "env-bd")
    assert store.resolve_business_domain(url) == "env-bd"
