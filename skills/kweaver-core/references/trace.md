# `kweaver trace` — trace diagnosis

Hybrid two-pillar diagnosis of a single conversation's trace. Combines
**symbolic** (cheap, deterministic TypeScript predicates) and **rubric**
(LLM-judged semantic verdicts via local `claude` CLI) findings, then runs
a **within-trace synthesizer** that turns N findings into one short
narrative (`summary.headline`, `primary_root_cause`, ordered `fix_priority`,
`cross_finding_links`).

Outputs `trace-diagnose-report/v1` as YAML (machine-readable source of
truth) and a Markdown projection of the same report (paste into tickets /
PRs / wikis). Both files are written side by side by default.

## Synopsis

```
kweaver trace diagnose <conversation_id> [flags]
kweaver trace diagnose rules validate <rule.yaml>
```

`<conversation_id>` is the value returned by `kweaver agent chat` /
`kweaver agent sessions <agent_id>`. Spans are fetched from
`/api/agent-observability/v1/traces/_search` via a two-hop lookup
(conversation_id → traceIds → spans); if a conversation produced more than
one OTel trace, diagnose analyzes the first and warns on stderr.

## Flags (`diagnose <conversation_id>`)

| Flag | Default | Description |
|------|---------|-------------|
| `--out <file>` | stdout | Write report(s) to file. With `--format=both` (default) the renderer writes `<stem>.yaml` + `<stem>.md` side by side; with `--format=yaml` or `--format=markdown` only the chosen format is written to the given path. `mkdir -p` is automatic. |
| `--rules <dir>` | `<cwd>/diagnosis-rules/` | Override the team rules directory |
| `--no-builtin` | off | Disable the 5+1 builtin baseline rules (debug only) |
| `--no-llm` | off (both pillars on) | Skip rubric rules (recorded under `rules_skipped[].reason = no-llm-flag-set`) AND drop the synthesizer back to deterministic template mode (`run.synthesizer_mode = template`). Use for offline / CI runs without `claude` on PATH. |
| `--format yaml\|markdown\|both` | `both` when `--out` is a file; `yaml` when stdout | YAML = canonical; Markdown = deterministic projection of the same `Report` (no facts in the md not in the yaml). `both` writes both files side by side. |
| `--lang en\|zh` | `en` | Output locale for agent-judged natural-language fields (`summary.headline`, `primary_root_cause.description`, `fix_priority[].reason`, rubric `evidence.excerpt`). JSON keys, enum values (`severity`, `judgment_kind`, `category`, etc.), and span IDs always remain English regardless of `--lang` — only prose is localized. |
| `--token <token>` | `$KWEAVER_TOKEN` / active platform | Bearer token; falls back to `~/.kweaver/` via `auth login` when omitted |
| `--base-url <url>` | `$KWEAVER_BASE_URL` / active platform | KWeaver platform base URL |
| `-bd, --business-domain <bd>` | `$KWEAVER_BUSINESS_DOMAIN` / `bd_public` | Business domain |

When `--out` is set, the CLI prints `wrote <yaml> + <md> (N findings)` to
stderr so the caller knows where to look.

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
# Default: diagnose a conversation, write yaml + md side by side
kweaver trace diagnose 01KRBDAMHSA4NHH7G6K4CSSS31 --out diagnosis/turn1.yaml
# → wrote diagnosis/turn1.yaml + diagnosis/turn1.md (2 findings)

# Chinese diagnosis prose (for zh-locale deployments)
kweaver trace diagnose 01KRBDAMHSA4NHH7G6K4CSSS31 --out diagnosis/turn1.yaml --lang zh

# Offline / CI mode — no rubric rules, template synthesizer
kweaver trace diagnose 01KRBDAMHSA4NHH7G6K4CSSS31 --out diagnosis/turn1.yaml --no-llm

# Pipe markdown directly to less / glow (no --out)
kweaver trace diagnose 01KRBDAMHSA4NHH7G6K4CSSS31 --format markdown | less

# Explicit credentials (CI / scripted runs)
kweaver trace diagnose 01KRBDAMHSA4NHH7G6K4CSSS31 \
  --base-url http://my-kweaver.internal \
  --token "$KWEAVER_TOKEN" \
  -bd bd_public

