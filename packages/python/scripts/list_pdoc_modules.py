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

from pathlib import Path


def main() -> None:
    pkg_root = Path(__file__).resolve().parent.parent / "src" / "kweaver"
    src_root = pkg_root.parent
    modules: list[str] = []
    for path in sorted(pkg_root.rglob("*.py")):
        rel = path.relative_to(src_root)
        parts = list(rel.with_suffix("").parts)
        if parts and parts[-1] == "__init__":
            parts = parts[:-1]
        if not parts:
            continue
        modules.append(".".join(parts))
    print(" ".join(modules))


if __name__ == "__main__":
    main()
