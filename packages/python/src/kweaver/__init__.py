"""KWeaver SDK — CLI and client library for KWeaver knowledge networks."""

from __future__ import annotations

import os
import threading
from typing import Iterator

from kweaver._auth import (
    ConfigAuth,
    HttpSigninAuth,
    NoAuth,
    OAuth2Auth,
    OAuth2BrowserAuth,
    TokenAuth,
)
from kweaver._client import KWeaverClient
from kweaver._errors import (
    KWeaverError,
    AuthenticationError,
    AuthorizationError,
    ConflictError,
    EndpointUnavailableError,
    NetworkError,
    NotFoundError,
    ServerError,
    ValidationError,
)
from kweaver.types import (
    Agent,
    AgentImportResult,
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
    "NoAuth",
    "HttpSigninAuth",
    "OAuth2Auth",
    "ConfigAuth",
    "OAuth2BrowserAuth",
    # Errors
    "KWeaverError",
    "AuthenticationError",
    "AuthorizationError",
    "ConflictError",
    "EndpointUnavailableError",
    "NetworkError",
    "NotFoundError",
    "ServerError",
    "ValidationError",
    # Types
    "Agent",
    "AgentImportResult",
    "BuildJob",
    "KnowledgeNetwork",
    "Message",
    "MessageChunk",
    "SemanticSearchResult",
    # Module-level API
    "configure",
    "login",
    "weaver",
    "search",
    "agents",
    "chat",
    "bkns",
]

# ── Global state ──────────────────────────────────────────────────────────────

_lock = threading.Lock()
_default_client: KWeaverClient | None = None
_default_bkn_id: str | None = None
_default_agent_id: str | None = None


# ── configure() ───────────────────────────────────────────────────────────────

def configure(
    url: str | None = None,
    *,
    token: str | None = None,
    username: str | None = None,
    password: str | None = None,
    config: bool = False,
    auth: bool | None = None,
    bkn_id: str | None = None,
    agent_id: str | None = None,
    business_domain: str | None = None,
) -> None:
    """Initialize the default KWeaver client.

    Auth priority: config > auth=False (NoAuth) > token > username+password >
    KWEAVER_NO_AUTH env (when KWEAVER_TOKEN is unset).

    Args:
        url: KWeaver base URL, e.g. "https://kweaver.example.com".
            Required unless config=True or KWEAVER_BASE_URL env var is set.
        token: Bearer token for TokenAuth.
        username: Username for HttpSigninAuth / HTTP sign-in (requires password).
        password: Password for HttpSigninAuth (requires username).
        auth: If False, use NoAuth (no Authorization headers). Requires ``url`` or
            ``KWEAVER_BASE_URL``. Incompatible with ``token``, ``username``/``password``, and ``config``.
            Alternatively set env ``KWEAVER_NO_AUTH=1`` (or ``true``/``yes``) with ``url`` or
            ``KWEAVER_BASE_URL`` when ``KWEAVER_TOKEN`` is not set (matches TS CLI behavior).
        config: If True, use credentials from the local config file (~/.kweaver/).
            When config=True, url is ignored — the base URL comes from the saved
            platform config, preventing accidental cross-environment credential leaks.
        bkn_id: Default BKN ID used by search() and weaver().
        agent_id: Default agent ID used by chat().
        business_domain: x-business-domain header value. Falls back to the
            KWEAVER_BUSINESS_DOMAIN env var, then defaults to "bd_public".

    Examples::

        # Zero-config: uses saved credentials from `kweaver auth login`
        import kweaver
        kweaver.configure(config=True, bkn_id="abc123", agent_id="ag1")

        # Explicit credentials with custom business domain
        kweaver.configure("https://kweaver.example.com", token="my-token",
                          bkn_id="abc123", business_domain="bd_enterprise")
    """
    global _default_client, _default_bkn_id, _default_agent_id

    with _lock:
        # Reset all state first so a failed re-configure never leaves a stale client.
        _default_client = None
        _default_bkn_id = None
        _default_agent_id = None

        effective_domain = business_domain or os.environ.get("KWEAVER_BUSINESS_DOMAIN")

        if config and auth is False:
            raise ValueError("Cannot use config=True with auth=False")
        if auth is False and (token or (username and password)):
            raise ValueError("Cannot combine auth=False with token= or username/password")

        if config:
            # ConfigAuth carries its own base_url from ~/.kweaver/ — do not pass url
            # to avoid sending credentials to the wrong environment.
            auth_provider = ConfigAuth()
            _default_client = KWeaverClient(auth=auth_provider, business_domain=effective_domain)
        elif auth is False:
            effective_url = url or os.environ.get("KWEAVER_BASE_URL")
            if not effective_url:
                raise ValueError("Provide url= or set KWEAVER_BASE_URL when auth=False")
            _default_client = KWeaverClient(
                base_url=effective_url, auth=NoAuth(), business_domain=effective_domain
            )
        elif token:
            effective_url = url or os.environ.get("KWEAVER_BASE_URL")
            if not effective_url:
                raise ValueError("Provide url=, config=True, or set KWEAVER_BASE_URL")
            auth_provider = TokenAuth(token)
            _default_client = KWeaverClient(
                base_url=effective_url, auth=auth_provider, business_domain=effective_domain
            )
        elif username and password:
            effective_url = url or os.environ.get("KWEAVER_BASE_URL")
            if not effective_url:
                raise ValueError("Provide url=, config=True, or set KWEAVER_BASE_URL")
            auth_provider = HttpSigninAuth(
                effective_url, username=username, password=password
            )
            _default_client = KWeaverClient(
                base_url=effective_url, auth=auth_provider, business_domain=effective_domain
            )
        elif os.environ.get("KWEAVER_NO_AUTH", "").lower() in ("1", "true", "yes") and not os.environ.get(
            "KWEAVER_TOKEN", ""
        ).strip():
            effective_url = url or os.environ.get("KWEAVER_BASE_URL")
            if not effective_url:
                raise ValueError(
                    "Provide url= or set KWEAVER_BASE_URL when KWEAVER_NO_AUTH is set"
                )
            _default_client = KWeaverClient(
                base_url=effective_url, auth=NoAuth(), business_domain=effective_domain
            )
        else:
            raise ValueError(
                "Provide token=, username+password=, config=True, or KWEAVER_NO_AUTH with url/KWEAVER_BASE_URL"
            )
        _default_bkn_id = bkn_id
        _default_agent_id = agent_id


