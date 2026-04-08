"""Multi-platform credential storage (~/.kweaver/), compatible with kweaverc.

Supports multiple user accounts per platform URL. User-scoped files
(token.json, config.json, context-loader.json) are stored under
``platforms/<encoded>/users/<userId>/``, while client.json stays at the
platform root.  Legacy flat layouts are auto-migrated on first access.
"""

from __future__ import annotations

import base64
import json
import os
import shutil
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


_DEFAULT_ROOT = Path.home() / ".kweaver"

_USER_SCOPED_FILES = {"token.json", "config.json", "context-loader.json"}


def _encode_url(url: str) -> str:
    """URL-safe base64 encode, matching kweaverc."""
    encoded = base64.b64encode(url.encode()).decode()
    return encoded.replace("+", "-").replace("/", "_").rstrip("=")


def _read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def _write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if sys.platform != "win32":
        os.chmod(path.parent, 0o700)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8", newline="\n")
    if sys.platform != "win32":
        os.chmod(path, 0o600)


def _decode_jwt_sub(jwt: str) -> str | None:
    """Extract ``sub`` claim from a JWT without signature verification."""
    parts = jwt.split(".")
    if len(parts) != 3:
        return None
    try:
        segment = parts[1]
        padded = segment + "=" * (-len(segment) % 4)
        safe = padded.replace("-", "+").replace("_", "/")
        payload = json.loads(base64.b64decode(safe))
        sub = payload.get("sub")
        return sub if isinstance(sub, str) else None
    except Exception:
        return None


def _extract_user_id(token_data: dict[str, Any]) -> str:
    """Extract userId from token data (try idToken, then accessToken, fallback 'default')."""
    id_token = token_data.get("idToken", "")
    if id_token:
        sub = _decode_jwt_sub(id_token)
        if sub:
            return sub
    access_token = token_data.get("accessToken", "")
    if access_token:
        sub = _decode_jwt_sub(access_token)
        if sub:
            return sub
    return "default"


@dataclass
class PlatformInfo:
    url: str
    alias: str | None = None
    has_token: bool = False
    has_client: bool = False
    user_id: str | None = None
    display_name: str | None = None


