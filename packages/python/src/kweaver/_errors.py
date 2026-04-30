"""KWeaver SDK error hierarchy."""

from __future__ import annotations

from typing import Any

import httpx


class KWeaverError(Exception):
    """Base exception for all SDK errors."""

    def __init__(
        self,
        message: str,
        *,
        status_code: int | None = None,
        error_code: str | None = None,
        trace_id: str | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.error_code = error_code
        self.trace_id = trace_id

    def __repr__(self) -> str:
        parts = [f"message={self.message!r}"]
        if self.status_code is not None:
            parts.append(f"status_code={self.status_code}")
        if self.error_code is not None:
            parts.append(f"error_code={self.error_code!r}")
        if self.trace_id is not None:
            parts.append(f"trace_id={self.trace_id!r}")
        return f"{type(self).__name__}({', '.join(parts)})"


class AuthenticationError(KWeaverError):
    """401 — token invalid or expired."""


class AuthorizationError(KWeaverError):
    """403 — insufficient permissions."""


class NotFoundError(KWeaverError):
    """404 — resource does not exist."""


class ValidationError(KWeaverError):
    """400 — bad request parameters."""


class ConflictError(KWeaverError):
    """409 — resource conflict."""


class ServerError(KWeaverError):
    """5xx — KWeaver server-side error."""


class NetworkError(KWeaverError):
    """Network unreachable (distinct from builtin ConnectionError)."""


class EndpointUnavailableError(KWeaverError):
    """404/405 on newer agent-factory routes — deployment may not expose this endpoint yet."""

    def __init__(
        self,
        message: str,
        *,
        endpoint_path: str,
        status_code: int | None = None,
        error_code: str | None = None,
        trace_id: str | None = None,
    ) -> None:
        super().__init__(message, status_code=status_code, error_code=error_code, trace_id=trace_id)
        self.endpoint_path = endpoint_path


class DryRunIntercepted(KWeaverError):
    """Raised when a write request is intercepted by dry-run mode."""

    def __init__(self, method: str, url: str, body: Any = None) -> None:
        self.method = method
        self.url = url
        self.body = body
        super().__init__(f"[DRY RUN] {method} {url}")


class VegaError(KWeaverError):
    """Base for all Vega errors."""


class VegaConnectionError(VegaError):
    def __init__(self, message: str, *, catalog_id: str = "", connector_type: str = "", **kw):
        super().__init__(message, **kw)
        self.catalog_id = catalog_id
        self.connector_type = connector_type


class VegaQueryError(VegaError):
    def __init__(self, message: str, *, query_type: str = "", **kw):
        super().__init__(message, **kw)
        self.query_type = query_type


class VegaDiscoverError(VegaError):
    def __init__(self, message: str, *, catalog_id: str = "", task_id: str = "", **kw):
        super().__init__(message, **kw)
        self.catalog_id = catalog_id
        self.task_id = task_id


_STATUS_MAP: dict[int, type[KWeaverError]] = {
    400: ValidationError,
    401: AuthenticationError,
    403: AuthorizationError,
    404: NotFoundError,
    409: ConflictError,
}


def raise_for_status_parts(
    status_code: int,
    body: bytes,
    *,
    reason_phrase: str | None = None,
) -> None:
    """Raise a typed KWeaverError from raw status/body parts."""
    if status_code < 400:
        return

    error_code: str | None = None
    message: str = reason_phrase or "Unknown error"
    trace_id: str | None = None

    try:
        payload = httpx.Response(status_code, content=body).json()
        if isinstance(payload, dict):
            error_code = payload.get("error_code") or payload.get("ErrorCode") or payload.get("code")
            message = (
                payload.get("message")
                or payload.get("Description")
                or payload.get("detail")
                or payload.get("description")
                or message
            )
            trace_id = payload.get("trace_id")
            if status_code == 400 and not message:
                message = str(payload)
        elif isinstance(payload, (list, str)):
            message = str(payload)
    except Exception:
        try:
            message = body.decode("utf-8") or message
        except Exception:
            pass

    exc_cls = _STATUS_MAP.get(status_code)
    if exc_cls is None:
        exc_cls = ServerError if status_code >= 500 else KWeaverError

    raise exc_cls(
        message,
        status_code=status_code,
        error_code=error_code,
        trace_id=trace_id,
    )


def raise_for_status(response: httpx.Response) -> None:
    """Raise a typed KWeaverError if the response indicates failure."""
    if response.status_code < 400:
        return

    # Try to extract structured error info from JSON body
    error_code: str | None = None
    message: str = response.reason_phrase or "Unknown error"
    trace_id: str | None = None

    try:
        body = response.json()
        if isinstance(body, dict):
            error_code = body.get("error_code") or body.get("ErrorCode") or body.get("code")
            message = (
                body.get("message")
                or body.get("Description")
                or body.get("detail")
                or body.get("description")
                or message
            )
            trace_id = body.get("trace_id")
            # Include full body for debugging validation errors
            if response.status_code == 400 and not message:
                message = str(body)
        elif isinstance(body, (list, str)):
            message = str(body)
    except Exception:
        pass

    exc_cls = _STATUS_MAP.get(response.status_code)
    if exc_cls is None:
        exc_cls = ServerError if response.status_code >= 500 else KWeaverError

    raise exc_cls(
        message,
        status_code=response.status_code,
        error_code=error_code,
        trace_id=trace_id,
    )
