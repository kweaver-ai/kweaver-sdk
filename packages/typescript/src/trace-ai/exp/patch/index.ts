// src/trace-ai/exp/patch/index.ts
import type { NextChange, AgentSkillsPatch, SkillBinding } from "../schemas.js";
import { NextChangeSchema } from "../schemas.js";
import { applyAgentConfigPatch } from "./agent-config.js";
import { KnPatcher } from "./kn.js";
import { SkillContentPatcher } from "./skill-content.js";
import type { KnApiClient } from "./kn-api-client.js";
import type { SkillApiClient } from "./skill-api-client.js";

export interface ApplyResult {
  candidate: Record<string, unknown>;
  skillVersion?: string;
}

export class PatchApplier {
  constructor(
    private workDir: string,
    private knClient?: KnApiClient,
    private skillClient?: SkillApiClient,
  ) {}

  async apply(candidate: Record<string, unknown>, rawNextChange: unknown): Promise<ApplyResult> {
    const nc = NextChangeSchema.parse(rawNextChange);
    const next = structuredClone(candidate) as Record<string, unknown>;

    switch (nc.target) {
      case "agent.system_prompt": {
        const patchStr = typeof nc.patch === "string" ? nc.patch : JSON.stringify(nc.patch);
        return { candidate: applyAgentConfigPatch(next, patchStr) };
      }
      case "agent.skills": {
        return { candidate: applyAgentSkillsPatch(next, nc.patch) };
      }
      case "kn.object_type":
      case "kn.relation_type": {
        if (!this.knClient) throw new Error("KnApiClient not provided for kn.* patch");
        await new KnPatcher(this.knClient, this.workDir).apply(nc.patch);
        const existingKn = (next["kn"] as Record<string, unknown> | undefined)
          ?? { id: nc.patch.kn_id, object_types: [], relation_types: [] };
        next["kn"] = {
          ...existingKn,
          object_types: [...((existingKn["object_types"] as unknown[]) ?? []), ...nc.patch.add_object_types],
          relation_types: [...((existingKn["relation_types"] as unknown[]) ?? []), ...nc.patch.add_relation_types],
        };
        return { candidate: next };
      }
      case "skill.content": {
        if (!this.skillClient) throw new Error("SkillApiClient not provided for skill.content patch");
        const { newVersion } = await new SkillContentPatcher(this.skillClient).apply(nc.patch);
        const agent = (next["agent"] as Record<string, unknown> | undefined) ?? {};
        const skills = (agent["skills"] as SkillBinding[] | undefined) ?? [];
        agent["skills"] = skills.map(s => s.id === nc.patch.skill_id ? { ...s, version: newVersion } : s);
        next["agent"] = agent;
        return { candidate: next, skillVersion: newVersion };
      }
    }
    throw new Error(`Unhandled patch target: ${String((nc as NextChange).target)}`);
  }
}

function applyAgentSkillsPatch(candidate: Record<string, unknown>, patch: AgentSkillsPatch): Record<string, unknown> {
  const agent = (candidate["agent"] as Record<string, unknown> | undefined) ?? {};
  const skills = ((agent["skills"] as SkillBinding[] | undefined) ?? []).slice();
  const unbindSet = new Set(patch.unbind);
  let updated = skills.filter(s => !unbindSet.has(s.id));
  for (const bind of patch.bind) {
    const idx = updated.findIndex(s => s.id === bind.id);
    if (idx >= 0) updated[idx] = bind;
    else updated.push(bind);
  }
  agent["skills"] = updated;
  candidate["agent"] = agent;
  return candidate;
}
