"""Tests for models resource (mf-model-manager + mf-model-api)."""

from unittest.mock import patch

import httpx
import pytest

from kweaver.resources.models import (
    assert_small_model_config_adapter_exclusive,
    assert_small_model_edit_body,
)

from tests.conftest import RequestCapture, make_client


def test_llm_list_defaults_and_quota(capture: RequestCapture):
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"items": []})

    client = make_client(handler, capture)
    client.models.llm.list(quota=True)
    url = capture.last_url()
    assert "/api/mf-model-manager/v1/llm/list" in url
    assert "quota=true" in url
    assert "size=30" in url
    assert "page=1" in url


def test_llm_get(capture: RequestCapture):
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"model_id": "m1"})

    client = make_client(handler, capture)
    client.models.llm.get("m1")
    assert "model_id=m1" in capture.last_url()


def test_llm_delete_body(capture: RequestCapture):
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={})

    client = make_client(handler, capture)
    client.models.llm.delete(["a", "b"])
    assert capture.last_body() == {"model_ids": ["a", "b"]}
    assert "/llm/delete" in capture.last_url()


def test_small_list_defaults(capture: RequestCapture):
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"items": []})

    client = make_client(handler, capture)
    client.models.small.list()
    url = capture.last_url()
    assert "/small-model/list" in url
    assert "size=30" in url


def test_small_add_validates_exclusive():
    client = make_client(lambda r: httpx.Response(200, json={}))
    with pytest.raises(ValueError, match="model_config cannot be combined"):
        client.models.small.add(
            {
                "model_config": {"api_url": "http://x", "api_model": "m"},
                "adapter": True,
                "adapter_code": "x",
            }
        )


def test_small_edit_skips_validation_when_no_config_fields(capture: RequestCapture):
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={})

    client = make_client(handler, capture)
    client.models.small.edit({"model_id": "mid", "name": "n"})
    assert capture.last_body()["model_id"] == "mid"


def test_small_edit_validates_when_adapter_present():
    client = make_client(lambda r: httpx.Response(200, json={}))
    with pytest.raises(ValueError, match="Either model_config"):
        client.models.small.edit({"model_id": "x", "adapter": True})


def test_manager_env_override(monkeypatch: pytest.MonkeyPatch, capture: RequestCapture):
    monkeypatch.setenv("KWEAVER_MF_MODEL_MANAGER_URL", "https://mgr.example.com")

    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={})

    client = make_client(handler, capture)
    client.models.llm.get("mid")
    url = capture.last_url()
    assert url.startswith("https://mgr.example.com/api/mf-model-manager/v1/llm/get")


def test_api_env_override(monkeypatch: pytest.MonkeyPatch, capture: RequestCapture):
    monkeypatch.setenv("KWEAVER_MF_MODEL_API_URL", "https://api.example.org")

    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": "hello"}}]},
        )

    client = make_client(handler, capture)
    out = client.models.invocation.chat(
        model_id="llm-1",
        messages=[{"role": "user", "content": "hi"}],
        stream=False,
    )
    assert out["text"] == "hello"
    url = capture.last_url()
    assert url.startswith("https://api.example.org/api/mf-model-api/v1/chat/completions")


def test_chat_non_stream_body(capture: RequestCapture):
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": "ok"}}]},
        )

    client = make_client(handler, capture)
    r = client.models.invocation.chat(
        model_id="mid",
        messages=[{"role": "user", "content": "x"}],
        stream=False,
    )
    assert r["text"] == "ok"
    body = capture.last_body()
    assert body["model"] == "mid"
    assert body["model_id"] == "mid"
    assert body["stream"] is False
    assert body["messages"][0]["role"] == "user"


def test_chat_stream_deltas():
    chunks = [
        {"choices": [{"delta": {"content": "hel"}}]},
        {"choices": [{"delta": {"content": "lo"}}]},
    ]
    client = make_client(lambda r: httpx.Response(200, json={}))
    with patch.object(
        client.models.invocation._root._http,
        "stream_post",
        return_value=iter(chunks),
    ):
        r = client.models.invocation.chat(
            model_id="mid",
            messages=[{"role": "user", "content": "x"}],
            stream=True,
        )
    assert r["text"] == "hello"


def test_embedding_path(capture: RequestCapture):
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"data": []})

    client = make_client(handler, capture)
    client.models.invocation.embedding(input=["a"], model_id="sm1")
    body = capture.last_body()
    assert body["input"] == ["a"]
    assert body["model_id"] == "sm1"
    assert body["model"] == "sm1"
    assert "/small-model/embedding" in capture.last_url()


def test_embeddings_defaults_model_to_model_id(capture: RequestCapture):
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"data": []})

    client = make_client(handler, capture)
    client.models.invocation.embeddings(input=["x"], model_id="sid99")
    body = capture.last_body()
    assert body["model_id"] == "sid99"
    assert body["model"] == "sid99"
    assert "/small-model/embeddings" in capture.last_url()


def test_rerank_defaults_model_to_model_id(capture: RequestCapture):
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"results": []})

    client = make_client(handler, capture)
    client.models.invocation.rerank(query="q", documents=["d"], model_id="r1")
    body = capture.last_body()
    assert body["model_id"] == "r1"
    assert body["model"] == "r1"
    assert body["query"] == "q"
    assert body["documents"] == ["d"]


def test_assert_small_model_config_adapter_exclusive_ok():
    assert_small_model_config_adapter_exclusive(
        {"adapter": True, "adapter_code": "async def main(t): return t"}
    )
    assert_small_model_config_adapter_exclusive(
        {"model_config": {"api_url": "http://u", "api_model": "m"}}
    )


def test_assert_small_model_edit_body_empty_config_noop():
    assert_small_model_edit_body({"model_id": "x", "model_config": {}})

