#!/usr/bin/env python3
"""Print dotted module names under ``src/kweaver`` for pdoc.

pdoc only emits HTML for modules passed on the CLI (plus their documented
members). If you pass ``kweaver`` alone, annotation links such as
``kweaver.resources.dataflow_v2.DataflowV2Resource`` stay plain text because
no ``dataflow_v2.html`` exists. Listing every submodule fixes cross-links.

Usage (from ``packages/python``)::

    PYTHONPATH=src uv run python -m pdoc -d google \\
      -o ../../docs/reference/python-api-html \\
      $(PYTHONPATH=src uv run python scripts/list_pdoc_modules.py)
"""

from __future__ import annotations

import sys
from pathlib import Path


def main() -> int:
    pkg_root = Path(__file__).resolve().parent.parent / "src" / "kweaver"
    src_root = pkg_root.parent
    if not pkg_root.is_dir():
        print(
            f"[list_pdoc_modules] package not found at {pkg_root}",
            file=sys.stderr,
        )
        return 2
    modules: list[str] = []
    for path in sorted(pkg_root.rglob("*.py")):
        if "__pycache__" in path.parts:
            continue
        rel = path.relative_to(src_root)
        parts = list(rel.with_suffix("").parts)
        if parts and parts[-1] == "__init__":
            parts = parts[:-1]
        if not parts:
            continue
        modules.append(".".join(parts))
    if not modules:
        print(
            "[list_pdoc_modules] no modules discovered under src/kweaver",
            file=sys.stderr,
        )
        return 1
    print(" ".join(modules))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
