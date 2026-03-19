#!/usr/bin/env bash
# Unified test runner for KWeaver SDK (Python package)
#
# Usage: tests/run_tests.sh <test_type> [pytest options]
#   test_type: unit | e2e | all (all = unit + e2e)
#
# Examples:
#   tests/run_tests.sh unit                              # Unit tests
#   tests/run_tests.sh e2e                               # Read-only E2E tests
#   tests/run_tests.sh e2e --run-destructive             # Including build/delete tests
#   tests/run_tests.sh e2e --e2e-base-url https://...    # Override KWeaver URL
#   tests/run_tests.sh all -v                            # Verbose unit + e2e

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${PROJECT_ROOT}"

TYPE="${1:-all}"
shift || true

run_unit() {
    echo "═══ Running Unit Tests ═══"
    pytest tests/unit/ "$@"
}

run_e2e() {
    echo "═══ Running E2E Tests ═══"
    pytest tests/e2e/ "$@"
}

case "${TYPE}" in
    unit)
        run_unit "$@"
        ;;
    e2e)
        run_e2e "$@"
        ;;
    all)
        run_unit "$@"
        run_e2e "$@"
        ;;
    *)
        echo "Usage: $0 {unit|e2e|all} [pytest options]"
        exit 1
        ;;
esac
