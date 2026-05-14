// src/trace-ai/exp/providers/synthesizer-client.ts
import { z } from "zod";
import yaml from "js-yaml";
import { defaultRegistry } from "../../../agent-providers/registry.js";
import type { Mission, NextChange, RoundData } from "../schemas.js";

export interface SynthesizerInput {
  mission: Mission;
  candidateConfig: Record<string, unknown>;
  prevRound?: RoundData;
  prevRounds: RoundData[];
  crossRoundMemoryRef?: string;
}

const SynthesizerOutputSchema = z.object({
  target: z.string(),
  hypothesis: z.string(),
  patch: z.string(),
});

export interface SynthesizerClient {
  generate(input: SynthesizerInput): Promise<NextChange>;
}

export class ClaudeCodeSynthesizer implements SynthesizerClient {
  async generate(input: SynthesizerInput): Promise<NextChange> {
    const provider = defaultRegistry.resolve({ preferred: "claude-code" });
    if (!provider) throw new Error("claude-code provider not available");

    const prevSummary = input.prevRounds.map(r =>
      `Round ${r.round}: outcome=${r.scores?.outcome.toFixed(2)}, hints=${r.triage_conclusion?.hints.join("; ") ?? "none"}`
    ).join("\n");

    const prompt = `You are an agent optimization assistant. Given an experiment goal and round results, suggest the next change to try.

GOAL: ${input.mission.goal}

CURRENT CANDIDATE CONFIG:
${yaml.dump(input.candidateConfig, { lineWidth: 80 })}

PREVIOUS ROUNDS:
${prevSummary || "None (first round)"}

${input.prevRound?.triage_conclusion ? `TRIAGE HINTS FROM LAST ROUND:\n${input.prevRound.triage_conclusion.hints.join("\n")}` : ""}

${input.crossRoundMemoryRef ? `CROSS-ROUND CONTEXT: ${input.crossRoundMemoryRef}` : ""}

Respond with a JSON object with exactly these fields:
- "target": one of "agent.system_prompt", "agent.temperature", "agent.model", "skill.add", "skill.remove", "skill.swap"
- "hypothesis": brief explanation of why this change might help
- "patch": a JSON Merge Patch string to apply to the candidate config

Example for changing system_prompt:
{"target": "agent.system_prompt", "hypothesis": "Add explicit stop condition", "patch": "{\"agent\":{\"system_prompt\":\"New prompt here\"}}"}`;

    const response = await provider.invoke({
      prompt,
      outputSchema: SynthesizerOutputSchema,
      correlationId: `synthesizer-${Date.now()}`,
    });
    return response.output;
  }
}
