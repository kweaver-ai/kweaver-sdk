"""SDK resource: conversations (agent-app service).

Actual backend endpoints (agent-app v1):
  - Chat:         POST /api/agent-app/v1/app/{app_key}/chat/completion
  - Debug:        POST /api/agent-app/v1/app/{app_key}/debug/completion
  - Terminate:    POST /api/agent-app/v1/app/{app_key}/chat/termination
  - Resume:       POST /api/agent-app/v1/app/{app_key}/chat/resume
  - List convs:   GET  /api/agent-app/v1/app/{agent_id}/conversations
  - List msgs:    GET  /api/agent-app/v1/conversations/{id}/messages
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Iterator

from kweaver._errors import NotFoundError
from kweaver.types import Conversation, Message, MessageChunk, Reference

if TYPE_CHECKING:
    from kweaver._http import HttpClient


class ConversationsResource:
    """Agent-app chat, streaming chunks, conversation/message listing — see module docstring."""

    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def create(
        self, agent_id: str, *, title: str | None = None
    ) -> Conversation:
        """Create a logical conversation handle (client-side).

        The actual backend does not have a separate "create conversation" API.
        Conversations are implicitly created on first message.  The real
        conversation_id is assigned by the backend in the first response.
        Pass the returned Conversation to send_message; the SDK will omit the
        conversation_id on the first call so the backend creates one.
        """
        return Conversation(
            id="",
            agent_id=agent_id,
            title=title,
            message_count=0,
            last_active=None,
        )

    def send_message(
        self,
        conversation_id: str,
        content: str,
        *,
        agent_id: str,
        agent_version: str = "latest",
        stream: bool = False,
        debug: bool = False,
        history: list[dict[str, str]] | None = None,
    ) -> Message | Iterator[MessageChunk]:
        """Send a message to an agent.

        Args:
            conversation_id: Conversation ID (from create()).
            content: The user query.
            agent_id: Agent ID (used as app_key in URL).
            agent_version: Agent version (default "latest").
            stream: Whether to stream the response.
            debug: Use debug/completion endpoint instead of chat/completion.
            history: Optional conversation history.
        """
        if debug:
            path = f"/api/agent-app/v1/app/{agent_id}/debug/completion"
            body: dict[str, Any] = {
                "agent_id": agent_id,
                "agent_version": agent_version,
                "input": {
                    "query": content,
                    "history": history or [],
                },
            }
        else:
            path = f"/api/agent-app/v1/app/{agent_id}/chat/completion"
            body = {
                "agent_id": agent_id,
                "agent_version": agent_version,
                "query": content,
                "conversation_id": conversation_id,
                "stream": stream,
                "inc_stream": False,
            }
            if history is not None:
                body["history"] = history

        if body.get("conversation_id"):
            body["chat_option"] = {"is_need_history": True}
        else:
            # Remove empty conversation_id; backend treats absent as "new conversation".
            body.pop("conversation_id", None)

        if not stream:
            data = self._http.post(path, json=body, timeout=120.0)
            return _parse_message(data)

        return self._stream_message(path, body)

    def _stream_message(
        self, path: str, body: dict[str, Any]
    ) -> Iterator[MessageChunk]:
        body["stream"] = True
        body["inc_stream"] = True
        for event in self._http.stream_post(path, json=body, timeout=120.0):
            refs = [Reference(**r) for r in event.get("references", [])]
            yield MessageChunk(
                delta=event.get("delta", event.get("answer", "")),
                finished=event.get("finished", False),
                references=refs,
            )

    def terminate(self, agent_id: str, conversation_id: str) -> None:
        """Terminate an ongoing conversation."""
        self._http.post(
            f"/api/agent-app/v1/app/{agent_id}/chat/termination",
            json={"conversation_id": conversation_id},
        )

    def delete(self, id: str, *, agent_id: str | None = None) -> None:
        """Delete / terminate a conversation.

        The backend doesn't have a dedicated delete API;
        this calls termination if agent_id is provided.
        """
        if agent_id:
            self.terminate(agent_id, id)

    def list(
        self, *, agent_id: str | None = None, limit: int | None = None
    ) -> list[Conversation]:
        """List conversations for an agent.

        Returns [] if the endpoint returns 404 (not available in all deployments).
        """
        if not agent_id:
            return []
        path = f"/api/agent-app/v1/app/{agent_id}/conversations"
        params: dict[str, Any] = {}
        if limit is not None:
            params["limit"] = limit
        try:
            data = self._http.get(path, params=params or None)
        except NotFoundError:
            return []
        items = _extract_list(data, "entries", "items", "list", "data")
        return [_parse_conversation(d) for d in items]

    def get(self, id: str) -> Conversation:
        """Get conversation by ID. Note: may not be available in all deployments."""
        return Conversation(id=id, agent_id="")

    def list_messages(
        self,
        conversation_id: str,
        *,
        limit: int | None = None,
        offset: int | None = None,
    ) -> list[Message]:
        """List messages in a conversation.

        Returns [] if the endpoint returns 404 (not available in all deployments).
        """
        path = f"/api/agent-app/v1/conversations/{conversation_id}/messages"
        params: dict[str, Any] = {}
        if limit is not None:
            params["limit"] = limit
        if offset is not None:
            params["offset"] = offset
        try:
            data = self._http.get(path, params=params or None)
        except NotFoundError:
            return []
        items = _extract_list(data, "entries", "items", "messages", "list", "data")
        return [_parse_message_item(d) for d in items]

    def get_traces_by_conversation(self, conversation_id: str) -> dict[str, Any]:
        """Get trace data for a conversation.

        Args:
            conversation_id: The conversation ID to query traces for.

        Returns:
            Trace data as a dictionary.
        """
        path = "/api/agent-observability/v1/traces/by-conversation"
        data = self._http.get(path, params={"conversation_id": conversation_id})
        return data if isinstance(data, dict) else {}


def _extract_list(data: Any, *keys: str) -> list[Any]:
    """Extract list from response dict or return data if already a list."""
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for k in keys:
            v = data.get(k)
            if isinstance(v, list):
                return v
    return []


def _parse_conversation(d: Any) -> Conversation:
    return Conversation(
        id=str(d.get("id", d.get("conversation_id", ""))),
        agent_id=d.get("agent_id", ""),
        title=d.get("title"),
        message_count=d.get("message_count", 0),
        last_active=d.get("last_active"),
    )


def _parse_message_item(d: Any) -> Message:
    """Parse a message from list_messages response."""
    content = d.get("content", "")
    if isinstance(content, dict):
        content = content.get("text", content.get("answer", str(content)))
    refs = [Reference(**r) for r in (d.get("references") or []) if isinstance(r, dict)]
    return Message(
        id=str(d.get("id", d.get("message_id", ""))),
        role=d.get("role", "assistant"),
        content=str(content) if content else "",
        references=refs,
        timestamp=d.get("timestamp", d.get("created_at", "")),
        conversation_id=d.get("conversation_id", ""),
    )


def _extract_answer_text(d: Any) -> str:
    """Extract answer text from various agent-app response layouts."""
    msg = d.get("message") or d
    content = msg.get("content")
    if isinstance(content, dict):
        fa = content.get("final_answer") or {}
        ans = fa.get("answer")
        if isinstance(ans, dict):
            return ans.get("text", "")
        if isinstance(ans, str):
            return ans
        return ""
    if isinstance(content, str) and content:
        return content
    return d.get("answer") or msg.get("answer") or ""


def _parse_message(d: Any) -> Message:
    refs = [Reference(**r) for r in (d.get("references") or [])]
    content = _extract_answer_text(d)
    msg = d.get("message") or d
    msg_id = (
        msg.get("id")
        or d.get("assistant_message_id")
        or d.get("message_id")
        or ""
    )
    conv_id = d.get("conversation_id") or msg.get("conversation_id") or ""
    return Message(
        id=str(msg_id),
        role=msg.get("role", "assistant"),
        content=content,
        references=refs,
        timestamp=msg.get("timestamp") or d.get("created_at") or "",
        conversation_id=conv_id,
    )
