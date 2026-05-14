/**
 * Builtin `semantic_match` judge for the eval-set test runner (M5 D5).
 *
 * Wraps an `AgentProvider` + the `builtin:answer-match-reference` prompt
 * template + a small zod output schema into the `SemanticMatchProvider`
 * surface the assertion-evaluator already speaks. The runner stays
 * provider-agnostic; only this file knows how to render the rubric
 * prompt and validate the LLM's reply.
 *
 * Output schema is intentionally local to this rubric (spec §4.1) —
 * not in `schemas.ts`, which only carries the eval-set / report shapes.
 */

import { z } from "zod";

import type { AgentProvider } from "../../agent-providers/types.js";
import {
  type PromptTemplateRegistry,
  render as renderPrompt,
  languageInstructionFor,
  type AgentOutputLang,
} from "../../agent-providers/prompt-template.js";
import type {
  SemanticMatchProvider,
  SemanticMatchVerdict,
} from "./assertion-evaluator.js";

export const ANSWER_MATCH_REFERENCE_REF = "builtin:answer-match-reference";

export const AnswerMatchOutputSchema = z.object({
  verdict: z.enum(["pass", "fail"]),
  reasoning: z.string(),
});

// JSON shape the LLM is told to emit; rendered into the prompt's
// `{{output_schema}}` placeholder. Kept declarative so we don't try to
// reflect a Zod schema into JSON at runtime.
const OUTPUT_SCHEMA_DOC = {
  type: "object",
  required: ["verdict", "reasoning"],
  properties: {
    verdict: { type: "string", enum: ["pass", "fail"] },
    reasoning: { type: "string" },
  },
};

export interface CreateSemanticMatchProviderOpts {
  provider: AgentProvider;
  promptRegistry: PromptTemplateRegistry;
  /** Output locale for the rubric's reasoning text. Default 'en'. */
  lang?: AgentOutputLang;
  /** Per-invoke timeout override. */
  timeoutMs?: number;
}

export function createBuiltinSemanticMatchProvider(
  opts: CreateSemanticMatchProviderOpts,
): SemanticMatchProvider {
  const { provider, promptRegistry, lang = "en", timeoutMs } = opts;
  return {
    async judgeSemanticMatch(
      question,
      candidateAnswer,
      referenceAnswer,
    ): Promise<SemanticMatchVerdict> {
      const tpl = promptRegistry.get(ANSWER_MATCH_REFERENCE_REF);
      const prompt = renderPrompt(tpl, {
        question,
        candidate_answer: candidateAnswer,
        reference_answer: referenceAnswer,
        language_instruction: languageInstructionFor(lang),
        output_schema: OUTPUT_SCHEMA_DOC,
      });
      const resp = await provider.invoke({
        prompt,
        outputSchema: AnswerMatchOutputSchema,
        timeoutMs,
      });
      return { verdict: resp.output.verdict, reasoning: resp.output.reasoning };
    },
  };
}
