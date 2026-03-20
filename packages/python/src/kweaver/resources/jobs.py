"""SDK resource: jobs & tasks (ontology-manager)."""
from __future__ import annotations

import time
from typing import TYPE_CHECKING, Any

from kweaver.types import Job, Task

if TYPE_CHECKING:
    from kweaver._http import HttpClient

_BASE = "/api/ontology-manager/v1/knowledge-networks"
_TERMINAL_STATES = frozenset({"completed", "failed"})
_MAX_BACKOFF = 30.0


def _parse_job(data: dict[str, Any]) -> Job:
    return Job(
        id=data.get("id", ""),
        kn_id=data.get("kn_id", ""),
        type=data.get("type", ""),
        status=data.get("status", ""),
        progress=data.get("progress"),
        creator=data.get("creator"),
        create_time=data.get("create_time"),
        update_time=data.get("update_time"),
    )


def _parse_task(data: dict[str, Any]) -> Task:
    return Task(
        id=data.get("id", ""),
        job_id=data.get("job_id", ""),
        name=data.get("name", ""),
        status=data.get("status", ""),
        error=data.get("error"),
        create_time=data.get("create_time"),
        update_time=data.get("update_time"),
    )


class JobsResource:
    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def list(self, kn_id: str, *, status: str | None = None, offset: int = 0, limit: int = 20) -> list[Job]:
        params: dict[str, Any] = {"offset": offset, "limit": limit}
        if status:
            params["status"] = status
        data = self._http.get(f"{_BASE}/{kn_id}/jobs", params=params)
        entries = data.get("entries", data.get("data", [])) if isinstance(data, dict) else data
        return [_parse_job(e) for e in entries]

    def get_tasks(self, kn_id: str, job_id: str) -> list[Task]:
        data = self._http.get(f"{_BASE}/{kn_id}/jobs/{job_id}/tasks")
        entries = data.get("entries", data.get("data", [])) if isinstance(data, dict) else data
        return [_parse_task(e) for e in entries]

    def delete(self, kn_id: str, job_ids: list[str]) -> None:
        ids_str = ",".join(job_ids)
        self._http.delete(f"{_BASE}/{kn_id}/jobs/{ids_str}")

    def wait(self, kn_id: str, job_id: str, *, timeout: float = 300, interval: float = 2.0) -> Job:
        """Poll job until terminal state. Uses exponential backoff (max 30s)."""
        deadline = time.monotonic() + timeout
        current_interval = interval
        while True:
            data = self._http.get(f"{_BASE}/{kn_id}/jobs/{job_id}")
            job = _parse_job(data)
            if job.status in _TERMINAL_STATES:
                return job
            if time.monotonic() + current_interval > deadline:
                raise TimeoutError(f"Job {job_id} did not complete within {timeout}s (status: {job.status})")
            time.sleep(current_interval)
            current_interval = min(current_interval * 2, _MAX_BACKOFF)
