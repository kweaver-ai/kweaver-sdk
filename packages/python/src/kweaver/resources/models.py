"""SDK resource: platform models (mf-model-manager + mf-model-api).

mf-model-manager (`/api/mf-model-manager/v1`): LLM and small-model metadata CRUD + test.
mf-model-api (`/api/mf-model-api/v1`): OpenAI-compatible chat, embedding, rerank.
"""

from __future__ import annotations

import logging
import os
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from kweaver._http import HttpClient

logger = logging.getLogger("kweaver.models")

MF_MODEL_MANAGER_PATH_PREFIX = "/api/mf-model-manager/v1"
MF_MODEL_API_PATH_PREFIX = "/api/mf-model-api/v1"


def _mf_small_invoke_model_field(
    model_name: str | None,
    model_id: str | None,
) -> str | None:
    """OpenAI-style ``model`` body field: trimmed registry name, else ``model_id`` (matches TS chat defaults)."""
    if model_name is not None and model_name.strip():
        return model_name.strip()
    if model_id is not None and model_id.strip():
        return model_id.strip()
    return None


def assert_small_model_config_adapter_exclusive(body: dict[str, Any]) -> None:
    """Ensure small-model bodies do not mix non-empty model_config with adapter mode."""
    cfg = body.get("model_config")
    has_config = (
        cfg is not None
        and isinstance(cfg, dict)
        and len(cfg) > 0
    )
    adapter = body.get("adapter") is True
    code_raw = body.get("adapter_code")
    code = isinstance(code_raw, str) and len(code_raw) > 0
    if has_config and (adapter or code):
        raise ValueError("model_config cannot be combined with adapter or adapter_code.")
    if not has_config and (not adapter or not code):
        raise ValueError(
            "Either model_config (non-empty) or adapter=true with adapter_code is required."
        )
    if adapter and not code:
        raise ValueError("adapter=true requires adapter_code.")


def assert_small_model_edit_body(body: dict[str, Any]) -> None:
    """Validate mutual exclusion for small-model edit when config/adapter fields are present."""
    cfg = body.get("model_config")
    has_config = (
        cfg is not None
        and isinstance(cfg, dict)
        and len(cfg) > 0
    )
    adapter = body.get("adapter") is True
    code_raw = body.get("adapter_code")
    code = isinstance(code_raw, str) and len(code_raw) > 0
    if not has_config and not adapter and not code:
        return
    assert_small_model_config_adapter_exclusive(body)


def _resolve_origin(platform_base: str, override: str | None, env_key: str) -> str:
    env_val = os.environ.get(env_key, "").strip()
    raw = override or (env_val if env_val else None) or platform_base
    return raw.rstrip("/")


def _openai_completion_text(data: dict[str, Any]) -> str:
    choices = data.get("choices")
    if not isinstance(choices, list) or not choices:
        return ""
    first = choices[0]
    if not isinstance(first, dict):
        return ""
    msg = first.get("message")
    if isinstance(msg, dict):
        c = msg.get("content")
        if isinstance(c, str):
            return c
    return ""


def _openai_delta_text(chunk: dict[str, Any]) -> str:
    choices = chunk.get("choices")
    if not isinstance(choices, list) or not choices:
        return ""
    first = choices[0]
    if not isinstance(first, dict):
        return ""
    delta = first.get("delta")
    if isinstance(delta, dict):
        c = delta.get("content")
        if isinstance(c, str):
            return c
    return ""