# Validate a team-supplied rule yaml
kweaver trace diagnose rules validate diagnosis-rules/my-rule.yaml
```

## Pipeline (what runs when you call `diagnose`)

1. **Fetch spans** — `_search` by conversation_id → trace_id(s) → spans.
2. **Stage-1 symbolic** — all 5 builtin TS predicates run unconditionally.
   Cheap; deterministic; no LLM cost. Each hit becomes a `judgment_kind:
   symbolic` finding.
3. **Stage-2 rubric** — all rubric rules run (unless `--no-llm`). Each one
   renders its prompt template, invokes the registered `AgentProvider`
   (`claude-code` by default; the local `claude` CLI), validates the JSON
   reply against the rule's `output_schema`, and emits a `judgment_kind:
   rubric` finding. Per-rule failures (timeout / transport / schema
   violation) downgrade to `rules_skipped[].reason = agent-error:<kind>`;
   the rest of the run still produces a report.
4. **Stage-3 within-trace synthesizer** — pulls all Stage-1 + Stage-2
   findings and composes one `Summary` (`headline`, `primary_root_cause`,
   `fix_priority`, `cross_finding_links`). Agent mode by default; falls
   back to a deterministic template under `--no-llm` or when the agent
   call fails (recorded in `run.synthesizer_mode`).
5. **Emit** — write YAML and/or Markdown per `--format`.

## Builtin rules (5 symbolic + 1 rubric)

### Symbolic (`judgment_kind: symbolic`)

| rule_id | Signals axis | MS class | Detects |
|---------|--------------|----------|---------|
| `tool_loop_no_state_change` | execution | retry_loop | Same tool, same args, no state change ≥ 3× |
| `tool_error_swallowed` | execution | cascading_error | Tool errored; next LLM prompt lacks the error |
| `retrieval_empty_no_fallback` | execution | cascading_error | Retrieval = 0 results, next is LLM (no fallback) |
| `llm_response_truncated_no_continue` | execution | context_loss | `finish_reason=length` (incl. `finish_reasons: ['length']` OTel array form), no continuation span |
| `excessive_tool_calls_per_turn` | execution | tool_misuse | Tool count per trace > 10 (PR-A approximation; PR-B does per-turn) |

### Rubric (`judgment_kind: rubric`, requires `claude` CLI on PATH)

| rule_id | Signals axis | MS class | Pairs with | Judge question |
|---------|--------------|----------|------------|----------------|
| `tool_retry_intent_mismatch` | interaction | goal_drift | `tool_loop_no_state_change` | "Given the user's intent and the tool retry pattern, was this a legitimate retry strategy, stale-results handling failure, or prompt confusion?" |

Rubric verdicts always include a `first_violating_step_id` span pointer,
which the binding folds into the finding's `evidence.spans` so symbolic
and rubric findings on the same incident can be cross-referenced by span.

## Report schema (`trace-diagnose-report/v1`)

```yaml
schema_version: trace-diagnose-report/v1
trace: { trace_id, agent_id, tenant }
run:
  mode: hybrid | symbolic-only | rubric-only
  rules_applied: [...]
  rules_skipped:                # populated under --no-llm / provider failure / etc.
    - { rule_id, reason }       # reason ∈ no-llm-flag-set | provider-not-available:<name> | agent-error:<kind>
  synthesizer_mode: agent | template
summary:                        # Stage-3 narrative (always present, even for 0 findings)
  headline: <≤ 160 chars; --lang controls language>
  primary_root_cause: { finding_ids, description, target_for_fix } | null
  fix_priority: [{ finding_id, reason }, ...]
  cross_finding_links: [{ finding_ids, relation }, ...]
findings:
  - rule_id
    judgment_kind: symbolic | rubric
    severity: low | medium | high
    symptom
    likely_cause
    evidence: { spans: [...], excerpt }
    suggested_fix: { target, change }
    confidence: low | medium | high     # symbolic always low; rubric uses agent verdict
    verify_with: { suggested_eval_case: { query_id, query, assertions } }
```

## Span attribute contract

Rule predicates read OTel GenAI semantic conventions; the trace shaper
maps `gen_ai.operation.name` to internal span kinds:

| `gen_ai.operation.name` | kind | Used by |
|---|---|---|
| `chat`, `text_completion` | `llm` | truncation / cascading-error / swallow rules |
| `execute_tool` | `tool` | tool-loop / excessive-tool-calls / swallow rules |
| `embeddings` | `retrieval` | retrieval-empty rule |

The legacy `agent.trace.type` attribute is still accepted as a fallback
for synthetic fixtures and runtimes that pre-tag spans with the custom
taxonomy.

## Batch mode (single agent)

```bash
kweaver trace diagnose --traces=<list> --out=<dir> [flags]
  --traces=conv1,conv2,...   # comma-separated conversation_ids
  --traces=@file.txt          # or @file with one id per line
  --out=<dir>                 # REQUIRED in batch mode
```

Walks N traces (must all belong to one agent_id; mismatch → exit 2)
through Stage-1 symbolic + batched Stage-2 rubric + Stage-3 template +
Stage-4 cross-trace synthesizer. Emits per-trace yaml/md + scan-summary
yaml/md.

LLM budget: 100-trace batch with B-mode gating → ~5 LLM calls (4 fast +
1 std). `--no-llm` not supported (cross-trace synth requires LLM).

### Artifacts

Default-on (`--no-artifacts` to opt out). Layout:
- `<out>/artifacts/run-metadata.json` — CLI args, timing, LLM call counts, cost estimate
- `<out>/artifacts/stage-2-rubric/<rule_id>/chunk-NNN.{prompt.md,response.json,parse-errors.json}` — Stage-2 LLM I/O per chunk
- `<out>/artifacts/stage-4-cross-trace-synth/{aggregates.json, samples.json, prompt.md, response.json}` — Stage-4 inputs + LLM I/O

Single-trace mode mirrors: `<stem>.artifacts/` sibling to the report file.

### Resume

Per-trace yaml on disk = ground truth. Rerunning with the same `--out`
skips conv_ids whose `<conv_id>.yaml` is already valid; recomputes the
rest plus Stage-4 + scan-summary.
