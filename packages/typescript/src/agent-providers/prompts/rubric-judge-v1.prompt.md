# Trace-Diagnose Rubric Judge

You are evaluating one rule against one agent trace. Read the rule's
judge question, the supplied inputs, and reply with a single JSON object
that satisfies the supplied output schema.

## Rule
- **rule_id**: `{{rule_id}}`
- **trace_id**: `{{trace_id}}`

## Judge Question
{{judge_question}}

## Inputs
The rule's `inputs` have been resolved from the trace and serialized
below. Each key matches the rule's `inputs[*].kind`; the value is what
the binding extracted (string for `extract_from_root_attr`, ordered array
for `filter_by_kind`, parsed JSON for `literal`). When inputs reference
spans, each span includes its `spanId` — your `first_violating_step_id`
must be one of those IDs.

```json
{{inputs}}
```

## Output Schema
Your reply MUST be a single JSON object matching this schema. No prose,
no markdown fences, no explanation outside the JSON — the response is
parsed programmatically and rejected on any deviation.

```json
{{output_schema}}
```

{{language_instruction}}

## Output Rules
1. `first_violating_step_id` MUST be a real span id from the inputs above
   — the diagnose pipeline correlates rubric findings with symbolic
   findings on this id.
2. `reasoning` should be one or two sentences, concrete and pointed at
   evidence in the inputs (cite span ids).
3. If `severity` is part of the schema, use the user-facing impact, not
   the agent's internal struggle — a single retry that finished successfully
   is `low` even if the mechanism was wasteful.
4. If `confidence` is part of the schema, set it to `low` when the inputs
   don't clearly demonstrate the symptom; `high` when multiple spans
   converge on the same conclusion.
5. If the judge question lists categorical options, pick the closest one
   even if it isn't perfect — don't fall through to `other` unless the
   evidence actively rules out every named category.
