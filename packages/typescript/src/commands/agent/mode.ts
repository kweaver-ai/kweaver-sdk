export const AGENT_MODES = ["default", "dolphin", "react"] as const;

export type AgentMode = typeof AGENT_MODES[number];

const AGENT_MODE_SET = new Set<string>(AGENT_MODES);

export const AGENT_MODE_HELP = `  --mode <mode>          Agent mode: default, dolphin, react (default: default)

Agent mode config:
  config.mode accepts "default", "dolphin", or "react".
  If --mode is provided, it overrides config.mode.
  If neither --mode nor config.mode is provided, the CLI sends config.mode="default".

ReAct config:
  react_config is only valid when mode is "react".
  Provide it through --config or --config-path, for example:
    {
      "mode": "react",
      "react_config": {
        "disable_history_in_a_conversation": false,
        "disable_llm_cache": false
      }
    }`;

function formatModeValue(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function looksLikeAgentConfig(value: Record<string, unknown>): boolean {
  return [
    "mode",
    "input",
    "output",
    "llms",
    "react_config",
    "system_prompt",
    "data_source",
    "skills",
    "memory",
    "conversation_history_config",
  ].some((field) => field in value);
}

export function parseAgentMode(value: string, flagName = "--mode"): AgentMode {
  const mode = value.trim();
  if (!AGENT_MODE_SET.has(mode)) {
    throw new Error(`${flagName} must be one of: ${AGENT_MODES.join(", ")}`);
  }
  return mode as AgentMode;
}

export function normalizeAgentConfigInput(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error("Agent config file must contain a JSON object.");
  }

  const nestedConfig = value.config;
  if (isRecord(nestedConfig) && !looksLikeAgentConfig(value)) {
    return nestedConfig;
  }

  return value;
}

export function applyAgentModeToConfig(config: Record<string, unknown>, explicitMode?: AgentMode): void {
  if (explicitMode) {
    config.mode = explicitMode;
    return;
  }

  const currentMode = config.mode;
  if (currentMode === undefined || currentMode === null || currentMode === "") {
    config.mode = "default";
    return;
  }

  if (typeof currentMode !== "string") {
    throw new Error(`config.mode must be one of: ${AGENT_MODES.join(", ")}; got ${formatModeValue(currentMode)}`);
  }

  const mode = currentMode.trim();
  if (!AGENT_MODE_SET.has(mode)) {
    throw new Error(`config.mode must be one of: ${AGENT_MODES.join(", ")}; got ${formatModeValue(currentMode)}`);
  }

  config.mode = mode;
}
