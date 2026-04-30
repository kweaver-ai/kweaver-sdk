"""SDK resource: agent templates (`agent-tpl`) — agent-factory v3 personal-space CRUD + publish."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from urllib.parse import quote

from kweaver._errors import EndpointUnavailableError, KWeaverError

if TYPE_CHECKING:
    from kweaver._http import HttpClient

_PREFIX = "/api/agent-factory/v3/agent-tpl"


def _reraise_agent_tpl(endpoint: str, exc: BaseException) -> None:
    """Remap 404/405 on newer routes to EndpointUnavailableError."""
    if isinstance(exc, KWeaverError) and exc.status_code in (404, 405):
        raise EndpointUnavailableError(
            f"Endpoint {endpoint} is not available on this server. "
            "It may require a newer agent-factory version.",
            status_code=exc.status_code,
            endpoint_path=endpoint,
            trace_id=getattr(exc, "trace_id", None),
            error_code=getattr(exc, "error_code", None),
        ) from exc
    raise exc


class AgentTemplatesResource:
    """CRUD and publish flows for personal-space agent templates (`agent-tpl`)."""

    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def get(self, template_id: str) -> dict[str, Any]:
        path = f"{_PREFIX}/{template_id}"
        try:
            data = self._http.get(path)
        except KWeaverError as exc:
            _reraise_agent_tpl(path, exc)
        return data if isinstance(data, dict) else {}

    def get_by_key(self, key: str) -> dict[str, Any]:
        path = f"{_PREFIX}/by-key/{quote(key, safe='')}"
        try:
            data = self._http.get(path)
        except KWeaverError as exc:
            _reraise_agent_tpl(path, exc)
        return data if isinstance(data, dict) else {}

    def update(self, template_id: str, body: dict[str, Any]) -> None:
        path = f"{_PREFIX}/{template_id}"
        try:
            self._http.put(path, json=body)
        except KWeaverError as exc:
            _reraise_agent_tpl(path, exc)

    def delete(self, template_id: str) -> None:
        path = f"{_PREFIX}/{template_id}"
        try:
            self._http.delete(path)
        except KWeaverError as exc:
            _reraise_agent_tpl(path, exc)

    def copy(self, template_id: str) -> dict[str, Any]:
        path = f"{_PREFIX}/{template_id}/copy"
        try:
            data = self._http.post(path, json={})
        except KWeaverError as exc:
            _reraise_agent_tpl(path, exc)
        return data if isinstance(data, dict) else {}

    def publish(self, template_id: str, *, body: dict[str, Any] | None = None) -> dict[str, Any]:
        payload = body if body is not None else {
            "business_domain_id": "bd_public",
            "category_ids": [],
        }
        path = f"{_PREFIX}/{template_id}/publish"
        try:
            data = self._http.post(path, json=payload)
        except KWeaverError as exc:
            _reraise_agent_tpl(path, exc)
        return data if isinstance(data, dict) else {}

    def unpublish(self, template_id: str) -> None:
        path = f"{_PREFIX}/{template_id}/unpublish"
        try:
            self._http.put(path)
        except KWeaverError as exc:
            _reraise_agent_tpl(path, exc)

    def get_publish_info(self, template_id: str) -> dict[str, Any]:
        path = f"{_PREFIX}/{template_id}/publish-info"
        try:
            data = self._http.get(path)
        except KWeaverError as exc:
            _reraise_agent_tpl(path, exc)
        return data if isinstance(data, dict) else {}

    def update_publish_info(self, template_id: str, body: dict[str, Any]) -> dict[str, Any]:
        path = f"{_PREFIX}/{template_id}/publish-info"
        try:
            data = self._http.put(path, json=body)
        except KWeaverError as exc:
            _reraise_agent_tpl(path, exc)
        return data if isinstance(data, dict) else {}
