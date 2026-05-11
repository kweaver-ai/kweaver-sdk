# `kweaver trace` — trace diagnosis

Symbolic-only diagnosis of a single conversation's trace. Produces a YAML report
at `trace-diagnose-report/v1`. Issue #1 PR-A scope; PR-B will add LLM rubric
judgments and an agent-driven within-trace synthesizer.

## Synopsis

```
kweaver trace diagnose <conversation_id> [flags]
kweaver trace diagnose rules validate <rule.yaml>
```

`<conversation_id>` is the value returned by `kweaver agent chat` /
`kweaver agent sessions <agent_id>`. Spans are fetched from
`/api/agent-observability/v1/traces/_search` via a two-hop lookup
(conversation_id → traceIds → spans); if a conversation produced more than one
OTel trace, diagnose analyzes the first and warns on stderr.

## Flags (`diagnose <conversation_id>`)

| Flag | Default | Description |
|------|---------|-------------|
| `--out <file>` | stdout | Write report to file (`mkdir -p` if needed); omit to write YAML to stdout |
| `--rules <dir>` | `<cwd>/diagnosis-rules/` | Override the team rules directory |
| `--no-builtin` | off | Disable the 5 builtin baseline rules (debug only) |
| `--no-llm` | always on (PR-A) | Reserved; PR-B will allow disabling |
| `--token <token>` | `$KWEAVER_TOKEN` / active platform | Bearer token; falls back to `~/.kweaver/` via `auth login` when omitted |
| `--base-url <url>` | `$KWEAVER_BASE_URL` / active platform | KWeaver platform base URL |
| `-bd, --business-domain <bd>` | `$KWEAVER_BUSINESS_DOMAIN` / `bd_public` | Business domain |

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | Success (including 0 findings) |
| 2 | Bad arguments |
| 4 | No spans found for the conversation |
| 5 | Auth missing / unreachable |
| 6 | Rule load / schema validation failure |

## Examples

```bash
# Diagnose a conversation (uses ~/.kweaver/ active platform — no flags needed)
kweaver trace diagnose 01KRBDAMHSA4NHH7G6K4CSSS31 --out diagnosis/turn1.yaml

# Explicit credentials (CI / scripted runs)
kweaver trace diagnose 01KRBDAMHSA4NHH7G6K4CSSS31 \
  --base-url http://my-kweaver.internal \
  --token "$KWEAVER_TOKEN" \
  -bd bd_public

# Validate a team-supplied rule yaml
kweaver trace diagnose rules validate diagnosis-rules/my-rule.yaml
```

## Builtin baseline rules (5)

| rule_id | Signals axis | MS class | Detects |
|---------|--------------|----------|---------|
| tool_loop_no_state_change | execution | retry_loop | Same tool, same args, no state change ≥ 3× |
| tool_error_swallowed | execution | cascading_error | Tool errored; next LLM prompt lacks the error |
| retrieval_empty_no_fallback | execution | cascading_error | Retrieval = 0 results, next is LLM (no fallback) |
| llm_response_truncated_no_continue | execution | context_loss | finish_reason=length (incl. `finish_reasons: ['length']` OTel array form), no continuation span |
| excessive_tool_calls_per_turn | execution | tool_misuse | Tool count per trace > 10 (PR-A approximation; PR-B does per-turn) |

## Span attribute contract

Rule predicates read OTel GenAI semantic conventions; the trace shaper maps
`gen_ai.operation.name` to internal span kinds:

| `gen_ai.operation.name` | kind | Used by |
|---|---|---|
| `chat`, `text_completion` | `llm` | truncation / cascading-error / swallow rules |
| `execute_tool` | `tool` | tool-loop / excessive-tool-calls / swallow rules |
| `embeddings` | `retrieval` | retrieval-empty rule |

The legacy `agent.trace.type` attribute is still accepted as a fallback for
synthetic fixtures and runtimes that pre-tag spans with the custom taxonomy.

## Not in PR-A (deferred)

- LLM-judged rubric rules (`judgment_kind: rubric`) — PR-B introduces
  `trace-core/agent/` abstraction + claude-code subprocess provider + one demo
  rubric rule paired with `tool_loop_no_state_change`.
- Cross-trace / batch / scan mode (`kweaver trace diagnose --traces=<list>`,
  `scan-summary/v1` aggregate report) — issue #2.

See `docs/superpowers/specs/2026-05-11-m4-diagnose-issue1-design.md` for the full
design including the rubric layer and within-trace synthesizer (PR-B).
