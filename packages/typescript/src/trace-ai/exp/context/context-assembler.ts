import type { PatchTarget, KnContext, SkillContext, SkillBinding } from "../schemas.js";
import type { VegaCatalogClient } from "./vega-catalog-client.js";
import type { KnSchemaClient } from "./kn-schema-client.js";
import type { SkillApiClient } from "../patch/skill-api-client.js";

export class ContextAssembler {
  constructor(
    private knSchemaClient: KnSchemaClient,
    private vegaCatalogClient: VegaCatalogClient,
    private skillApiClient: SkillApiClient,
  ) {}

  async assemble(
    suggestedTarget: PatchTarget,
    knId: string | undefined,
    boundSkills: SkillBinding[],
  ): Promise<{ kn_context?: KnContext; skill_context?: SkillContext }> {
    if (suggestedTarget === "kn.object_type" || suggestedTarget === "kn.relation_type") {
      if (!knId) throw new Error("kn_id is required for kn.* patch target but was not found in candidate.yaml");
      const [existing_schema, available_dataviews] = await Promise.all([
        this.knSchemaClient.getSchema(knId),
        this.vegaCatalogClient.listDataviews({ knId }),
      ]);
      return { kn_context: { kn_id: knId, existing_schema, available_dataviews } };
    }

    if (suggestedTarget === "skill.content") {
      const bound_skills = await Promise.all(
        boundSkills.map(async (s) => ({
          id: s.id,
          version: s.version,
          content: await this.skillApiClient.getSkillContent(s.id),
        })),
      );
      return { skill_context: { bound_skills } };
    }

    // agent.system_prompt / agent.skills: no platform data needed
    return {};
  }
}
