"""SDK resource: dataflow — unstructured data processing pipelines."""

from __future__ import annotations

import logging
import time
import uuid
from pathlib import Path
from typing import TYPE_CHECKING, Any

from kweaver.types import DataflowJob, DataflowRunResult, S3File

if TYPE_CHECKING:
    from kweaver._http import HttpClient

logger = logging.getLogger("kweaver.dataflow")

_BASE = "/api/automation/v1"

# Default template for file parsing pipeline:
#   trigger → file_parse → write vectors → write elements → write file meta
_DEFAULT_FILE_PARSE_STEPS = [
    {
        "id": "0",
        "title": "",
        "operator": "@trigger/dataflow-doc",
    },
    {
        "id": "1",
        "title": "",
        "operator": "@content/file_parse",
        "parameters": {
            "docid": "{{__0.id}}",
            "model": "embedding",
            "slice_vector": "slice_vector",
            "source_type": "docid",
            "version": "{{__0.rev}}",
        },
    },
    {
        "id": "1001",
        "title": "写入向量",
        "operator": "@opensearch/bulk-upsert",
        "parameters": {
            "base_type": "content_index_cli",
            "category": "log",
            "data_type": "user9",
            "documents": "{{__1.chunks}}",
            "template": "default",
        },
    },
    {
        "id": "1002",
        "title": "写入元素",
        "operator": "@opensearch/bulk-upsert",
        "parameters": {
            "base_type": "content_element_cli",
            "category": "log",
            "data_type": "user9",
            "documents": "{{__1.content_list}}",
        },
    },
    {
        "id": "1003",
        "title": "写入文件元信息",
        "operator": "@opensearch/bulk-upsert",
        "parameters": {
            "base_type": "content_document_cli",
            "category": "log",
            "data_type": "user9",
            "documents": (
                '{  "id": "{{__0.item_id}}",\n'
                '  "rev": "{{__0.rev}}",\n'
                '  "name": "{{__0.name}}",\n'
                '  "document_id": "{{__0.docid}}"\n}'
            ),
        },
    },
]


def _parse_s3_file(data: dict[str, Any]) -> S3File:
    return S3File(
        id=data.get("id", ""),
        bucket=data.get("bucket", ""),
        key=data.get("key", ""),
        name=data.get("name", ""),
        size=data.get("size", 0),
        last_modified=data.get("last_modified"),
        download_url=data.get("download_url"),
    )