class ModelsResource:
    """mf-model-manager CRUD + mf-model-api invocation."""

    def __init__(
        self,
        http: HttpClient,
        *,
        manager_base_url: str | None = None,
        api_base_url: str | None = None,
    ) -> None:
        self._http = http
        self._manager_base_override = manager_base_url
        self._api_base_override = api_base_url
        self.llm = LlmModelsSubresource(self)
        self.small = SmallModelsSubresource(self)
        self.invocation = ModelInvocationSubresource(self)

    def _platform_origin(self) -> str:
        return str(self._http._client.base_url).rstrip("/")

    def _manager_url(self, rel: str) -> str:
        origin = _resolve_origin(
            self._platform_origin(),
            self._manager_base_override,
            "KWEAVER_MF_MODEL_MANAGER_URL",
        )
        r = rel if rel.startswith("/") else f"/{rel}"
        return f"{origin}{MF_MODEL_MANAGER_PATH_PREFIX}{r}"

    def _api_url(self, rel: str) -> str:
        origin = _resolve_origin(
            self._platform_origin(),
            self._api_base_override,
            "KWEAVER_MF_MODEL_API_URL",
        )
        r = rel if rel.startswith("/") else f"/{rel}"
        return f"{origin}{MF_MODEL_API_PATH_PREFIX}{r}"


class LlmModelsSubresource:
    def __init__(self, root: ModelsResource) -> None:
        self._root = root

    def list(
        self,
        *,
        page: int = 1,
        size: int = 30,
        order: str = "desc",
        rule: str = "update_time",
        series: str = "all",
        name: str = "",
        api_model: str = "",
        model_type: str = "",
        quota: bool | None = None,
    ) -> Any:
        params: dict[str, Any] = {
            "page": page,
            "size": size,
            "order": order,
            "rule": rule,
            "series": series,
            "name": name,
            "api_model": api_model,
            "model_type": model_type,
        }
        if quota is not None:
            params["quota"] = str(quota).lower()
        return self._root._http.get(self._root._manager_url("/llm/list"), params=params)

    def get(self, model_id: str) -> Any:
        return self._root._http.get(
            self._root._manager_url("/llm/get"),
            params={"model_id": model_id},
        )

    def add(self, body: dict[str, Any]) -> Any:
        return self._root._http.post(
            self._root._manager_url("/llm/add"),
            json=body,
            headers={"content-type": "application/json"},
        )

    def edit(self, body: dict[str, Any]) -> Any:
        return self._root._http.post(
            self._root._manager_url("/llm/edit"),
            json=body,
            headers={"content-type": "application/json"},
        )

    def delete(self, model_ids: list[str]) -> Any:
        return self._root._http.post(
            self._root._manager_url("/llm/delete"),
            json={"model_ids": model_ids},
            headers={"content-type": "application/json"},
        )

    def test(self, body: dict[str, Any]) -> Any:
        return self._root._http.post(
            self._root._manager_url("/llm/test"),
            json=body,
            headers={"content-type": "application/json"},
        )


class SmallModelsSubresource:
    def __init__(self, root: ModelsResource) -> None:
        self._root = root

    def list(
        self,
        *,
        page: int = 1,
        size: int = 30,
        order: str = "desc",
        rule: str = "update_time",
        model_name: str = "",
        model_type: str = "",
        model_series: str = "",
    ) -> Any:
        params: dict[str, Any] = {
            "order": order,
            "rule": rule,
            "page": page,
            "size": size,
            "model_name": model_name,
            "model_type": model_type,
            "model_series": model_series,
        }
        return self._root._http.get(
            self._root._manager_url("/small-model/list"),
            params=params,
        )

    def get(self, model_id: str) -> Any:
        return self._root._http.get(
            self._root._manager_url("/small-model/get"),
            params={"model_id": model_id},
        )

    def add(self, body: dict[str, Any]) -> Any:
        assert_small_model_config_adapter_exclusive(body)
        return self._root._http.post(
            self._root._manager_url("/small-model/add"),
            json=body,
            headers={"content-type": "application/json"},
        )

    def edit(self, body: dict[str, Any]) -> Any:
        assert_small_model_edit_body(body)
        return self._root._http.post(
            self._root._manager_url("/small-model/edit"),
            json=body,
            headers={"content-type": "application/json"},
        )

    def delete(self, model_ids: list[str]) -> Any:
        return self._root._http.post(
            self._root._manager_url("/small-model/delete"),
            json={"model_ids": model_ids},
            headers={"content-type": "application/json"},
        )

    def test(self, body: dict[str, Any]) -> Any:
        return self._root._http.post(
            self._root._manager_url("/small-model/test"),
            json=body,
            headers={"content-type": "application/json"},
        )


