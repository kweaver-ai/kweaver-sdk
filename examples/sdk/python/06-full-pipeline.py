"""Example 06: Full Pipeline — from datasource to intelligent search.

Mirrors examples/sdk/06-full-pipeline.ts. The Python SDK does not expose a
``create_from_ds`` shortcut today, so DS registration and BKN scaffolding go
through the ``kweaver`` CLI (the same path the TypeScript example takes); the
build / export / search / cleanup steps use the Python SDK directly.

DESTRUCTIVE: This example creates and deletes resources.

Prerequisites:
  - A reachable database (default mysql)
  - The ``kweaver`` CLI on PATH (``npm install -g @kweaver-ai/kweaver-sdk``)
  - Set environment variables: KWEAVER_TEST_DB_HOST, KWEAVER_TEST_DB_PORT,
    KWEAVER_TEST_DB_NAME, KWEAVER_TEST_DB_USER, KWEAVER_TEST_DB_PASS,
    KWEAVER_TEST_DB_TYPE (optional, default mysql)
  - RUN_DESTRUCTIVE=1 to actually run.

Run: RUN_DESTRUCTIVE=1 python examples/sdk/06-full-pipeline.py
"""

from __future__ import annotations

import json
import os
import subprocess
import time

from setup import create_client, pp


def _require_env(name: str, default: str | None = None) -> str:
    v = os.environ.get(name) or default
    if not v:
        raise RuntimeError(f"Missing env var: {name}")
    return v


def _run_cli(args: list[str]) -> str:
    """Run ``kweaver <args>``; return stdout (raises on non-zero exit)."""
    result = subprocess.run(
        ["kweaver", *args], capture_output=True, text=True, check=True
    )
    return result.stdout


def main() -> None:
    if os.environ.get("RUN_DESTRUCTIVE") != "1":
        print("This example creates and deletes resources.")
        print("Set RUN_DESTRUCTIVE=1 to run it.")
        return

    db_host = _require_env("KWEAVER_TEST_DB_HOST")
    db_port = _require_env("KWEAVER_TEST_DB_PORT", "3306")
    db_name = _require_env("KWEAVER_TEST_DB_NAME")
    db_user = _require_env("KWEAVER_TEST_DB_USER")
    db_pass = _require_env("KWEAVER_TEST_DB_PASS")
    db_type = _require_env("KWEAVER_TEST_DB_TYPE", "mysql")
    suffix = int(time.time())
    ds_name = f"example_pipeline_{suffix}"
    kn_name = f"example_pipeline_{suffix}"

    ds_id: str | None = None
    kn_id: str | None = None

    try:
        # Step 1: Register datasource (CLI)
        print("=== Step 1: Register Datasource ===")
        ds_out = _run_cli(
            [
                "ds", "connect", db_type, db_host, db_port, db_name,
                "--account", db_user, "--password", db_pass,
                "--name", ds_name,
            ]
        )
        ds_parsed = json.loads(ds_out)
        ds_id = str(ds_parsed.get("id") or ds_parsed.get("ds_id") or "")
        print(f"Created datasource: {ds_name} ({ds_id})\n")

        # Step 2: Create BKN from datasource (CLI)
        print("=== Step 2: Create BKN from Datasource ===")
        kn_out = _run_cli(
            ["bkn", "create-from-ds", ds_id, "--name", kn_name, "--no-build"]
        )
        kn_parsed = json.loads(kn_out)
        kn_id = str(kn_parsed.get("kn_id") or kn_parsed.get("id") or "")
        print(f"Created BKN: {kn_name} ({kn_id})\n")

        # Step 3: Build the knowledge network index (Python SDK)
        print("=== Step 3: Build BKN ===")
        client = create_client()
        print("Building... (this may take a while)")
        job = client.knowledge_networks.build(kn_id)
        status = job.wait(timeout=300, interval=5)
        print(f"Build complete: {status.state}")

        # Step 4: Export the BKN to see what was created
        print("\n=== Step 4: Export BKN ===")
        exported = client.knowledge_networks.export(kn_id)
        print("Exported schema:")
        pp(exported)

        # Step 5: Semantic search on the new BKN
        print("\n=== Step 5: Semantic Search ===")
        result = client.query.semantic_search(kn_id, "数据")
        print("Search results:")
        pp(result)

    finally:
        print("\n=== Cleanup ===")
        if kn_id:
            try:
                _run_cli(["bkn", "delete", kn_id, "-y"])
                print(f"Deleted BKN: {kn_id}")
            except Exception as e:
                print(f"Failed to delete BKN: {e}")
        if ds_id:
            try:
                _run_cli(["ds", "delete", ds_id, "-y"])
                print(f"Deleted datasource: {ds_id}")
            except Exception as e:
                print(f"Failed to delete datasource: {e}")


if __name__ == "__main__":
    main()
