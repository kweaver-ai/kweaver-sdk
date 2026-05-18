// src/trace-ai/exp/providers/synthesizer-client.ts
import yaml from "js-yaml";
import { defaultRegistry } from "../../../agent-providers/registry.js";
import { NextChangeSchema } from "../schemas.js";
import type { Mission, NextChange, RoundData, KnContext, SkillContext, FailureAttribution } from "../schemas.js";

export interface SynthesizerInput {
  mission: Mission;
  candidateConfig: Record<string, unknown>;
  prevRound?: RoundData;
  prevRounds: RoundData[];
  crossRoundMemoryRef?: string;
  failure_attribution?: FailureAttribution[];
  kn_context?: KnContext;
  skill_context?: SkillContext;
}

export interface SynthesizerClient {
  generate(input: SynthesizerInput): Promise<NextChange>;
}

export function buildSynthesizerPrompt(input: SynthesizerInput): string {
  const prevSummary = input.prevRounds.map(r =>
    `Round ${r.round}: outcome=${r.scores?.outcome.toFixed(2) ?? "?"}, hints=${r.triage_conclusion?.hints.join("; ") ?? "none"}`
  ).join("\n");

  let contextSection = "";
  if (input.kn_context) contextSection += "\n\n" + buildKnContextPrompt(input.kn_context);
  if (input.skill_context) contextSection += "\n\n" + buildSkillContextPrompt(input.skill_context);

  const attributionHint = input.failure_attribution && input.failure_attribution.length > 0
    ? `\nFAILURE ATTRIBUTION:\n${input.failure_attribution.map(fa =>
        `  layer=${fa.layer}, suggested_target=${fa.suggested_target}, evidence="${fa.evidence}", affected=${fa.affected_queries.join(", ")}`
      ).join("\n")}`
    : "";

  return `You are an agent optimization assistant. Given an experiment goal and round results, suggest the next change to try.

GOAL: ${input.mission.goal}

CURRENT CANDIDATE CONFIG:
${yaml.dump(input.candidateConfig, { lineWidth: 80 })}

PREVIOUS ROUNDS:
${prevSummary || "None (first round)"}

${input.prevRound?.triage_conclusion ? `TRIAGE HINTS FROM LAST ROUND:\n${input.prevRound.triage_conclusion.hints.join("\n")}` : ""}

${input.crossRoundMemoryRef ? `CROSS-ROUND CONTEXT: ${input.crossRoundMemoryRef}` : ""}
${attributionHint}${contextSection}

Respond with a JSON object with exactly these fields:
- "target": one of "agent.system_prompt", "agent.skills", "kn.object_type", "kn.relation_type", "skill.content"
- "hypothesis": brief explanation of why this change might help
- "patch": shape depends on target — see examples below, follow exactly

Use the suggested_target from failure_attribution[0] when available.

OUTPUT EXAMPLES (pick the one matching your chosen target):

# agent.system_prompt — patch is a JSON string (escaped) or object with {agent:{system_prompt}}
{"target":"agent.system_prompt","hypothesis":"Add explicit stop condition","patch":"{\\"agent\\":{\\"system_prompt\\":\\"New prompt here\\"}}"}

# agent.skills — patch is structured {unbind:[skill_id...], bind:[{id,version}...]}
{"target":"agent.skills","hypothesis":"Swap retrieval skill to v2","patch":{"unbind":["retrieval-v1"],"bind":[{"id":"retrieval-v2","version":"v2"}]}}

# kn.object_type — patch is {kn_id, add_object_types:[{concept_name, dataview_id, primary_keys, data_properties}], add_relation_types:[]}
{"target":"kn.object_type","hypothesis":"Add vehicle_sales concept","patch":{"kn_id":"kn-x","add_object_types":[{"concept_name":"vehicle_sales","dataview_id":"dv-001","primary_keys":["vehicle_sales_id"],"data_properties":[{"name":"sales","type":"integer"},{"name":"month","type":"string"}]}],"add_relation_types":[]}}

# kn.relation_type — patch is {kn_id, add_object_types:[], add_relation_types:[{concept_name, source_object_type, target_object_type, join_key}]}
{"target":"kn.relation_type","hypothesis":"Link sales to vehicle","patch":{"kn_id":"kn-x","add_object_types":[],"add_relation_types":[{"concept_name":"sold_for","source_object_type":"vehicle_sales","target_object_type":"vehicle","join_key":"vehicle_id"}]}}

# skill.content — patch is {skill_id, append_section}
{"target":"skill.content","hypothesis":"Document sort_by usage","patch":{"skill_id":"query-sop","append_section":"## Sort_by usage\\nPass sort_by=[{field, order}] to query_object_instance for ordering."}}`;
}

