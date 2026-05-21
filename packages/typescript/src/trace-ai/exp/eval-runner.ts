// src/trace-ai/exp/eval-runner.ts
import path from "node:path";
import yaml from "js-yaml";
import fs from "node:fs/promises";
import type { QueryResult } from "./schemas.js";
import type { RunnerDeps } from "../eval-set/test-runner.js";
import { run as evalSetRun } from "../eval-set/test-runner.js";

export interface EvalRunnerOpts {
  evalSetPaths: string[];       // paths to eval-set dirs
  candidatePath: string;        // path to candidate YAML
  expDir: string;
  round: number;                // used to isolate eval output per round
  deps: RunnerDeps;
  maxParallel?: number;
}

export interface EvalRunResult {
  queryResults: QueryResult[];
}

export async function runEval(opts: EvalRunnerOpts): Promise<EvalRunResult> {
  const candidateRaw = yaml.load(await fs.readFile(opts.candidatePath, "utf8")) as Record<string, unknown>;
  const agentId = (candidateRaw["agent_id"] as string | undefined) ?? "candidate";
  // candidate_version ("v1", "v2", …) is the experiment's own round numbering,
  // NOT a platform agent version. The eval always measures the current live
  // agent, which fetchAgent resolves at "latest" — never conflate the two.

  const roundEvalBase = path.join(opts.expDir, ".trace-state", "rounds", `round-${opts.round}-eval`);

  // Run eval for each eval-set (sequentially for MVP-C single-path)
  const allResults: QueryResult[] = [];
  for (const evalSetDir of opts.evalSetPaths) {
    // Each eval-set gets its own subdir so outputs from multiple sets don't overwrite each other
    const outDir = path.join(roundEvalBase, path.basename(evalSetDir));
    await fs.mkdir(outDir, { recursive: true });

    await evalSetRun({
      evalSetDir,
      candidateAgentId: agentId,
      outDir,
      maxParallel: opts.maxParallel ?? 4,
      deps: opts.deps,
    });

    // Read report and convert to QueryResult[]
    const reportPath = path.join(outDir, "report.yaml");
    const report = yaml.load(await fs.readFile(reportPath, "utf8")) as {
      cases: Array<{
        query_id: string;
        assertion_results: Array<{ assertion: { type: string }; verdict: string; actual?: unknown }>;
        duration_ms?: number;
        trace_id?: string | null;
        conversation_id?: string;
      }>;
    };

    for (const c of report.cases) {
      allResults.push({
        query_id: c.query_id,
        assertion_results: (c.assertion_results as Array<{
          assertion: { type: string };
          verdict: string;
          actual?: unknown;
        }>).map(ar => ({
          type: ar.assertion.type,
          verdict: ar.verdict as "pass" | "fail" | "skip",
          reason: typeof ar.actual === "string" ? ar.actual : undefined,
        })),
        trajectory_summary: {
          tool_call_sequence: [],  // populated from trace if available
          retry_count: 0,
          latency_ms: c.duration_ms ?? 0,
          error_codes: [],
        },
        raw_trace_id: c.trace_id ?? undefined,
        conversation_id: c.conversation_id ?? undefined,
      });
    }
  }

  return { queryResults: allResults };
}
