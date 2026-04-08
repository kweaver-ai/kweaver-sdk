"""Tests for PlatformStore credential storage."""

import base64
import json
from pathlib import Path

import pytest

from kweaver.config.store import PlatformStore, _encode_url, _extract_user_id


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


# ---------------------------------------------------------------------------
# Multi-account support tests
# ---------------------------------------------------------------------------


def _make_jwt(payload: dict) -> str:
    """Build a fake JWT (no signature verification)."""
    header = base64.urlsafe_b64encode(json.dumps({"alg": "RS256", "typ": "JWT"}).encode()).decode().rstrip("=")
    body = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
    return f"{header}.{body}.fake-sig"


def test_extract_user_id_from_id_token():
    token_data = {
        "idToken": _make_jwt({"sub": "alice"}),
        "accessToken": "opaque",
    }
    assert _extract_user_id(token_data) == "alice"


def test_extract_user_id_fallback_access_token():
    token_data = {
        "accessToken": _make_jwt({"sub": "bob"}),
    }
    assert _extract_user_id(token_data) == "bob"


def test_extract_user_id_fallback_default():
    token_data = {"accessToken": "opaque-no-jwt"}
    assert _extract_user_id(token_data) == "default"


def test_save_token_routes_to_user_dir(tmp_path: Path):
    store = _make_store(tmp_path)
    url = "https://multi.example.com"
    id_token = _make_jwt({"sub": "user-abc"})
    store.save_token(url, {
        "baseUrl": url,
        "accessToken": "at-1",
        "idToken": id_token,
    })
    assert store.get_active_user(url) == "user-abc"
    loaded = store.load_token(url)
    assert loaded["accessToken"] == "at-1"


def test_multiple_users_on_same_platform(tmp_path: Path):
    store = _make_store(tmp_path)
    url = "https://multi.example.com"

    store.save_token(url, {
        "baseUrl": url, "accessToken": "at-alice",
        "idToken": _make_jwt({"sub": "alice"}),
    })
    store.save_token(url, {
        "baseUrl": url, "accessToken": "at-bob",
        "idToken": _make_jwt({"sub": "bob"}),
    })

    users = store.list_users(url)
    assert "alice" in users
    assert "bob" in users
    assert store.get_active_user(url) == "bob"
    assert store.load_token(url)["accessToken"] == "at-bob"

    store.set_active_user(url, "alice")
    assert store.get_active_user(url) == "alice"
    assert store.load_token(url)["accessToken"] == "at-alice"


def test_delete_user(tmp_path: Path):
    store = _make_store(tmp_path)
    url = "https://del.example.com"

    store.save_token(url, {
        "baseUrl": url, "accessToken": "at-1",
        "idToken": _make_jwt({"sub": "user-1"}),
    })
    store.save_token(url, {
        "baseUrl": url, "accessToken": "at-2",
        "idToken": _make_jwt({"sub": "user-2"}),
    })

    assert store.get_active_user(url) == "user-2"
    store.delete_user(url, "user-2")
    assert store.list_users(url) == ["user-1"]
    assert store.get_active_user(url) == "user-1"


def test_migration_flat_to_user_scoped(tmp_path: Path):
    root = tmp_path / ".kweaver"
    url = "https://migrate.example.com"
    encoded = _encode_url(url)
    plat_dir = root / "platforms" / encoded
    plat_dir.mkdir(parents=True)

    id_token = _make_jwt({"sub": "migrated-user"})
    (plat_dir / "token.json").write_text(json.dumps({
        "baseUrl": url, "accessToken": "at-m", "idToken": id_token,
    }))
    (plat_dir / "config.json").write_text(json.dumps({"businessDomain": "bd_test"}))
    (plat_dir / "client.json").write_text(json.dumps({
        "baseUrl": url, "clientId": "cid", "clientSecret": "csec",
    }))

    store = PlatformStore(root=root)

    assert store.get_active_user(url) == "migrated-user"
    assert store.load_token(url)["accessToken"] == "at-m"
    # client.json stays at platform root
    assert (plat_dir / "client.json").exists()
    # token.json moved to users/
    assert not (plat_dir / "token.json").exists()
    assert (plat_dir / "users" / "migrated-user" / "token.json").exists()
    assert (plat_dir / "users" / "migrated-user" / "config.json").exists()


def test_list_platforms_includes_user_id(tmp_path: Path):
    store = _make_store(tmp_path)
    url = "https://platform.example.com"
    store.save_token(url, {
        "baseUrl": url, "accessToken": "at-1",
        "idToken": _make_jwt({"sub": "the-user"}),
    })
    platforms = store.list_platforms()
    assert len(platforms) == 1
    assert platforms[0].user_id == "the-user"


def test_display_name_persisted_and_surfaced(tmp_path: Path):
    store = _make_store(tmp_path)
    url = "https://display.example.com"
    store.save_token(url, {
        "baseUrl": url, "accessToken": "at-display",
        "idToken": _make_jwt({"sub": "uid-42"}),
        "displayName": "alice",
    })

    platforms = store.list_platforms()
    assert len(platforms) == 1
    assert platforms[0].user_id == "uid-42"
    assert platforms[0].display_name == "alice"

    profiles = store.list_user_profiles(url)
    assert len(profiles) == 1
    assert profiles[0]["userId"] == "uid-42"
    assert profiles[0]["username"] == "alice"

    tok = store.load_user_token(url, "uid-42")
    assert tok["displayName"] == "alice"


def test_delete_client_removes_cached_file(tmp_path: Path):
    store = _make_store(tmp_path)
    url = "https://del-client.example.com"
    store.save_client(url, {"clientId": "stale-cid", "clientSecret": "stale-secret"})
    assert store.load_client(url).get("clientId") == "stale-cid"

    store.delete_client(url)
    assert store.load_client(url) == {}

    # Idempotent
    store.delete_client(url)


def test_list_user_profiles_falls_back_to_id_token_claims(tmp_path: Path):
    store = _make_store(tmp_path)
    url = "https://fallback.example.com"
    store.save_token(url, {
        "baseUrl": url, "accessToken": "at-fb",
        "idToken": _make_jwt({"sub": "uid-99", "preferred_username": "bob", "email": "bob@example.com"}),
    })

    profiles = store.list_user_profiles(url)
    assert len(profiles) == 1
    assert profiles[0]["username"] == "bob"
    assert profiles[0]["email"] == "bob@example.com"
