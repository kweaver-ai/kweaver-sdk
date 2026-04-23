"""SDK resource: action types (ontology-query + ontology-manager)."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from kweaver.types import ActionExecution, ActionType

if TYPE_CHECKING:
    from kweaver._http import HttpClient

_PREFIX = "/api/ontology-query/v1/knowledge-networks"
_OM_PREFIX = "/api/ontology-manager/v1/knowledge-networks"


class ActionTypesResource:
    """Action Type query, execution, and log management."""

    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def list(self, kn_id: str, *, branch: str = "main") -> list[dict[str, Any]]:
        """List action types (schema) from ontology-manager."""
        data = self._http.get(
            f"{_OM_PREFIX}/{kn_id}/action-types",
            params={"limit": -1, "branch": branch},
        )
        if isinstance(data, list):
            return data
        return data.get("entries") or data.get("data") or []

    def query(self, kn_id: str, action_type_id: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
        """Query an Action Type definition and parameters."""
        data = self._http.post(
            f"{_PREFIX}/{kn_id}/action-types/{action_type_id}/",
            json=body or {},
            headers={"X-HTTP-Method-Override": "GET"},
        )
        return data or {}

    def inputs(self, kn_id: str, action_type_id: str) -> list[dict[str, Any]]:
        """Return ActionType parameters with ``value_from == "input"``.

        These are exactly the parameters the caller MUST supply via
        ``dynamic_params`` when calling :meth:`execute`. Each returned dict
        keeps the original parameter fields (``name``, ``type``, ``source``,
        ``required``, ``description``, ...) so callers can build their own
        validation or template logic on top.
        """
        raw = self._http.get(
            f"{_OM_PREFIX}/{kn_id}/action-types/{action_type_id}",
        )
        params = _collect_input_parameters(raw)
        return params

    def execute(
        self,
        kn_id: str,
        action_type_id: str,
        params: dict[str, Any] | None = None,
        *,
        dynamic_params: dict[str, Any] | None = None,
        instances: list[dict[str, Any]] | None = None,
        trigger_type: str = "manual",
    ) -> ActionExecution:
        """Execute an Action Type, returns an async execution object.

        Args:
            kn_id: Knowledge network ID.
            action_type_id: Action type ID.
            params: Pre-assembled envelope body. Mutually exclusive with the
                ``dynamic_params`` / ``instances`` / ``trigger_type`` kwargs;
                use this only when you already have a full envelope JSON.
            dynamic_params: Mapping of input parameters (the ones with
                ``value_from == "input"``). Includes any header-source params
                like ``Authorization`` that the ActionType declares as inputs.
            instances: List of identity objects appended to
                ``_instance_identities``. Empty list (default) is correct for
                "create"-style actions that don't target an existing instance.
            trigger_type: Envelope ``trigger_type`` field, defaults to ``manual``.

            When the kwargs are used, the SDK assembles the envelope below.
            **Must use the envelope shape** below — top-
                level fields other than ``trigger_type`` / ``_instance_identities``
                are silently dropped by the backend, leaving ``dynamic_params``
                empty and downstream tools receiving ``null`` parameters
                (typically surfacing as 401 token expired or 500 type errors).

                ::

                    {
                      "trigger_type": "manual",
                      "_instance_identities": [{"<primary_key>": "<value>"}],
                      "dynamic_params": {
                        "<param>": "<value>",
                        "Authorization": "Bearer <token>",
                      },
                    }

                - ``_instance_identities`` may be ``[]`` for "create"-style actions.
                - Each ActionType parameter has a ``value_from`` discriminator:

                    * ``input``    — caller MUST supply via ``dynamic_params``.
                      Includes ``source: header`` params (e.g.
                      ``Authorization``/``token``), which are usually
                      credentials for the DOWNSTREAM system the action calls —
                      NOT the platform session token. The SDK never
                      auto-forwards its session token.
                    * ``const``    — frozen in the ActionType snapshot; values
                      in body are silently ignored. Edit the ActionType
                      definition to ``input`` first if caller override is needed.
                    * ``property`` — auto-populated from the resolved instance's
                      property; do not (and cannot) supply via body.

                Practical recipe: query the ActionType, filter parameters where
                ``value_from == "input"``, put exactly those names into
                ``dynamic_params``.

                See ``skills/kweaver-core/references/bkn.md`` for the full contract.
        """
        using_kwargs = dynamic_params is not None or instances is not None
        if params is not None and using_kwargs:
            raise ValueError(
                "execute(): `params` (envelope) and `dynamic_params`/`instances` "
                "are mutually exclusive — pick one form."
            )
        if params is None:
            params = {
                "trigger_type": trigger_type,
                "_instance_identities": list(instances or []),
                "dynamic_params": dict(dynamic_params or {}),
            }
        data = self._http.post(
            f"{_PREFIX}/{kn_id}/action-types/{action_type_id}/execute",
            json=params,
            timeout=120.0,
        )
        execution_id = data.get("execution_id") or data.get("id") or ""
        status = data.get("status", "pending")

        execution = ActionExecution(
            execution_id=execution_id,
            kn_id=kn_id,
            action_type_id=action_type_id,
            status=status,
            result=data.get("result"),
        )
        execution.set_poll_fn(lambda: self._poll_execution(kn_id, execution_id))
        return execution

    def _poll_execution(self, kn_id: str, execution_id: str) -> ActionExecution:
        data = self.get_execution(kn_id, execution_id)
        return ActionExecution(
            execution_id=execution_id,
            kn_id=kn_id,
            action_type_id=data.get("action_type_id", ""),
            status=data.get("status", "running"),
            result=data.get("result"),
        )

    def get_execution(self, kn_id: str, execution_id: str) -> dict[str, Any]:
        """Get execution status."""
        data = self._http.get(
            f"{_PREFIX}/{kn_id}/action-executions/{execution_id}",
        )
        return data or {}

    def list_logs(
        self,
        kn_id: str,
        *,
        offset: int = 0,
        limit: int = 20,
        sort: str = "create_time",
        direction: str = "desc",
    ) -> list[dict[str, Any]]:
        """List Action execution logs."""
        data = self._http.get(
            f"{_PREFIX}/{kn_id}/action-logs",
            params={
                "offset": offset,
                "limit": limit,
                "sort": sort,
                "direction": direction,
            },
        )
        if isinstance(data, list):
            return data
        return data.get("entries") or data.get("data") or []

    def get_log(self, kn_id: str, log_id: str) -> dict[str, Any]:
        """Get a single execution log."""
        data = self._http.get(f"{_PREFIX}/{kn_id}/action-logs/{log_id}")
        return data or {}

    def cancel(self, kn_id: str, log_id: str) -> None:
        """Cancel a running Action execution."""
        self._http.post(f"{_PREFIX}/{kn_id}/action-logs/{log_id}/cancel")


def _collect_input_parameters(node: Any) -> list[dict[str, Any]]:
    """Walk an ActionType response and pull every parameter with
    ``value_from == "input"``. The exact response envelope varies between
    endpoints (root, ``data.action_type``, ``entries[*]`` ...), so we walk all
    nested dicts/lists and de-dup by parameter name.
    """
    seen: set[str] = set()
    out: list[dict[str, Any]] = []

    def walk(n: Any) -> None:
        if isinstance(n, list):
            for item in n:
                walk(item)
            return
        if not isinstance(n, dict):
            return
        params = n.get("parameters")
        if isinstance(params, list):
            for p in params:
                if not isinstance(p, dict):
                    continue
                if p.get("value_from") != "input":
                    continue
                name = p.get("name")
                if not isinstance(name, str) or name in seen:
                    continue
                seen.add(name)
                out.append(p)
        for v in n.values():
            walk(v)

    walk(node)
    return out
