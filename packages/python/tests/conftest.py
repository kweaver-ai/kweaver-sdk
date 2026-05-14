"""Root test configuration — shared helpers for unit and integration tests."""

from __future__ import annotations

import json
import os
from typing import Any, Callable

import httpx
import pytest

from kweaver import KWeaverClient


# ---------------------------------------------------------------------------
# Mock transport helpers (used by unit & integration tests)
# ---------------------------------------------------------------------------


class RequestCapture:
    """Captures requests made through a mock transport."""

    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []

    def last_body(self) -> Any:
        return json.loads(self.requests[-1].content)

    def last_url(self) -> str:
        return str(self.requests[-1].url)

    def last_headers(self) -> httpx.Headers:
        return self.requests[-1].headers


def make_mock_transport(
    handler: Callable[[httpx.Request], httpx.Response],
    capture: RequestCapture | None = None,
) -> httpx.MockTransport:
    def _handler(request: httpx.Request) -> httpx.Response:
        if capture is not None:
            capture.requests.append(request)
        return handler(request)

    return httpx.MockTransport(_handler)


def make_client(
    handler: Callable[[httpx.Request], httpx.Response],
    capture: RequestCapture | None = None,
    **kwargs,
) -> KWeaverClient:
    transport = make_mock_transport(handler, capture)
    return KWeaverClient(base_url="https://mock", token="test-token", transport=transport, **kwargs)


@pytest.fixture
def capture() -> RequestCapture:
    return RequestCapture()


@pytest.fixture
def client() -> KWeaverClient:
    """Integration-test fixture: connects to a real server when
    ``KWEAVER_BASE_URL`` and ``KWEAVER_TOKEN`` are set, otherwise
    falls back to a basic mock transport."""
    base_url = os.environ.get("KWEAVER_BASE_URL")
    token = os.environ.get("KWEAVER_TOKEN")
    if base_url and token:
        c = KWeaverClient(base_url=base_url, token=token)
    else:
        transport = httpx.MockTransport(
            lambda r: httpx.Response(200, json={"code": 0, "data": {}})
        )
        c = KWeaverClient(base_url="https://mock", token="tok", transport=transport)
    yield c
    c.close()
