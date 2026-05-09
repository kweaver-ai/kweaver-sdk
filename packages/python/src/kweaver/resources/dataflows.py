"""SDK resource: dataflow DAG automation (create → run → poll → delete)."""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from kweaver._errors import KWeaverError

if TYPE_CHECKING:
    from kweaver._http import HttpClient

_BASE = "/api/automation/v1"


@dataclass
class DataflowStep:
    id: str
    title: str
    operator: str
    parameters: dict[str, Any] = field(default_factory=dict)


@dataclass
class DataflowResult:
    status: str
    reason: str | None = None


class DataflowsResource:
    """DAG-style dataflow automation on ``/api/automation/v1``.

    Create workflows from ``DataflowStep`` definitions, run them, poll status,
    and delete DAGs. Prefer ``DataflowV2Resource`` for document-centric flows.
    """

    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def create(
        self,
        *,
        title: str,
        steps: list[DataflowStep | dict[str, Any]],
        trigger_operator: str = "manual",
        description: str | None = None,
    ) -> str:
        """Create a dataflow DAG. Returns the new DAG id."""
        serialized_steps = []
        for s in steps:
            if isinstance(s, DataflowStep):
                serialized_steps.append(
                    {"id": s.id, "title": s.title, "operator": s.operator, "parameters": s.parameters}
                )
            else:
                serialized_steps.append(s)

        body: dict[str, Any] = {
            "title": title,
            "trigger_config": {"operator": trigger_operator},
            "steps": serialized_steps,
        }
        if description is not None:
            body["description"] = description

        data = self._http.post(f"{_BASE}/data-flow/flow", json=body)
        return data["id"]

    def run(self, dag_id: str) -> None:
        """Trigger a run for an existing dataflow DAG."""
        self._http.post(f"{_BASE}/run-instance/{dag_id}", json={})

    def poll(
        self,
        dag_id: str,
        *,
        interval: float = 3.0,
        timeout: float = 900.0,
    ) -> DataflowResult:
        """Poll DAG results until completion or failure.

        Raises ``KWeaverError`` on failed/error status, ``TimeoutError`` on timeout.
        """
        deadline = time.monotonic() + timeout
        current_interval = interval

        while True:
            data = self._http.get(f"{_BASE}/dag/{dag_id}/results")
            results = data.get("results", []) if isinstance(data, dict) else []

            if results:
                latest = results[0]
                status = latest.get("status", "")
                reason = latest.get("reason")

                if status in ("success", "completed"):
                    return DataflowResult(status=status, reason=reason)
                if status in ("failed", "error"):
                    msg = f"Dataflow run {status}"
                    if reason:
                        msg += f": {reason}"
                    raise KWeaverError(msg, status_code=None, error_code=None)

            if time.monotonic() + current_interval > deadline:
                raise TimeoutError(
                    f"Dataflow polling timed out after {timeout}s for DAG {dag_id}"
                )
            time.sleep(current_interval)
            current_interval = min(current_interval * 2, 30.0)

    def delete(self, dag_id: str) -> None:
        """Delete a dataflow DAG. Best-effort — does not raise on errors."""
        try:
            self._http.delete(f"{_BASE}/data-flow/flow/{dag_id}")
        except Exception:
            pass

    def execute(
        self,
        *,
        title: str,
        steps: list[DataflowStep | dict[str, Any]],
        trigger_operator: str = "manual",
        description: str | None = None,
        interval: float = 3.0,
        timeout: float = 900.0,
    ) -> DataflowResult:
        """Full dataflow lifecycle: create → run → poll → delete (always).

        Returns the final ``DataflowResult`` on success.
        """
        dag_id = self.create(
            title=title,
            steps=steps,
            trigger_operator=trigger_operator,
            description=description,
        )
        try:
            self.run(dag_id)
            return self.poll(dag_id, interval=interval, timeout=timeout)
        finally:
            self.delete(dag_id)
