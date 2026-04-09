"""VegaTasksResource — metric task operations."""
from __future__ import annotations

from typing import TYPE_CHECKING

from kweaver.types import VegaMetricTask

if TYPE_CHECKING:
    from kweaver._http import HttpClient

_METRIC_BASE = "/api/mdl-data-model/v1/metric-tasks"


class VegaTasksResource:
    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def get_metric(self, task_id: str) -> VegaMetricTask:
        data = self._http.get(f"{_METRIC_BASE}/{task_id}")
        if isinstance(data, dict) and "entries" in data:
            data = data["entries"][0] if data["entries"] else data
        return VegaMetricTask(**data)
