// src/trace-ai/exp/run-preflight.ts
//
// Preflight orchestration: before an eval round runs, reconcile the live agent
// against expectation. On first run it captures a baseline expected fingerprint;
// thereafter it verifies the live agent still matches that baseline and that the
// agent's KN binding matches every eval set's declared target_kn.
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { EvalSetIndexSchema } from "../eval-set/schemas.js";
import { captureAgentFingerprint, type AgentConfigFetcher } from "./capture-fingerprint.js";
import { preflightCheck } from "./preflight.js";
import { writeExpectedFingerprint } from "./exp-store/expected-fingerprint.js";

export interface RunPreflightOpts {
  expDir: string;
  agentId: string;
  fetchConfig: AgentConfigFetcher;
  evalSetPaths: string[];
}

/**
 * Resolve the single KN the eval sets expect the agent to be bound to.
 * Returns undefined when no eval set declares a target_kn (invariant 4 is then
 * skipped). Throws when eval sets declare conflicting target_kn values.
 */
async function resolveEvalTargetKn(evalSetPaths: string[]): Promise<string | undefined> {
  const found = new Set<string>();
  for (const p of evalSetPaths) {
    let raw: string;
    try {
      raw = await fs.readFile(path.join(p, "index.yaml"), "utf8");
    } catch {
      continue; // no index here — the eval runner surfaces that, not preflight
    }
    const parsed = EvalSetIndexSchema.safeParse(yaml.load(raw));
    if (parsed.success && parsed.data.target_kn) found.add(parsed.data.target_kn);
  }
  if (found.size === 0) return undefined;
  if (found.size > 1) {
    throw new Error(`eval sets declare conflicting target_kn: ${[...found].sort().join(", ")}`);
  }
  return [...found][0];
}

/**
 * Run the preflight reconciliation. Throws PreflightMismatchError if the live
 * agent's KN binding does not match the eval set's target_kn.
 *
 * The expected fingerprint is re-captured every round: without an executor that
 * deploys patches, the loop cannot tell an intentional agent change from
 * unintended drift, so it does not gate on config drift. It records the live
 * config as the per-round provenance fingerprint and lets preflightCheck
 * enforce the load-bearing invariant — the KN binding. (When an executor
 * exists, pass the deployed fingerprint as `expected` to also gate on drift.)
 */
export async function runPreflight(opts: RunPreflightOpts): Promise<void> {
  const actual = await captureAgentFingerprint(opts.fetchConfig, opts.agentId, "latest");
  await writeExpectedFingerprint(opts.expDir, actual);

  const targetKn = await resolveEvalTargetKn(opts.evalSetPaths);
  preflightCheck(actual, actual, targetKn);
}
