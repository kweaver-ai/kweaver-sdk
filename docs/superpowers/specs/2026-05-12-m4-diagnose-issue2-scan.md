# M4 Trace Diagnose — Issue #2 Design (Scan / Batch / Cross-Trace Synthesizer)

Last updated: 2026-05-12

Tracking issue: [kweaver-ai/kweaver-sdk#123](https://github.com/kweaver-ai/kweaver-sdk/issues/123)
Predecessor: [#120](https://github.com/kweaver-ai/kweaver-sdk/issues/120) (PR-A symbolic + PR-B rubric, single-trace)
Vision references: `plan-traceai/vision/trace-cli-detailed-design.md` §3.1 / §3.3.4
Issue plan: `plan-traceai/plan/2026-05-11-m4-diagnose-issue-plan.md` §2 #2

## Summary

Extend `kweaver trace diagnose` from single-trace mode (#120, PR-A + PR-B) to two sibling batch entry points sharing the same internal pipeline:

- `kweaver trace diagnose scan --time-range=24h [--tenant=acme]` — streaming pull from `agent-observability` over a time window with optional tenant filter
- `kweaver trace diagnose --traces=conv1,conv2,conv3` — explicit conversation_id list, used when the caller already has a triage queue (from a ticket / log / human review)

Both walk N traces through Stage-1 (symbolic) and a **batched** Stage-2 (rubric), produce a deterministic-template Stage-3 within-trace summary per trace, and end with a single LLM-driven Stage-4 cross-trace synthesizer over deterministic aggregates + K sampled trace summaries.

The cost / time profile is intentionally different from PR-B's single-trace mode. PR-B does one rubric LLM call per trace and one synthesizer LLM call per trace — fine for a single conversation but burns ~140 LLM calls on 100 traces. This issue batches rubric (chunks of K=10 traces per LLM call), drops Stage-3 to template mode (zero LLM calls), and lets a single Stage-4 LLM call produce the cross-trace narrative. Result for 100 traces / 38 flagged: **5 LLM calls total** (4 fast-tier Stage-2 batches + 1 std-tier Stage-4 synth).

The cost reduction is structural, not just an optimization. It enables:
- ~30× fewer LLM calls than naïve per-trace synthesis at the same trace count
- The Stage-2 batched rubric prompt sees all flagged traces together — the LLM can recognize cross-trace patterns ("30/38 of these are `stale_results`") that per-trace evaluation would miss
- A separate `tier: 'fast' | 'std'` abstraction in `AgentProvider` so callers express *task difficulty intent* (classification vs synthesis) instead of hardcoding model names (`haiku` vs `sonnet`)

This work lands as a new `trace-ai/scan/` subtree (peer of `trace-ai/diagnose/`) plus thin extensions to `agent-providers/` and `trace-ai/diagnose/schemas.ts`. PR-B's existing `agent-providers/`, single-trace `diagnose()`, and report markdown renderer are reused — not refactored.

## Goals

- Ship `kweaver trace diagnose scan` and `kweaver trace diagnose --traces=<list>` as sibling entry points sharing one pipeline.
- Introduce **Stage-4 cross-trace synthesizer** producing `scan-summary/v1` reports — both yaml and markdown.
- Introduce **Stage-1 → Stage-2 paired-rule gating** via `rubric.gates_on` in the rule YAML (resolves PR-B's known "rubric fires on benign traces" issue without breaking single-trace mode).
- Introduce **batched rubric evaluation**: one LLM call evaluates a chunk of flagged traces. Costs O(N/K) LLM calls instead of O(N).
- Introduce **`tier: 'fast' | 'std'` abstraction** in `JudgmentRequest`. Callers don't hardcode model names. Providers map tier → concrete model via constructor opts.
- Establish **partial-output resume semantics**: per-trace yaml on disk = ground truth; re-running `scan` skips already-diagnosed traces by trace_id.
- Reuse PR-B's `AgentProvider`, prompt-template, claude-code subprocess provider, and within-trace template synthesizer — no refactoring required.

## Non-goals

- Do not support `--no-llm` in scan / batch mode. The cross-trace synthesizer is the value proposition of scan; without LLM the user gets only deterministic `aggregates` + per-trace reports (which they can already get from single-trace mode). Fail-fast with exit 2 + a clear message instead of silently degrading.
- Do not support stdin (`--traces=-`) for the trace list in MVP. `<list>` accepts comma-separated values and `@<file>` (one id per line). stdin is post-MVP if a user needs it for shell pipelines.
- Do not implement `--max-parallel` adaptive backoff under rate-limit conditions. The flag sets a cap; rate-limit hits surface as `agent-error:transport` and skip the affected batch. Self-tuning is post-MVP.
- Do not implement payload `{shared_context, per_trace_overlay}` as an explicit data structure. The batched prompt template inherently factors shared context (judge_question + output_schema once, per-trace span lists in an array). No additional dedup machinery needed.
- Do not implement `pattern_clusters` (similarity-based grouping beyond rule_id) in `aggregates`. Issue #2 ships rule_frequency + agent_failure_rate; clustering is post-MVP.
- Do not extend the `tier` enum beyond `'fast' | 'std'` in this issue. `'premium'` (opus) is reserved for future enum extension.
- Do not refactor PR-B's single-trace `diagnose()`. The CLI dispatches by subcommand; `scan` / `--traces` calls a new entry point.

## Key Design Decisions

| # | Decision | Choice | Rationale |
|---|---|---|---|
| 1 | scan vs `--traces=<list>` plumbing | Same pipeline, two trace-source adapters | Pipeline complexity is in Stage-2/3/4; only difference is whether trace_ids come from streaming search or a literal list. Treating them as separate codepaths would duplicate 90% of work. |
| 2 | Stage-2 evaluation model | Batched-by-rule: one LLM call per chunk of K=10 flagged traces per rubric rule | Per-trace LLM evaluation costs scale O(N); batched scales O(N/K). LLM seeing the full chunk also enables cross-trace pattern recognition the per-trace path can't. |
| 3 | Stage-3 evaluation model | Template-only (deterministic) in batch mode; PR-B's agent path remains for single-trace mode | Per-trace LLM synthesis is the dominant cost in PR-B (100/139 calls for the 100-trace example). Template mode produces correct-shape Summary blocks at zero LLM cost; users wanting a deep narrative re-run single-trace `diagnose <conv_id>` on the suspect. |
| 4 | Stage-2 rubric gating | Paired gate: `rubric.gates_on: [<symbolic_rule_id>...]` in rule YAML. Stage-2 only triggers when at least one named symbolic rule fired on that trace | Solves PR-B's "rubric fires on benign traces" issue. The gate is explicit in YAML — the existing implicit pairing between `tool_retry_intent_mismatch` and `tool_loop_no_state_change` becomes machine-checkable. |
| 5 | Single-trace mode + `gates_on` | Ignored in single-trace mode; rubric runs unconditionally as in PR-B | Single-trace mode already establishes a "diagnose this specific trace fully" UX. Applying the gate would surprise users who explicitly asked for one trace's diagnosis. |
| 6 | Model selection | `JudgmentRequest.tier?: 'fast' \| 'std'`; provider maps tier → concrete model via `modelByTier` constructor opt. Stage-2 = fast, Stage-4 = std, PR-B mode = unset (CLI default) | Hardcoding `'haiku'` / `'sonnet'` in diagnose code leaks claude-specific model names into trace-ai logic. Tier abstraction stays stable across model upgrades and across providers. |
| 7 | scan-summary schema | `scan-summary/v1` independent schema, `summary{}` field shape mirrors within-trace `Summary` field-by-field where the concept is the same, uses different names (`rule_id` vs `finding_id`) where ID spaces differ | "Don't allow ambiguity; maximize reuse where unambiguous." Same `headline` / `description` / `reason` / `relation` field names cross levels — md renderer reuses templates. Different `finding_id` vs `rule_id` field names keep cross-level reading unambiguous. |
| 8 | `--no-llm` in scan | Fail-fast with exit 2 + message | Cross-trace synthesizer narrative is the scan value-add; without LLM the user gets only deterministic aggregates (already in scan-summary as a side-effect) plus per-trace reports (available from single-trace `diagnose` already). Silently degrading would emit half-useful reports. |
| 9 | Cross-trace synth input | Pre-aggregated counts + K=5 sampled trace summaries; LLM does narrative on top | Sending all N raw summaries blows the token budget past ~50 traces and forces the LLM to find patterns in noise. Pre-aggregation does deterministic counting; sampler picks representatives so the LLM still sees concrete examples. |
| 10 | Sampler discipline | Per dominant rule (frequency ≥ `max(3, 5% of N)`): top-1 by severity. Plus 2-3 cross-rule co-fire cases. Plus 1-2 outliers (rubric self-labeled false positive). Hard cap K=5 total. | Deterministic picks keep cross-trace synth reproducible. Outlier samples teach the LLM what noise looks like so it doesn't over-fit on dominant pattern. |
| 11 | Resume semantics | Partial-output trust: `<out>/<trace_id>.yaml` exists → skip. Atomic write via `.partial` → rename. Corrupt yaml = re-diagnose. `--force` flag absent in MVP; user `rm` manually if they want full re-run | Filesystem is ground truth; no separate state file. Survives ctrl-c / OOM / network blip with minimal machinery. Distributed multi-worker scan is post-MVP — when needed, upgrade to explicit checkpoint state. |
| 12 | LLM I/O formats | INPUT = YAML compact form (saves ~30-40% structural tokens vs `JSON.stringify(_, null, 2)`); OUTPUT = JSON + zod validation | claude's reliability advantage on JSON output (training + schema constraint) outweighs the 5-10% structural token savings of TOON/markdown. INPUT is read once; OUTPUT is parsed and validated downstream — flip the format-quality tradeoff per direction. |
| 13 | Failure granularity | Per-chunk LLM call failure → all traces in chunk skipped with `rules_skipped[].reason = agent-error:<kind>`. Single per-trace schema_violation inside chunk → only that trace skipped; chunk's other 9 traces unaffected | Isolates blast radius. Chunked retries are post-MVP — MVP records the skip in the per-trace yaml and moves on. |

## Industry Alignment (delta from PR-B)

PR-B's spec §Industry Alignment already established the two-stage (deterministic triage + LLM judge) discipline used across LangSmith, Phoenix, Braintrust, Langfuse, OpenAI Evals, and the Signals paper. This issue exercises that discipline in its intended workload (batch evaluation) where it was originally motivated as a cost-control measure.

Two refinements relative to PR-B:

1. **Stage-1 gate becomes operative** — PR-B noted "issue #1 single trace: runs rubric unconditionally; issue #2 scan: will gate on any Stage-1 hit." This issue implements the gate, with one refinement: gate by *paired* symbolic rule rather than "any Stage-1 hit" (decision #4 above). The Signals paper's 3-axis taxonomy already encourages per-axis pairing.
2. **Batched LLM judgment** — the academic Agent-as-Judge work (NeurIPS'24, arXiv 2410.10934) reports per-trace judging only scales to ~50 traces due to cost. Batched evaluation is the industry response (e.g. Phoenix's batch eval mode). Our batched-by-rule formulation is the natural fit when rule YAML declares its own `inputs` schema — rubric template can grow a multi-trace input array without changing the rule's contract.

## Architecture

### Module layout

```
packages/typescript/src/
├── commands/trace.ts                                # +scan subcommand parsing; +--traces parsing; dispatch
├── api/trace.ts                                     # +searchTracesStream (streaming pagination)
├── agent-providers/                                 # PR-B; tier abstraction added (small extension)
│   ├── types.ts                                     # JudgmentRequest.tier?: 'fast' | 'std' (new field)
│   └── providers/claude-code-subprocess.ts          # modelByTier opt; conditional --model flag
└── trace-ai/
    ├── diagnose/                                    # PR-B; unchanged in this issue except schemas.ts
    │   └── schemas.ts                               # RuleSchema gains rubric.gates_on
    └── scan/                                        # NEW peer subtree
        ├── index.ts                                 # runScan(opts) -> ScanSummary; orchestrator
        ├── trace-source.ts                          # 'time-window' | 'explicit-list' adapters; both expose AsyncIterable<{conv_id, traces_for_conv}>
        ├── traces-list-parser.ts                    # --traces=<list> | --traces=@file → string[]
        ├── runner.ts                                # parallel per-trace Stage-1 + Stage-3-template; collects pending rubric work
        ├── batched-rubric.ts                        # Stage-2: chunk flagged traces by rule, render multi-trace prompt, parse JSON, fan out verdicts to per-trace reports
        ├── aggregator.ts                            # deterministic aggregates: rule_frequency, agent_failure_rate
        ├── sampler.ts                               # K=5 sample selector for cross-trace synth input
        ├── cross-trace-synthesizer.ts               # Stage-4: one LLM call (tier: 'std') producing scan-summary.summary{} block
        ├── scan-summary-schema.ts                   # zod schema for scan-summary/v1
        ├── scan-summary-markdown.ts                 # md renderer (mirrors trace-ai/diagnose/report-markdown.ts)
        └── prompts/
            └── builtin/rubric-judge-batch-v1.prompt.md     # multi-trace rubric template
            └── builtin/cross-trace-synthesizer-v1.prompt.md # cross-trace narrative template
```

### Data flow

```
$ kweaver trace diagnose scan --time-range=24h --tenant=acme --out=diagnosis/latest/
       │
       ▼
[commands/trace.ts]
  parse subcommand → call runScan(opts)
       │
       ▼
[trace-ai/scan/index.ts: runScan]
  1. trace-source → AsyncIterable<{conv_id, raw_spans}>
       - time-window: api/trace.searchTracesStream(query, page_size=500)
       - explicit-list: parse --traces; for each conv_id, api/trace.getSpansByConversationId
  2. per-trace loop (parallel, bounded by --max-parallel):
       - resume check: if `<out>/<conv_id>.yaml` exists and parses → SKIP, count in traces_reused
       - assembleTraceTree → run Stage-1 symbolic (reuse trace-ai/diagnose)
       - collect into rubric_work_queue if `gates_on` matched for any rubric rule
       - run Stage-3 template synth (reuse trace-ai/diagnose/synthesizer-template)
       - assemble per-trace report (reuse trace-ai/diagnose/report-assembler)
       - write `<conv_id>.yaml.partial`, fsync, atomic-rename to `<conv_id>.yaml`
       - write `<conv_id>.md` (reuse trace-ai/diagnose/report-markdown)
  3. Stage-2 batched rubric (sequential per rule, parallel chunks within rule):
       for each rubric_rule:
         flagged = rubric_work_queue[rubric_rule]
         for chunk in chunks(flagged, K=10):
           prompt = render(builtin:rubric-judge-batch-v1, {rubric_rule, traces: chunk.toYamlCompact()})
           response = provider.invoke({prompt, outputSchema: BatchedRubricSchema, tier: 'fast'})
           for verdict in response.trace_results:
             update per-trace `<conv_id>.yaml` with new rubric Finding (atomic re-write)
             update per-trace `<conv_id>.md`
  4. aggregator over all final per-trace reports → AggregatesBlock
  5. sampler picks K=5 representative trace summaries → SamplerOutput
  6. cross-trace-synthesizer:
       prompt = render(builtin:cross-trace-synthesizer-v1, {aggregates, samples, n_total, sample_ratio})
       response = provider.invoke({prompt, outputSchema: ScanSummaryShape, tier: 'std'})
  7. assemble scan-summary.yaml + scan-summary.md
       - emit aggregates, per_trace_index, summary, scan{traces_diagnosed, traces_reused, ...}
```

## Contracts

### `scan-summary/v1` schema

```yaml
schema_version: scan-summary/v1

scan:
  scope:                                          # entry-point context
    kind: time_window | explicit_list
    time_range: 24h | null
    tenant: acme | null
    traces: [conv1, conv2, ...] | null            # populated only when kind=explicit_list
  traces_diagnosed: 142
  traces_with_findings: 38
  traces_reused: 78                               # resume: how many came from existing .yaml on disk
  traces_freshly_diagnosed: 64
  resumed_from_partial: true | false              # true iff traces_reused > 0
  diagnosed_at: 2026-05-12T...
  cli_version: 0.7.4
  synthesizer_mode: agent                         # always 'agent' in scan mode (no template fallback)

summary:                                          # Stage-4 cross-trace synthesizer output — field shape mirrors within-trace Summary
  headline: "tool_loop_no_state_change is the dominant failure mode (29% of flagged traces)"
  primary_root_cause:
    rule_ids: [tool_loop_no_state_change]         # ★ rule_ids at scan level (cf. finding_ids at within-trace level — same concept different ID space)
    description: "..."
    target_for_fix: decision_agent.prompt
  fix_priority:
    - rule_id: tool_loop_no_state_change          # ★ rule_id at scan level (cf. finding_id at within-trace level)
      affected_trace_count: 41
      reason: "highest-frequency failure mode; fixing the loop prevention prompt would reduce the dominant pattern"
  cross_rule_links:                               # ★ cross-rule rather than cross-finding (rules cross-pollinate at scan level)
    - rule_ids: [tool_loop_no_state_change, tool_retry_intent_mismatch]
      relation: "fires on same span sequence in 38/41 cases — semantic and mechanical aspects of one incident class"

aggregates:                                       # deterministic, computed without LLM
  rule_frequency:
    - rule_id: tool_loop_no_state_change
      count: 41
      severity_breakdown: { high: 30, medium: 8, low: 3 }
  agent_failure_rate:
    - agent_id: 01KR0327YK6...
      traces_diagnosed: 80
      traces_with_findings: 24
      top_rules: [tool_loop_no_state_change, tool_retry_intent_mismatch]

per_trace_index:                                  # pointers to per-trace artifacts
  - trace_id: ...
    conversation_id: ...
    report_path: diagnosis/latest/<conv_id>.yaml
    finding_count: N
```

### `diagnosis-rule/v1` extension (backwards-compatible)

```yaml
rubric:
  judge_question: ...
  inputs: [...]
  output_schema: { ... }
  agent_binding: { ... }
  gates_on:                                       # NEW; optional
    - tool_loop_no_state_change                   # array of symbolic rule_ids; OR-joined
```

Semantics:
- In scan / batch mode: Stage-2 evaluates a rubric rule on a trace only if at least one rule_id in `gates_on` produced a symbolic Finding on that trace. Empty / missing `gates_on` → rubric is evaluated on **all** traces (preserves PR-B fallback behavior; explicit-list mode honors this for compatibility).
- In single-trace mode: `gates_on` is **ignored**; rubric runs unconditionally (preserves PR-B UX where `kweaver trace diagnose <conv>` fully diagnoses the requested trace).

### `JudgmentRequest.tier` (backwards-compatible)

```typescript
export interface JudgmentRequest<T> {
  prompt: string;
  outputSchema: ZodType<T>;
  timeoutMs?: number;
  correlationId?: string;
  tier?: 'fast' | 'std';                          // NEW; undefined = provider default (no --model flag)
}
```

### `ClaudeCodeSubprocessProvider` tier mapping

```typescript
export interface ClaudeCodeSubprocessProviderOpts {
  // ...existing
  modelByTier?: { fast?: string; std?: string };  // defaults: fast='haiku', std='sonnet'
}
```

`invoke()` appends `--model {modelByTier[req.tier]}` to spawn args when `req.tier` is set; otherwise omits `--model` entirely (preserves PR-B behavior — claude CLI picks its own default).

### Batched rubric LLM output schema

```yaml
type: object
required: [trace_results]
properties:
  trace_results:
    type: array
    items:
      type: object
      required: [trace_id, category, reasoning, severity, first_violating_step_id]
      properties:
        trace_id: { type: string }                # must echo back one of the trace_ids supplied in input
        category: { type: string, enum: [...rule-specific...] }
        reasoning: { type: string }
        severity: { type: string, enum: [low, medium, high] }
        first_violating_step_id: { type: string } # must be a real span_id from THIS trace's spans
        evidence_span_ids: { type: array, items: { type: string } }
```

Validation enforced post-parse:
- `trace_id` in each item maps to a unique input trace (1:1 with input chunk)
- `first_violating_step_id` is a real span_id from that trace's input spans
- Item failing either check → recorded as `rules_skipped[].reason = agent-error:schema_violation` on the affected trace only

## Stage-2 Batched Rubric — Prompt Structure

`builtin:rubric-judge-batch-v1`:

```markdown
# Trace-Diagnose Rubric Judge (Batched)

You are evaluating one rubric rule across multiple agent traces. Read the rule's
judge question, the supplied traces, and reply with a single JSON object
containing one verdict per trace.

## Rule
- **rule_id**: `{{rule_id}}`
- **batch_size**: {{batch_size}}

## Judge Question
{{judge_question}}

## Traces
Each trace below is identified by `trace_id`. Each trace's inputs follow the
rule's `inputs` schema (resolved from the trace's spans).

{{traces_yaml}}

## Output Schema
Reply with a single JSON object. Each entry in `trace_results` corresponds to
one trace in the supplied batch, in any order. The `trace_id` field MUST echo
back the trace_id from the input.

```json
{{output_schema}}
```

{{language_instruction}}

## Output Rules
1. ONE entry per input trace_id, no duplicates, no extra entries.
2. `first_violating_step_id` MUST be a real span id from THAT trace's spans —
   the diagnose pipeline cross-checks; mis-attributed IDs cause the entry to
   be discarded with `agent-error:schema_violation`.
3. `reasoning` should cite span ids in the affected trace. When multiple traces
   share a pattern, you may cite that in one trace's reasoning ("same retry
   pattern as trace tr_xxx").
4. Pick the closest category even if imperfect; do not fall through to `other`
   unless evidence actively rules out every named category.
5. If you cannot evaluate a trace (missing spans, malformed input), emit an
   entry with `category: other`, `reasoning` explaining the gap, `severity: low`,
   `first_violating_step_id` = any real span_id from that trace.
```

## Stage-4 Cross-Trace Synthesizer — Prompt Structure

`builtin:cross-trace-synthesizer-v1`:

```markdown
# Cross-Trace Synthesizer

You are summarizing a batch of {{n_total}} agent trace diagnoses for an
operator. Aggregate statistics have been computed deterministically. You see
{{sample_count}} representative trace summaries selected as samples
({{sample_ratio}} of total). Your job: compose a short narrative explaining
the dominant failure patterns, prioritized rule-level fixes, and cross-rule
relationships.

## Aggregated Stats (deterministic)

```yaml
{{aggregates}}
```

## Representative Samples ({{sample_count}} of {{n_total}})

{{samples_yaml}}

## Output Schema
Reply with a single JSON object satisfying this schema. No prose outside the
JSON.

```json
{{output_schema}}
```

{{language_instruction}}

## Composition Rules
1. `headline` ≤ 160 chars; lead with the dominant rule pattern named in
   aggregates.rule_frequency.
2. `primary_root_cause.rule_ids` lists rules that, if fixed, would resolve the
   most traces. Cite aggregate counts; do not invent rule_ids not in
   aggregates.
3. `fix_priority` MUST order ALL rules in aggregates.rule_frequency from
   highest to lowest impact. `affected_trace_count` must match aggregates.
4. `cross_rule_links` only when ≥ X traces fire both rules together
   (sampler shows co-fire cases; aggregator surfaces counts).
5. Aggregate-grounded only: every claim in `primary_root_cause.description`
   and `fix_priority[].reason` must be backed by aggregates or samples; the
   LLM does not invent new rule_ids or trace counts.
```

## CLI Surface

```shell
kweaver trace diagnose scan
  [--time-range <duration>]                       # e.g. 24h, 7d; required when --traces not set
  [--tenant <name>]                               # optional filter
  [--out <dir>]                                   # default: ./diagnosis/scan-<timestamp>/
  [--rules <dir>]                                 # override <cwd>/diagnosis-rules/
  [--no-builtin]                                  # disable the 5+1 builtin baseline rules
  [--max-parallel <n>]                            # default 4
  [--max-traces-per-batch <n>]                    # default 100; cap on streaming pull
  [--format yaml|markdown|both]                   # default 'both'
  [--lang en|zh]                                  # default 'en'
  [--token <token>] [--base-url <url>] [-bd <bd>] # match existing convention

kweaver trace diagnose --traces=<list>
  --traces=conv1,conv2,...                        # comma-separated conversation_ids
  --traces=@/path/to/ids.txt                      # OR @file with one id per line
  [other flags same as scan above]

# Single-trace mode (unchanged from PR-B):
kweaver trace diagnose <conv_id> [...]            # rejects --traces and scan-only flags
```

Error / exit codes:

| Exit | Condition |
|---|---|
| 2 | `scan` or `--traces` with `--no-llm` (fail-fast; see decision #8) |
| 2 | `--traces=@file` where file does not exist |
| 4 | scan returned zero traces (empty time-window result, or all --traces id lookups returned 0 spans) |
| 5 | Auth missing / unreachable |
| 6 | Rule load / schema validation failure |
| 1 | Token budget exceeded during Stage-2 batch chunk preparation; message includes `--max-traces-per-batch` suggestion |

## Checkpoint / Resume

Filesystem-grounded, no separate state file.

**Write path**: every per-trace report is written as `<conv_id>.yaml.partial` first, then `fsync`'d, then atomic-renamed to `<conv_id>.yaml`. Same for `<conv_id>.md`. A partial file is never used.

**Resume path**: at runScan start, for each trace_source-emitted conv_id, check if `<out>/<conv_id>.yaml` exists.
- If yes and parses as `trace-diagnose-report/v1`: count as `traces_reused`, skip Stage-1/2/3 entirely, include this report in aggregator + sampler input.
- If yes but yaml is malformed or schema-incompatible: log warning to stderr, delete, re-diagnose. Treat as a leftover from a crashed older CLI version.
- If no: full pipeline.

**scan-summary failure path**: if Stage-4 errors out (or aggregator / sampler errors out) but per-trace reports were written successfully, the user can re-run the same command — all per-trace yaml files are reused and only Stage-4 + scan-summary write get retried.

**`--force` flag** is **not** in MVP scope. Users who want a clean re-run delete `--out` directory contents manually (and the CLI doesn't auto-delete to avoid catastrophic data loss).

## Error Handling

| Failure | Behavior | Effect on scan-summary |
|---|---|---|
| Stage-2 chunk LLM call timeout / transport / 4xx | All K traces in chunk recorded under `rules_skipped[].reason = agent-error:<kind>`; their per-trace yaml is re-written (kept Stage-1 findings; no rubric finding) | aggregates count these in `rules_skipped` per trace; cross-trace synth sees the skip count |
| Stage-2 single-item schema_violation (within otherwise-successful chunk) | Affected trace records `rules_skipped[].reason = agent-error:schema_violation`; other 9 chunk items unaffected | same as above, single-trace granularity |
| Stage-4 cross-trace synth failure | scan-summary.yaml emitted with `summary: null`; aggregates + per_trace_index still populated. User reruns; per-trace reports skipped on resume | scan-summary missing `summary` block |
| Provider returns malformed JSON envelope (Stage-2 or Stage-4) | Same as transport error; trigger one retry per PR-B's existing claude-code-subprocess retry path | n/a |
| `--traces=@file` parsed but file is empty or all-whitespace | Exit 2 with clear message ("no conversation_ids found in <file>") | scan does not start |
| time-window mode: streaming search throws after some pages consumed | Exit 5 with `HttpError` formatting; per-trace reports emitted so far are preserved; resume works | scan-summary not written; resume reuses partial work |

## Testing

Test framework: Node native `node:test` + `node:assert/strict`. HTTP mocked via the existing `mockFetchSequence()` pattern from PR-B tests.

### Unit tests

- `traces-list-parser.test.ts`: comma-separated; `@file` syntax; missing file; empty file; whitespace handling
- `aggregator.test.ts`: rule_frequency over N synthetic per-trace reports; severity_breakdown sum invariant; agent_failure_rate dedup; deterministic ordering
- `sampler.test.ts`: dominant rule threshold edges (`max(3, 5% of N)`); top-1-by-severity per rule; cross-rule co-fire detection; outlier (rubric self-labeled FP) selection; K=5 hard cap
- `batched-rubric.test.ts`: chunk K=10 split; per-chunk prompt assembly; per-item schema validation (trace_id echo, first_violating_step_id in spans); single-item failure isolation; full-chunk failure recording
- `cross-trace-synthesizer.test.ts`: aggregator + sampler output assembled into prompt; output schema validation; missing aggregate field surfaces as schema_violation
- `scan-summary-schema.test.ts`: zod round-trip; field name mirroring with within-trace Summary; nullable `summary` block under Stage-4 failure
- `scan-summary-markdown.test.ts`: aggregates rendered; per_trace_index with relative paths; summary block under both success and `summary: null` paths
- `agent-providers/tier.test.ts`: `JudgmentRequest.tier` plumbing; ClaudeCodeSubprocessProvider model arg injection; modelByTier override

### End-to-end tests

- `scan-with-list.test.ts`: `runScan({ traceIds: [...] })` with mocked agent-observability and stub agent provider; assert per-trace yaml + scan-summary.yaml + .md emitted; aggregates correct; sample selection correct
- `scan-with-time-window.test.ts`: same with mocked streaming search; assert pagination consumed; same outputs
- `scan-resume.test.ts`: write 5 fake per-trace yamls into `--out` dir, invoke scan over 10 traces, assert 5 reused + 5 freshly diagnosed; resumed_from_partial=true; scan-summary regenerated
- `scan-gates-on.test.ts`: rubric with `gates_on: [tool_loop_no_state_change]` runs only on traces where symbolic fired; verify rubric_work_queue dedup
- `scan-batched-rubric-failure.test.ts`: stub provider returns malformed JSON for one chunk; assert affected traces have `rules_skipped[].reason = agent-error:schema_violation`; other chunks succeed; scan-summary still emits
- `scan-no-llm-fail-fast.test.ts`: `scan --no-llm` exits 2 with message

### Coverage

No coverage threshold change. New modules in `trace-ai/scan/` should ship with both unit + e2e coverage proportional to PR-B's coverage levels.

## Open Questions Deferred to Implementation

1. **Streaming search query shape** — `searchTracesStream` page size, sort order, and whether to filter by `traceId.keyword` agg in the first pass or query spans directly. To resolve when first benchmarked against 62 agent-observability.
2. **`--max-parallel` upper bound under fast tier** — haiku has higher rate limits than sonnet; whether to expose a separate `--max-parallel-fast` / `--max-parallel-std`. Defer until rate-limiting is observed.
3. **Aggregator's `top_rules` selection per agent** — currently spec says "top rules" without specifying ranking. Default to top 3 by count; may revise based on real data.
4. **Cross-trace synth `cross_rule_links` threshold** — "≥ X traces fire both rules together". X TBD; aggregator should surface co-fire counts and let cross-trace synth decide based on the data.
5. **`--max-traces-per-batch` interaction with token budget** — soft cap for scan; the LLM-side cap is K=10 per batch and is fixed. Whether to expose token-budget as a config or auto-compute. Default 100 traces per scan run (UX cap, not LLM cap).
6. **Resume semantics for `--rules` changes** — if user re-runs scan with a different rules directory, should reused per-trace yamls still apply? MVP says yes (filesystem trumps); spec note that mixed-rules scans produce undefined behavior in aggregates.

## References

- Tracking issue: [kweaver-ai/kweaver-sdk#123](https://github.com/kweaver-ai/kweaver-sdk/issues/123)
- Predecessor: [#120 (PR-A + PR-B)](https://github.com/kweaver-ai/kweaver-sdk/pull/122)
- PR-B design: `docs/superpowers/specs/2026-05-11-m4-diagnose-issue1-design.md`
- Issue plan: `plan-traceai/plan/2026-05-11-m4-diagnose-issue-plan.md` §2 #2
- Vision: `plan-traceai/vision/trace-cli-detailed-design.md` §3.1 L382-384 (the original two-entry-points form), §3.3.4 (provider wrapper abstraction)
- Reference provider implementation (model tier pattern): `~/dev/github/petri/src/providers/claude-code.ts`
