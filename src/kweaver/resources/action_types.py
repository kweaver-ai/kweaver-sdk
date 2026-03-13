"""SDK resource: action types (ontology-query)."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from kweaver.types import ActionExecution, ActionType

if TYPE_CHECKING:
    from kweaver._http import HttpClient

_PREFIX = "/api/ontology-query/v1/knowledge-networks"


class ActionTypesResource:
    """Action Type query, execution, and log management."""

    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def query(self, kn_id: str, action_type_id: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
        """Query an Action Type definition and parameters."""
        data = self._http.post(
            f"{_PREFIX}/{kn_id}/action-types/{action_type_id}/",
            json=body or {},
            headers={"X-HTTP-Method-Override": "GET"},
        )
        return data or {}

    def execute(self, kn_id: str, action_type_id: str, params: dict[str, Any] | None = None) -> ActionExecution:
        """Execute an Action Type, returns an async execution object."""
        data = self._http.post(
            f"{_PREFIX}/{kn_id}/action-types/{action_type_id}/execute",
            json=params or {},
            timeout=120.0,
        )
        execution_id = data.get("execution_id") or data.get("id") or ""
        status = data.get("status", "pending")

        execution = ActionExecution(
            execution_id=execution_id,
            kn_id=kn_id,
            action_type_id=action_type_id,
            status=status,
            result=data.get("result"),
        )
        execution.set_poll_fn(lambda: self._poll_execution(kn_id, execution_id))
        return execution

    def _poll_execution(self, kn_id: str, execution_id: str) -> ActionExecution:
        data = self.get_execution(kn_id, execution_id)
        return ActionExecution(
            execution_id=execution_id,
            kn_id=kn_id,
            action_type_id=data.get("action_type_id", ""),
            status=data.get("status", "running"),
            result=data.get("result"),
        )

    def get_execution(self, kn_id: str, execution_id: str) -> dict[str, Any]:
        """Get execution status."""
        data = self._http.get(
            f"{_PREFIX}/{kn_id}/action-executions/{execution_id}",
        )
        return data or {}

    def list_logs(
        self,
        kn_id: str,
        *,
        offset: int = 0,
        limit: int = 20,
        sort: str = "create_time",
        direction: str = "desc",
    ) -> list[dict[str, Any]]:
        """List Action execution logs."""
        data = self._http.get(
            f"{_PREFIX}/{kn_id}/action-logs",
            params={
                "offset": offset,
                "limit": limit,
                "sort": sort,
                "direction": direction,
            },
        )
        if isinstance(data, list):
            return data
        return data.get("entries") or data.get("data") or []

    def get_log(self, kn_id: str, log_id: str) -> dict[str, Any]:
        """Get a single execution log."""
        data = self._http.get(f"{_PREFIX}/{kn_id}/action-logs/{log_id}")
        return data or {}

    def cancel(self, kn_id: str, log_id: str) -> None:
        """Cancel a running Action execution."""
        self._http.post(f"{_PREFIX}/{kn_id}/action-logs/{log_id}/cancel")
