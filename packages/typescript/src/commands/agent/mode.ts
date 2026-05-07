// 支持的 Agent 模式列表
export const AGENT_MODES = ["default", "dolphin", "react"] as const;

// Agent 模式的类型定义
export type AgentMode = typeof AGENT_MODES[number];

// 用于快速验证模式是否有效的 Set
const AGENT_MODE_SET = new Set<string>(AGENT_MODES);

// Agent 模式的帮助信息
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

// 格式化模式值，用于错误消息显示
function formatModeValue(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

// 解析并验证 Agent 模式
export function parseAgentMode(value: string, flagName = "--mode"): AgentMode {
  const mode = value.trim();
  if (!AGENT_MODE_SET.has(mode)) {
    throw new Error(`${flagName} must be one of: ${AGENT_MODES.join(", ")}`);
  }
  return mode as AgentMode;
}

// 将 Agent 模式应用到配置对象
export function applyAgentModeToConfig(config: Record<string, unknown>, explicitMode?: AgentMode): void {
  // 如果提供了显式模式，直接使用
  if (explicitMode) {
    config.mode = explicitMode;
    return;
  }

  // 检查当前配置中的模式
  const currentMode = config.mode;
  if (currentMode === undefined || currentMode === null || currentMode === "") {
    // 未设置模式时，使用默认值
    config.mode = "default";
    return;
  }

  // 验证模式值类型
  if (typeof currentMode !== "string") {
    throw new Error(`config.mode must be one of: ${AGENT_MODES.join(", ")}; got ${formatModeValue(currentMode)}`);
  }

  // 验证模式值有效性
  const mode = currentMode.trim();
  if (!AGENT_MODE_SET.has(mode)) {
    throw new Error(`config.mode must be one of: ${AGENT_MODES.join(", ")}; got ${formatModeValue(currentMode)}`);
  }

  // 设置有效的模式值
  config.mode = mode;
}
