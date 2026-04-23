"""Shared helpers for the Python SDK examples.

Mirrors examples/sdk/setup.ts. Imports the in-repo package directly so
the examples run without installing; published users would simply use
``from kweaver import KWeaverClient, ConfigAuth``.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

_REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(_REPO / "packages" / "python" / "src"))

from kweaver import ConfigAuth, KWeaverClient  # noqa: E402


def create_client() -> KWeaverClient:
    """Build a KWeaverClient from saved ~/.kweaver/ credentials.

    Run ``kweaver auth login <url>`` (or call ``kweaver.login(...)`` from
    Python) first to populate ``~/.kweaver/``.
    """
    try:
        return KWeaverClient(auth=ConfigAuth())
    except Exception as exc:
        msg = str(exc)
        if "platform" in msg or "accessToken" in msg or "base_url" in msg:
            print(
                "Auth not configured. Run:\n"
                "  kweaver auth login <your-platform-url>\n"
                "or in Python:\n"
                "  import kweaver; kweaver.login('<url>', username='...', password='...')",
                file=sys.stderr,
            )
        raise


def find_kn_with_data(client: KWeaverClient) -> tuple[str, str]:
    """Find the first BKN that has at least one object type, otherwise exit 0.

    Examples need a populated BKN to be useful; we treat "no data" as an
    expected, environment-driven outcome (not an example bug) and print a
    friendly message instead of raising.
    """
    for kn in client.knowledge_networks.list(limit=20):
        if not kn.id:
            continue
        ots = client.object_types.list(kn.id)
        if ots:
            return kn.id, kn.name or kn.id
    print(
        "No BKN with object types found for the current user. "
        "Create or get access to a populated BKN, then re-run.",
        file=sys.stderr,
    )
    sys.exit(0)


def find_agent(client: KWeaverClient) -> tuple[str, str]:
    """Find the first accessible agent, otherwise exit 0 (see find_kn_with_data)."""
    try:
        agents = client.agents.list(limit=10)
    except Exception as exc:
        print(f"Agent service unavailable ({exc}); skipping example.", file=sys.stderr)
        sys.exit(0)
    if not agents or not agents[0].id:
        print("No accessible agent for the current user; skipping example.", file=sys.stderr)
        sys.exit(0)
    return agents[0].id, agents[0].name or agents[0].id


def pp(value: Any) -> None:
    """Pretty-print a JSON-serializable value (dataclasses / pydantic supported)."""
    def _coerce(v: Any) -> Any:
        if hasattr(v, "model_dump"):
            return v.model_dump()
        if hasattr(v, "__dict__"):
            return {k: _coerce(x) for k, x in vars(v).items() if not k.startswith("_")}
        if isinstance(v, dict):
            return {k: _coerce(x) for k, x in v.items()}
        if isinstance(v, (list, tuple)):
            return [_coerce(x) for x in v]
        return v

    print(json.dumps(_coerce(value), indent=2, ensure_ascii=False, default=str))
