.PHONY: test test-cover test-e2e lint ci docs-python

# UT: unit tests only, full mock, no external deps, < 60s
# Use `python -m pytest` to guarantee the venv interpreter is used,
# avoiding PATH conflicts with system/conda pytest installations.
test:
	uv run python -m pytest tests/unit/ -q

# test-cover: UT + coverage report, output to test-result/
test-cover:
	uv run python -c "import os; os.makedirs('test-result', exist_ok=True)"
	uv run python -m pytest tests/unit/ \
		--cov=src/kweaver \
		--cov-report=term-missing \
		--cov-report=xml:test-result/coverage.xml \
		-q

# test-e2e: full e2e suite (requires live KWeaver + DB env vars in ~/.env.secrets)
test-e2e:
	uv run python -m pytest tests/e2e/ -v --run-destructive

# lint: compile-check all Python sources (cross-platform, no find/tr)
lint:
	uv run python -m compileall -q src/kweaver

# ci: lint + test-cover
ci: lint test-cover

# docs-python: HTML API reference from docstrings (output gitignored at repo root).
# Pass every submodule so pdoc emits per-module HTML and type annotations link (not plain text).
docs-python:
	PYTHONPATH=src uv run --extra docs python -m pdoc --docformat google \
		-o ../../docs/reference/python-api-html \
		$$(PYTHONPATH=src uv run python scripts/list_pdoc_modules.py)
