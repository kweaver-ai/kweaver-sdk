"""Example 03: Query & Traverse — instance queries, subgraph traversal, Context Loader (MCP).

Demonstrates: instance queries, property reads, subgraph traversal, MCP Layer 1+2.

Run: python examples/sdk/03-query-and-traverse.py
"""

from __future__ import annotations

from setup import create_client, find_kn_with_data, pp

from kweaver.types import PathEdge, PathNode, SubgraphPath


def main() -> None:
    client = create_client()
    kn_id, kn_name = find_kn_with_data(client)
    print(f"Using BKN: {kn_name} ({kn_id})\n")

    # --- Part 1: Direct Client API queries ---
    object_types = client.object_types.list(kn_id)
    if not object_types:
        print("No object types found.")
        return
    ot = object_types[0]
    print(f'=== Querying instances of "{ot.name}" ===')

    instances = client.query.instances(kn_id, ot.id, limit=5)
    print("\nInstances (first 5):")
    pp(instances)

    if instances.data:
        identity = instances.data[0].get("_instance_identity")
        if identity:
            try:
                print("\nProperties of first instance:")
                props = client.query.object_type_properties(
                    kn_id, ot.id, {"identity": identity}
                )
                pp(props)
            except Exception as e:
                print(f"  (skipped — instance has no queryable identity: {e})")
    else:
        print("\nNo instances found — skipping property query.")

    # 4. Subgraph traversal (if relation types + matching object types exist)
    relation_types = client.relation_types.list(kn_id)
    rt = next((r for r in relation_types if r.source_ot_id and r.target_ot_id), None)
    if rt is not None:
        print(f'\n=== Subgraph via "{rt.name}" ===')
        try:
            subgraph = client.query.subgraph(
                kn_id,
                [
                    SubgraphPath(
                        object_types=[
                            PathNode(id=rt.source_ot_id),
                            PathNode(id=rt.target_ot_id),
                        ],
                        relation_types=[
                            PathEdge(
                                id=rt.id,
                                source=rt.source_ot_id,
                                target=rt.target_ot_id,
                            )
                        ],
                    )
                ],
            )
            print("Subgraph result:")
            pp(subgraph)
        except Exception as e:
            print(f"  (subgraph query failed — this BKN may lack linked data: {e})")
    elif relation_types:
        print("\nRelation types found but none have complete source/target — skipping subgraph.")

    # --- Part 2: Context Loader (MCP) ---
    print("\n=== Context Loader (MCP) ===")
    base_url = str(client._http._client.base_url).rstrip("/")
    mcp_url = f"{base_url}/api/agent-retrieval/v1/mcp"
    token = (
        client._auth_provider.auth_headers()
        .get("Authorization", "")
        .removeprefix("Bearer ")
        .strip()
    )
    from kweaver.resources.context_loader import ContextLoaderResource

    print(f"  MCP endpoint: {mcp_url}")
    with ContextLoaderResource(base_url, token, kn_id=kn_id) as cl:
        print("Layer 1 — Schema search:")
        # "数据" means "data" in Chinese — change this to match your BKN's language
        schema_results = cl.kn_schema_search("数据", max_concepts=5)
        pp(schema_results)

        if ot.id:
            print(f'\nLayer 2 — Instance query for "{ot.name}" via MCP:')
            try:
                mcp_instances = cl.query_object_instance(ot_id=ot.id, limit=5)
                pp(mcp_instances)
            except Exception as e:
                print(f"  (MCP instance query failed: {e})")


if __name__ == "__main__":
    main()