export class ClaudeCodeSynthesizer implements SynthesizerClient {
  async generate(input: SynthesizerInput): Promise<NextChange> {
    const provider = defaultRegistry.resolve({ preferred: "claude-code" });
    if (!provider) throw new Error("claude-code provider not available");

    const response = await provider.invoke({
      prompt: buildSynthesizerPrompt(input),
      outputSchema: NextChangeSchema,
      correlationId: `synthesizer-${Date.now()}`,
    });
    return response.output;
  }
}

export function buildKnContextPrompt(ctx: KnContext): string {
  const existingTypes = ctx.existing_schema.object_types
    .map(t => `  - ${t.concept_name}: fields=[${t.fields.map(f => `${f.name}(${f.type})`).join(", ")}]`)
    .join("\n");
  const existingRelations = ctx.existing_schema.relation_types
    .map(r => `  - ${r.concept_name}: ${r.source} → ${r.target}, join_key="${r.join_key}"`)
    .join("\n") || "  (none)";
  const dataviews = ctx.available_dataviews
    .map(dv => `  - id="${dv.id}" name="${dv.name}"\n    columns=[${dv.columns.map(c => `${c.name}(${c.type})`).join(", ")}]`)
    .join("\n");

  return `
## Existing KN Schema (kn_id: ${ctx.kn_id})
Object types:
${existingTypes || "  (none)"}
Relation types:
${existingRelations}

## Available Vega Dataviews
${dataviews}

## Instructions for generating the KN patch:
1. Find the dataview whose name contains the missing concept_name as a suffix substring
   (e.g. concept "vehicle_sales" matches "ht_data_513_vehicle_sales" because name.endsWith("vehicle_sales") after split by "_" heuristic).
   If multiple candidates exist, pick the closest suffix match.
2. Extract data_properties from that dataview's columns.
3. Infer primary_keys: look for a column named "{concept_name}_id". If not found, use "id".
   Include only the primary key column(s), not all columns.
4. For relation_type inference:
   - Normalize field names: lowercase + remove underscores (e.g. "VEHICLEID" → "vehicleid", "vehicle_id" → "vehicleid").
   - If any existing KN object_type has a field whose normalized name equals any column in the new dataview:
     propose a relation_type with join_key = "{existing_field_name} → {new_column_name}".
5. Set kn_id to "${ctx.kn_id}".
`.trim();
}

export function buildSkillContextPrompt(ctx: SkillContext): string {
  const skillDocs = ctx.bound_skills
    .map(s => `### skill_id: "${s.id}" (version: ${s.version})\n${s.content}`)
    .join("\n\n---\n\n");

  return `
## Currently Bound Skills
${skillDocs}

## Instructions for generating the skill.content patch:
1. Read the failure evidence carefully. It names a specific tool (e.g. "query_object_instance").
2. Search each skill's content for that tool name. The skill that documents the tool is the one to patch.
   Set skill_id to that skill's id.
3. Generate append_section that fixes the capability gap described in the failure evidence.
   - Match the existing document style (heading level, bullet format, code examples if any).
   - Be specific: if the issue is "no sort_by", show exactly how to pass sort_by.
   - If the issue is "no pagination", show the search_after loop pattern.
`.trim();
}
