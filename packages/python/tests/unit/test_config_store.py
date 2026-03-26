"""Tests for PlatformStore credential storage."""

from pathlib import Path

import pytest

from kweaver.config.store import PlatformStore, _encode_url


def _make_store(tmp_path: Path) -> PlatformStore:
    return PlatformStore(root=tmp_path / ".kweaver")


def test_get_active_returns_none_when_empty(tmp_path: Path):
    store = _make_store(tmp_path)
    assert store.get_active() is None


def test_use_sets_active_platform(tmp_path: Path):
    store = _make_store(tmp_path)
    url = "https://adp.example.com"
    result = store.use(url)
    assert result == url
    assert store.get_active() == url


def test_save_and_load_token(tmp_path: Path):
    store = _make_store(tmp_path)
    url = "https://adp.example.com"
    store.use(url)

    token_data = {
        "baseUrl": url,
        "accessToken": "tok_abc123",
        "expiresAt": "2099-01-01T00:00:00+00:00",
        "refreshToken": "ref_xyz",
    }
    store.save_token(url, token_data)
    loaded = store.load_token(url)
    assert loaded["accessToken"] == "tok_abc123"
    assert loaded["refreshToken"] == "ref_xyz"
    assert loaded["baseUrl"] == url


def test_save_and_load_client(tmp_path: Path):
    store = _make_store(tmp_path)
    url = "https://adp.example.com"
    store.use(url)

    client_data = {
        "baseUrl": url,
        "clientId": "cid_001",
        "clientSecret": "csecret_001",
        "redirectUri": "http://127.0.0.1:9010/callback",
    }
    store.save_client(url, client_data)
    loaded = store.load_client(url)
    assert loaded["clientId"] == "cid_001"
    assert loaded["clientSecret"] == "csecret_001"


def test_list_platforms(tmp_path: Path):
    store = _make_store(tmp_path)
    url1 = "https://adp1.example.com"
    url2 = "https://adp2.example.com"

    store.save_token(url1, {"baseUrl": url1, "accessToken": "t1"})
    store.save_client(url2, {"baseUrl": url2, "clientId": "c2"})

    platforms = store.list_platforms()
    urls = {p.url for p in platforms}
    assert url1 in urls
    assert url2 in urls

    p1 = next(p for p in platforms if p.url == url1)
    assert p1.has_token is True
    assert p1.has_client is False

    p2 = next(p for p in platforms if p.url == url2)
    assert p2.has_token is False
    assert p2.has_client is True


def test_set_alias_and_resolve(tmp_path: Path):
    store = _make_store(tmp_path)
    url = "https://adp.example.com"
    store.set_alias("prod", url)

    resolved = store.resolve("prod")
    assert resolved == url

    # Unknown alias returns input as-is
    assert store.resolve("https://other.com") == "https://other.com"


def test_delete_platform(tmp_path: Path):
    store = _make_store(tmp_path)
    url = "https://adp.example.com"

    store.use(url)
    store.set_alias("prod", url)
    store.save_token(url, {"baseUrl": url, "accessToken": "tok"})
    store.save_client(url, {"baseUrl": url, "clientId": "cid"})

    # Verify it exists before deletion
    assert store.get_active() == url
    assert len(store.list_platforms()) == 1

    store.delete(url)

    # Active platform should be cleared
    assert store.get_active() is None
    # Platform directory should be gone
    assert len(store.list_platforms()) == 0
    # Alias should be removed
    assert store.resolve("prod") == "prod"


def test_save_and_load_business_domain(tmp_path: Path):
    store = _make_store(tmp_path)
    url = "https://adp.example.com"
    store.use(url)
    store.save_business_domain(url, "54308785-4438-43df-9490-a7fd11df5765")
    assert store.load_business_domain(url) == "54308785-4438-43df-9490-a7fd11df5765"
    cfg = store.load_config(url)
    assert cfg.get("businessDomain") == "54308785-4438-43df-9490-a7fd11df5765"


def test_encode_url_is_url_safe_base64():
    encoded = _encode_url("https://adp.example.com:8443/path")
    # URL-safe base64 must not contain +, /, or =
    assert "+" not in encoded
    assert "/" not in encoded
    assert "=" not in encoded
    # Should be non-empty
    assert len(encoded) > 0
    # Should be deterministic
    assert _encode_url("https://adp.example.com:8443/path") == encoded
