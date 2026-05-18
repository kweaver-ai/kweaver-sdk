// src/trace-ai/exp/providers/synthesizer-client.ts
//
// NOTE: The former ClaudeCodeSynthesizer + buildSynthesizerPrompt have been
// merged into ClaudeCodeTriageClient (single LLM call per round). This file
// now only hosts the two context sub-prompt builders, which TriageClient
// imports when assembling its planner prompt.
import type { KnContext, SkillContext } from "../schemas.js";

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
  const probes = ctx.data_probes && ctx.data_probes.length > 0
    ? "\n## Data Probes (live record counts from KN)\n" + ctx.data_probes
        .map(p => `  - ${p.concept_name} (data_view: ${p.data_view_id}) → ${p.total_records} records`)
        .join("\n")
    : "";

  return `
## Existing KN Schema (kn_id: ${ctx.kn_id})
Object types:
${existingTypes || "  (none)"}
Relation types:
${existingRelations}

## Available Vega Dataviews
${dataviews}${probes}

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