class DataflowResource:
    """Manage dataflow pipelines for unstructured data processing."""

    def __init__(self, http: HttpClient) -> None:
        self._http = http

    # ── File management ─────────────────────────────────────────────

    def upload_file(self, dag_id: str, file_path: str) -> S3File:
        """Upload a file to an existing dataflow's S3 storage."""
        data = self._http.upload(
            f"{_BASE}/data-flow/{dag_id}/files/upload",
            file_path=file_path,
            timeout=300.0,
        )
        return _parse_s3_file(data)

    def list_files(self, dag_id: str) -> list[S3File]:
        """List files uploaded to a dataflow."""
        data = self._http.get(f"{_BASE}/data-flow/{dag_id}/files")
        return [_parse_s3_file(f) for f in (data or {}).get("files", [])]

    def delete_file(self, dag_id: str, key: str) -> None:
        """Delete a file from a dataflow's S3 storage."""
        self._http.delete(
            f"{_BASE}/data-flow/{dag_id}/files",
            params={"key": key},
        )

    # ── Dataflow CRUD ───────────────────────────────────────────────

    def create(
        self,
        title: str,
        *,
        steps: list[dict[str, Any]],
        trigger_config: dict[str, Any],
        description: str = "",
        status: str = "normal",
    ) -> str:
        """Create a dataflow pipeline. Returns the dag ID."""
        body: dict[str, Any] = {
            "title": title,
            "description": description,
            "status": status,
            "steps": steps,
            "trigger_config": trigger_config,
        }
        data = self._http.post(f"{_BASE}/data-flow/flow", json=body)
        return data["id"]

    def delete(self, dag_id: str) -> None:
        """Delete a dataflow pipeline."""
        self._http.delete(f"{_BASE}/data-flow/{dag_id}")

    # ── Execution ───────────────────────────────────────────────────

    def run(self, dag_id: str) -> None:
        """Trigger a manual execution of a dataflow."""
        self._http.post(f"{_BASE}/run-instance/{dag_id}")

    def list_runs(
        self,
        dag_id: str,
        *,
        page: int = 0,
        limit: int = 20,
    ) -> DataflowRunResult:
        """List execution history for a dataflow."""
        data = self._http.get(
            f"{_BASE}/dag/{dag_id}/results",
            params={"page": page, "limit": limit, "sortby": "started_at", "order": "desc"},
        )
        data = data or {}
        return DataflowRunResult(
            total=data.get("total", 0),
            results=data.get("results", []),
            progress=data.get("progress"),
        )

    def get_run(self, dag_id: str, run_id: str) -> list[dict[str, Any]]:
        """Get task-level details for a specific execution run."""
        data = self._http.get(f"{_BASE}/dag/{dag_id}/result/{run_id}")
        return data if isinstance(data, list) else []

    # ── High-level: create-and-run pipeline ─────────────────────────

    def parse_files(
        self,
        file_paths: list[str],
        *,
        title: str | None = None,
        wait: bool = True,
        timeout: float = 600,
        poll_interval: float = 3.0,
    ) -> DataflowJob:
        """Upload files, create a default parsing pipeline, and run it.

        This is the high-level convenience method that wraps:
          upload files → create dataflow → trigger run → poll status

        Args:
            file_paths: Local file paths to process.
            title: Optional pipeline name (auto-generated if omitted).
            wait: If True, block until execution completes or times out.
            timeout: Max seconds to wait (only if wait=True).
            poll_interval: Seconds between status polls.

        Returns:
            A DataflowJob with the dag_id and final status.
        """
        if not file_paths:
            raise ValueError("At least one file path is required")

        # Use a temp session ID for uploading before dag creation
        session_id = uuid.uuid4().hex[:16]

        # Step 1: Upload files to temp storage
        uploaded: list[S3File] = []
        for fp in file_paths:
            p = Path(fp)
            if not p.is_file():
                raise FileNotFoundError(f"File not found: {fp}")
            item = self.upload_file(session_id, str(p))
            uploaded.append(item)

        # Step 2: Build trigger config with uploaded file references
        sources = [
            {
                "key": f.key,
                "name": f.name,
                "size": f.size,
            }
            for f in uploaded
        ]

        trigger_config: dict[str, Any] = {
            "operator": "@trigger/manual",
            "dataSource": {
                "operator": "@s3/list-objects",
                "parameters": {
                    "sources": sources,
                    "mode": "upload",
                },
            },
        }

        # Step 3: Create dataflow with default file-parse template
        if title is None:
            title = f"sdk_parse_{session_id}"

        dag_id = self.create(
            title=title,
            steps=_DEFAULT_FILE_PARSE_STEPS,
            trigger_config=trigger_config,
        )

        # Step 4: Trigger execution
        self.run(dag_id)

        job = DataflowJob(dag_id=dag_id, status="running")
        job.set_poll_fn(lambda: self._poll_status(dag_id))

        # Step 5: Optionally wait for completion
        if wait:
            job = job.wait(timeout=timeout, poll_interval=poll_interval)

        return job

    def _poll_status(self, dag_id: str) -> DataflowJob:
        """Check the latest execution status of a dataflow."""
        result = self.list_runs(dag_id, page=0, limit=1)
        if not result.results:
            return DataflowJob(dag_id=dag_id, status="init")

        latest = result.results[0]
        status = latest.get("status", "unknown")
        return DataflowJob(
            dag_id=dag_id,
            status=status,
            run_id=latest.get("id"),
            progress=result.progress,
        )
