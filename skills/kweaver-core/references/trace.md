# `kweaver trace` — trace diagnosis

Symbolic-only diagnosis of a single trace. Produces a YAML report at
`trace-diagnose-report/v1`. Issue #1 PR-A scope; PR-B will add LLM rubric judgments
and a within-trace synthesizer.

## Synopsis

```
kweaver trace diagnose <trace_id> [flags]
kweaver trace diagnose rules validate <rule.yaml>
```

## Flags (`diagnose <trace_id>`)

| Flag | Default | Description |
|------|---------|-------------|
| `--out <file>` | stdout | Write report to file (`mkdir -p` if needed); omit to write YAML to stdout |
| `--rules <dir>` | `<cwd>/diagnosis-rules/` | Override the team rules directory |
| `--no-builtin` | off | Disable the 5 builtin baseline rules (debug only) |
| `--no-llm` | always on (PR-A) | Reserved; PR-B will allow disabling |
| `--token <token>` | `$KWEAVER_TOKEN` | Bearer token |
| `--base-url <url>` | `$KWEAVER_BASE_URL` | KWeaver platform base URL |
| `-bd, --business-domain <bd>` | `bd_public` | Business domain |

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | Success (including 0 findings) |
| 2 | Bad arguments |
| 4 | Trace not found |
| 5 | Auth missing / unreachable |
| 6 | Rule load / schema validation failure |

## Examples

```bash
# Diagnose a single trace
kweaver trace diagnose tr_de39 --out=diagnosis/refund-001.yaml

# Validate a team-supplied rule yaml
kweaver trace diagnose rules validate diagnosis-rules/my-rule.yaml
```

## Builtin baseline rules (5)

| rule_id | Signals axis | MS class | Detects |
|---------|--------------|----------|---------|
| tool_loop_no_state_change | execution | retry_loop | Same tool, same args, no state change ≥ 3× |
| tool_error_swallowed | execution | cascading_error | Tool errored; next LLM prompt lacks the error |
| retrieval_empty_no_fallback | execution | cascading_error | Retrieval = 0 results, next is LLM (no fallback) |
| llm_response_truncated_no_continue | execution | context_loss | finish_reason=length, no continuation |
| excessive_tool_calls_per_turn | execution | tool_misuse | Tool count per turn > 10 |

See `docs/superpowers/specs/2026-05-11-m4-diagnose-issue1-design.md` for the full design including the rubric layer and within-trace synthesizer (PR-B).
