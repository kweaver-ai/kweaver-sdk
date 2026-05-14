// src/trace-ai/exp/coordinator.ts
import path from "node:path";
import fs from "node:fs/promises";
import yaml from "js-yaml";
import { ExpStore } from "./exp-store/index.js";
import { applyPatch } from "./patch/index.js";
import { computeScores } from "./scoring.js";
import { writeBundles } from "./bundle-writer.js";
import type { ExpFsmState, Mission, NextChange, QueryResult, RoundData } from "./schemas.js";

export interface SynthesizerClient {
  generate(input: {
    mission: Mission;
    candidateConfig: Record<string, unknown>;
    prevRound?: RoundData;
    prevRounds: RoundData[];
    crossRoundMemoryRef?: string;
  }): Promise<NextChange>;
}

export interface TriageClient {
  triage(input: {
    currentRound: RoundData;
    prevRounds: RoundData[];
    candidateConfig: Record<string, unknown>;
    crossRoundMemoryRef?: string;
  }): Promise<RoundData["triage_conclusion"] & { new_memory_token: string }>;
}

export interface CoordinatorOpts {
  expDir: string;
  synthesizer: SynthesizerClient;
  triage: TriageClient;
  runEval: (opts: { evalSetPaths: string[]; candidatePath: string; expDir: string }) => Promise<{ queryResults: QueryResult[] }>;
  experimentId?: string;
}

export class ExperimentCoordinator {
  private store: ExpStore;
  private heartbeatTimer?: ReturnType<typeof setInterval>;

  constructor(private opts: CoordinatorOpts) {
    this.store = new ExpStore(opts.expDir);
  }

  async run(): Promise<void> {
    const replayed = await this.store.replayState();

    if (replayed.isTerminal && !replayed.currentState.includes("Aborted")) {
      throw new Error(`Experiment is in terminal state ${replayed.currentState}. Use --new-run to start fresh.`);
    }

    await this.store.acquireLock();
    this.heartbeatTimer = setInterval(() => { void this.store.updateHeartbeat(); }, 10_000);

    try {
      const mission = await this.store.readMission();
      const expId = this.opts.experimentId ?? `exp_${Date.now()}`;

      if (replayed.currentRound === 0) {
        await this.store.initDir(mission);
      }

      await this.runLoop(mission, replayed.currentRound, expId);
    } finally {
      clearInterval(this.heartbeatTimer);
      await this.store.releaseLock();
    }
  }

  async resume(): Promise<void> {
    const replayed = await this.store.replayState();
    if (replayed.currentState !== "Deciding") {
      throw new Error(`Cannot resume: experiment is in state ${replayed.currentState}, not Deciding. Only Deciding state supports resume.`);
    }
    await this.store.acquireLock();
    this.heartbeatTimer = setInterval(() => { void this.store.updateHeartbeat(); }, 10_000);
    try {
      const mission = await this.store.readMission();
      const expId = `exp_${replayed.currentRound}`;
      await this.runLoop(mission, replayed.currentRound, expId);
    } finally {
      clearInterval(this.heartbeatTimer);
      await this.store.releaseLock();
    }
  }

