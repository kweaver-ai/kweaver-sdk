"""ADPClient — main entry point for the SDK."""

from __future__ import annotations

from typing import Any

import httpx

from kweaver._auth import AuthProvider, ConfigAuth, TokenAuth
from kweaver._http import HttpClient
from kweaver.resources.agents import AgentsResource
from kweaver.resources.conversations import ConversationsResource
from kweaver.resources.datasources import DataSourcesResource
from kweaver.resources.dataviews import DataViewsResource
from kweaver.resources.knowledge_networks import KnowledgeNetworksResource
from kweaver.resources.object_types import ObjectTypesResource
from kweaver.resources.action_types import ActionTypesResource
from kweaver.resources.query import QueryResource
from kweaver.resources.relation_types import RelationTypesResource


class ADPClient:
    """Client for the ADP platform.

    Provides access to all SDK resource modules via attribute-style access.
    Thread-safe and stateless (does not hold business data).
    """

    def __init__(
        self,
        base_url: str | None = None,
        *,
        token: str | None = None,
        auth: AuthProvider | None = None,
        account_id: str | None = None,
        account_type: str | None = None,
        business_domain: str | None = None,
        timeout: float = 30.0,
        transport: httpx.BaseTransport | None = None,
        log_requests: bool = False,
    ) -> None:
        if auth is None:
            if token is None:
                raise ValueError("Either 'token' or 'auth' must be provided")
            auth = TokenAuth(token)

        # ConfigAuth carries its own base_url
        if base_url is None:
            if isinstance(auth, ConfigAuth):
                base_url = auth.base_url
            else:
                raise ValueError(
                    "base_url is required (unless using ConfigAuth)"
                )

        self._http = HttpClient(
            base_url=base_url,
            auth=auth,
            account_id=account_id,
            account_type=account_type,
            business_domain=business_domain,
            timeout=timeout,
            transport=transport,
            log_requests=log_requests,
        )

        self.datasources = DataSourcesResource(self._http)
        self.dataviews = DataViewsResource(self._http)
        self.knowledge_networks = KnowledgeNetworksResource(self._http)
        self.object_types = ObjectTypesResource(self._http)
        self.relation_types = RelationTypesResource(self._http)
        self.query = QueryResource(self._http)
        self.agents = AgentsResource(self._http)
        self.conversations = ConversationsResource(self._http)
        self.action_types = ActionTypesResource(self._http)

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> ADPClient:
        return self

    def __exit__(self, *args: Any) -> None:
        self.close()
