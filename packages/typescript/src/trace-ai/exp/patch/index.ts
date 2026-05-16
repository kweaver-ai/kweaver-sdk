// src/trace-ai/exp/patch/index.ts
import type { NextChange } from "../schemas.js";
import { applyAgentConfigPatch } from "./agent-config.js";
import { applySkillPatch } from "./skill.js";
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { NextChangeSchema, type KnPatch } from "../schemas.js";
import { KnPatcher } from "./kn.js";
import { SkillContentPatcher } from "./skill-content.js";
import type { KnApiClient } from "./kn-api-client.js";
import type { SkillApiClient } from "./skill-api-client.js";

export function applyPatch(candidate: Record<string, unknown>, change: NextChange): Record<string, unknown> {
  const prefix = change.target.split(".")[0];
  switch (prefix) {
    case "agent":
      return applyAgentConfigPatch(candidate, change.patch as string);
    case "skill":
      return applySkillPatch(candidate, change.patch as string);
    default:
      throw new Error(`Unsupported target prefix "${prefix}" — only agent.* and skill.* are supported in MVP-C`);
  }
}

export class PatchApplier {
  constructor(
    private workDir: string,
    private knClient?: KnApiClient,
    private skillClient?: SkillApiClient,
  ) {}

  async apply(rawNextChange: unknown): Promise<{ skillVersion?: string }> {
    const nextChange = NextChangeSchema.parse(rawNextChange);
    return this.dispatch(nextChange);
  }

  private async dispatch(nc: NextChange): Promise<{ skillVersion?: string }> {
    if (nc.target === "agent.system_prompt" || nc.target === "agent.skills") {
      return {};
    }

    if (nc.target === "kn.object_type" || nc.target === "kn.relation_type") {
      if (!this.knClient) throw new Error("KnApiClient not provided for kn.* patch");
      await new KnPatcher(this.knClient, this.workDir).apply(nc.patch);
      await this.accumulateCandidateKn(nc.patch);
      return {};
    }

    if (nc.target === "skill.content") {
      if (!this.skillClient) throw new Error("SkillApiClient not provided for skill.content patch");
      const { newVersion } = await new SkillContentPatcher(this.skillClient).apply(nc.patch);
      await this.updateCandidateSkillVersion(nc.patch.skill_id, newVersion);
      return { skillVersion: newVersion };
    }

    throw new Error(`Unhandled patch target: ${String((nc as NextChange).target)}`);
  }

  private async accumulateCandidateKn(patch: KnPatch): Promise<void> {
    const candidatePath = path.join(this.workDir, "candidate.yaml");
    let candidate: Record<string, unknown> = {};
    try {
      candidate = (yaml.load(await fs.readFile(candidatePath, "utf-8")) as Record<string, unknown>) ?? {};
    } catch {}
    const existingKn = (candidate["kn"] as Record<string, unknown> | undefined) ?? { id: patch.kn_id, object_types: [], relation_types: [] };
    candidate["kn"] = {
      ...existingKn,
      object_types: [...((existingKn["object_types"] as unknown[]) ?? []), ...patch.add_object_types],
      relation_types: [...((existingKn["relation_types"] as unknown[]) ?? []), ...patch.add_relation_types],
    };
    await fs.writeFile(candidatePath, yaml.dump(candidate), "utf-8");
  }

  private async updateCandidateSkillVersion(skillId: string, newVersion: string): Promise<void> {
    const candidatePath = path.join(this.workDir, "candidate.yaml");
    let candidate: Record<string, unknown> = {};
    try {
      candidate = (yaml.load(await fs.readFile(candidatePath, "utf-8")) as Record<string, unknown>) ?? {};
    } catch {}
    const agent = (candidate["agent"] as Record<string, unknown> | undefined) ?? {};
    const skills = (agent["skills"] as Array<{ id: string; version: string }> | undefined) ?? [];
    agent["skills"] = skills.map((s) => s.id === skillId ? { ...s, version: newVersion } : s);
    candidate["agent"] = agent;
    await fs.writeFile(candidatePath, yaml.dump(candidate), "utf-8");
  }
}
