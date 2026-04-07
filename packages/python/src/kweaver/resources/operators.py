"""SDK resource: operators (execution-factory service)."""
from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from kweaver._http import HttpClient

_API_PREFIX = "/api/agent-operator-integration/v1"


class OperatorsResource:
    """Operator management via agent-operator-integration API."""

    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def list(
        self,
        *,
        page: int = 1,
        page_size: int = 10,
        operator_id: str | None = None,
        name: str | None = None,
        status: str = "published",
        metadata_type: str | None = None,
        category: str | None = None,
        source: str | None = None,
        create_user: str | None = None,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {"page": page, "page_size": page_size, "status": status}
        if operator_id:
            params["operator_id"] = operator_id
        if name:
            params["name"] = name
        if metadata_type:
            params["metadata_type"] = metadata_type
        if category:
            params["category"] = category
        if source:
            params["source"] = source
        if create_user:
            params["create_user"] = create_user
        return self._http.get(f"{_API_PREFIX}/operator/info/list", params=params)

    def get(self, operator_id: str, *, version: str | None = None) -> dict[str, Any]:
        url = f"{_API_PREFIX}/operator/{operator_id}"
        if version:
            url += f"?version={version}"
        return self._http.get(url)

    def register(self, body: dict[str, Any]) -> dict[str, Any]:
        return self._http.post(f"{_API_PREFIX}/operator/register", json=body)

    def edit(self, operator_id: str, version: str, *, body: dict[str, Any]) -> dict[str, Any]:
        return self._http.put(
            f"{_API_PREFIX}/operator/{operator_id}/versions/{version}", json=body
        )

    def delete(self, body: list[dict[str, Any]]) -> dict[str, Any]:
        return self._http.post(f"{_API_PREFIX}/operator/delete", json=body)

    def update_status(self, body: list[dict[str, Any]]) -> dict[str, Any]:
        return self._http.put(f"{_API_PREFIX}/operator/status", json=body)

    def debug(self, body: dict[str, Any]) -> dict[str, Any]:
        return self._http.post(f"{_API_PREFIX}/operator/debug", json=body)

    def list_history(
        self, operator_id: str, *, page: int = 1, page_size: int = 10
    ) -> dict[str, Any]:
        params = {"page": page, "page_size": page_size}
        return self._http.get(
            f"{_API_PREFIX}/operator/{operator_id}/history", params=params
        )

    def list_market(
        self,
        *,
        page: int = 1,
        page_size: int = 10,
        operator_id: str | None = None,
        name: str | None = None,
        category: str | None = None,
        source: str | None = None,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {"page": page, "page_size": page_size}
        if operator_id:
            params["operator_id"] = operator_id
        if name:
            params["name"] = name
        if category:
            params["category"] = category
        if source:
            params["source"] = source
        return self._http.get(f"{_API_PREFIX}/operator/market", params=params)

    def get_market(self, operator_id: str) -> dict[str, Any]:
        return self._http.get(f"{_API_PREFIX}/operator/market/{operator_id}")

    def list_categories(self) -> list[dict[str, Any]]:
        return self._http.get(f"{_API_PREFIX}/operator/categories")

    def register_internal(self, body: dict[str, Any]) -> dict[str, Any]:
        return self._http.post(f"{_API_PREFIX}/operator/internal/register", json=body)
