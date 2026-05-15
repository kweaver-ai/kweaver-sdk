"""Tests for conversations resource (agent-app v1 API)."""

from unittest.mock import patch

import httpx

from tests.conftest import RequestCapture, make_client


def test_create_conversation():
    """Create returns a client-side conversation handle (no backend call)."""
    client = make_client(lambda r: httpx.Response(200, json={}))
    conv = client.conversations.create("agent_01", title="测试会话")
    assert conv.id == ""  # Placeholder; backend assigns ID on first message
    assert conv.agent_id == "agent_01"
    assert conv.title == "测试会话"


def test_send_message_sync(capture: RequestCapture):
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={
            "message_id": "msg_02", "role": "assistant",
            "answer": "物料库存充足",
            "references": [
                {"source": "库存表", "content": "华东仓 1200件", "score": 0.95},
            ],
            "created_at": "2026-03-12T10:01:00Z",
        })

    client = make_client(handler, capture)
    reply = client.conversations.send_message(
        "conv_01", "库存情况？", agent_id="agent_01",
    )
    assert reply.role == "assistant"
    assert reply.content == "物料库存充足"
    assert len(reply.references) == 1
    assert reply.references[0].source == "库存表"
    body = capture.last_body()
    assert body["query"] == "库存情况？"
    assert body["agent_id"] == "agent_01"
    assert body["chat_option"] == {"is_need_history": True}
    assert "/app/agent_01/chat/completion" in capture.last_url()


def test_send_message_debug(capture: RequestCapture):
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={
            "message_id": "msg_03", "answer": "调试回复",
        })

    client = make_client(handler, capture)
    reply = client.conversations.send_message(
        "conv_01", "测试问题", agent_id="agent_01", debug=True,
    )
    assert reply.content == "调试回复"
    assert "/app/agent_01/debug/completion" in capture.last_url()
    body = capture.last_body()
    assert body["input"]["query"] == "测试问题"


def test_send_message_stream():
    chunks = [
        {"delta": "物料", "finished": False, "references": []},
        {"delta": "库存充足", "finished": True,
         "references": [{"source": "库存表", "content": "1200件", "score": 0.9}]},
    ]
    client = make_client(lambda r: httpx.Response(200, json={}))
    with patch.object(
        client.conversations._http, "stream_post", return_value=iter(chunks)
    ):
        result = list(
            client.conversations.send_message(
                "conv_01", "hi", agent_id="agent_01", stream=True,
            )
        )
    assert len(result) == 2
    assert result[0].delta == "物料"
    assert not result[0].finished
    assert result[1].delta == "库存充足"
    assert result[1].finished
    assert result[1].references[0].source == "库存表"


def test_terminate_conversation(capture: RequestCapture):
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(204)

    client = make_client(handler, capture)
    client.conversations.terminate("agent_01", "conv_01")
    assert "/app/agent_01/chat/termination" in capture.last_url()


def test_delete_calls_terminate(capture: RequestCapture):
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(204)

    client = make_client(handler, capture)
    client.conversations.delete("conv_01", agent_id="agent_01")
    assert "/chat/termination" in capture.last_url()


def test_list_conversations(capture: RequestCapture):
    """List conversations calls GET /app/{agent_id}/conversations."""
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={
            "entries": [
                {"id": "conv_01", "agent_id": "agent_01", "title": "Session 1", "message_count": 3},
            ],
        })

    client = make_client(handler, capture)
    convs = client.conversations.list(agent_id="agent_01")
    assert len(convs) == 1
    assert convs[0].id == "conv_01"
    assert convs[0].agent_id == "agent_01"
    assert "/app/agent_01/conversations" in capture.last_url()


def test_list_conversations_404_returns_empty():
    """404 (endpoint not available) returns empty list."""
    client = make_client(lambda r: httpx.Response(404, json={"message": "not found"}))
    convs = client.conversations.list(agent_id="agent_01")
    assert convs == []


def test_list_messages(capture: RequestCapture):
    """List messages calls GET /conversations/{id}/messages."""
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={
            "messages": [
                {"id": "msg_01", "role": "user", "content": "hello", "timestamp": "2026-03-12T10:00:00Z"},
                {"id": "msg_02", "role": "assistant", "content": "hi", "timestamp": "2026-03-12T10:00:01Z"},
            ],
        })

    client = make_client(handler, capture)
    msgs = client.conversations.list_messages("conv_01", limit=20)
    assert len(msgs) == 2
    assert msgs[0].role == "user" and msgs[0].content == "hello"
    assert msgs[1].role == "assistant" and msgs[1].content == "hi"
    assert "/conversations/conv_01/messages" in capture.last_url()
    assert "limit=20" in capture.last_url()


def test_list_messages_404_returns_empty():
    """404 (endpoint not available) returns empty list."""
    client = make_client(lambda r: httpx.Response(404, json={"message": "not found"}))
    msgs = client.conversations.list_messages("conv_01")
    assert msgs == []


def test_get_traces_by_conversation(capture: RequestCapture):
    """Get traces calls GET /api/agent-observability/v1/traces/by-conversation."""
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={
            "traces": [
                {"span_id": "span_01", "name": "query", "start_time": "2026-03-12T10:00:00Z"},
            ],
        })

    client = make_client(handler, capture)
    data = client.conversations.get_traces_by_conversation("conv_01")
    assert "traces" in data
    assert len(data["traces"]) == 1
    assert data["traces"][0]["span_id"] == "span_01"
    assert "/api/agent-observability/v1/traces/by-conversation" in capture.last_url()
    assert "conversation_id=conv_01" in capture.last_url()


def test_get_traces_by_conversation_empty():
    """Empty response returns empty dict."""
    client = make_client(lambda r: httpx.Response(200, json={}))
    data = client.conversations.get_traces_by_conversation("conv_01")
    assert data == {}
