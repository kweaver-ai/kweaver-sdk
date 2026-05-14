// src/trace-ai/exp/exp-store/readme-template.ts
export function renderReadme(opts: { experimentId: string; timestamp: string; goal: string }): string {
  return `# Experiment: ${opts.experimentId}

Created: ${opts.timestamp}
Goal: ${opts.goal}

## 目录说明
- mission.md        — 实验意图（你来编辑）
- eval-sets/        — 评测集（来自 MVP-B 或手动预置）
- candidates/       — Agent 候选快照
- outputs/          — 最终产物（bundle / manifest / provenance）
- .trace-state/     — 运行态，勿手动编辑

## 常用命令
\`\`\`
kweaver trace exp run .           — 启动 / 新开一轮
kweaver trace exp resume .        — 从 Deciding 状态继续
kweaver trace exp show .          — 查看当前状态和建议
kweaver trace exp status .        — 一行摘要（适合脚本）
kweaver trace exp abort .         — 优雅中止
kweaver trace exp doctor .        — 环境自检
\`\`\`
`;
}
