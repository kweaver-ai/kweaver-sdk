"""Multi-platform credential storage (~/.kweaver/), compatible with kweaverc."""

from __future__ import annotations

import base64
import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


_DEFAULT_ROOT = Path.home() / ".kweaver"


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
    os.chmod(path.parent, 0o700)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    os.chmod(path, 0o600)


@dataclass
class PlatformInfo:
    url: str
    alias: str | None = None
    has_token: bool = False
    has_client: bool = False


class PlatformStore:
    """Manage multi-platform ADP credentials in ~/.kweaver/."""

    def __init__(self, root: Path | None = None) -> None:
        self._root = root or _DEFAULT_ROOT

    def _state_path(self) -> Path:
        return self._root / "state.json"

    def _platform_dir(self, url: str) -> Path:
        return self._root / "platforms" / _encode_url(url)

    def _read_state(self) -> dict[str, Any]:
        return _read_json(self._state_path())

    def _write_state(self, data: dict[str, Any]) -> None:
        _write_json(self._state_path(), data)

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
        active = state.get("currentPlatform")
        aliases = state.get("aliases", {})
        url_to_alias: dict[str, str] = {}
        for a, u in aliases.items():
            url_to_alias[u] = a

        platforms_dir = self._root / "platforms"
        result = []
        if not platforms_dir.exists():
            return result

        for entry in sorted(platforms_dir.iterdir()):
            if not entry.is_dir():
                continue
            token_path = entry / "token.json"
            client_path = entry / "client.json"
            url = None
            for p in [token_path, client_path]:
                if p.exists():
                    data = _read_json(p)
                    url = data.get("baseUrl")
                    if url:
                        break
            if not url:
                continue
            result.append(PlatformInfo(
                url=url,
                alias=url_to_alias.get(url),
                has_token=token_path.exists(),
                has_client=client_path.exists(),
            ))
        return result

    def delete(self, url_or_alias: str) -> None:
        """Delete a platform's stored credentials."""
        import shutil
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
        self._write_state(state)

    # -- Client config --

    def load_client(self, url: str | None = None) -> dict[str, Any]:
        url = url or self.get_active()
        if not url:
            raise RuntimeError("No active platform. Run 'kweaver auth login' first.")
        return _read_json(self._platform_dir(url) / "client.json")

    def save_client(self, url: str, data: dict[str, Any]) -> None:
        _write_json(self._platform_dir(url) / "client.json", data)

    # -- Token --

    def load_token(self, url: str | None = None) -> dict[str, Any]:
        url = url or self.get_active()
        if not url:
            raise RuntimeError("No active platform. Run 'kweaver auth login' first.")
        return _read_json(self._platform_dir(url) / "token.json")

    def save_token(self, url: str, data: dict[str, Any]) -> None:
        _write_json(self._platform_dir(url) / "token.json", data)