def login(
    base_url: str,
    *,
    username: str | None = None,
    password: str | None = None,
    refresh_token: str | None = None,
    client_id: str | None = None,
    client_secret: str | None = None,
    new_password: str | None = None,
    no_auth: bool = False,
    tls_insecure: bool = False,
    open_browser: bool = True,
) -> dict:
    """One-call login. Strategy is picked from arguments. See design spec for the full matrix."""
    if no_auth:
        if username or password or refresh_token:
            raise ValueError(
                "no_auth=True is mutually exclusive with username/password/refresh_token"
            )
        from kweaver.auth import save_no_auth_platform

        return save_no_auth_platform(base_url, tls_insecure=tls_insecure)

    if refresh_token:
        if not (client_id and client_secret):
            raise ValueError("refresh_token requires client_id and client_secret")
        auth = OAuth2BrowserAuth(base_url, tls_insecure=tls_insecure)
        auth.login_with_refresh_token(
            client_id=client_id, client_secret=client_secret, refresh_token=refresh_token
        )
        from kweaver.config.store import PlatformStore

        return PlatformStore().load_token(base_url.rstrip("/"))

    if username and password:
        from kweaver.auth import http_signin

        return http_signin(
            base_url,
            username=username,
            password=password,
            client_id=client_id,
            client_secret=client_secret,
            new_password=new_password,
            tls_insecure=tls_insecure,
        )

    if username or password:
        raise ValueError("username and password must be provided together")

    auth = OAuth2BrowserAuth(base_url, tls_insecure=tls_insecure)
    auth.login(no_browser=not open_browser)
    from kweaver.config.store import PlatformStore

    return PlatformStore().load_token(base_url.rstrip("/"))


def _require_client() -> KWeaverClient:
    with _lock:
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
