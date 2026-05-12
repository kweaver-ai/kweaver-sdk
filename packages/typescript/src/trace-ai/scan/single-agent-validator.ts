export type SingleAgentValidationErrorCode = "empty" | "no-spans" | "mixed";

export class SingleAgentValidationError extends Error {
  constructor(
    public readonly code: SingleAgentValidationErrorCode,
    message: string,
    public readonly byConvId: ReadonlyMap<string, string | undefined> = new Map(),
  ) {
    super(message);
    this.name = "SingleAgentValidationError";
  }
}

export interface SingleAgentValidationResult {
  agentId: string;
  checkedConvIds: number;
}

export interface FetchSpansResult {
  spans: Array<{ attributes: Record<string, unknown> }>;
  conversation_id: string;
}

export type FetchSpansByConvId = (convId: string) => Promise<FetchSpansResult>;

function extractAgentId(spans: FetchSpansResult["spans"]): string | undefined {
  for (const s of spans) {
    const v = s.attributes["gen_ai.agent.id"];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}

/**
 * Verify every conv_id in the batch resolves to spans owned by the same
 * agent_id. Throws SingleAgentValidationError on mismatch with a discrepancy
 * map for the CLI to print.
 */
export async function validateSingleAgent(
  convIds: string[],
  fetchSpansById: FetchSpansByConvId,
): Promise<SingleAgentValidationResult> {
  if (convIds.length === 0) {
    throw new SingleAgentValidationError("empty", "no conversation_ids supplied");
  }
  const byConvId = new Map<string, string | undefined>();
  for (const convId of convIds) {
    const fetched = await fetchSpansById(convId);
    if (fetched.spans.length === 0) {
      throw new SingleAgentValidationError("no-spans", `conversation_id has no spans: ${convId}`);
    }
    byConvId.set(convId, extractAgentId(fetched.spans));
  }
  const agentIds = new Set(byConvId.values());
  if (agentIds.size > 1 || (agentIds.size === 1 && agentIds.has(undefined))) {
    const lines = [...byConvId.entries()].map(([c, a]) => `  ${c} → ${a ?? "(no agent.id)"}`).join("\n");
    throw new SingleAgentValidationError(
      "mixed",
      `--traces conversation_ids span multiple agents:\n${lines}`,
      byConvId,
    );
  }
  return { agentId: [...agentIds][0]!, checkedConvIds: convIds.length };
}
