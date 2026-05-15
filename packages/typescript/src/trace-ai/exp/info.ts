// src/trace-ai/exp/info.ts
import path from "node:path";
import fs from "node:fs/promises";
import yaml from "js-yaml";
import { ExpStore } from "./exp-store/index.js";
import { defaultRegistry } from "../../agent-providers/registry.js";
import type { ThreeAxisScores } from "./schemas.js";

export interface HealthChecks {
  mission_valid: boolean;
  eval_set_valid: boolean;
  candidate_readable: boolean;
  provider_available: boolean;
  no_step_failed: boolean;
}

export interface ExpSnapshot {
  workspace: string;
  state: string;
  round: number;
  scores: ThreeAxisScores | null;
  triage_summary: string | null;
  suggested_next: { target: string; hypothesis: string } | null;
  lineage_versions: number;
  health: HealthChecks;
}

export async function getHealthChecks(expDir: string): Promise<HealthChecks> {
  const store = new ExpStore(expDir);
  let mission_valid = false;
  let eval_set_valid = false;
  let candidate_readable = false;

  try {
    const mission = await store.readMission();
    mission_valid = true;
    let allEvalSetsOk = true;
    for (const es of mission.eval_sets) {
      try { await fs.access(path.join(expDir, es.path)); }
      catch { allEvalSetsOk = false; }
    }
    eval_set_valid = allEvalSetsOk;
    try {
      await fs.access(path.join(expDir, mission.current_candidate.path));
      candidate_readable = true;
    } catch {
      candidate_readable = false;
    }
  } catch { /* mission_valid stays false */ }

  let provider_available = false;
  try { provider_available = defaultRegistry.resolve({ preferred: "claude-code" }) !== null; }
  catch { provider_available = false; }

  const replayed = await store.replayState();
  const no_step_failed = replayed.lastFailure === null;

  return { mission_valid, eval_set_valid, candidate_readable, provider_available, no_step_failed };
}

export async function buildExpSnapshot(expDir: string): Promise<ExpSnapshot> {
  // Throw early if the experiment directory doesn't exist, so callers (e.g.
  // runList) can catch and render a "(missing)" row instead of returning a
  // phantom "Init" snapshot for a non-existent path.
  await fs.access(expDir);
  const store = new ExpStore(expDir);
  const replayed = await store.replayState();
  const rounds = await store.readAllRounds();
  const lineage = await store.readLineage();
  const mission = await store.readMission().catch(() => null);
  const health = await getHealthChecks(expDir);

  const lastRound = rounds.length > 0 ? rounds[rounds.length - 1] : null;
  const scores = lastRound?.scores ?? null;
  const triage_summary = lastRound?.triage_conclusion?.diagnoses.join("; ") ?? null;
  const suggested_next = mission?.next_change
    ? { target: mission.next_change.target, hypothesis: mission.next_change.hypothesis }
    : null;

  return {
    workspace: expDir,
    state: replayed.currentState,
    round: replayed.currentRound,
    scores: scores ?? null,
    triage_summary,
    suggested_next,
    lineage_versions: lineage.length,
    health,
  };
}

export function formatSnapshotYaml(snap: ExpSnapshot): string {
  return yaml.dump(snap, { lineWidth: -1 });
}

export function formatSnapshotTableRow(
  entry: { path: string; last_active_ts: string },
  snap: ExpSnapshot | null
): string {
  if (snap === null) {
    return [entry.path.padEnd(50), "(missing)"].join("  ");
  }
  const outcome = snap.scores?.outcome.toFixed(2) ?? "-";
  const trajectory = snap.scores?.trajectory.toFixed(2) ?? "-";
  const lastActive = entry.last_active_ts.replace("T", " ").slice(0, 19);
  return [
    entry.path.padEnd(50),
    snap.state.padEnd(12),
    String(snap.round).padEnd(6),
    outcome.padEnd(8),
    trajectory.padEnd(10),
    lastActive,
  ].join("  ");
}

export async function runInfo(expDir: string, opts: { json?: boolean } = {}): Promise<void> {
  const snap = await buildExpSnapshot(expDir);
  if (opts.json) {
    process.stdout.write(JSON.stringify(snap, null, 2) + "\n");
  } else {
    process.stdout.write(formatSnapshotYaml(snap));
  }
}

export async function runList(
  registryEntries: Array<{ path: string; last_active_ts: string }>
): Promise<void> {
  const header = [
    "PATH".padEnd(50),
    "STATE".padEnd(12),
    "ROUND".padEnd(6),
    "OUTCOME".padEnd(8),
    "TRAJECTORY".padEnd(10),
    "LAST_ACTIVE",
  ].join("  ");
  process.stdout.write(header + "\n");
  process.stdout.write("-".repeat(header.length) + "\n");
  for (const entry of registryEntries) {
    let snap: ExpSnapshot | null = null;
    try { snap = await buildExpSnapshot(entry.path); } catch { /* missing path */ }
    process.stdout.write(formatSnapshotTableRow(entry, snap) + "\n");
  }
}
