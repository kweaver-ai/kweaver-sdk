"""KWeaver SDK — CLI and client library for KWeaver knowledge networks."""

from __future__ import annotations

from typing import Iterator

from kweaver._auth import ConfigAuth, OAuth2Auth, OAuth2BrowserAuth, PasswordAuth, TokenAuth
from kweaver._client import KWeaverClient
from kweaver._errors import (
    KWeaverError,
    AuthenticationError,
    AuthorizationError,
    ConflictError,
    NetworkError,
    NotFoundError,
    ServerError,
    ValidationError,
)
from kweaver.types import (
    Agent,
    BuildJob,
    KnowledgeNetwork,
    Message,
    MessageChunk,
    SemanticSearchResult,
)

__all__ = [
    # Client
    "KWeaverClient",
    # Auth
    "TokenAuth",
    "PasswordAuth",
    "OAuth2Auth",
    "ConfigAuth",
    "OAuth2BrowserAuth",
    # Errors
    "KWeaverError",
    "AuthenticationError",
    "AuthorizationError",
    "ConflictError",
    "NetworkError",
    "NotFoundError",
    "ServerError",
    "ValidationError",
    # Module-level API
    "configure",
    "weaver",
    "search",
    "agents",
    "chat",
    "bkns",
]

# ── Global state ──────────────────────────────────────────────────────────────

_default_client: KWeaverClient | None = None
_default_bkn_id: str | None = None
_default_agent_id: str | None = None


# ── configure() ───────────────────────────────────────────────────────────────

def configure(
    url: str,
    *,
    token: str | None = None,
    username: str | None = None,
    password: str | None = None,
    config: bool = False,
    bkn_id: str | None = None,
    agent_id: str | None = None,
) -> None:
    """Initialize the default KWeaver client.

    Auth priority: token > username+password > config file.

    Args:
        url: KWeaver base URL, e.g. "https://kweaver.example.com".
        token: Bearer token for TokenAuth.
        username: Username for PasswordAuth (requires password).
        password: Password for PasswordAuth (requires username).
        config: If True, use credentials from the local config file (~/.kweaver/).
            When config=True, url is ignored — the base URL comes from the saved
            platform config, preventing accidental cross-environment credential leaks.
        bkn_id: Default BKN ID used by search() and weaver().
        agent_id: Default agent ID used by chat().

    Example::

        import kweaver
        kweaver.configure("https://kweaver.example.com", token="my-token", bkn_id="abc123")
    """
    global _default_client, _default_bkn_id, _default_agent_id

    if token:
        auth = TokenAuth(token)
        _default_client = KWeaverClient(base_url=url, auth=auth)
    elif username and password:
        auth = PasswordAuth(base_url=url, username=username, password=password)
        _default_client = KWeaverClient(base_url=url, auth=auth)
    elif config:
        # ConfigAuth carries its own base_url from ~/.kweaver/ — do not pass url
        # to avoid sending credentials to the wrong environment.
        auth = ConfigAuth()
        _default_client = KWeaverClient(auth=auth)
    else:
        raise ValueError("Provide token=, username+password=, or config=True")
    _default_bkn_id = bkn_id
    _default_agent_id = agent_id


def _require_client() -> KWeaverClient:
    if _default_client is None:
        raise RuntimeError(
            "No KWeaver client configured. Call kweaver.configure() first."
        )
    return _default_client


# ── Top-level API functions ───────────────────────────────────────────────────

