# Cross-Trace Synthesizer

You are summarizing a batch of {{n_total}} agent trace diagnoses for agent
{{agent_id}}. All traces belong to this single agent. Aggregate statistics
have been computed deterministically. You see {{sample_count}} representative
trace summaries selected as samples ({{sample_ratio}} of total). Your job:
compose a short narrative explaining the dominant failure patterns,
prioritized rule-level fixes, and cross-rule relationships **specific to
this agent's program**.

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
   aggregates.rule_frequency. Frame as "this agent does X" since all traces
   share the same agent.
2. `primary_root_cause.rule_ids` lists rules that, if fixed in THIS agent's
   program, would resolve the most traces. Cite aggregate counts; do not
   invent rule_ids not in aggregates.
3. `fix_priority` MUST order ALL rules in aggregates.rule_frequency from
   highest to lowest impact. `affected_trace_count` must match aggregates.
4. `cross_rule_links` only when ≥ 2 rules fire on the same trace (sampler
   shows co-fire cases; aggregator surfaces counts indirectly).
5. Aggregate-grounded only: every claim in `primary_root_cause.description`
   and `fix_priority[].reason` must be backed by aggregates or samples; the
   LLM does not invent new rule_ids or trace counts.
