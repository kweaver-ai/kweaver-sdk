// src/trace-ai/exp/preflight.ts
//
// Preflight reconciliation: before an eval round measures an agent, verify the
// agent under test actually matches what the experiment expects. The exp loop
// has no actuator/read-back of its own, so without this guard a whole round can
// silently measure the wrong agent, the wrong version, or an agent bound to the
// wrong KN. This turns those silent failures into a fail-fast at ~1s cost.

/** A single tool the agent has bound, identified by tool + toolbox. */
export interface ToolRef {
  tool_id: string;
  tool_box_id: string;
}

/**
 * The material subset of an agent's configuration — the fields that affect eval
 * outcomes. Both the loop-owned "expected" record and the per-round "actual"
 * read-back are normalized into this shape so they can be compared field-by-field.
 */
export interface AgentFingerprint {
  agent_id: string;
  version: string;
  system_prompt: string;
  model: string;
  temperature: number;
  /** Bound tools, sorted by tool_id. */
  tools: ToolRef[];
  /** KN ids the agent's tools query, deduped and sorted. */
  kn_ids: string[];
}

/** One field that failed reconciliation. */
export interface PreflightMismatch {
  field: string;
  expected: string;
  actual: string;
}

/** Thrown by preflightCheck when the agent under test does not match expectation. */
export class PreflightMismatchError extends Error {
  readonly mismatches: PreflightMismatch[];
  constructor(mismatches: PreflightMismatch[]) {
    const lines = mismatches.map(m => `  - ${m.field}: expected ${m.expected}, actual ${m.actual}`);
    super(`Preflight check failed — agent under test does not match expectation:\n${lines.join("\n")}`);
    this.name = "PreflightMismatchError";
    this.mismatches = mismatches;
  }
}

/**
 * Build an AgentFingerprint from a raw agent-factory config object (the JSON
 * returned by `agent get`). Format-specific extraction lives here so the rest of
 * the loop only ever deals with the normalized fingerprint.
 */
export function fingerprintFromAgentConfig(
  agentId: string,
  version: string,
  raw: Record<string, unknown>,
): AgentFingerprint {
  const system_prompt = typeof raw["system_prompt"] === "string" ? raw["system_prompt"] : "";

  const llms = Array.isArray(raw["llms"]) ? (raw["llms"] as Array<Record<string, unknown>>) : [];
  const defaultLlm = llms.find(l => l["is_default"] === true) ?? llms[0];
  const llmConfig = (defaultLlm?.["llm_config"] as Record<string, unknown> | undefined) ?? {};
  const model = typeof llmConfig["name"] === "string" ? llmConfig["name"] : "";
  const temperature = typeof llmConfig["temperature"] === "number" ? llmConfig["temperature"] : NaN;

  const skills = (raw["skills"] as Record<string, unknown> | undefined) ?? {};
  const rawTools = Array.isArray(skills["tools"]) ? (skills["tools"] as Array<Record<string, unknown>>) : [];
  const tools: ToolRef[] = rawTools
    .map(t => ({ tool_id: String(t["tool_id"] ?? ""), tool_box_id: String(t["tool_box_id"] ?? "") }))
    .sort((a, b) => a.tool_id.localeCompare(b.tool_id));

  const knSet = new Set<string>();
  for (const t of rawTools) {
    const inputs = Array.isArray(t["tool_input"]) ? (t["tool_input"] as Array<Record<string, unknown>>) : [];
    for (const inp of inputs) {
      if (inp["input_name"] === "kn_id" && typeof inp["map_value"] === "string" && inp["map_value"] !== "") {
        knSet.add(inp["map_value"]);
      }
    }
  }
  const kn_ids = [...knSet].sort();

  return { agent_id: agentId, version, system_prompt, model, temperature, tools, kn_ids };
}

/** Render a value for a diff message, truncating long strings so the message stays readable. */
function repr(value: string): string {
  if (value.length > 80) return `"${value.slice(0, 60)}…"(${value.length} chars)`;
  return JSON.stringify(value);
}

function toolsEqual(a: ToolRef[], b: ToolRef[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((t, i) => {
    const bt = b[i];
    return bt !== undefined && t.tool_id === bt.tool_id && t.tool_box_id === bt.tool_box_id;
  });
}

function reprTools(tools: ToolRef[]): string {
  return tools.length === 0 ? "(none)" : tools.map(t => t.tool_id).join(",");
}

/**
 * Reconcile the agent under test against expectation. Throws PreflightMismatchError
 * listing every failed invariant. Checks four invariants:
 *   1. identity         — agent_id matches
 *   2. version          — pinned version matches
 *   3. config           — system_prompt / model / temperature / tools match
 *   4. question↔patient — agent's KN binding is exactly the eval set's target_kn
 *
 * Invariant 4 is skipped when evalTargetKn is undefined (eval set has not yet
 * declared a target_kn) — it cannot check what is not declared.
 */
export function preflightCheck(
  expected: AgentFingerprint,
  actual: AgentFingerprint,
  evalTargetKn?: string,
): void {
  const mismatches: PreflightMismatch[] = [];

  if (expected.agent_id !== actual.agent_id) {
    mismatches.push({ field: "agent_id", expected: repr(expected.agent_id), actual: repr(actual.agent_id) });
  }
  if (expected.version !== actual.version) {
    mismatches.push({ field: "version", expected: repr(expected.version), actual: repr(actual.version) });
  }
  if (expected.system_prompt !== actual.system_prompt) {
    mismatches.push({ field: "system_prompt", expected: repr(expected.system_prompt), actual: repr(actual.system_prompt) });
  }
  if (expected.model !== actual.model) {
    mismatches.push({ field: "model", expected: repr(expected.model), actual: repr(actual.model) });
  }
  // NaN marks an absent temperature; two absent temperatures are equal.
  const tempEqual = expected.temperature === actual.temperature
    || (Number.isNaN(expected.temperature) && Number.isNaN(actual.temperature));
  if (!tempEqual) {
    mismatches.push({ field: "temperature", expected: String(expected.temperature), actual: String(actual.temperature) });
  }
  if (!toolsEqual(expected.tools, actual.tools)) {
    mismatches.push({ field: "tools", expected: reprTools(expected.tools), actual: reprTools(actual.tools) });
  }
  if (evalTargetKn !== undefined) {
    const actualKn = actual.kn_ids;
    if (actualKn.length !== 1 || actualKn[0] !== evalTargetKn) {
      mismatches.push({
        field: "kn_binding",
        expected: repr(evalTargetKn),
        actual: actualKn.length === 0 ? "(none)" : actualKn.map(repr).join(","),
      });
    }
  }

  if (mismatches.length > 0) throw new PreflightMismatchError(mismatches);
}
