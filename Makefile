.PHONY: test test-cover lint ci test-python test-typescript lint-python lint-typescript test-equiv docs-python

# Unified monorepo: Python + TypeScript in one project.
# Test equivalence: both suites must pass; same scenarios covered on both sides.

# Run all tests (Python + TypeScript) — both must pass
test: test-python test-typescript
	@echo "---"
	@echo "All tests passed (Python + TypeScript)"

# Run Python unit tests (packages/python)
test-python:
	$(MAKE) -C packages/python test

# Run TypeScript unit tests (packages/typescript)
test-typescript:
	$(MAKE) -C packages/typescript test

# Coverage (both) — output to packages/*/test-result/
test-cover: test-cover-python test-cover-typescript
	@echo "---"
	@echo "Coverage complete: packages/python/test-result/ packages/typescript/test-result/"

test-cover-python:
	$(MAKE) -C packages/python test-cover

test-cover-typescript:
	$(MAKE) -C packages/typescript test-cover

# Lint (both)
lint: lint-python lint-typescript
	@echo "---"
	@echo "Lint passed (Python + TypeScript)"

lint-python:
	$(MAKE) -C packages/python lint

lint-typescript:
	$(MAKE) -C packages/typescript lint

# Generate Python SDK API HTML (pdoc; requires docs extra in packages/python)
docs-python:
	$(MAKE) -C packages/python docs-python

# CI: lint + test-cover (both packages)
ci: lint test-cover
	@echo "---"
	@echo "CI passed"

# Test equivalence check: run both suites, fail if either fails
test-equiv: test
	@echo "Test equivalence: Python and TypeScript suites both passed"