class ModelInvocationSubresource:
    def __init__(self, root: ModelsResource) -> None:
        self._root = root

    def chat(
        self,
        *,
        model_id: str,
        messages: list[dict[str, str]],
        stream: bool = False,
        temperature: float | None = None,
        max_tokens: int | None = None,
        top_p: float | None = None,
        top_k: int | None = None,
        presence_penalty: float | None = None,
        frequency_penalty: float | None = None,
        cache: bool | None = None,
        verbose: bool = False,
        timeout: float | None = 120.0,
    ) -> dict[str, Any]:
        """OpenAI-compatible chat; returns ``{"text": str, "raw": ...}``.

        ``model`` and ``model_id`` in the request body are both set to ``model_id``.
        """
        if verbose:
            logger.debug("model chat stream=%s model_id=%s", stream, model_id)
        body: dict[str, Any] = {
            "model": model_id,
            "model_id": model_id,
            "messages": messages,
            "stream": stream,
        }
        if temperature is not None:
            body["temperature"] = temperature
        if max_tokens is not None:
            body["max_tokens"] = max_tokens
        if top_p is not None:
            body["top_p"] = top_p
        if top_k is not None:
            body["top_k"] = top_k
        if presence_penalty is not None:
            body["presence_penalty"] = presence_penalty
        if frequency_penalty is not None:
            body["frequency_penalty"] = frequency_penalty
        if cache is not None:
            body["cache"] = cache

        url = self._root._api_url("/chat/completions")
        if stream:
            parts: list[str] = []
            for chunk in self._root._http.stream_post(
                url,
                json=body,
                headers={
                    "content-type": "application/json",
                    "accept": "text/event-stream",
                },
                timeout=timeout,
            ):
                if not isinstance(chunk, dict):
                    continue
                parts.append(_openai_delta_text(chunk))
            return {"text": "".join(parts), "raw": None}

        raw = self._root._http.post(
            url,
            json=body,
            headers={
                "content-type": "application/json",
                "accept": "application/json",
            },
            timeout=timeout,
        )
        if isinstance(raw, dict):
            return {"text": _openai_completion_text(raw), "raw": raw}
        return {"text": "", "raw": raw}

    def embedding(
        self,
        *,
        input: list[str],
        model_id: str | None = None,
        model_name: str | None = None,
    ) -> Any:
        body: dict[str, Any] = {"input": input}
        if model_id:
            body["model_id"] = model_id
        mf_model = _mf_small_invoke_model_field(model_name, model_id)
        if mf_model is not None:
            body["model"] = mf_model
        return self._root._http.post(
            self._root._api_url("/small-model/embedding"),
            json=body,
            headers={"content-type": "application/json"},
        )

    def embeddings(
        self,
        *,
        input: list[str],
        model_id: str | None = None,
        model_name: str | None = None,
    ) -> Any:
        body: dict[str, Any] = {"input": input}
        if model_id:
            body["model_id"] = model_id
        mf_model = _mf_small_invoke_model_field(model_name, model_id)
        if mf_model is not None:
            body["model"] = mf_model
        return self._root._http.post(
            self._root._api_url("/small-model/embeddings"),
            json=body,
            headers={"content-type": "application/json"},
        )

    def rerank(
        self,
        *,
        query: str,
        documents: list[str],
        model_id: str | None = None,
        model_name: str | None = None,
    ) -> Any:
        body: dict[str, Any] = {"query": query, "documents": documents}
        if model_id:
            body["model_id"] = model_id
        mf_model = _mf_small_invoke_model_field(model_name, model_id)
        if mf_model is not None:
            body["model"] = mf_model
        return self._root._http.post(
            self._root._api_url("/small-model/reranker"),
            json=body,
            headers={"content-type": "application/json"},
        )
