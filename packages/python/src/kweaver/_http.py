"""HTTP transport layer with auth injection, retry, and log sanitization."""

from __future__ import annotations

import copy
import logging
import time
import json as _json
from typing import Any, Iterator

import httpx

from kweaver._auth import AuthProvider
from kweaver._errors import NetworkError, raise_for_status

logger = logging.getLogger("kweaver.http")

_SENSITIVE_BODY_KEYS = {"password", "secret", "client_secret"}
_MAX_RETRIES = 3
_BACKOFF_BASE = 0.5


def _sanitize_body(body: Any) -> Any:
    """Deep-copy and mask sensitive fields for logging."""
    if not isinstance(body, dict):
        return body
    out = {}
    for k, v in body.items():
        if k in _SENSITIVE_BODY_KEYS:
            out[k] = "***"
        elif isinstance(v, dict):
            out[k] = _sanitize_body(v)
        else:
            out[k] = v
    return out


class HttpClient:
    """Low-level HTTP client wrapping httpx with KWeaver-specific concerns."""

    def __init__(
        self,
        base_url: str,
        auth: AuthProvider,
        *,
        account_id: str | None = None,
        account_type: str | None = None,
        business_domain: str | None = None,
        timeout: float = 30.0,
        transport: httpx.BaseTransport | None = None,
        log_requests: bool = False,
        middlewares: list | None = None,
    ) -> None:
        self._auth = auth
        self._account_id = account_id
        self._account_type = account_type
        self._business_domain = business_domain
        self._log_requests = log_requests
        self._middlewares = middlewares or []

        # Build middleware chain once (H3 perf fix)
        self._handler = self._do_request
        for mw in reversed(self._middlewares):
            self._handler = mw.wrap(self._handler)

        client_kwargs: dict[str, Any] = {
            "base_url": base_url,
            "timeout": timeout,
        }
        if transport is not None:
            client_kwargs["transport"] = transport
        self._client = httpx.Client(**client_kwargs)

    def _build_headers(self, extra: dict[str, str] | None = None) -> dict[str, str]:
        headers = self._auth.auth_headers()
        if self._account_id:
            headers["x-account-id"] = self._account_id
        if self._account_type:
            headers["x-account-type"] = self._account_type
        if self._business_domain:
            headers["x-business-domain"] = self._business_domain
        if extra:
            headers.update(extra)
        return headers

    def _log(self, method: str, url: str, body: Any = None) -> None:
        if not self._log_requests:
            return
        safe = _sanitize_body(body) if body else None
        logger.info("%s %s body=%s", method, url, safe)

    def request(
        self,
        method: str,
        path: str,
        *,
        json: Any = None,
        params: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
        retry: bool = True,
        timeout: float | None = None,
    ) -> Any:
        from kweaver._middleware import RequestContext

        ctx = RequestContext(
            method=method,
            path=path,
            kwargs={"json": json, "params": params, "headers": headers, "retry": retry, "timeout": timeout},
        )

        return self._handler(ctx)

    def _do_request(self, ctx: Any) -> Any:
        """Execute the HTTP request with retry logic — the innermost handler in the middleware chain."""
        method = ctx.method
        path = ctx.path
        json = ctx.kwargs.get("json")
        params = ctx.kwargs.get("params")
        headers = ctx.kwargs.get("headers")
        retry = ctx.kwargs.get("retry", True)
        timeout = ctx.kwargs.get("timeout")

        merged_headers = self._build_headers(headers)
        self._log(method, path, json)

        last_exc: Exception | None = None
        attempts = _MAX_RETRIES if retry else 1

        # Build httpx kwargs conditionally to avoid sending json=None (M7 fix)
        req_kwargs: dict[str, Any] = {}
        if json is not None:
            req_kwargs["json"] = json
        if params is not None:
            req_kwargs["params"] = params
        if timeout is not None:
            req_kwargs["timeout"] = timeout

        for attempt in range(attempts):
            try:
                resp = self._client.request(
                    method,
                    path,
                    headers=merged_headers,
                    **req_kwargs,
                )
            except httpx.HTTPError as exc:
                last_exc = exc
                if attempt < attempts - 1:
                    time.sleep(_BACKOFF_BASE * (2**attempt))
                    continue
                raise NetworkError(
                    str(exc), status_code=None, error_code=None
                ) from exc

            if resp.status_code >= 500 and attempt < attempts - 1:
                last_exc = None
                time.sleep(_BACKOFF_BASE * (2**attempt))
                continue

            if resp.status_code >= 400:
                logger.warning(
                    "HTTP %d %s %s -> %s",
                    resp.status_code, method, path, resp.text[:500],
                )
            raise_for_status(resp)

            if resp.status_code == 204 or not resp.content:
                return None
            return resp.json()

        if last_exc:
            raise NetworkError(str(last_exc), status_code=None, error_code=None) from last_exc
        return None  # pragma: no cover

    def get(self, path: str, *, params: dict[str, Any] | None = None, headers: dict[str, str] | None = None) -> Any:
        return self.request("GET", path, params=params, headers=headers)

    def post(self, path: str, *, json: Any = None, params: dict[str, Any] | None = None, headers: dict[str, str] | None = None, timeout: float | None = None) -> Any:
        return self.request("POST", path, json=json, params=params, headers=headers, retry=False, timeout=timeout)

    def put(self, path: str, *, json: Any = None, headers: dict[str, str] | None = None) -> Any:
        return self.request("PUT", path, json=json, headers=headers)

    def delete(self, path: str, *, headers: dict[str, str] | None = None) -> Any:
        return self.request("DELETE", path, headers=headers)

    # TODO: route stream_post through middleware chain
    def stream_post(
        self,
        path: str,
        *,
        json: Any = None,
        headers: dict[str, str] | None = None,
        timeout: float | None = None,
    ) -> Iterator[dict[str, Any]]:
        """POST with streaming response — yields parsed JSON lines/SSE events."""
        merged_headers = self._build_headers(headers)
        self._log("POST", path, json)

        with self._client.stream(
            "POST", path, json=json, headers=merged_headers, timeout=timeout,
        ) as resp:
            if resp.status_code >= 400:
                resp.read()
                raise_for_status(resp)
            for line in resp.iter_lines():
                line = line.strip()
                if not line:
                    continue
                if line.startswith("data: "):
                    line = line[6:]
                if line == "[DONE]":
                    break
                try:
                    yield _json.loads(line)
                except Exception:
                    continue

    def close(self) -> None:
        self._client.close()
