.PHONY: test test-cover lint ci

# Use shell glob expansion (no quotes) so Node receives real file paths.
# Node/tsx treat "test/**/*.test.ts" as literal path and fail.
test:
	node --import tsx --test test/*.test.ts

# test-cover: run full test first (all 161), then coverage report.
# Node --experimental-test-coverage runs only first file when given multiple; we run test first to ensure all pass.
test-cover:
	$(MAKE) test
	@mkdir -p test-result
	node --import tsx \
		--experimental-test-coverage \
		--test-reporter=tap \
		--test-reporter-destination=test-result/tap.txt \
		--test-reporter=spec \
		--test-reporter-destination=stdout \
		test/*.test.ts

# M4: lint — TypeScript type check (static, no external deps)
lint:
	node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json

# M3: ci — lint + test-cover
ci: lint test-cover
