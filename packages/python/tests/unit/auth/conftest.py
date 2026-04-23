"""Shared fixtures for auth/* tests."""
from __future__ import annotations

from pathlib import Path

import pytest


@pytest.fixture
def tmp_kweaver_home(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Isolated ~/.kweaver/ for each test."""
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: home))
    return home
