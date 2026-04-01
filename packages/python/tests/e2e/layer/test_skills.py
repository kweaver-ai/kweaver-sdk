"""E2E: Skill registry and progressive read operations."""

from __future__ import annotations

import io
import zipfile
from typing import Any

import pytest

from kweaver import KWeaverClient
from kweaver._errors import NotFoundError

pytestmark = pytest.mark.e2e

_EMBEDDED_SKILL_MD = f"""---
name: brand-guidelines
description: Applies Anthropic's official brand colors and typography to any sort of artifact that may benefit from having Anthropic's look-and-feel. Use it when brand colors or style guidelines, visual formatting, or company design standards apply.
license: Complete terms in LICENSE.txt
---

# Anthropic Brand Styling

## Overview

To access Anthropic's official brand identity and style resources, use this skill.

**Keywords**: branding, corporate identity, visual identity, post-processing, styling, brand colors, typography, Anthropic brand, visual formatting, visual design

## Brand Guidelines

### Colors

**Main Colors:**

- Dark: `#141413` - Primary text and dark backgrounds
- Light: `#faf9f5` - Light backgrounds and text on dark
- Mid Gray: `#b0aea5` - Secondary elements
- Light Gray: `#e8e6dc` - Subtle backgrounds

**Accent Colors:**

- Orange: `#d97757` - Primary accent
- Blue: `#6a9bcc` - Secondary accent
- Green: `#788c5d` - Tertiary accent

### Typography

- **Headings**: Poppins (with Arial fallback)
- **Body Text**: Lora (with Georgia fallback)
- **Note**: Fonts should be pre-installed in your environment for best results

## Features

### Smart Font Application

- Applies Poppins font to headings (24pt and larger)
- Applies Lora font to body text
- Automatically falls back to Arial/Georgia if custom fonts unavailable
- Preserves readability across all systems

### Text Styling

- Headings (24pt+): Poppins font
- Body text: Lora font
- Smart color selection based on background
- Preserves text hierarchy and formatting

### Shape and Accent Colors

- Non-text shapes use accent colors
- Cycles through orange, blue, and green accents
- Maintains visual interest while staying on-brand

## Technical Details

### Font Management

- Uses system-installed Poppins and Lora fonts when available
- Provides automatic fallback to Arial (headings) and Georgia (body)
- No font installation required - works with existing system fonts
- For best results, pre-install Poppins and Lora fonts in your environment

### Color Application

- Uses RGB color values for precise brand matching
- Applied via python-pptx's RGBColor class
- Maintains color fidelity across different systems
"""

_EXPECTED_SKILL_NAME = "brand-guidelines"
_EXPECTED_SKILL_HEADING = "Anthropic Brand Styling"
_EXPECTED_SKILL_SECTION = "Brand Guidelines"