  private async runLoop(mission: Mission, startRound: number, expId: string): Promise<void> {
    const round = startRound + 1;
    const maxRounds = mission.max_rounds ?? Infinity;

    if (await this.checkAbort(round)) return;

    // === Generating (Apply Phase) ===
    await this.store.appendEvent({ type: "state_transition", from: "Deciding", to: "Generating", round });
    const nextChange = mission.next_change;
    if (!nextChange) throw new Error("mission.md has no next_change — add one or let Synthesizer suggest");

    const prevRounds = await this.store.readAllRounds();

    // Load current candidate and apply patch
    const currentCandidatePath = path.join(this.opts.expDir, mission.current_candidate.path);
    const currentCandidate = yaml.load(await fs.readFile(currentCandidatePath, "utf8")) as Record<string, unknown>;
    const patched = applyPatch(currentCandidate, nextChange);
    patched["candidate_version"] = `v${round}`;

    const newCandidatePath = path.join(this.opts.expDir, "candidates", `candidate-v${round}.yaml`);
    await fs.writeFile(newCandidatePath, yaml.dump(patched, { lineWidth: -1 }));

    await this.store.appendLineage({
      version: round,
      candidate_path: `candidates/candidate-v${round}.yaml`,
      next_change: nextChange,
      status: "running",
    });

    if (await this.checkAbort(round)) return;

    // === Executing ===
    await this.store.appendEvent({ type: "state_transition", from: "Generating", to: "Executing", round });
    const evalSetPaths = mission.eval_sets.map(e => path.join(this.opts.expDir, e.path));
    let queryResults: QueryResult[];
    try {
      const result = await this.withRetry(
        () => this.opts.runEval({ evalSetPaths, candidatePath: newCandidatePath, expDir: this.opts.expDir }),
        "Executing"
      );
      queryResults = result.queryResults;
    } catch {
      return;  // step_failed already written by withRetry
    }

    if (await this.checkAbort(round)) return;

    // === Scoring ===
    await this.store.appendEvent({ type: "state_transition", from: "Executing", to: "Scoring", round });
    const guardrails = mission.guardrails ?? [];
    const scores = computeScores(queryResults, guardrails);

    if (scores.guardrail_hard_fail) {
      await this.store.updateLineage(round, { status: "guardrail_failed" });
      await this.store.writeRound(round, { round, trial_version: round, guardrail_failed: true, scores });
      await this.store.appendEvent({ type: "state_transition", from: "Scoring", to: "Deciding", round });
      process.stdout.write(`\nRound ${round}: Guardrail hard gate violated. Fix the candidate and run exp resume.\n`);
      return;
    }

    await this.store.updateLineage(round, { status: "scored" });
    await this.store.writeRound(round, { round, trial_version: round, scores, per_query_results: queryResults });

    if (await this.checkAbort(round)) return;

    // === Triaging ===
    await this.store.appendEvent({ type: "state_transition", from: "Scoring", to: "Triaging", round });
    const currentRoundData = (await this.store.readAllRounds()).find(r => r.round === round) ?? { round, trial_version: round };
    const prevMemory = prevRounds.at(-1)?.triage_conclusion?.cross_round_memory_ref;

    let triageResult: RoundData["triage_conclusion"] & { new_memory_token: string };
    try {
      triageResult = await this.withRetry(
        () => this.opts.triage.triage({
          currentRound: currentRoundData,
          prevRounds,
          candidateConfig: patched,
          crossRoundMemoryRef: prevMemory,
        }),
        "Triaging"
      );
    } catch {
      return;
    }

    await this.store.writeRound(round, {
      triage_conclusion: {
        diagnoses: triageResult.diagnoses,
        hints: triageResult.hints,
        verdict: triageResult.verdict,
        cross_round_memory_ref: triageResult.new_memory_token,
      },
    });
    await this.store.appendEvent({ type: "round_completed", round, verdict: triageResult.verdict });

    // Generate next suggestion if continuing
    if (triageResult.verdict === "continue" && round < maxRounds) {
      const updatedMission = await this.store.readMission();
      try {
        const suggestion = await this.withRetry(
          () => this.opts.synthesizer.generate({
            mission: updatedMission,
            candidateConfig: patched,
            prevRound: currentRoundData,
            prevRounds,
            crossRoundMemoryRef: triageResult.new_memory_token,
          }),
          "Triaging"
        );
        await this.store.writeSuggestedChange(suggestion);
      } catch {
        return;
      }
    }

    // === Deciding ===
    await this.store.appendEvent({ type: "state_transition", from: "Triaging", to: "Deciding", round });

    if (triageResult.verdict === "publish" || round >= maxRounds) {
      // Publish immediately
      await this.store.appendEvent({ type: "state_transition", from: "Deciding", to: "Publishing", round });
      const allRounds = await this.store.readAllRounds();
      const allLineage = await this.store.readLineage();
      await writeBundles({ expDir: this.opts.expDir, experimentId: expId, lineage: allLineage, rounds: allRounds, createdBy: process.env["USER"] ?? "unknown" });
      await this.store.appendEvent({ type: "state_transition", from: "Publishing", to: "Published", round });
      process.stdout.write(`\nExperiment complete. Outputs written to ${path.join(this.opts.expDir, "outputs")}\n`);
    } else {
      // Pause at Deciding — lock released by run()/resume() finally block
      process.stdout.write(`\nRound ${round} complete.\n`);
      process.stdout.write(`Scores: outcome=${scores.outcome.toFixed(2)}, trajectory=${scores.trajectory.toFixed(2)}\n`);
      process.stdout.write(`Triage: ${triageResult.diagnoses.join("; ")}\n`);
      process.stdout.write(`Next suggestion written to mission.md. Review and run exp resume to continue.\n`);
    }
  }

  private async checkAbort(round: number): Promise<boolean> {
    if (await this.store.isAborted()) {
      clearInterval(this.heartbeatTimer);
      await this.store.appendEvent({ type: "aborted", round, reason: "user_abort" });
      await this.store.releaseLock();
      return true;
    }
    return false;
  }

  private async withRetry<T>(fn: () => Promise<T>, state: string): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        if (attempt < 2) {
          await new Promise(r => setTimeout(r, 1000 * 2 ** attempt));
        }
      }
    }
    await this.store.appendEvent({
      type: "step_failed",
      state: state as ExpFsmState,
      error: String(lastErr),
      retryable: true,
    });
    throw lastErr;
  }
}
