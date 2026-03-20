"""VegaNamespace -- all Vega resources under one namespace."""
from __future__ import annotations
import logging
from typing import TYPE_CHECKING
from kweaver.resources.vega.models import (
    VegaMetricModelsResource, VegaEventModelsResource, VegaTraceModelsResource,
    VegaDataViewsResource, VegaDataDictsResource, VegaObjectiveModelsResource,
)
from kweaver.resources.vega.query import VegaQueryResource
from kweaver.resources.vega.catalogs import VegaCatalogsResource
from kweaver.resources.vega.resources import VegaResourcesResource
from kweaver.resources.vega.connector_types import VegaConnectorTypesResource
from kweaver.resources.vega.tasks import VegaTasksResource
from kweaver.types import (
    VegaServerInfo, VegaPlatformStats, VegaInspectReport, VegaHealthReport,
)

if TYPE_CHECKING:
    from kweaver._http import HttpClient

logger = logging.getLogger(__name__)


class VegaNamespace:
    def __init__(self, http: HttpClient) -> None:
        self._http = http
        self.metric_models = VegaMetricModelsResource(http)
        self.event_models = VegaEventModelsResource(http)
        self.trace_models = VegaTraceModelsResource(http)
        self.data_views = VegaDataViewsResource(http)
        self.data_dicts = VegaDataDictsResource(http)
        self.objective_models = VegaObjectiveModelsResource(http)
        self.query = VegaQueryResource(http)
        self.catalogs = VegaCatalogsResource(http)
        self.resources = VegaResourcesResource(http)
        self.connector_types = VegaConnectorTypesResource(http)
        self.tasks = VegaTasksResource(http)

    def health(self) -> VegaServerInfo:
        """Return Vega server info from the /health endpoint."""
        data = self._http.get("/health")
        return VegaServerInfo(**data)

    def stats(self) -> VegaPlatformStats:
        """Return composite platform statistics (best-effort; partial on failure).

        Counts are capped at limit=100 per resource type. Use the platform API
        for exact totals if available.
        """
        s = VegaPlatformStats()
        _LIMIT = 100
        fetch_map = [
            (self.catalogs, "catalog_count"),
            (self.metric_models, "metric_model_count"),
            (self.event_models, "event_model_count"),
            (self.trace_models, "trace_model_count"),
            (self.data_views, "data_view_count"),
            (self.data_dicts, "data_dict_count"),
            (self.objective_models, "objective_model_count"),
        ]
        for resource, attr in fetch_map:
            try:
                items = resource.list(limit=_LIMIT)
                setattr(s, attr, len(items))
            except Exception as exc:
                logger.debug("stats: failed to fetch %s: %s", attr, exc)
        return s

    def inspect(self, *, full: bool = False) -> VegaInspectReport:
        """Return a one-shot health + catalog + tasks report (partial on failure)."""
        server_info: VegaServerInfo | None = None
        try:
            server_info = self.health()
        except Exception as exc:
            logger.debug("inspect: failed to fetch health: %s", exc)

        catalog_health = VegaHealthReport()
        try:
            cats = self.catalogs.list(limit=100)
            catalog_health.catalogs = cats
            catalog_health.healthy_count = sum(
                1 for c in cats if c.health_status == "healthy"
            )
            catalog_health.degraded_count = sum(
                1 for c in cats if c.health_status == "degraded"
            )
            catalog_health.unhealthy_count = sum(
                1 for c in cats if c.health_status == "unhealthy"
            )
            catalog_health.offline_count = sum(
                1 for c in cats
                if c.health_status not in ("healthy", "degraded", "unhealthy")
            )
        except Exception as exc:
            logger.debug("inspect: failed to fetch catalogs: %s", exc)

        active_tasks = []
        try:
            active_tasks = self.tasks.list_discover(status="running")
        except Exception as exc:
            logger.debug("inspect: failed to fetch tasks: %s", exc)

        return VegaInspectReport(
            server_info=server_info,
            catalog_health=catalog_health,
            active_tasks=active_tasks,
        )
