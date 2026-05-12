import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { StubAgentProvider } from "../../src/agent-providers/providers/stub.js";

export async function tmpOutDir(prefix: string): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const FIX = path.join(__dirname, "..", "fixtures/trace-diagnose");
/** Pre-built tool-loop fixture that includes gen_ai.agent.id (required for batch single-agent validation). */
export const BATCH_FIX = path.join(FIX, "synthetic/tool-loop-with-agent-id.json");

export function mockTraceFetcher(
  fixtureByConvId: Map<string, unknown>,
): { restore: () => void; calls: string[] } {
  const orig = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    const body =
      init?.body && typeof init.body === "string" ? JSON.parse(init.body) : {};
    const convId =
      body?.query?.term?.["attributes.gen_ai.conversation.id.keyword"] ?? "_";
    calls.push(url);
    const fix = fixtureByConvId.get(convId) ?? { hits: { hits: [] } };
    return new Response(JSON.stringify(fix), { status: 200 });
  };
  return {
    restore: () => {
      globalThis.fetch = orig;
    },
    calls,
  };
}

export function stubProviderForBatch(): StubAgentProvider {
  return new StubAgentProvider({
    name: "claude-code",
    capabilities: ["structured_output"],
    responseFn: async (prompt: string) => {
      if (/Cross-Trace Synthesizer/i.test(prompt)) {
        return {
          headline: "agent X dominated by tool_loop",
          primary_root_cause: {
            rule_ids: ["tool_loop_no_state_change"],
            description: "loop pattern",
            target_for_fix: "agent.prompt",
          },
          fix_priority: [
            {
              rule_id: "tool_loop_no_state_change",
              affected_trace_count: 3,
              reason: "dominant",
            },
          ],
          cross_rule_links: [],
        };
      }
      // Batched rubric: parse trace_id + spans from the YAML block in the prompt
      // js-yaml.dump produces "- trace_id: <id>\n  spans:\n  - spanId1\n  ..."
      // Match the trace_id and gather span ids from the subsequent list
      const traceBlocks = [...prompt.matchAll(/- trace_id:\s+(\S+)/g)];
      const spansForTrace = new Map<string, string[]>();
      // Parse spans from yaml block: after "spans:" collect "  - <id>" lines
      const spansMatches = [...prompt.matchAll(/trace_id:\s+(\S+)[\s\S]*?spans:\n((?:\s*- \S+\n)*)/g)];
      for (const m of spansMatches) {
        const traceId = m[1];
        const spansBlock = m[2];
        const spanIds = [...spansBlock.matchAll(/- (\S+)/g)].map((s) => s[1]);
        spansForTrace.set(traceId, spanIds);
      }
      // Fallback: just use the trace block list if spans parse failed
      const results = traceBlocks.map((m) => {
        const traceId = m[1];
        const spanIds = spansForTrace.get(traceId) ?? ["root", "t1", "t2", "t3"];
        return {
          trace_id: traceId,
          category: "stale_results",
          reasoning: `rubric verdict for ${traceId}`,
          severity: "high",
          first_violating_step_id: spanIds[0] ?? "root",
          evidence_span_ids: spanIds,
        };
      });
      return { trace_results: results };
    },
  });
}
