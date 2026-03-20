"""Middleware chain infrastructure for HttpClient."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Protocol


@dataclass
class RequestContext:
    """Encapsulates a single HTTP request flowing through the middleware chain."""
    method: str
    path: str
    kwargs: dict[str, Any] = field(default_factory=dict)


RequestHandler = Callable[[RequestContext], Any]


class Middleware(Protocol):
    """Protocol for middleware components."""
    def wrap(self, handler: RequestHandler) -> RequestHandler: ...
