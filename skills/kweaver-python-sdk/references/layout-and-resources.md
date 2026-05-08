# Layout and resources (`packages/python`)

## Directory layout

| Path | Role |
|------|------|
| `src/kweaver/` | Package root; `_client.py`, `_http.py`, `_auth.py`, `_errors.py`, etc. |
| `src/kweaver/resources/` | One module per API area (e.g. `agents.py`, `models.py`). Classes expose typed methods that call `HttpClient`. |
| `tests/unit/` | Unit tests — mocks only, must pass without network. |
| `tests/e2e/` | Integration tests — requires live platform + secrets (not part of default `make test`). |

## Registering a resource on `KWeaverClient`

1. Implement a resource class in `resources/<name>.py` taking `HttpClient` (and optional kwargs, e.g. model-factory base URLs).
2. Import it in [`_client.py`](../../../packages/python/src/kweaver/_client.py).
3. Instantiate and assign on `self` in `KWeaverClient.__init__` (e.g. `self.models = ModelsResource(...)`).
4. Document constructor kwargs on `KWeaverClient.__init__` if the resource needs extra base URLs.

Lazy or secondary clients (example: **`vega`**) may build a dedicated **`HttpClient`** when first accessed — follow the existing `VegaNamespace` pattern.

## Checklist for a new resource module

- **English** module and class docstrings (Google style used project-wide).
- Methods delegate URL paths and payloads to match backend contracts; align naming with **TypeScript** when a twin exists.
- Type hints for parameters and return values; raise **`kweaver._errors`** helpers where appropriate.
- Export surface: only add **`__all__`** in `resources/__init__.py` if the package already uses it for that module (prefer consistency with neighboring resources).
- Unit tests under **`tests/unit/`** with **`respx`** mocking HTTP — no real requests.

## Related files

- [`_http.py`](../../../packages/python/src/kweaver/_http.py) — retries, auth injection, business-domain header default, error mapping.
- [`_errors.py`](../../../packages/python/src/kweaver/_errors.py) — typed exceptions.
