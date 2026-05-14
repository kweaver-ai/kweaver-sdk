// src/trace-ai/exp/patch/skill.ts
interface SkillEntry { name: string; [k: string]: unknown }
interface SkillPatchSpec { add?: SkillEntry[]; remove?: string[]; swap?: { from: string; to: SkillEntry } }

export function applySkillPatch(candidate: Record<string, unknown>, patchJson: string): Record<string, unknown> {
  const patch = JSON.parse(patchJson) as { skills: SkillPatchSpec };
  if (!patch.skills) throw new Error("skill.* patch must have a 'skills' key");
  const result = structuredClone(candidate) as Record<string, unknown>;
  let skills: SkillEntry[] = (result["skills"] as SkillEntry[]) ?? [];

  if (patch.skills.remove) {
    const toRemove = new Set(patch.skills.remove);
    skills = skills.filter(s => !toRemove.has(s.name));
  }
  if (patch.skills.add) {
    skills = [...skills, ...patch.skills.add];
  }
  if (patch.skills.swap) {
    const { from, to } = patch.skills.swap;
    skills = skills.map(s => s.name === from ? to : s);
  }
  result["skills"] = skills;
  return result;
}
