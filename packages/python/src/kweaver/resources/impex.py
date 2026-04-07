"""SDK resource: import/export (execution-factory service)."""
from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from kweaver._http import HttpClient

_API_PREFIX = "/api/agent-operator-integration/v1"


class ImpexResource:
    """Import/Export for execution factory resources."""

    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def export_data(self, *, type: str, id: str) -> dict[str, Any]:
        return self._http.get(f"{_API_PREFIX}/impex/export/{type}/{id}")

    def import_data(self, *, type: str, body: dict[str, Any]) -> dict[str, Any]:
        return self._http.post(f"{_API_PREFIX}/impex/import/{type}", json=body)
