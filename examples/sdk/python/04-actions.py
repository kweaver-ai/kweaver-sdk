"""Example 04: Actions — execute actions and track results.

Demonstrates: action discovery, execution, async polling, execution logs.

Run: python examples/sdk/04-actions.py
"""

from __future__ import annotations

from setup import create_client, find_kn_with_data, pp


def main() -> None:
    client = create_client()
    kn_id, kn_name = find_kn_with_data(client)
    print(f"Using BKN: {kn_name} ({kn_id})\n")

    action_types = client.action_types.list(kn_id)
    print(f"=== Action Types ({len(action_types)}) ===")
    for at in action_types:
        print(f"  {at.get('name')} ({at.get('id')}) — {at.get('description', '')}")

    if not action_types:
        print("\nNo action types found. This BKN has no executable actions.")
        return

    at = action_types[0]
    at_id = at.get("id")
    print(f'\n=== Action Detail: "{at.get("name")}" ===')
    try:
        action_detail = client.action_types.query(kn_id, at_id, {})
        pp(action_detail)
    except Exception as e:
        print(f"  (query failed — action's backing datasource may be unavailable: {e})")

    print("\n=== Action Logs ===")
    try:
        # The Python list_logs() doesn't filter by action_type_id today —
        # we list all recent logs and filter client-side for parity with TS.
        all_logs = client.action_types.list_logs(kn_id, limit=20)
        logs = [log for log in all_logs if str(log.get("at_id") or log.get("action_type_id") or "") == at_id][:5]
        print(f'Found {len(logs)} log(s) for "{at.get("name")}":')
        for log in logs:
            print(f"  [{log.get('status')}] {log.get('id')} — {log.get('created_at', '')}")

        if logs and logs[0].get("id"):
            first_id = logs[0]["id"]
            print(f"\n=== Log Detail: {first_id} ===")
            detail = client.action_types.get_log(kn_id, first_id)
            pp(detail)
    except Exception as e:
        print(f"  (logs unavailable — execution index may not exist yet: {e})")

    # =====================================================================
    # UNCOMMENT BELOW TO EXECUTE (WRITE OPERATION — triggers real side effects)
    # =====================================================================
    #
    # execution = client.action_types.execute(kn_id, at_id, {})
    # print("Execution started:", execution)
    # # action_types.execute() already polls until completion; result is the final state.


if __name__ == "__main__":
    main()
