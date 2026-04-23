"""KWeaverClient — main entry point for the SDK."""

from __future__ import annotations

from typing import Any

import httpx

from kweaver._auth import AuthProvider, ConfigAuth, TokenAuth
from kweaver._http import HttpClient
from kweaver._middleware import Middleware
from kweaver._middleware.debug import DebugMiddleware
from kweaver._middleware.dry_run import DryRunMiddleware
from kweaver.resources.agents import AgentsResource
from kweaver.resources.concept_groups import ConceptGroupsResource
from kweaver.resources.conversations import ConversationsResource
from kweaver.resources.dataflows import DataflowsResource
from kweaver.resources.dataflow_v2 import DataflowV2Resource
from kweaver.resources.datasources import DataSourcesResource
from kweaver.resources.dataviews import DataViewsResource
from kweaver.resources.knowledge_networks import KnowledgeNetworksResource
from kweaver.resources.object_types import ObjectTypesResource
from kweaver.resources.action_types import ActionTypesResource
from kweaver.resources.query import QueryResource
from kweaver.resources.jobs import JobsResource
from kweaver.resources.relation_types import RelationTypesResource
from kweaver.resources.skills import SkillsResource
from kweaver.resources.vega import VegaNamespace


class KWeaverClient:
    """Client for the KWeaver platform.

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
        debug: bool = False,
        dry_run: bool = False,
        vega_url: str | None = None,
        tls_insecure: bool = False,
    ) -> None:
        if auth is None:
            if token is None:
                raise ValueError("Either 'token' or 'auth' must be provided")
            auth = TokenAuth(token)

        # ConfigAuth carries its own base_url + saved tlsInsecure flag
        if isinstance(auth, ConfigAuth):
            if base_url is None:
                base_url = auth.base_url
            if not tls_insecure and auth.tls_insecure:
                tls_insecure = True
        elif base_url is None:
            raise ValueError("base_url is required (unless using ConfigAuth)")

        middlewares: list[Middleware] = []
        if debug:
            middlewares.append(DebugMiddleware())
        if dry_run:
            middlewares.append(DryRunMiddleware())

        verify = not tls_insecure
        self._tls_insecure = tls_insecure

        self._http = HttpClient(
            base_url=base_url,
            auth=auth,
            account_id=account_id,
            account_type=account_type,
            business_domain=business_domain,
            timeout=timeout,
            transport=transport,
            verify=verify,
            log_requests=log_requests or debug,
            middlewares=middlewares,
        )

        # Store for lazy vega namespace creation
        self._vega_url = vega_url
        self._vega: VegaNamespace | None = None
        self._auth_provider = auth
        self._middlewares = middlewares
        self._transport = transport
        self._timeout = timeout
        self._log_requests = log_requests or debug

        self.dataflows = DataflowsResource(self._http)
        self.dataflow_v2 = DataflowV2Resource(self._http)
        self.datasources = DataSourcesResource(self._http)
        self.dataviews = DataViewsResource(self._http)
        self.knowledge_networks = KnowledgeNetworksResource(self._http)
        self.object_types = ObjectTypesResource(self._http)
        self.relation_types = RelationTypesResource(self._http)
        self.query = QueryResource(self._http)
        self.agents = AgentsResource(self._http)
        self.conversations = ConversationsResource(self._http)
        self.action_types = ActionTypesResource(self._http)
        self.jobs = JobsResource(self._http)
        self.concept_groups = ConceptGroupsResource(self._http)
        self.skills = SkillsResource(self._http)

    @property
    def vega(self) -> VegaNamespace:
        """Lazily create and return a VegaNamespace instance.

        Falls back to base_url when vega_url is not explicitly configured,
        which works when Vega API is behind the same gateway as KWeaver.
        """
        if self._vega is None:
            vega_base = self._vega_url or str(self._http._client.base_url).rstrip("/")
            vega_http = HttpClient(
                base_url=vega_base,
                auth=self._auth_provider,
                timeout=self._timeout,
                transport=self._transport,
                verify=not self._tls_insecure,
                log_requests=self._log_requests,
                middlewares=self._middlewares,
            )
            self._vega = VegaNamespace(vega_http)
        return self._vega

    def close(self) -> None:
        self._http.close()
        if self._vega is not None:
            self._vega._http.close()

    def __enter__(self) -> KWeaverClient:
        return self

    def __exit__(self, *args: Any) -> None:
        self.close()