class PlatformStore:
    """Manage multi-platform KWeaver credentials in ~/.kweaver/."""

    def __init__(self, root: Path | None = None) -> None:
        self._root = root or _DEFAULT_ROOT
        self._migrate_all_to_user_scoped()

    def _state_path(self) -> Path:
        return self._root / "state.json"

    def _platform_dir(self, url: str) -> Path:
        return self._root / "platforms" / _encode_url(url)

    def _users_dir(self, url: str) -> Path:
        return self._platform_dir(url) / "users"

    def _user_dir(self, url: str, user_id: str) -> Path:
        return self._users_dir(url) / user_id

    def _read_state(self) -> dict[str, Any]:
        return _read_json(self._state_path())

    def _write_state(self, data: dict[str, Any]) -> None:
        _write_json(self._state_path(), data)

    # ------------------------------------------------------------------
    # File routing: user-scoped vs platform-level
    # ------------------------------------------------------------------

    def _resolve_file(self, url: str, filename: str) -> Path:
        """Resolve file path with auto-migration fallback for user-scoped files."""
        if filename not in _USER_SCOPED_FILES:
            return self._platform_dir(url) / filename

        uid = self._get_active_user_raw(url)
        if uid:
            user_path = self._user_dir(url, uid) / filename
            if user_path.exists():
                return user_path

        legacy_path = self._platform_dir(url) / filename
        if legacy_path.exists():
            legacy_token = self._platform_dir(url) / "token.json"
            if legacy_token.exists():
                self._migrate_platform_to_user_scoped(url)
                migrated = self._get_active_user_raw(url)
                if migrated:
                    mp = self._user_dir(url, migrated) / filename
                    if mp.exists():
                        return mp
            return legacy_path

        if uid:
            return self._user_dir(url, uid) / filename
        return legacy_path

    # ------------------------------------------------------------------
    # Migration
    # ------------------------------------------------------------------

    def _migrate_platform_to_user_scoped(self, url: str) -> None:
        """Migrate a single platform from flat layout to users/<userId>/."""
        pdir = self._platform_dir(url)
        root_token = pdir / "token.json"
        users_dir = self._users_dir(url)

        if not root_token.exists() or users_dir.exists():
            return

        token_data = _read_json(root_token)
        if not token_data:
            return

        uid = _extract_user_id(token_data)
        udir = self._user_dir(url, uid)
        udir.mkdir(parents=True, exist_ok=True)
        if sys.platform != "win32":
            os.chmod(udir, 0o700)

        root_token.rename(udir / "token.json")

        for fname in ("config.json", "context-loader.json"):
            src = pdir / fname
            if src.exists():
                src.rename(udir / fname)

        resolved_url = token_data.get("baseUrl", url)
        state = self._read_state()
        au = dict(state.get("activeUsers") or {})
        au[resolved_url] = uid
        state["activeUsers"] = au
        self._write_state(state)

    def _migrate_all_to_user_scoped(self) -> None:
        """Scan all platform dirs and migrate any flat layouts."""
        platforms_dir = self._root / "platforms"
        if not platforms_dir.exists():
            return
        for entry in platforms_dir.iterdir():
            if not entry.is_dir():
                continue
            root_token = entry / "token.json"
            users_dir = entry / "users"
            if not root_token.exists() or users_dir.exists():
                continue
            token_data = _read_json(root_token)
            base_url = token_data.get("baseUrl")
            if not base_url:
                continue
            self._migrate_platform_to_user_scoped(base_url)

    # ------------------------------------------------------------------
    # Active user management
    # ------------------------------------------------------------------

    def _get_active_user_raw(self, url: str) -> str | None:
        """Read active user without triggering migration (avoids recursion)."""
        state = _read_json(self._state_path()) if self._state_path().exists() else {}
        uid = (state.get("activeUsers") or {}).get(url)
        if uid:
            return uid
        users_dir = self._users_dir(url)
        if not users_dir.exists():
            return None
        for child in sorted(users_dir.iterdir()):
            if child.is_dir() and (child / "token.json").exists():
                return child.name
        return None

    def get_active_user(self, url: str) -> str | None:
        """Get the active userId for a platform."""
        return self._get_active_user_raw(url)

    def set_active_user(self, url: str, user_id: str) -> None:
        """Set the active userId for a platform."""
        state = self._read_state()
        au = dict(state.get("activeUsers") or {})
        au[url] = user_id
        state["activeUsers"] = au
        self._write_state(state)

    def list_users(self, url: str) -> list[str]:
        """List all user IDs stored under a platform."""
        users_dir = self._users_dir(url)
        if not users_dir.exists():
            return []
        return sorted(e.name for e in users_dir.iterdir() if e.is_dir())

    def list_user_profiles(self, url: str) -> list[dict[str, str | None]]:
        """List user profiles enriched with display names.

        Returns list of ``{"userId": ..., "username": ..., "email": ...}``.
        ``username`` is resolved from token ``displayName`` first, then id_token claims.
        """
        import base64 as _b64
        import json as _json

        user_ids = self.list_users(url)
        profiles: list[dict[str, str | None]] = []
        for uid in user_ids:
            tok = self.load_user_token(url, uid)
            username: str | None = tok.get("displayName") if tok else None
            email: str | None = None

            if tok and tok.get("idToken"):
                try:
                    parts = tok["idToken"].split(".")
                    if len(parts) >= 2:
                        padded = parts[1] + "=" * (-len(parts[1]) % 4)
                        payload = _json.loads(_b64.urlsafe_b64decode(padded))
                        if not username:
                            username = payload.get("preferred_username") or payload.get("name")
                        email = payload.get("email")
                except Exception:
                    pass

            profiles.append({"userId": uid, "username": username, "email": email})
        return profiles

    def delete_user(self, url: str, user_id: str) -> None:
        """Delete a single user's profile directory."""
        udir = self._user_dir(url, user_id)
        if udir.exists():
            shutil.rmtree(udir)

        state = self._read_state()
        au = dict(state.get("activeUsers") or {})
        if au.get(url) == user_id:
            remaining = self.list_users(url)
            if remaining:
                au[url] = remaining[0]
            else:
                au.pop(url, None)
            if au:
                state["activeUsers"] = au
            else:
                state.pop("activeUsers", None)
            self._write_state(state)

    # ------------------------------------------------------------------
    # Platform / alias management
    # ------------------------------------------------------------------

    def get_active(self) -> str | None:
        """Return the currently active platform URL, or None."""
        state = self._read_state()
        return state.get("currentPlatform")

    def resolve(self, url_or_alias: str) -> str:
        """Resolve an alias to a URL, or return the input as-is."""
        state = self._read_state()
        aliases = state.get("aliases", {})
        key = url_or_alias.strip().lower()
        if key in {k.lower(): k for k in aliases}:
            for k, v in aliases.items():
                if k.lower() == key:
                    return v
        return url_or_alias.strip()

    def use(self, url_or_alias: str) -> str:
        """Set the active platform. Returns resolved URL."""
        url = self.resolve(url_or_alias)
        state = self._read_state()
        state["currentPlatform"] = url
        self._write_state(state)
        return url

    def set_alias(self, alias: str, url: str) -> None:
        state = self._read_state()
        aliases = state.get("aliases", {})
        aliases[alias] = url
        state["aliases"] = aliases
        self._write_state(state)

    def list_platforms(self) -> list[PlatformInfo]:
        """List all saved platforms."""
        state = self._read_state()
        aliases = state.get("aliases", {})
        url_to_alias: dict[str, str] = {}
        for a, u in aliases.items():
            url_to_alias[u] = a

        platforms_dir = self._root / "platforms"
        result: list[PlatformInfo] = []
        if not platforms_dir.exists():
            return result

        for entry in sorted(platforms_dir.iterdir()):
            if not entry.is_dir():
                continue

            url: str | None = None

            # Check users/ subdirectory first (new layout)
            users_dir = entry / "users"
            if users_dir.exists():
                for user_entry in sorted(users_dir.iterdir()):
                    if user_entry.is_dir():
                        td = _read_json(user_entry / "token.json")
                        if td.get("baseUrl"):
                            url = td["baseUrl"]
                            break

            # Fallback: legacy flat layout
            if not url:
                for fname in ("token.json", "client.json"):
                    p = entry / fname
                    if p.exists():
                        data = _read_json(p)
                        url = data.get("baseUrl")
                        if url:
                            break

            if not url:
                continue

            has_token = self._resolve_file(url, "token.json").exists()
            active_user = self.get_active_user(url)
            display_name: str | None = None
            if active_user:
                tok = self.load_user_token(url, active_user)
                if tok:
                    display_name = tok.get("displayName") or None

            result.append(PlatformInfo(
                url=url,
                alias=url_to_alias.get(url),
                has_token=has_token,
                has_client=(entry / "client.json").exists(),
                user_id=active_user,
                display_name=display_name,
            ))
        return result

    def delete(self, url_or_alias: str) -> None:
        """Delete a platform's stored credentials."""
        url = self.resolve(url_or_alias)
        d = self._platform_dir(url)
        if d.exists():
            shutil.rmtree(d)
        state = self._read_state()
        if state.get("currentPlatform") == url:
            state.pop("currentPlatform", None)
        aliases = state.get("aliases", {})
        to_remove = [k for k, v in aliases.items() if v == url]
        for k in to_remove:
            del aliases[k]
        if aliases:
            state["aliases"] = aliases
        elif "aliases" in state:
            del state["aliases"]
        au = dict(state.get("activeUsers") or {})
        au.pop(url, None)
        if au:
            state["activeUsers"] = au
        else:
            state.pop("activeUsers", None)
        self._write_state(state)

    # ------------------------------------------------------------------
    # Client config (platform-level — shared across users)
    # ------------------------------------------------------------------

    def load_client(self, url: str | None = None) -> dict[str, Any]:
        url = url or self.get_active()
        if not url:
            raise RuntimeError("No active platform. Run 'kweaver auth login' first.")
        return _read_json(self._platform_dir(url) / "client.json")

    def save_client(self, url: str, data: dict[str, Any]) -> None:
        _write_json(self._platform_dir(url) / "client.json", data)

    def delete_client(self, url: str) -> None:
        path = self._platform_dir(url) / "client.json"
        path.unlink(missing_ok=True)

    # ------------------------------------------------------------------
    # Token (user-scoped)
    # ------------------------------------------------------------------

    def load_token(self, url: str | None = None) -> dict[str, Any]:
        url = url or self.get_active()
        if not url:
            raise RuntimeError("No active platform. Run 'kweaver auth login' first.")
        return _read_json(self._resolve_file(url, "token.json"))

    def load_user_token(self, url: str, user_id: str) -> dict[str, Any]:
        """Load token.json for a specific user (by userId)."""
        return _read_json(self._user_dir(url, user_id) / "token.json")

    def save_token(self, url: str, data: dict[str, Any], user_id: str | None = None) -> None:
        """Save token under the user's profile directory.

        Extracts userId from token JWT claims if *user_id* is not provided.
        """
        uid = user_id or _extract_user_id(data)
        udir = self._user_dir(url, uid)
        udir.mkdir(parents=True, exist_ok=True)
        if sys.platform != "win32":
            os.chmod(udir, 0o700)
        _write_json(udir / "token.json", data)
        self.set_active_user(url, uid)

    # ------------------------------------------------------------------
    # Platform config — businessDomain etc. (user-scoped)
    # ------------------------------------------------------------------

    def load_config(self, url: str | None = None) -> dict[str, Any]:
        """Load config.json for a platform (e.g. businessDomain)."""
        url = url or self.get_active()
        if not url:
            return {}
        return _read_json(self._resolve_file(url, "config.json"))

    def save_config(self, url: str, data: dict[str, Any]) -> None:
        uid = self.get_active_user(url)
        if uid:
            udir = self._user_dir(url, uid)
            udir.mkdir(parents=True, exist_ok=True)
            _write_json(udir / "config.json", data)
        else:
            _write_json(self._platform_dir(url) / "config.json", data)

    def load_business_domain(self, url: str | None = None) -> str | None:
        """Return saved business domain id if set."""
        cfg = self.load_config(url)
        bd = cfg.get("businessDomain")
        return bd if isinstance(bd, str) and bd else None

    def save_business_domain(self, url: str, business_domain: str) -> None:
        """Persist default business domain for the platform."""
        existing = self.load_config(url)
        existing["businessDomain"] = business_domain
        self.save_config(url, existing)

    def resolve_business_domain(self, url: str | None = None) -> str:
        """Resolve business domain: env > config.json > bd_public."""
        from_env = os.environ.get("KWEAVER_BUSINESS_DOMAIN")
        if from_env:
            return from_env
        target = url or self.get_active()
        if target:
            from_cfg = self.load_business_domain(target)
            if from_cfg:
                return from_cfg
        return "bd_public"

    # ------------------------------------------------------------------
    # Context Loader config (user-scoped)
    # ------------------------------------------------------------------

    def load_context_loader_config(self, url: str | None = None) -> dict[str, Any]:
        """Load context-loader.json for a platform. Compatible with kweaverc format."""
        url = url or self.get_active()
        if not url:
            return {}
        return _read_json(self._resolve_file(url, "context-loader.json"))

    def save_context_loader_config(self, url: str, config: dict[str, Any]) -> None:
        """Save context-loader.json for a platform."""
        uid = self.get_active_user(url)
        if uid:
            udir = self._user_dir(url, uid)
            udir.mkdir(parents=True, exist_ok=True)
            _write_json(udir / "context-loader.json", config)
        else:
            _write_json(self._platform_dir(url) / "context-loader.json", config)

    def add_context_loader_entry(self, url: str, name: str, kn_id: str) -> None:
        """Add or update a named context-loader entry for a platform."""
        config = self.load_context_loader_config(url) or {}
        configs: list[dict[str, Any]] = config.get("configs", [])
        idx = next((i for i, c in enumerate(configs) if c.get("name") == name), -1)
        entry = {"name": name, "knId": kn_id}
        if idx >= 0:
            configs[idx] = entry
        else:
            configs.append(entry)
        current = config.get("current") or name
        has_current = any(c.get("name") == current for c in configs)
        self.save_context_loader_config(url, {
            "configs": configs,
            "current": current if has_current else name,
        })

    def set_current_context_loader(self, url: str, name: str) -> None:
        """Set the active context-loader entry by name."""
        config = self.load_context_loader_config(url)
        if not config or not config.get("configs"):
            raise RuntimeError(
                "Context-loader is not configured. Run: kweaver context-loader config set --kn-id <id>"
            )
        if not any(c.get("name") == name for c in config["configs"]):
            raise RuntimeError(
                f"No context-loader config named '{name}'. Use 'config list' to see available configs."
            )
        config["current"] = name
        self.save_context_loader_config(url, config)

    def remove_context_loader_entry(self, url: str, name: str) -> None:
        """Remove a named context-loader entry."""
        config = self.load_context_loader_config(url)
        if not config:
            return
        new_configs = [c for c in config.get("configs", []) if c.get("name") != name]
        if not new_configs:
            p = self._resolve_file(url, "context-loader.json")
            if p.exists():
                p.unlink()
            return
        new_current = config.get("current", "")
        if new_current == name:
            new_current = new_configs[0]["name"]
        self.save_context_loader_config(url, {"configs": new_configs, "current": new_current})

    def get_current_context_loader_kn(
        self, url: str | None = None
    ) -> tuple[str, str] | None:
        """Return (mcp_url, kn_id) for the active context-loader entry, or None."""
        from kweaver.resources.context_loader import _build_mcp_url
        url = url or self.get_active()
        if not url:
            return None
        config = self.load_context_loader_config(url)
        if not config:
            return None
        current_name = config.get("current", "")
        entry = next(
            (c for c in config.get("configs", []) if c.get("name") == current_name),
            None,
        )
        if not entry or not entry.get("knId"):
            return None
        return _build_mcp_url(url), entry["knId"]
