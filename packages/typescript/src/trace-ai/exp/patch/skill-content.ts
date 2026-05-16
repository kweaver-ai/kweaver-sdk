// src/trace-ai/exp/patch/skill-content.ts
import type { SkillContentPatch } from "../schemas.js";
import type { SkillApiClient } from "./skill-api-client.js";

export class SkillContentPatcher {
  constructor(private client: SkillApiClient) {}

  async apply(patch: SkillContentPatch): Promise<{ newVersion: string }> {
    const existing = await this.client.getSkillContent(patch.skill_id);
    const updated = existing.trimEnd() + "\n\n" + patch.append_section;
    const result = await this.client.publishSkillVersion(patch.skill_id, updated);
    return { newVersion: result.version };
  }
}
