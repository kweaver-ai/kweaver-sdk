"""SDK resource: document-style dataflow v2 APIs."""

from __future__ import annotations

import json
from pathlib import Path
from typing import TYPE_CHECKING, Any

from kweaver._errors import raise_for_status_parts

if TYPE_CHECKING:
    from kweaver._http import HttpClient


class DataflowV2Resource:
    """Thin SDK wrapper for document-style dataflow APIs."""

    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def list_dataflows(self) -> dict[str, Any]:
        return self._http.get(
            "/api/automation/v2/dags",
            params={"type": "data-flow", "page": 0, "limit": -1},
        )

    def run_dataflow_with_file(
        self,
        dag_id: str,
        *,
        file_path: str | Path | None = None,
        file_name: str | None = None,
        file_bytes: bytes | None = None,
    ) -> dict[str, Any]:
        if file_path is not None and (file_name is not None or file_bytes is not None):
            raise ValueError("Use either file_path or file_name + file_bytes, not both.")

        if file_path is not None:
            path = Path(file_path)
            file_name = path.name
            file_bytes = path.read_bytes()

        if file_name is None or file_bytes is None:
            raise ValueError("Provide file_path or both file_name and file_bytes.")

        status_code, body = self._http.post_multipart(
            f"/api/automation/v2/dataflow-doc/trigger/{dag_id}",
            files={"file": (file_name, file_bytes, "application/octet-stream")},
        )
        raise_for_status_parts(status_code, body)
        return json.loads(body)

    def run_dataflow_with_remote_url(
        self,
        dag_id: str,
        *,
        url: str,
        name: str,
    ) -> dict[str, Any]:
        return self._http.post(
            f"/api/automation/v2/dataflow-doc/trigger/{dag_id}",
            json={
                "source_from": "remote",
                "url": url,
                "name": name,
            },
        )

    def list_dataflow_runs(
        self,
        dag_id: str,
        *,
        page: int = 0,
        limit: int = 100,
        sort_by: str | None = None,
        order: str | None = None,
        start_time: int | None = None,
        end_time: int | None = None,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {"page": page, "limit": limit}
        if sort_by is not None:
            params["sortBy"] = sort_by
        if order is not None:
            params["order"] = order
        if start_time is not None:
            params["start_time"] = start_time
        if end_time is not None:
            params["end_time"] = end_time
        return self._http.get(f"/api/automation/v2/dag/{dag_id}/results", params=params)

    def get_dataflow_logs_page(
        self,
        dag_id: str,
        instance_id: str,
        *,
        page: int = 0,
        limit: int = 10,
    ) -> dict[str, Any]:
        return self._http.get(
            f"/api/automation/v2/dag/{dag_id}/result/{instance_id}",
            params={"page": page, "limit": limit},
        )
