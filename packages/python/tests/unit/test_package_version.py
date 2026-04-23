"""Monorepo package versions stay aligned (Python pyproject, TS package.json, editable install).

After changing ``version`` in ``pyproject.toml``, reinstall the editable package so
``importlib.metadata.version("kweaver-sdk")`` matches (e.g. ``pip install -e packages/python``).
"""
from __future__ import annotations

import importlib.metadata
import json
import re
from pathlib import Path


def _pyproject_version(pyproject: Path) -> str:
    text = pyproject.read_text(encoding="utf-8")
    m = re.search(r'^version\s*=\s*"([^"]+)"', text, re.MULTILINE)
    assert m, "version = \"…\" not found in pyproject.toml"
    return m.group(1)


def test_python_ts_and_installed_versions_match() -> None:
    pkg_python = Path(__file__).resolve().parents[2]
    py_ver = _pyproject_version(pkg_python / "pyproject.toml")
    ts_path = pkg_python.parent / "typescript" / "package.json"
    ts_ver = json.loads(ts_path.read_text(encoding="utf-8"))["version"]
    assert py_ver == ts_ver
    installed = importlib.metadata.version("kweaver-sdk")
    assert installed == py_ver, (
        f"Installed kweaver-sdk is {installed!r} but pyproject has {py_ver!r}; "
        "run: pip install -e packages/python"
    )