def _extract_items(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if isinstance(payload, dict):
        items = payload.get("data")
        if isinstance(items, list):
            return items
    return []


def _extract_skill_id(skill: dict[str, Any]) -> str | None:
    value = skill.get("skill_id") or skill.get("id")
    return value if isinstance(value, str) and value else None


@pytest.fixture(scope="module")
def registered_skill_zip() -> tuple[str, bytes, str]:
    """Build one temporary skill ZIP payload for E2E registration."""
    skill_md = _EMBEDDED_SKILL_MD
    guide_md = "\n".join(
        [
            "# Guide",
            "",
            "This file is bundled for read_file verification.",
        ]
    )
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("SKILL.md", skill_md)
        zf.writestr("references/guide.md", guide_md)
    return "brand-guidelines", buf.getvalue(), skill_md


@pytest.fixture(scope="module")
def registered_skill(kweaver_client: KWeaverClient, registered_skill_zip) -> dict[str, Any]:
    """Register one temporary skill and delete it after the module finishes."""
    _, archive, skill_md = registered_skill_zip
    result = kweaver_client.skills.register_zip(
        "sdk-e2e-skill.zip",
        archive,
    )
    skill_id = _extract_skill_id(result)
    assert skill_id, f"register_zip did not return a skill id: {result!r}"
    detail = kweaver_client.skills.get(skill_id)
    detail["_expected_name"] = _EXPECTED_SKILL_NAME
    detail["_expected_heading"] = _EXPECTED_SKILL_HEADING
    detail["_expected_section"] = _EXPECTED_SKILL_SECTION
    detail["_expected_skill_md"] = skill_md
    yield detail
    try:
        kweaver_client.skills.delete(skill_id)
    except Exception:
        pass


@pytest.mark.destructive
def test_skills_register_zip(registered_skill):
    """Registering a ZIP skill should return detail with a stable skill id."""
    skill_id = _extract_skill_id(registered_skill)
    assert skill_id
    assert isinstance(registered_skill, dict)


@pytest.mark.destructive
def test_skills_list(kweaver_client: KWeaverClient, registered_skill):
    """List should include the newly registered skill."""
    result = kweaver_client.skills.list()
    items = _extract_items(result)
    skill_id = _extract_skill_id(registered_skill)
    assert skill_id
    assert any(_extract_skill_id(item) == skill_id for item in items), result


def test_skills_market(kweaver_client: KWeaverClient):
    """Market listing should return a list-like payload even when empty."""
    result = kweaver_client.skills.market(page=1, page_size=10)
    assert isinstance(result, (list, dict))
    assert isinstance(_extract_items(result), list)


@pytest.mark.destructive
def test_skills_get(kweaver_client: KWeaverClient, registered_skill):
    """Get should return detail for the newly registered skill."""
    skill_id = _extract_skill_id(registered_skill)
    assert skill_id
    result = kweaver_client.skills.get(skill_id)
    assert isinstance(result, dict)
    assert _extract_skill_id(result) == skill_id


@pytest.mark.destructive
def test_skills_content(kweaver_client: KWeaverClient, registered_skill):
    """Content endpoint should return the rendered temporary skill content."""
    skill_id = _extract_skill_id(registered_skill)
    assert skill_id
    content = kweaver_client.skills.fetch_content(skill_id)
    assert isinstance(content, str)
    assert content.strip()
    assert registered_skill["_expected_heading"] in content
    assert registered_skill["_expected_section"] in content


@pytest.mark.destructive
def test_skills_read_file(kweaver_client: KWeaverClient, registered_skill):
    """Read-file should fetch the bundled guide file from the ZIP skill."""
    skill_id = _extract_skill_id(registered_skill)
    assert skill_id
    content = kweaver_client.skills.fetch_file(skill_id, "references/guide.md")
    assert isinstance(content, bytes)
    assert content.strip()
    assert b"Guide" in content


@pytest.mark.destructive
def test_skills_download(kweaver_client: KWeaverClient, registered_skill):
    """Download should return a valid ZIP archive for the temporary skill."""
    skill_id = _extract_skill_id(registered_skill)
    assert skill_id
    filename, archive = kweaver_client.skills.download(skill_id)
    assert filename == f"{skill_id}.zip"
    assert archive.startswith(b"PK")
    with zipfile.ZipFile(io.BytesIO(archive)) as zf:
        names = zf.namelist()
        skill_md = zf.read("SKILL.md").decode("utf-8")
    assert names
    assert any(name.endswith("SKILL.md") for name in names)
    assert registered_skill["_expected_name"] in skill_md
    assert registered_skill["_expected_heading"] in skill_md


@pytest.mark.destructive
def test_skills_update_status(kweaver_client: KWeaverClient, registered_skill):
    """Status update should succeed for the temporary skill."""
    skill_id = _extract_skill_id(registered_skill)
    assert skill_id
    result = kweaver_client.skills.update_status(skill_id, "published")
    assert isinstance(result, dict)
    updated = kweaver_client.skills.get(skill_id)
    status = updated.get("status")
    assert status in (None, "published")


@pytest.mark.destructive
def test_skills_offline_and_delete(kweaver_client: KWeaverClient, registered_skill):
    """Offline and delete should leave no readable skill behind."""
    skill_id = _extract_skill_id(registered_skill)
    assert skill_id

    result = kweaver_client.skills.update_status(skill_id, "offline")
    assert isinstance(result, dict)

    updated = kweaver_client.skills.get(skill_id)
    status = updated.get("status")
    assert status in (None, "offline")

    deleted = kweaver_client.skills.delete(skill_id)
    assert isinstance(deleted, dict)
