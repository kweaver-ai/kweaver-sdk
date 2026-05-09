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
from kweaver.resources.bkn_metrics import BknMetricsResource
from kweaver.resources.metric_query import MetricQueryResource
from kweaver.resources.models import ModelsResource
from kweaver.resources.relation_types import RelationTypesResource
from kweaver.resources.skills import SkillsResource
from kweaver.resources.toolboxes import ToolboxesResource
from kweaver.resources.vega import VegaNamespace


class KWeaverClient:
    """Client for the KWeaver platform.

    Provides access to all SDK resource modules via attribute-style access.
    Thread-safe and stateless (does not hold business data).

    Use ``client.<name>`` for the resources below (each maps to a typed helper class
    under ``kweaver.resources``).

    BKN **metrics**: ``metrics`` (definitions on bkn-backend), ``metric_query``
    (data query and dry-run on ontology-query). These are not Vega ``metric_models``.

    Attributes:
        dataflows: Automation service DAG APIs (create/run/poll/delete).
        dataflow_v2: Document-style dataflow (v2) workflows.
        datasources: Data-connection data sources (CRUD, probe, tables).
        dataviews: MDL data views / atomic views over datasources.
        knowledge_networks: Knowledge networks (KN/BKN) lifecycle and build jobs.
        object_types: Object type schema bound to dataviews (ontology-manager).
        relation_types: Relation types between object types (ontology-manager).
        query: Semantic search, KN search, object queries, subgraph APIs.
        agents: Decision agents (agent-factory): list, CRUD, publish.
        conversations: Agent chat, streaming, conversations (agent-app).
        action_types: Action type list, execution, logs (ontology-query/manager).
        jobs: KN-scoped async jobs and tasks (ontology-manager).
        metrics: BKN metric definitions CRUD (bkn-backend); exposed as ``metrics``.
        metric_query: Metric data queries and dry-run (ontology-query).
        concept_groups: Concept groups for a KN (ontology-manager).
        skills: Skill registry, market, install (ADP APIs).
        toolboxes: Toolboxes and OpenAPI tools (agent-operator-integration).
        vega: Vega observability namespace (lazy property): catalogs, models, health, tasks.
        models: Hosted LLM/small-model registry and invocation helpers.
    """

    dataflows: DataflowsResource
    dataflow_v2: DataflowV2Resource
    datasources: DataSourcesResource
    dataviews: DataViewsResource
    knowledge_networks: KnowledgeNetworksResource
    object_types: ObjectTypesResource
    relation_types: RelationTypesResource
    query: QueryResource
    agents: AgentsResource
    conversations: ConversationsResource
    action_types: ActionTypesResource
    jobs: JobsResource
    metrics: BknMetricsResource
    metric_query: MetricQueryResource
    concept_groups: ConceptGroupsResource
    skills: SkillsResource
    toolboxes: ToolboxesResource
    models: ModelsResource

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
        mf_model_manager_base_url: str | None = None,
        mf_model_api_base_url: str | None = None,
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
        self._mf_model_manager_base_url = mf_model_manager_base_url
        self._mf_model_api_base_url = mf_model_api_base_url
        self._auth_provider = auth
        self._middlewares = middlewares
        self._transport = transport
        self._timeout = timeout
        self._log_requests = log_requests or debug

        #: Automation service DAG APIs (create/run/poll/delete).
        self.dataflows = DataflowsResource(self._http)
        #: Document-style dataflow (v2) workflows.
        self.dataflow_v2 = DataflowV2Resource(self._http)
        #: Data-connection data sources (CRUD, probe, tables).
        self.datasources = DataSourcesResource(self._http)
        #: MDL data views / atomic views over datasources.
        self.dataviews = DataViewsResource(self._http)
        #: Knowledge networks (KN/BKN) lifecycle and build jobs.
        self.knowledge_networks = KnowledgeNetworksResource(self._http)
        #: Object type schema bound to dataviews (ontology-manager).
        self.object_types = ObjectTypesResource(self._http)
        #: Relation types between object types (ontology-manager).
        self.relation_types = RelationTypesResource(self._http)
        #: Semantic search, KN search, object queries, subgraph APIs.
        self.query = QueryResource(self._http, tls_insecure=self._tls_insecure)
        #: Decision agents (agent-factory): list, CRUD, publish.
        self.agents = AgentsResource(self._http)
        #: Agent chat, streaming, conversations (agent-app).
        self.conversations = ConversationsResource(self._http)
        #: Action type list, execution, logs (ontology-query/manager).
        self.action_types = ActionTypesResource(self._http)
        #: KN-scoped async jobs and tasks (ontology-manager).
        self.jobs = JobsResource(self._http)
        #: BKN metric definitions CRUD (bkn-backend); not Vega metric models.
        self.metrics = BknMetricsResource(self._http)
        #: Metric data queries and dry-run on ontology-query.
        self.metric_query = MetricQueryResource(self._http)
        #: Concept groups for a KN (ontology-manager).
        self.concept_groups = ConceptGroupsResource(self._http)
        #: Skill registry, market, install (ADP APIs).
        self.skills = SkillsResource(self._http)
        #: Toolboxes and OpenAPI tools (agent-operator-integration).
        self.toolboxes = ToolboxesResource(self._http)
        #: Hosted LLM/small-model registry and invocation helpers.
        self.models = ModelsResource(
            self._http,
            manager_base_url=mf_model_manager_base_url,
            api_base_url=mf_model_api_base_url,
        )

    @property
    def vega(self) -> VegaNamespace:
        """Vega observability namespace (lazy): catalogs, metric/event/trace models, query, tasks, health.

        Created on first access. Uses ``vega_url`` when set; otherwise the main
        ``base_url`` (same gateway as KWeaver).
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
