"""Shared fixtures for layer tests — read-only data discovery."""
from __future__ import annotations

import pytest

from kweaver import KWeaverClient
from kweaver.resources.context_loader import ContextLoaderResource


@pytest.fixture(scope="module")
def kn_with_data(kweaver_client: KWeaverClient):
    """Find a KN with at least one object type that has indexed data.

    Prefer a smaller object type (by doc_count) to keep queries fast.
    """
    kns = kweaver_client.knowledge_networks.list()
    candidates: list[tuple] = []
    for kn in kns:
        try:
            ots = kweaver_client.object_types.list(kn.id)
        except Exception:
            continue
        for ot in ots:
            if ot.status and ot.status.doc_count > 0:
                candidates.append((kn, ot))
    if not candidates:
        pytest.skip("No knowledge network with indexed data found")
    kn, ot = min(candidates, key=lambda x: x[1].status.doc_count)
    return {"kn": kn, "ot": ot}


@pytest.fixture(scope="module")
def cl_context(kweaver_client: KWeaverClient, e2e_env: dict):
    """Set up Context Loader with a KN that has indexed data + a sample instance.

    Returns dict with: kn, ot, cl (ContextLoaderResource), sample (first instance).
    """
    kns = kweaver_client.knowledge_networks.list()
    for kn in kns:
        try:
            ots = kweaver_client.object_types.list(kn.id)
        except Exception:
            continue
        for ot in ots:
            if ot.status and ot.status.doc_count > 0 and ot.properties:
                result = kweaver_client.query.instances(kn.id, ot.id, limit=1)
                if result.data and result.data[0].get("_instance_identity"):
                    token = kweaver_client._http._auth.auth_headers().get(
                        "Authorization", ""
                    ).removeprefix("Bearer ").strip()
                    base_url = str(kweaver_client._http._client.base_url).rstrip("/")
                    cl = ContextLoaderResource(base_url, token, kn_id=kn.id)
                    return {
                        "kn": kn,
                        "ot": ot,
                        "cl": cl,
                        "sample": result.data[0],
                    }
    pytest.skip("No KN with indexed data and instance identities found")
