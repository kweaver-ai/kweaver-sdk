// src/trace-ai/exp/patch/agent-config.ts
export function applyAgentConfigPatch(candidate: Record<string, unknown>, patchJson: string): Record<string, unknown> {
  const patch = JSON.parse(patchJson) as Record<string, unknown>;
  if (!patch.agent) throw new Error("agent.* patch must have an 'agent' key");
  // Only the agent sub-tree is patched; extra top-level keys in patchJson are intentionally ignored.
  // Callers should scope patch JSON to { agent: { ... } } only.
  const result = structuredClone(candidate) as Record<string, unknown>;
  result["agent"] = mergePatch(result["agent"] as Record<string, unknown>, patch["agent"] as Record<string, unknown>);
  return result;
}

function mergePatch(target: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) {
      delete result[k];
    } else if (typeof v === "object" && !Array.isArray(v)) {
      result[k] = mergePatch((result[k] as Record<string, unknown>) ?? {}, v as Record<string, unknown>);
    } else {
      result[k] = v;
    }
  }
  return result;
}
