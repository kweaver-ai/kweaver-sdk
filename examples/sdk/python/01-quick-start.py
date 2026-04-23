"""Example 01: Quick Start — 5 minutes to your first search.

Demonstrates: module-level API, auto-auth from ``~/.kweaver/``, BKN listing,
semantic search.

Run: python examples/sdk/01-quick-start.py
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "packages" / "python" / "src"))

import kweaver  # noqa: E402


def main() -> None:
    kweaver.configure(config=True)
    print("✓ Configured from ~/.kweaver/\n")

    kn_list = kweaver.bkns(limit=10)
    print(f"Found {len(kn_list)} knowledge network(s):")
    for kn in kn_list:
        print(f"  - {kn.name} ({kn.id})")

    if not kn_list:
        print("\nNo BKNs found. Create one first.")
        return

    first = kn_list[0]
    print(f'\nSearching in "{first.name}"...')

    # "数据" means "data" in Chinese — change this to match your BKN's language
    result = kweaver.search("数据", bkn_id=first.id, max_concepts=5)
    print(f"\nSearch results ({result.hits_total or 0} hits):")
    for c in result.concepts or []:
        print(f"  - {c.concept_name} (score: {c.intent_score})")


if __name__ == "__main__":
    main()
