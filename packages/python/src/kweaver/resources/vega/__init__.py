"""VegaNamespace -- all Vega resources under one namespace."""
from __future__ import annotations
from typing import TYPE_CHECKING
from kweaver.resources.vega.models import (
    VegaMetricModelsResource, VegaEventModelsResource, VegaTraceModelsResource,
    VegaDataViewsResource, VegaDataDictsResource, VegaObjectiveModelsResource,
)
if TYPE_CHECKING:
    from kweaver._http import HttpClient


class VegaNamespace:
    def __init__(self, http: HttpClient) -> None:
        self._http = http
        self.metric_models = VegaMetricModelsResource(http)
        self.event_models = VegaEventModelsResource(http)
        self.trace_models = VegaTraceModelsResource(http)
        self.data_views = VegaDataViewsResource(http)
        self.data_dicts = VegaDataDictsResource(http)
        self.objective_models = VegaObjectiveModelsResource(http)
