"""SDK resource: skill registry, market, progressive read, and install helpers."""

from __future__ import annotations

import io
import json
import shutil
import zipfile
from pathlib import Path
from typing import TYPE_CHECKING, Any

from kweaver._errors import raise_for_status_parts

if TYPE_CHECKING:
    from kweaver._http import HttpClient


SkillStatus = str


def _unwrap_data(payload: Any) -> Any:
    if isinstance(payload, dict) and "data" in payload:
        return payload["data"]
    return payload


class SkillsResource:
    """Client for ADP/KWeaver skill management APIs."""

    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def list(
        self,
        *,
        page: int = 1,
        page_size: int = 30,
        sort_by: str | None = None,
        sort_order: str | None = None,
        all: bool | None = None,
        name: str | None = None,
        status: SkillStatus | None = None,
        source: str | None = None,
        create_user: str | None = None,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {"page": page, "page_size": page_size}
        if sort_by:
            params["sort_by"] = sort_by
        if sort_order:
            params["sort_order"] = sort_order
        if all is not None:
            params["all"] = all
        if name:
            params["name"] = name
        if status:
            params["status"] = status
        if source:
            params["source"] = source
        if create_user:
            params["create_user"] = create_user
        return _unwrap_data(self._http.get("/api/agent-operator-integration/v1/skills", params=params))

    def market(
        self,
        *,
        page: int = 1,
        page_size: int = 30,
        sort_by: str | None = None,
        sort_order: str | None = None,
        all: bool | None = None,
        name: str | None = None,
        source: str | None = None,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {"page": page, "page_size": page_size}
        if sort_by:
            params["sort_by"] = sort_by
        if sort_order:
            params["sort_order"] = sort_order
        if all is not None:
            params["all"] = all
        if name:
            params["name"] = name
        if source:
            params["source"] = source
        return _unwrap_data(self._http.get("/api/agent-operator-integration/v1/skills/market", params=params))

    def get(self, skill_id: str) -> dict[str, Any]:
        return _unwrap_data(self._http.get(f"/api/agent-operator-integration/v1/skills/{skill_id}"))

    def register_content(
        self,
        content: str,
        *,
        source: str | None = None,
        extend_info: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        # Backend's file_type=content path is half-implemented: it stores
        # the markdown body but skips skill_file_index, so the skill is
        # unreadable after publish (GET /skills/:id/content -> 404).
        # See kweaver-ai/kweaver-core#313. Bundle the content into a
        # 1-file SKILL.md zip and route through the zip path, which writes
        # skill_file_index correctly.
        bundle = _bundle_skill_md_to_zip(content)
        return self.register_zip(
            "SKILL.md.zip",
            bundle,
            source=source,
            extend_info=extend_info,
        )

    def register_zip(
        self,
        filename: str,
        data: bytes,
        *,
        source: str | None = None,
        extend_info: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        files = {
            "file_type": (None, "zip"),
            "file": (filename, data, "application/zip"),
        }
        if source:
            files["source"] = (None, source)
        if extend_info is not None:
            files["extend_info"] = (None, json.dumps(extend_info))
        status_code, body = self._http.post_multipart(
            "/api/agent-operator-integration/v1/skills",
            files=files,
        )
        raise_for_status_parts(status_code, body)
        return _unwrap_data(json.loads(body))

    def delete(self, skill_id: str) -> dict[str, Any]:
        return _unwrap_data(self._http.delete(f"/api/agent-operator-integration/v1/skills/{skill_id}"))

    def update_status(self, skill_id: str, status: SkillStatus) -> dict[str, Any]:
        return _unwrap_data(
            self._http.put(
                f"/api/agent-operator-integration/v1/skills/{skill_id}/status",
                json={"status": status},
            )
        )

    def content(self, skill_id: str) -> dict[str, Any]:
        return _unwrap_data(self._http.get(f"/api/agent-operator-integration/v1/skills/{skill_id}/content"))

    def fetch_content(self, skill_id: str) -> str:
        content = self.content(skill_id)
        return self._http.fetch_response(content["url"], follow_redirects=True, timeout=30.0).text

    def read_file(self, skill_id: str, rel_path: str) -> dict[str, Any]:
        return _unwrap_data(
            self._http.post(
                f"/api/agent-operator-integration/v1/skills/{skill_id}/files/read",
                json={"rel_path": rel_path},
            )
        )

    def fetch_file(self, skill_id: str, rel_path: str) -> bytes:
        file_info = self.read_file(skill_id, rel_path)
        return self._http.fetch_response(file_info["url"], follow_redirects=True, timeout=30.0).content

    def download(self, skill_id: str) -> tuple[str, bytes]:
        status_code, archive = self._http.get_bytes(f"/api/agent-operator-integration/v1/skills/{skill_id}/download")
        raise_for_status_parts(status_code, archive)
        return f"{skill_id}.zip", archive

    def install(self, skill_id: str, directory: str, *, force: bool = False) -> dict[str, Any]:
        _, archive = self.download(skill_id)
        install_skill_archive(archive, directory, force=force)
        return {"directory": str(Path(directory).resolve())}


def _bundle_skill_md_to_zip(content: str) -> bytes:
    """Wrap a SKILL.md string into an in-memory zip for upload."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("SKILL.md", content)
    return buf.getvalue()


def install_skill_archive(data: bytes, directory: str, *, force: bool = False) -> None:
    """Extract a skill ZIP archive into ``directory``."""
    target = Path(directory).resolve()
    if target.exists() and any(target.iterdir()):
        if not force:
            raise ValueError(f"Install target is not empty: {target}. Use --force to replace it.")
        shutil.rmtree(target)
    target.mkdir(parents=True, exist_ok=True)
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            zf.extractall(target)
    except Exception:
        if target.exists():
            shutil.rmtree(target)
        raise
