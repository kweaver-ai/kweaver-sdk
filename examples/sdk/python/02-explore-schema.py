"""Example 02: Explore Schema — discover object types, relations, and actions.

Demonstrates: ``KWeaverClient``, BKN statistics, schema trifecta (OT/RT/AT).

Run: python examples/sdk/02-explore-schema.py
"""

from __future__ import annotations

from setup import create_client, find_kn_with_data, pp


def main() -> None:
    client = create_client()
    kn_id, kn_name = find_kn_with_data(client)
    print(f"Using BKN: {kn_name} ({kn_id})\n")

    detail = client.knowledge_networks.get(kn_id, include_statistics=True)
    print("=== BKN Statistics ===")
    pp(detail)

    object_types = client.object_types.list(kn_id)
    ot_name_by_id = {ot.id: ot.name for ot in object_types}
    print(f"\n=== Object Types ({len(object_types)}) ===")
    for ot in object_types:
        prop_count = len(ot.properties or [])
        print(f"  {ot.name} ({ot.id}) — {prop_count} properties")

    relation_types = client.relation_types.list(kn_id)
    print(f"\n=== Relation Types ({len(relation_types)}) ===")
    for rt in relation_types:
        src = ot_name_by_id.get(rt.source_ot_id, rt.source_ot_id)
        dst = ot_name_by_id.get(rt.target_ot_id, rt.target_ot_id)
        print(f"  {src} —[{rt.name}]→ {dst}  ({rt.id})")

    action_types = client.action_types.list(kn_id)
    print(f"\n=== Action Types ({len(action_types)}) ===")
    for at in action_types:
        print(f"  {at.get('name')} ({at.get('id')})")


if __name__ == "__main__":
    main()
