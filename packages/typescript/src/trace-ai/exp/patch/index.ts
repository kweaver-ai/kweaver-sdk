// src/trace-ai/exp/patch/index.ts
import type { NextChange } from "../schemas.js";
import { applyAgentConfigPatch } from "./agent-config.js";
import { applySkillPatch } from "./skill.js";

export function applyPatch(candidate: Record<string, unknown>, change: NextChange): Record<string, unknown> {
  const prefix = change.target.split(".")[0];
  switch (prefix) {
    case "agent":
      return applyAgentConfigPatch(candidate, change.patch);
    case "skill":
      return applySkillPatch(candidate, change.patch);
    default:
      throw new Error(`Unsupported target prefix "${prefix}" — only agent.* and skill.* are supported in MVP-C`);
  }
}
