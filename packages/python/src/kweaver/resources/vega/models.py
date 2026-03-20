"""All 6 Vega model resources via VegaModelResource subclasses."""
from __future__ import annotations
from typing import TYPE_CHECKING
from kweaver.resources.vega._base import VegaModelResource
from kweaver.types import (
    VegaMetricModel, VegaEventModel, VegaTraceModel,
    VegaDataView, VegaDataDict, VegaObjectiveModel,
)
if TYPE_CHECKING:
    from kweaver._http import HttpClient

_MDL = "/api/mdl-data-model/v1"


class VegaMetricModelsResource(VegaModelResource[VegaMetricModel]):
    def __init__(self, http: HttpClient):
        super().__init__(http, f"{_MDL}/metric-models", lambda d: VegaMetricModel(**d))


class VegaEventModelsResource(VegaModelResource[VegaEventModel]):
    def __init__(self, http: HttpClient):
        super().__init__(http, f"{_MDL}/event-models", lambda d: VegaEventModel(**d))


class VegaTraceModelsResource(VegaModelResource[VegaTraceModel]):
    def __init__(self, http: HttpClient):
        super().__init__(http, f"{_MDL}/trace-models", lambda d: VegaTraceModel(**d))


class VegaDataViewsResource(VegaModelResource[VegaDataView]):
    def __init__(self, http: HttpClient):
        super().__init__(http, f"{_MDL}/data-views", lambda d: VegaDataView(**d))


class VegaDataDictsResource(VegaModelResource[VegaDataDict]):
    def __init__(self, http: HttpClient):
        super().__init__(http, f"{_MDL}/data-dicts", lambda d: VegaDataDict(**d))


class VegaObjectiveModelsResource(VegaModelResource[VegaObjectiveModel]):
    def __init__(self, http: HttpClient):
        super().__init__(http, f"{_MDL}/objective-models", lambda d: VegaObjectiveModel(**d))
