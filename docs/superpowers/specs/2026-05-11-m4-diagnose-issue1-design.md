# M4 Trace Diagnose — Issue #1 Design (Symbolic + Rubric Double Pillar)

Last updated: 2026-05-11

Tracking issue: [kweaver-ai/kweaver-sdk#120](https://github.com/kweaver-ai/kweaver-sdk/issues/120)
Vision references: `plan-traceai/vision/trace-cli-detailed-design.md` §3.1, §3.3.4 / `vision/trace-ai-continuous-learning-design.md` §7.M4
Issue plan: `plan-traceai/plan/2026-05-11-m4-diagnose-issue-plan.md`

## Summary

Introduce a new `trace diagnose` command family in the TypeScript CLI that turns a single trace (identified by `trace_id`) into a structured YAML diagnosis report. The report is produced by a two-stage diagnosis pipeline:

- **Stage-1 — Symbolic triage signals**: deterministic TypeScript predicates over the in-memory trace tree. Cheap, replayable, machine-checkable. Catch mechanical antipatterns (loops, swallowed errors, missing fallbacks, truncation, runaway cost). 5 baseline rules ship in this issue.
- **Stage-2 — Rubric semantic verdicts**: structured judgment criteria executed by a pluggable `AgentProvider`. Expensive, non-deterministic, semantic. Catch antipatterns that require reading the trace contextually (e.g. "was this retry legitimate?"). 1 baseline rule ships in this issue, executed via a local `claude-code` subprocess provider.

For single-trace mode (this issue), both stages run unconditionally on the requested trace. For batch / `scan` mode (issue #2), Stage-1 acts as a gate so Stage-2 only runs on triage-flagged traces — this is the cost-control reason the two stages are layered, not parallel. See §Industry Alignment for evidence that this layering is the published convergent design across LangSmith, Phoenix, Braintrust, Langfuse, and the Signals paper (arXiv 2604.00356).

After Stage-1 + Stage-2 produce findings, a **within-trace Synthesizer** (Stage-3) collapses N raw findings into a single short narrative: top-1 root-cause hypothesis, fix priority, and cross-finding links (which findings are different views of the same incident). Without this layer, a report with 3+ findings is "trees, no forest" — the user has to manually correlate span_ids across findings to see the picture. The Synthesizer is `agent-providers/`'s second user (a peer of `DiagnosisAgentBinding`), uses the same `AgentProvider`, and falls back to a deterministic template under `--no-llm`.

Issue #2 (`scan` mode) extends synthesis cross-trace: aggregate per-rule frequencies, cluster similar evidence patterns, rank agents/programs by failure rate, and emit a `scan-summary.yaml` alongside the per-trace reports.

The agent abstraction (`agent-providers/`) is intentionally placed at a layer above `diagnose/` because it will be reused by future trace-ai modules (M6 Agent Synthesizer, future Triage). `diagnose/` adds thin domain bindings on top — this issue ships two of them (`agent-binding.ts` for rubric judgments, `synthesizer.ts` for within-trace narratives).

This work lands as **two peer top-level subtrees** under `packages/typescript/src/`: `trace-ai/` (the feature module — currently holds `diagnose/`; future M6 Synthesizer, Triage etc. will live alongside as siblings) and `agent-providers/` (the cross-feature LLM-provider abstraction, peer to `api/` — `AgentProvider` interface + claude-code subprocess provider + stub). The two are at the same layer as the existing `bkn / dataflow / vega / agent` modules so the project layout reflects the actual peering of feature areas. The only edit to pre-existing files is wiring the new top-level command into `packages/typescript/src/cli.ts`; `commands/`, `api/`, `auth/`, `config/` are untouched.

> Refactor note (2026-05-12, mid-PR-B): an earlier revision of this spec placed both subtrees inside a single `trace-core/` container. That naming made trace-ai look "special" relative to peer modules (bkn / dataflow / vega) and buried `agent/` (which is platform infrastructure, not trace-ai-specific) one level too deep. The current layout — `agent-providers/` hoisted to top level, `trace-ai/` named to match the M-vocabulary — is what shipped. The refactor was done while PR-B was still on the feature branch and only PR-B referenced the paths, so the cost was a single mechanical sweep.

## Goals

- Expose `kweaver trace diagnose <trace_id>` and `kweaver trace diagnose rules validate <rule.yaml>` in the CLI.
- Establish the durable contracts: `diagnosis-rule/v1`, `trace-diagnose-report/v1`, `AgentProvider`. These are intended to remain stable across future M4 / M6 / triage work.
- Promote the agent abstraction to `agent-providers/` as a reusable shared layer with one concrete provider (`claude-code` subprocess) and one stub provider (for tests / CI).
- Match existing CLI conventions for auth, business-domain resolution, and error formatting (see `AGENTS.md` at the repo root).
- Reuse the existing M3 trace search API (`POST /api/trace-ai/_search`) rather than waiting on a new backend single-trace endpoint.

## Non-goals

- Do not implement a remote `decision-agent` provider — ship as stub with TODO; real implementation deferred to post-MVP.
- Do not implement `kweaver trace diagnose scan` (time-window / tenant-filtered batch) — deferred to issue #2.
- Do not implement `kweaver trace diagnose --traces=<id-list>` (explicit conversation-id list batch, named in vision §3.1 L383) — deferred to issue #2 as a sibling entry point to `scan`. Both share the same Stage-1 → Stage-3 pipeline; the only difference is the trace source (streaming search vs. explicit enumeration). Until issue #2 lands, callers needing batch coverage must shell-loop over `diagnose <conv_id>` invocations and aggregate the resulting YAML reports manually.
- Do not implement `diagnose rules list`. Teams can use `ls diagnosis-rules/`.
- Do not allow team-authored TypeScript predicates. Team YAML files may only reference `predicate: builtin:<name>` or define inline `rubric:` blocks.
- Do not introduce `ajv` or any other JSON Schema runtime. Schema validation uses `zod`.
- Do not introduce `@anthropic-ai/sdk` or any other LLM SDK. The only LLM transport in this issue is the `claude-code` subprocess provider.
- Do not refactor unrelated command groups. Existing `commands/agent.ts`, `commands/dataflow.ts`, etc. are untouched.

## Key Design Decisions

| # | Decision | Choice | Rationale |
|---|---|---|---|
| 1 | M3 trace fetch | Reuse `POST /api/trace-ai/_search` with `{"query":{"term":{"traceId":"..."}}}` | The single-trace `GET /traces/{id}` endpoint named in vision §3.1 does not exist in the backend. Reusing `_search` keeps issue #1 self-contained. The `getTrace` API hides the OpenSearch DSL and assembles the in-memory tree locally. |
| 2 | Schema validation library | `zod` (not `ajv` as named in vision) | TS-first; type inference removes the need to maintain a separate `interface` and `.schema.json` pair. `zod.toJsonSchema()` provides a future bridge if cross-language reuse is ever needed. |
| 3 | Rule expression form | Hybrid: YAML metadata + one of `predicate:` (TS function) or `rubric:` (structured judge spec) | A 1-rule-only YAML DSL is over-engineering. A pure-TS approach leaks the contract into code. The hybrid keeps the team-facing contract in YAML while letting predicate / rubric complexity live in TypeScript or in the agent. |
| 4 | Agent abstraction location | `packages/typescript/src/agent-providers/` (a peer of `trace-ai/diagnose/`, not nested under it) | Vision §3.3.4 calls for the same wrapper pattern in M4 Diagnose Provider, M6 Agent Synthesizer, and the future Triage Wrapper. Promoting the abstraction to a shared layer prevents three near-duplicate implementations. |
| 5 | Agent transport for issue #1 | `claude-code` invoked as a local subprocess | Zero remote service dependency, dogfoods the Claude Code agent, can ship independently. The remote `decision-agent` provider is reserved as a stub and TODO for post-MVP. |
| 6 | Default rule loading | `builtin` (5) merged with `<cwd>/diagnosis-rules/*.yaml`. `--rules <dir>` overrides the cwd default; `--no-builtin` disables baselines. Name conflicts fail-fast. | Most users start by `cd`-ing into the agent project; auto-loading the team's local rules removes a "always forget --rules" footgun. The output report's `run.rules_applied` makes the implicit loading auditable. |
| 7 | Report shape | Wrapped: `{schema_version, trace, run, findings[]}` | Trace-level and run-level metadata are recorded once. Zero-finding case is represented explicitly by `findings: []` and the file is still written, so "the diagnoser ran" is provable. |
| 8 | `confidence` in symbolic findings | Fixed `low` | Symbolic predicates have no semantic basis to assert higher confidence. Rubric findings carry agent-supplied confidence in the rubric's `output_schema`. |

## Industry Alignment

Before settling on the two-stage design we ran a focused web survey of how production agent-eval / trace-analysis systems frame their evaluator primitives. The convergent finding: every major platform separates **deterministic checks** from **LLM-as-judge** and runs the former first. Selected evidence:

- **LangSmith** trajectory evals split into "deterministic comparison" (tool-sequence / step matching) and "LLM-judge" (efficiency / appropriateness). [docs](https://docs.langchain.com/langsmith/trajectory-evals)
- **Arize Phoenix**, **Braintrust**, **Langfuse** — three independent observability platforms, identical primitive set: code-based scorer + LLM-as-judge scorer; documentation in all three recommends asking "is the failure mode deterministic or subjective" first.
- **OpenAI Evals** templates are literally named *Basic* (deterministic) vs *Model-Graded*.
- **Anthropic engineering blog "Demystifying evals for AI agents"** explicitly recommends "transcript-level deterministic checks + judge for nuance"; no "all-rubric" position appears in their public material.
- **Microsoft 2025 "Taxonomy of Failure Modes in Agentic AI Systems"** white-paper enumerates 6 failure classes (retry loop, tool misuse, context loss, goal drift, cascading error, silent quality degradation) and prescribes deterministic monitors for the first three; rubric judges for the last three.
- **arXiv 2604.00356 "Signals: Trajectory Sampling and Triage for Agentic Interactions"** is essentially the published version of this design. Quote: *"all signals are computed through deterministic rules rather than model calls, which means the method incurs negligible overhead and scales easily to large collections of interaction traces."* The paper's 3-axis taxonomy — **interaction / execution / environment** — is what this spec adopts for the symbolic rule classification below. (Vision §3.1 already references this paper's 82% informativeness benchmark.)
- **Reflexion** (NeurIPS 2023) uses pre-defined heuristics for common failure cases — its tool-loop detector ("if the agent executes the same action and receives the same response for more than 3 cycles") is the prior-art version of this issue's `tool_loop_no_state_change` rule.

### Why not pure-rubric

The pure-rubric path was considered and rejected:

- **Cost** — Agent-as-a-Judge (NeurIPS'24, arXiv 2410.10934) reports step-wise judging only at ~50-trace scale due to per-trace LLM cost; for a `scan` workload over 100+ traces this is prohibitive.
- **Reproducibility** — Phoenix and Braintrust documentation both stress that deterministic scorers are reproducible across runs; LLM-judge outputs are not, which complicates regression detection across CLI versions.
- **Audit trail** — production playbooks (Latitude, Maxim) report that retry-loop and tool-error patterns are reliably caught by step-count monitors, while LLM judges sometimes rationalize them as semantically reasonable behavior — a silent-failure mode for the diagnoser itself.

### Forward-compatibility with post-training

If trace-ai later feeds Process Reward Model (PRM) or RLAIF reward-signal pipelines (vision §7 long-term direction), the symbolic signals serve as ground-truth bootstrap for reward training (PRM survey arXiv 2510.08049 confirms this pattern). Keeping symbolic as a first-class layer preserves this option.

### Conclusion

The two-stage design is industry-mainstream, not a custom invention. The remaining design discipline is to (a) align our symbolic rule taxonomy with Signals' 3 axes and MS's 6 failure classes, (b) make Stage-1 an explicit gate in the future `scan` mode (issue #2), and (c) keep the rubric output schema rich enough to integrate with Stage-1 evidence (specifically, a `first_violating_step_id` pointer per finding so semantic and mechanical evidence converge on the same span IDs).

## Architecture

### Module layout

```
packages/typescript/src/
├── cli.ts                                      # +trace top-level dispatch
├── commands/trace.ts                           # 二级 dispatch via yargs: diagnose / diagnose rules validate
├── api/trace.ts                                # B1 minimal: getTrace via _search
├── agent-providers/                            # NEW peer of api/ — cross-feature LLM provider abstraction
│   ├── types.ts                                # AgentProvider, JudgmentRequest/Response, AgentRegistry
│   ├── registry.ts                             # registerProvider / resolveProvider; capability check
│   ├── prompt-template.ts                      # PromptTemplateRegistry, render()
│   └── providers/
│       ├── claude-code-subprocess.ts           # spawn `claude -p --output-format=json`
│       ├── stub.ts                             # fixture-replay provider for tests
│       └── decision-agent-remote.ts            # stub + TODO; post-MVP implements remote HTTP
└── trace-ai/                                   # NEW peer of bkn / dataflow / vega — feature module
    └── diagnose/                               # M4 module
        ├── index.ts                            # diagnose(traceId, opts) -> Report
        ├── schemas.ts                          # B5: zod schemas (rule, report, finding, judgment, summary)
        ├── trace-shaper.ts                     # _search spans[] -> in-memory tree + indexes
        ├── rule-loader.ts                      # builtin + cwd merge; conflict detection
        ├── predicate-registry.ts               # builtin:<name> -> Predicate
        ├── signal-probe.ts                     # run all rules (Stage-1 + Stage-2), collect Hit[]
        ├── agent-binding.ts                    # Stage-2: Rubric -> AgentProvider.invoke -> RubricJudgment
        ├── synthesizer.ts                      # Stage-3: (meta, findings[]) -> Summary; LLM via AgentProvider OR template fallback under --no-llm
        ├── report-assembler.ts                 # findings + summary + meta -> Report (template rendering)
        ├── report-markdown.ts                  # Report -> human-readable markdown projection (--format=markdown|both)
        └── builtin-rules/
            ├── tool-loop-no-state-change.yaml + .ts
            ├── tool-error-swallowed.yaml + .ts
            ├── retrieval-empty-no-fallback.yaml + .ts
            ├── llm-response-truncated-no-continue.yaml + .ts
            ├── excessive-tool-calls-per-turn.yaml + .ts
            ├── tool-retry-intent-mismatch.yaml + tool-retry-intent-mismatch.prompt.md   # rubric
            └── within-trace-synthesizer-v1.prompt.md                                     # synthesizer prompt template
```

### Data flow

```
$ kweaver trace diagnose tr_de39 --out=diagnosis/refund.yaml
       │
       ▼
[commands/trace.ts]
   parse args -> resolve auth / baseUrl / business-domain -> call diagnose(traceId, opts)
       │
       ▼
[trace-ai/diagnose/index.ts]
   1. B1.getTrace(traceId)
        -> POST /api/trace-ai/_search {"query":{"term":{"traceId":"..."}}}
        -> raw spans[]
   2. trace-shaper.assemble(spans)
        -> TraceTree { root, spansById, parentToChildren, byKind, byAttribute }
   3. rule-loader.load({builtinDir, cwdRulesDir, override})
        -> Rule[] (each with resolved predicate or rubric)
        -> on conflict / unknown predicate ref: throw RuleLoadError
   4. signal-probe.run(rules, tree, agentBinding?)
        # Stage-1: run all symbolic predicates first (cheap, deterministic)
        for each symbolic rule:
          predicate(tree, rule.params) -> Hit[]
        # Stage-2: run rubric judgments
        #   issue #1 (single trace): runs unconditionally on the requested trace
        #   issue #2 (scan mode):    will gate on "any Stage-1 hit?" before invoking rubric
        for each rubric rule:
          if --no-llm or no agent registered:
            skip (warn, increment skipped counter, record in run.rules_skipped)
          else:
            judgment = agentBinding.judge(rule.rubric, ctx) -> Hit[]
            # judgment.first_violating_step_id is required (schema-enforced)
        collect findings[]
   5. synthesizer.synthesize(meta, findings, agentBinding?) -> Summary
        # Stage-3: turn N findings into one short narrative + cross-finding links
        if findings.length === 0:
          summary = { headline: "No findings", primary_root_cause: null, fix_priority: [], cross_finding_links: [] }
        else if --no-llm or no agent registered:
          # Template fallback: pick top-1 by severity, no LLM call
          summary = templateSynthesize(findings)   # deterministic; emits "see findings[0]" style headline
        else:
          summary = await agentBinding.invoke({
            prompt: render('builtin:within-trace-synthesizer-v1', { meta, findings }),
            output_schema: SummarySchema
          })
   6. report-assembler.assemble(meta, summary, findings)
        -> render templates ({{tool_name}}, {{loop_count}}, ...)
        -> validate against trace-diagnose-report/v1
   7. write yaml to opts.out
```

## Contracts

### `diagnosis-rule/v1` schema

```yaml
schema_version: diagnosis-rule/v1
id: tool_loop_no_state_change
severity: high                              # default; rubric agent may override
symptom: repeated_tool_call_without_state_change
taxonomy:                                   # required; per Industry Alignment §
  signals_axis: execution                   # interaction | execution | environment
  ms_class: retry_loop                      # retry_loop | tool_misuse | context_loss | goal_drift | cascading_error | silent_quality_degradation
suggested_fix:
  target: decision_agent.prompt
  change_template: "add stop condition after {{loop_count}} equivalent failed retrievals"
verify_with:
  assertion_templates:
    - "tool_call_count({{tool_name}}) <= {{max_count}}"

# exactly one of `predicate` or `rubric` must be present:

predicate: builtin:tool_loop_no_state_change       # symbolic
params:                                             # passed through to the TS function
  min_consecutive: 3

# OR

rubric:                                             # rubric
  judge_question: "Given the user's intent and the tool retry pattern, was this a legitimate retry strategy, stale-results handling failure, or prompt confusion?"
  inputs:
    - kind: user_intent
      source: extract_from_root_attr:gen_ai.user.message
    - kind: span_sequence
      source: filter_by_kind:[tool, llm]
  output_schema:                                    # zod-equivalent JSON Schema
    type: object
    required: [category, reasoning, severity]
    properties:
      category:
        enum: [legitimate_retry, stale_results, prompt_confusion, other]
      reasoning: { type: string }
      severity: { enum: [low, medium, high] }
      first_violating_step_id: { type: string }      # required for all rubric rules
      evidence_span_ids: { type: array, items: { type: string } }
    required: [category, reasoning, severity, first_violating_step_id]
agent_binding:
  provider: claude-code                              # name in AgentRegistry
  prompt_template_ref: builtin:rubric-judge-v1
```

The zod schema enforces:
- `predicate` XOR `rubric` (exactly one must be present)
- `taxonomy.signals_axis` and `taxonomy.ms_class` required on every rule
- For rubric rules: `output_schema.required` must include `first_violating_step_id` (rule-loader rejects rubric YAMLs that omit this field)

This last check is the convergence contract between Stage-1 and Stage-2: every rubric verdict produces a span pointer, so rubric findings can always be correlated with symbolic evidence on the same span.

### `trace-diagnose-report/v1` schema

```yaml
schema_version: trace-diagnose-report/v1
trace:
  trace_id: tr_de39cbe9...
  agent_id: agent_123                       # nullable if not in trace
  tenant: acme                              # nullable
run:
  diagnosed_at: 2026-05-11T10:30:00Z
  cli_version: 0.8.0
  mode: hybrid                              # symbolic-only | rubric-only | hybrid
  rules_applied: [tool_loop_no_state_change, ...]
  rules_skipped:                            # rubric rules skipped under --no-llm
    - rule_id: tool_retry_intent_mismatch
      reason: no-llm-flag-set
  synthesizer_mode: agent                   # agent | template (template = --no-llm fallback)
summary:                                    # ★ Stage-3: forest view over findings[]
  headline: "Agent failed to recognize stale retrieval results across 3 retries"
  primary_root_cause:
    finding_ids: [0, 1]                     # indexes into findings[] below
    description: "Agent retried the retrieval tool 3 times facing identical stale results without recognizing they were stale; symbolic rule caught the mechanical loop, rubric judged the semantic class as stale_results handling failure."
    target_for_fix: decision_agent.prompt
  fix_priority:                             # multi-finding ordering
    - finding_id: 0
      reason: "highest severity; root of the cascading retry pattern"
    - finding_id: 1
      reason: "same incident as f0 from the semantic angle; one fix likely addresses both"
  cross_finding_links:                      # which findings describe the same incident
    - finding_ids: [0, 1]
      relation: "same span sequence; symbolic detects mechanical pattern, rubric judges semantic intent"
findings:
  - rule_id: tool_loop_no_state_change
    judgment_kind: symbolic                 # symbolic | rubric
    severity: high
    symptom: repeated_tool_call_without_state_change
    likely_cause: missing_termination_condition_in_agent_program
    evidence:
      spans: [sp_7, sp_8, sp_9]
      excerpt: |
        retrieval(query="refund policy 2024") was invoked 3 times in succession with identical args; no state mutation observed between calls.
    suggested_fix:
      target: decision_agent.prompt
      change: "add stop condition after 3 equivalent failed retrievals"
    confidence: low                         # symbolic always low
    verify_with:
      suggested_eval_case:
        query_id: refund_001
        query: <extracted from trace if available, else null>
        assertions:
          - "tool_call_count(retrieval) <= 2"
  - rule_id: tool_retry_intent_mismatch
    judgment_kind: rubric
    severity: high                          # from agent output
    symptom: repeated_tool_call_without_state_change
    likely_cause: stale_results_handling_failure
    evidence:
      spans: [sp_7, sp_8, sp_9]
      excerpt: "Agent did not detect that retrieval results were unchanged across 3 attempts."
    suggested_fix:
      target: decision_agent.prompt
      change: "after second identical retrieval response, switch to clarification or fallback"
    confidence: medium
    rubric_output:                          # raw structured output preserved for audit
      category: stale_results
      reasoning: "..."
      severity: high
      first_violating_step_id: sp_8         # the span where the judge first identified the antipattern
      evidence_span_ids: [sp_7, sp_8, sp_9]
    verify_with: { ... }
```

### `AgentProvider` interface (cross-trace-ai shared)

Located at `agent-providers/types.ts`. Domain-agnostic — does not know about diagnosis or rubrics specifically.

```typescript
export interface AgentProvider {
  readonly name: string;                                    // 'claude-code' | 'decision-agent' | 'stub'
  readonly kind: 'local-subprocess' | 'remote-http';

  capabilities(): ProviderCapabilities;
  invoke(req: JudgmentRequest): Promise<JudgmentResponse>;
}

export interface ProviderCapabilities {
  structured_output: 'native' | 'prompt-coerced';
  max_context_tokens: number;
  requires_local_binary?: string;                           // e.g. 'claude' for claude-code-subprocess
  supports_streaming?: boolean;
}

export interface JudgmentRequest {
  prompt: string;                                           // assembled by caller
  output_schema: ZodSchema<Record<string, unknown>>;        // validation + JSON Schema for prompt hint
  context_excerpt?: TraceExcerpt;                           // optional structured trace slice
  timeout_ms?: number;                                      // default 60000
}

export interface JudgmentResponse {
  output: Record<string, unknown>;                          // already validated against output_schema
  raw_text: string;
  metadata: {
    provider: string;
    latency_ms: number;
    retries: number;
    tokens?: { prompt: number; completion: number };
  };
}

export interface AgentRegistry {
  register(provider: AgentProvider): void;
  resolve(name: string): AgentProvider;                     // throws ProviderNotRegisteredError
  list(): AgentProvider[];
}
```

### Predicate signature (symbolic rules)

```typescript
export type Predicate = (trace: TraceTree, params: Record<string, unknown>) => Hit[];

export interface Hit {
  evidence_spans: string[];                                 // span_id list
  excerpt: string;                                          // free text summary, written to finding.evidence.excerpt
  bindings: Record<string, unknown>;                        // template vars: {tool_name, loop_count, ...}
}
```

`signal-probe` collects `Hit[]`; `report-assembler` renders `change_template` and `assertion_templates` against `bindings` to fill the finding.

## Builtin Rules

### Symbolic (5)

Each symbolic rule is classified along the **Signals paper's 3 axes** (`interaction` / `execution` / `environment`) and mapped to the **MS taxonomy's 6 failure classes** (`retry_loop` / `tool_misuse` / `context_loss` / `goal_drift` / `cascading_error` / `silent_quality_degradation`). The classification is recorded in each rule's YAML under a `taxonomy:` block so reports and aggregations can pivot by category.

| # | rule_id | Signals axis | MS class | Trigger condition |
|---|---|---|---|---|
| 1 | `tool_loop_no_state_change` | execution | retry_loop | Same `tool_name` invoked ≥ `min_consecutive` (default 3) times in succession; equivalent args (deep equal); no state field change between calls. Final state-field list TBD against real fixture during impl (see deferred questions). |
| 2 | `tool_error_swallowed` | execution | cascading_error | A tool span with `status=error` is followed by an LLM span whose prompt does not contain the error text or a recognizable error indicator |
| 3 | `retrieval_empty_no_fallback` | execution | cascading_error | A retrieval span with `result_count=0` is followed directly by an LLM generation, with no intervening retry, query rewrite, or alternate source |
| 4 | `llm_response_truncated_no_continue` | execution | context_loss | An LLM span with `finish_reason=length` (or `truncated=true`) is not followed by a continuation LLM span |
| 5 | `excessive_tool_calls_per_turn` | execution | tool_misuse | Total tool calls within a single user turn exceeds `max_tool_calls_per_turn` (default 10) |

**Coverage note**: all 5 baselines fall on the `execution` axis. The `interaction` and `environment` axes, plus the `goal_drift` and `silent_quality_degradation` MS classes, are deliberately left to rubric rules — they require semantic judgment that symbolic predicates cannot reasonably provide. This is an explicit roadmap signal for future rubric expansion.

For each rule, the implementation includes:
- One YAML metadata file (with `taxonomy:` block)
- One TS predicate module exporting a function matching the `Predicate` type
- One synthetic fixture under `test/fixtures/trace-diagnose/synthetic/<rule_id>.json` (a minimal trace that triggers exactly this rule)

### Rubric (1)

| rule_id | Signals axis | MS class | Pairs with | Judge question |
|---|---|---|---|---|
| `tool_retry_intent_mismatch` | interaction | goal_drift | `tool_loop_no_state_change` | "Given the user's intent and the tool retry pattern, was this a legitimate retry strategy, stale-results handling failure, or prompt confusion?" |

Output schema:

```yaml
output_schema:
  type: object
  required: [category, reasoning, severity, first_violating_step_id]
  properties:
    category: { enum: [legitimate_retry, stale_results, prompt_confusion, other] }
    reasoning: { type: string }
    severity: { enum: [low, medium, high] }
    first_violating_step_id:
      # Per arXiv 2603.18096 trace assurance pattern: the rubric judge must point at
      # the specific span where the violation became evident, not just give a verdict.
      # Lets Stage-2 verdicts converge with Stage-1 evidence on the same span IDs.
      type: string
      description: "span_id of the first span where the judge identified the antipattern"
    evidence_span_ids: { type: array, items: { type: string } }
```

**General convention**: every rubric rule's `output_schema` MUST include `first_violating_step_id` as a required field. The `agent-binding` layer enforces this at rule-load time — a rubric rule whose output schema lacks this field fails validation. This is the contract that lets Stage-1 (symbolic) and Stage-2 (rubric) findings be correlated: both ultimately produce a span_id, so the report's `findings[]` can be sorted, deduplicated, or cross-referenced by span position.

Pairing this rubric with the `tool_loop_no_state_change` symbolic rule on the same fixture demonstrates the two-stage value: the symbolic rule deterministically catches the mechanical pattern (Stage-1 triage); the rubric judges the semantic class of failure and pinpoints which span first revealed it (Stage-2 verdict). On a future `scan` workload (issue #2), Stage-1 would gate Stage-2 — the rubric only runs on traces flagged by at least one symbolic rule.

## Synthesizer (Stage-3, within-trace)

Located at `trace-ai/diagnose/synthesizer.ts`. Runs after Stage-1 + Stage-2 produce findings; emits the report's top-level `summary:` block. The synthesizer is the second consumer of `agent-providers/`'s `AgentProvider` (peer of `agent-binding.ts`).

**Why this exists** — without Stage-3, a report with 3+ findings forces the user to manually correlate span_ids across findings to see the picture. In particular, when symbolic and rubric rules fire on the same span sequence (the `tool_loop_no_state_change` + `tool_retry_intent_mismatch` pair), they describe one incident from two angles; Stage-3 makes that explicit via `cross_finding_links`.

**Output schema** (`Summary`):

```typescript
const SummarySchema = z.object({
  headline: z.string().max(160),
  primary_root_cause: z.object({
    finding_ids: z.array(z.number().int()).min(1),
    description: z.string(),
    target_for_fix: z.string(),
  }).nullable(),                            // null if findings is empty
  fix_priority: z.array(z.object({
    finding_id: z.number().int(),
    reason: z.string(),
  })),
  cross_finding_links: z.array(z.object({
    finding_ids: z.array(z.number().int()).min(2),
    relation: z.string(),
  })),
});
```

**Two execution modes**:

| Mode | When | How |
|---|---|---|
| `agent` | default; `claude-code` provider available | render `builtin:within-trace-synthesizer-v1` prompt with `{meta, findings}`, invoke `AgentProvider`, validate output against `SummarySchema` |
| `template` | `--no-llm` flag, OR no agent registered, OR agent invocation failed (after retries) | deterministic fallback: pick top-1 by `severity`, headline = `"see findings[0]: <symptom>"`, `cross_finding_links` populated only when two findings share ≥ 50% of evidence span_ids; emits a real `Summary` so downstream consumers always have one |

The `template` fallback ensures `--no-llm` mode still produces a `summary` block — there is no "summary missing" case in the report schema. `run.synthesizer_mode` records which path ran.

**Empty findings**: if `findings.length === 0`, the synthesizer short-circuits to `{headline: "No findings", primary_root_cause: null, fix_priority: [], cross_finding_links: []}` without invoking the agent. Saves an LLM call when the report has nothing to summarize.

**Cost**: one `AgentProvider.invoke` per trace in agent mode. For single-trace mode (this issue) the cost is negligible. For `scan` mode (issue #2), Stage-3 will follow the Stage-1 gate — only invoked on traces with ≥ 1 finding.

## CLI Surface

```shell
kweaver trace diagnose <trace_id>
  [--out <file>]                            # default: ./diagnosis/<trace_id>.yaml
  [--rules <dir>]                           # override <cwd>/diagnosis-rules/
  [--no-builtin]                            # disable the 5 symbolic baselines (debug only)
  [--no-llm]                                # skip rubric rules; symbolic only
  [--format yaml|markdown|both]             # yaml = source of truth; markdown = human view; both = write both side by side. Default: 'both' when --out is a file, 'yaml' when stdout.
  [--agent-provider <name>]                 # default: 'claude-code'; testing: 'stub'
  [--timeout-ms <n>]                        # per-rubric agent invocation; default 60000
  [-bd | --business-domain <bd>]            # match existing kweaver-sdk convention
  [--token <token>] [--base-url <url>]      # match existing convention

kweaver trace diagnose rules validate <rule.yaml>
  # exit 0 on pass; exit 6 on failure with detailed schema errors
```

Default `--out` strategy: if the directory does not exist, it is created (`mkdir -p`). If `--out -` is passed, the report is written to stdout (used by tests and pipelines).

**Output format**: YAML is canonical (machine-readable, schema-validated). Markdown is a deterministic projection of the same `Report` object via `report-markdown.ts` — there are no facts in the md that are not in the yaml. When `--out diagnosis/refund.yaml --format=both` is given, the renderer writes `diagnosis/refund.yaml` + `diagnosis/refund.md` side by side; user can paste the md straight into a ticket / PR / wiki while the yaml lives in git for tooling. Md → YAML round-tripping is intentionally NOT supported (md is lossy by design — the `verify_with.suggested_eval_case.query_id` etc. structured fields are flattened into prose).

Help output and all log lines must be in English (per `AGENTS.md`).

## Provider Implementation: claude-code subprocess

Located at `agent-providers/providers/claude-code-subprocess.ts`.

```typescript
class ClaudeCodeSubprocessProvider implements AgentProvider {
  readonly name = 'claude-code';
  readonly kind = 'local-subprocess';

  capabilities(): ProviderCapabilities {
    return {
      structured_output: 'prompt-coerced',
      max_context_tokens: 200000,
      requires_local_binary: 'claude',
    };
  }

  async invoke(req: JudgmentRequest): Promise<JudgmentResponse> {
    // 1. Append schema hint to prompt:
    //    "\n\nOutput ONLY a JSON object matching this schema:\n<JSON Schema from req.output_schema>"
    // 2. spawn('claude', ['-p', '--output-format=json', '--max-turns=1'])
    //    pipe assembled prompt via stdin
    //    enforce req.timeout_ms (default 60000) via AbortController
    // 3. capture stdout (claude returns JSON wrapping the conversation); extract assistant final message
    // 4. parse assistant message as JSON; on failure, retry up to N=2 with explicit "your previous output was not valid JSON" preamble
    // 5. validate parsed JSON against req.output_schema (zod); throw OutputSchemaValidationError on failure
    // 6. return JudgmentResponse with output, raw_text, metadata (latency, retries)
  }
}
```

Failure modes and exit treatment (raised as typed errors, surfaced by the caller):

| Condition | Error class | Caller behavior |
|---|---|---|
| `claude` not on PATH | `ProviderUnavailableError` (raised at `capabilities()` check before `invoke`) | fail-fast at startup with installation hint |
| Subprocess timeout | `ProviderTimeoutError` | report finding skipped + warn; continue other rules |
| Subprocess non-zero exit | `ProviderInvocationError` | same as timeout |
| Output JSON parse failure after retries | `OutputParseError` | same |
| Output schema validation failure | `OutputSchemaValidationError` | same |

CI environments without `claude` installed must use `--agent-provider stub` or `KWEAVER_DIAGNOSE_AGENT_PROVIDER=stub`.

## Error Handling

| Failure | Behavior | Exit code |
|---|---|---|
| `trace_id` not found in `_search` response | Friendly error suggesting time-window / tenant check | 4 |
| M3 returns 401 / unreachable | Wrap `HttpError` from `src/utils/http.ts`, suggest `kweaver auth login` | 5 |
| Rule name conflict (builtin vs cwd) | fail-fast listing both file paths | 6 |
| YAML references `predicate: builtin:X` where X is unregistered | rule-loader stage error (does not reach probe) | 6 |
| YAML fails `diagnosis-rule/v1` zod validation | rule-loader error with zod issue path | 6 |
| `--out` directory does not exist | auto `mkdir -p` | 0 |
| 0 findings | report still written with `findings: []`; stdout: "no findings" | 0 |
| Rubric rule with `--no-llm` | skipped, recorded under `run.rules_skipped`, warn to stderr | 0 |

## Testing

Test framework: Node native (`node:test` + `node:assert/strict`). HTTP mocking via the existing `mockFetchSequence()` helper from `packages/typescript/test/agent-trace.test.ts`.

### Unit tests

- `rule-loader.test.ts`: builtin loading, cwd merge, name conflict, unknown predicate ref, unknown agent provider ref, predicate XOR rubric enforcement, taxonomy required, rubric `first_violating_step_id` enforcement
- `signal-probe.test.ts`: each builtin symbolic predicate independently — feed minimal hand-built `TraceTree`, assert expected `Hit[]`
- `synthesizer.test.ts`:
  - empty findings → short-circuits to "No findings" summary, no agent call
  - template mode (forced via `--no-llm`) → top-1 by severity, deterministic headline, no agent call; verify same input always produces same output
  - agent mode with stub provider → returns canned summary, validates against `SummarySchema`
  - agent invocation failure → falls back to template mode, `run.synthesizer_mode === 'template'`
  - cross-finding links: two findings on overlapping spans → `cross_finding_links` populated; non-overlapping findings → empty
- `report-assembler.test.ts`: template rendering with bindings, empty findings, meta + summary fields, schema validation
- `agent-registry.test.ts`: register / resolve / capability check; ProviderUnavailableError surfaced before invoke
- `claude-code-subprocess.test.ts`: subprocess spawn args, stdin payload format, timeout handling, JSON parse retry, schema validation; mock `child_process.spawn`
- `stub-provider.test.ts`: fixture replay; deterministic outputs

### End-to-end tests

For each of the 5 symbolic baseline rules:
- Build a synthetic `_search` response fixture under `test/fixtures/trace-diagnose/synthetic/<rule_id>.json`
- `mockFetchSequence` returns the fixture for a `_search` call with the matching `traceId` term
- Run `diagnose(traceId, {out: '/dev/null', noLlm: true})` programmatically
- Assert: `findings.length === 1`, `findings[0].rule_id === <rule_id>`, `findings[0].judgment_kind === 'symbolic'`, `summary.primary_root_cause.finding_ids === [0]`, `run.synthesizer_mode === 'template'`

For the 1 rubric rule:
- Synthetic fixture triggers `tool_loop_no_state_change`
- Run with `--agent-provider stub`; stub returns canned `category: stale_results` judgment + canned synthesizer summary
- Assert: 2 findings (1 symbolic + 1 rubric), rubric finding has `judgment_kind: 'rubric'` and `rubric_output.category === 'stale_results'`, `summary.cross_finding_links` links findings 0 and 1, `run.synthesizer_mode === 'agent'`

For false-positive checking:
- Snapshot `plan-traceai/status_quo/附录-完整trace样本/01_raw_opensearch_response.json` to `test/fixtures/trace-diagnose/real/de39cbe9.json`
- Run all 6 rules (5 symbolic + 1 rubric, with stub provider)
- Assert: `findings.length === 0`, `summary.headline === "No findings"`, `run.synthesizer_mode === 'agent' || 'template'` (depends on whether stub is registered)

For `rules validate` command:
- Pass each builtin rule YAML — expect exit 0
- Pass a malformed rule (missing required field, unknown predicate, neither predicate nor rubric) — expect exit 6 with descriptive error containing the offending field path

### Coverage gates

The Makefile target `make test-cover` should continue to pass; new modules in `trace-ai/` and `agent-providers/` should not regress overall coverage. No coverage gate threshold change is requested for this issue.

## Documentation Synchronization

Per `AGENTS.md`, CLI changes must update four places:

- `packages/typescript/src/cli.ts` `printHelp()`: add `trace` to the top-level command list
- `packages/typescript/src/commands/trace.ts` help: full subcommand and flag listing
- `skills/kweaver-core/references/`: add `trace.md` reference document with synopsis, examples, and exit codes
- `README.md`: mention `trace diagnose` in the command summary

## Open Questions Deferred to Implementation

These are recorded so the implementation plan can address them; they do not block the design.

1. **State field list for `tool_loop_no_state_change`**: which exact attribute keys count as "state change between calls" needs to be informed by sample real traces. Initial guess: `gen_ai.conversation.state`, `gen_ai.session.*`. To be finalized when writing the predicate.
2. **`verify_with.suggested_eval_case.query` extraction**: the user query lives somewhere in the root span's request body. Need to inspect a representative trace to pin down the attribute path. If unavailable, set to `null`.
3. **Prompt template format for builtin rubric rules**: a markdown file with `{{placeholder}}` substitution is sufficient for one rule; if a richer template language is needed later, that will be a separate decision. Issue #1 ships the smallest workable form.
4. **"In succession" semantics for `tool_loop_no_state_change`**: whether intervening non-tool spans (e.g. a brief LLM "let me try again" reasoning span) break the chain, or whether the predicate operates on the filtered subsequence of tool spans only. To be decided when writing the predicate against a real fixture; recorded in the predicate's TS file as a comment.

## References

- Tracking issue: [kweaver-ai/kweaver-sdk#120](https://github.com/kweaver-ai/kweaver-sdk/issues/120)
- Issue plan with full decision log: `plan-traceai/plan/2026-05-11-m4-diagnose-issue-plan.md`
- Vision: `plan-traceai/vision/trace-cli-detailed-design.md` §3.1, §3.3.4 / `vision/trace-ai-continuous-learning-design.md` §7.M4
- Repo conventions: [`AGENTS.md`](/home/zhang/kweaver/kweaver-sdk/AGENTS.md)
- Existing similar spec for style reference: [`docs/superpowers/specs/2026-04-02-dataflow-cli-design.md`](/home/zhang/kweaver/kweaver-sdk/docs/superpowers/specs/2026-04-02-dataflow-cli-design.md)