def search(
    query: str,
    *,
    bkn_id: str | None = None,
    mode: str = "keyword_vector_retrieval",
    max_concepts: int = 10,
) -> SemanticSearchResult:
    """Semantic search on a BKN (Business Knowledge Network).

    Args:
        query: Natural-language search query.
        bkn_id: BKN ID. Falls back to the bkn_id set in configure().
        mode: Retrieval mode (default "keyword_vector_retrieval").
        max_concepts: Maximum number of concepts to return.

    Example::

        results = kweaver.search("供应链有哪些风险？")
        for concept in results.concepts:
            print(concept.concept_name)
    """
    client = _require_client()
    resolved_bkn_id = bkn_id or _default_bkn_id
    if not resolved_bkn_id:
        raise ValueError(
            "No bkn_id provided. Pass bkn_id= or set it in kweaver.configure()."
        )
    return client.query.semantic_search(
        resolved_bkn_id, query, mode=mode, max_concepts=max_concepts
    )


def agents(
    *,
    keyword: str | None = None,
    status: str | None = None,
    limit: int = 50,
) -> list[Agent]:
    """List agents.

    Args:
        keyword: Filter by name substring.
        status: Filter by status ("published" / "draft").
        limit: Maximum number of agents to return.

    Example::

        for agent in kweaver.agents(status="published"):
            print(agent.name)
    """
    client = _require_client()
    return client.agents.list(keyword=keyword, status=status, limit=limit)


def chat(
    message: str,
    *,
    agent_id: str | None = None,
    stream: bool = False,
    conversation_id: str = "",
) -> Message | Iterator[MessageChunk]:
    """Send a message to an agent.

    Args:
        message: User message content.
        agent_id: Agent ID. Falls back to the agent_id set in configure().
        stream: If True, return an iterator of MessageChunk objects.
        conversation_id: Existing conversation ID (omit to start a new conversation).

    Example::

        reply = kweaver.chat("分析一下供应链风险")
        print(reply.content)

        # Streaming
        for chunk in kweaver.chat("讲个故事", stream=True):
            print(chunk.delta, end="", flush=True)
    """
    client = _require_client()
    resolved_agent_id = agent_id or _default_agent_id
    if not resolved_agent_id:
        raise ValueError(
            "No agent_id provided. Pass agent_id= or set it in kweaver.configure()."
        )
    return client.conversations.send_message(
        conversation_id,
        message,
        agent_id=resolved_agent_id,
        stream=stream,
    )


def bkns(
    *,
    name: str | None = None,
    limit: int = 50,
) -> list[KnowledgeNetwork]:
    """List BKNs (Business Knowledge Networks).

    Args:
        name: Filter by exact name.
        limit: Maximum number of results to return.

    Example::

        for bkn in kweaver.bkns():
            print(bkn.id, bkn.name)
    """
    client = _require_client()
    return client.knowledge_networks.list(name=name, limit=limit)


def weaver(
    *,
    bkn_id: str | None = None,
    wait: bool = False,
    timeout: float = 300,
) -> BuildJob:
    """Trigger a full build (index rebuild) of a BKN.

    After adding or modifying data sources, object types, or relation types,
    call weaver() to rebuild the BKN index so changes are searchable by agents.

    This is only needed when you make write-side changes (e.g. added a new
    datasource, updated object types). Read-only usage (search, chat) does
    not require weaver().

    Args:
        bkn_id: BKN ID to build. Falls back to the bkn_id set in configure().
        wait: If True, block until the build completes (or raises TimeoutError).
              If False (default), return immediately with a BuildJob.
        timeout: Max seconds to wait when wait=True (default 300).

    Returns:
        BuildJob — call .poll() to check status or .wait() to block.

    Example::

        # Fire-and-forget
        job = kweaver.weaver()

        # Block until done
        kweaver.weaver(wait=True)
    """
    client = _require_client()
    resolved_bkn_id = bkn_id or _default_bkn_id
    if not resolved_bkn_id:
        raise ValueError(
            "No bkn_id provided. Pass bkn_id= or set it in kweaver.configure()."
        )
    job = client.knowledge_networks.build(resolved_bkn_id)
    if wait:
        status = job.wait(timeout=timeout)
        if status.state == "failed":
            detail = status.state_detail or "no detail"
            raise RuntimeError(f"BKN build failed for {resolved_bkn_id}: {detail}")
    return job
