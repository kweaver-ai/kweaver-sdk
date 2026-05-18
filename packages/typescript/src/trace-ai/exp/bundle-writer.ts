// src/trace-ai/exp/bundle-writer.ts
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import yaml from "js-yaml";
import type { LineageEntry, RoundData } from "./schemas.js";

interface WriteBundlesOpts {
  expDir: string;
  experimentId: string;
  lineage: LineageEntry[];
  rounds: RoundData[];
  createdBy: string;
}

export async function writeBundles(opts: WriteBundlesOpts): Promise<void> {
  const { expDir, experimentId, lineage, rounds, createdBy } = opts;
  const bestEntry = lineage.filter(e => e.status === "scored").at(-1) ?? lineage.at(-1);
  const bestVersion = bestEntry?.version ?? 0;
  const bundleId = `bundle_${crypto.randomBytes(4).toString("hex")}`;
  const now = new Date().toISOString();

  const bundle = {
    schema_version: "trace-bundle/v1",
    experiment_id: experimentId,
    bundle_id: bundleId,
    best_trial_version: bestVersion,
    resources: {
      agent_config: bestEntry?.next_change ?? {},
      skills: [],
    },
    provenance: {
      created_by: createdBy,
      created_at: now,
      evidence_traces: rounds.flatMap(r => (r.per_query_results ?? []).map(q => q.raw_trace_id ?? "").filter(Boolean)),
      round_refs: rounds.map(r => `.trace-state/rounds/round-${r.round}.yaml`),
    },
  };

  const lastRound = rounds.at(-1);
  const manifest = {
    schema_version: "trace-manifest/v1",
    experiment_id: experimentId,
    trial_version: bestVersion,
    predictions: {
      fixes: (lastRound?.per_query_results ?? [])
        .filter(q => q.assertion_results.every(a => a.verdict === "pass"))
        .map(q => ({ query_id: q.query_id, reason: "all assertions passed" })),
      risks: (lastRound?.per_query_results ?? [])
        .filter(q => q.assertion_results.some(a => a.verdict === "fail"))
        .map(q => ({ query_id: q.query_id, reason: "assertions failed" })),
    },
  };

  const provenance = {
    experiment_id: experimentId,
    generated_at: now,
    rounds_count: rounds.length,
    lineage_count: lineage.length,
    round_verdicts: rounds.map(r => ({ round: r.round, verdict: r.triage_conclusion?.verdict ?? "pending" })),
  };

  const outDir = path.join(expDir, "outputs");
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, "bundle.yaml"), yaml.dump(bundle, { lineWidth: -1 }));
  await fs.writeFile(path.join(outDir, "manifest.yaml"), yaml.dump(manifest, { lineWidth: -1 }));
  await fs.writeFile(path.join(outDir, "provenance.yaml"), yaml.dump(provenance, { lineWidth: -1 }));
}
