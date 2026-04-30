"""Tests for KWEAVER_PROFILE env-var scoping of state.json (Python SDK)."""

from pathlib import Path

import pytest

from kweaver.config.store import PlatformStore


def _make_store(tmp_path: Path) -> PlatformStore:
    return PlatformStore(root=tmp_path / ".kweaver")


def test_profile_invalid_name_raises(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("KWEAVER_PROFILE", "../evil")
    store = _make_store(tmp_path)
    with pytest.raises(ValueError, match="KWEAVER_PROFILE"):
        store.use("https://x.example.com")


def test_profile_safe_name_routes_state_into_profile_dir(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("KWEAVER_PROFILE", "acct-a_1")
    store = _make_store(tmp_path)
    store.use("https://x.example.com")
    assert (tmp_path / ".kweaver" / "profiles" / "acct-a_1" / "state.json").exists()
    assert not (tmp_path / ".kweaver" / "state.json").exists()


def test_profile_unset_uses_root_state(tmp_path: Path, monkeypatch):
    monkeypatch.delenv("KWEAVER_PROFILE", raising=False)
    store = _make_store(tmp_path)
    store.use("https://z.example.com")
    assert (tmp_path / ".kweaver" / "state.json").exists()
    assert not (tmp_path / ".kweaver" / "profiles").exists()


def test_two_profiles_share_tokens_but_isolate_active_state(tmp_path: Path, monkeypatch):
    url_x = "https://x.example.com"
    url_y = "https://y.example.com"
    token_x = {
        "baseUrl": url_x,
        "accessToken": "tok-x",
        "tokenType": "bearer",
        "scope": "openid",
        "obtainedAt": "2026-04-29T00:00:00.000Z",
    }
    token_y = {**token_x, "baseUrl": url_y, "accessToken": "tok-y"}

    monkeypatch.setenv("KWEAVER_PROFILE", "a")
    store_a = _make_store(tmp_path)
    store_a.save_token(url_x, token_x)
    store_a.use(url_x)
    assert store_a.get_active() == url_x

    monkeypatch.setenv("KWEAVER_PROFILE", "b")
    store_b = _make_store(tmp_path)
    assert store_b.get_active() is None
    # Shared platforms/ dir: profile B can still read profile A's token.
    assert store_b.load_token(url_x)["accessToken"] == "tok-x"

    store_b.save_token(url_y, token_y)
    store_b.use(url_y)
    assert store_b.get_active() == url_y

    monkeypatch.setenv("KWEAVER_PROFILE", "a")
    store_a_reload = _make_store(tmp_path)
    assert store_a_reload.get_active() == url_x

    assert (tmp_path / ".kweaver" / "profiles" / "a" / "state.json").exists()
    assert (tmp_path / ".kweaver" / "profiles" / "b" / "state.json").exists()
    assert not (tmp_path / ".kweaver" / "state.json").exists()
