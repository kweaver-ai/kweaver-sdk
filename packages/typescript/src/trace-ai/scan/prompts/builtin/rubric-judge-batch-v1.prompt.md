# Trace-Diagnose Rubric Judge (Batched)

You are evaluating one rubric rule across multiple agent traces from the
same agent (agent_id: {{agent_id}}). Read the rule's judge question, the
supplied traces, and reply with a single JSON object containing one verdict
per trace.

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
