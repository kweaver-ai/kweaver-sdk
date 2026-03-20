"""Generic model resource for mdl-data-model services."""
from __future__ import annotations
from typing import Any, Callable, Generic, TypeVar, TYPE_CHECKING
if TYPE_CHECKING:
    from kweaver._http import HttpClient

T = TypeVar("T")


class VegaModelResource(Generic[T]):
    def __init__(self, http: HttpClient, path: str, parse_fn: Callable[[dict], T]) -> None:
        self._http = http
        self._path = path
        self._parse = parse_fn

    def list(self, *, limit: int = 20, offset: int = 0, **params: Any) -> list[T]:
        params.update({"limit": limit, "offset": offset})
        data = self._http.get(self._path, params=params)
        entries = data.get("entries", data.get("data", [])) if isinstance(data, dict) else data
        return [self._parse(e) for e in entries]

    def get(self, id: str) -> T:
        data = self._http.get(f"{self._path}/{id}")
        if isinstance(data, dict) and "entries" in data:
            data = data["entries"][0] if data["entries"] else data
        return self._parse(data)

    def get_batch(self, ids: list[str]) -> list[T]:
        ids_str = ",".join(ids)
        data = self._http.get(f"{self._path}/{ids_str}")
        entries = data.get("entries", data.get("data", [data])) if isinstance(data, dict) else data
        return [self._parse(e) for e in entries]
