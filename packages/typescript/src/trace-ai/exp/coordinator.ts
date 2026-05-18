// src/trace-ai/exp/coordinator.ts
import path from "node:path";
import fs from "node:fs/promises";
import yaml from "js-yaml";
import { ExpStore } from "./exp-store/index.js";
import { PatchApplier } from "./patch/index.js";
import type { KnApiClient } from "./patch/kn-api-client.js";
import type { SkillApiClient } from "./patch/skill-api-client.js";
import { computeScores } from "./scoring.js";
import { writeBundles } from "./bundle-writer.js";
import { ContextAssembler } from "./context/context-assembler.js";
import { analyzeFailures } from "./context/failure-analyzer.js";
import type { TriageClient, TriageResult } from "./providers/triage-client.js";
import type { ExpFsmState, KnContext, Mission, QueryResult, SkillBinding, SkillContext } from "./schemas.js";
import type { TraceSpan } from "../../api/conversations.js";

export type { TriageClient, TriageResult };

export interface CoordinatorOpts {
  expDir: string;
  triage: TriageClient;
  runEval: (opts: { evalSetPaths: string[]; candidatePath: string; expDir: string; round: number }) => Promise<{ queryResults: QueryResult[] }>;
  experimentId?: string;
  contextAssembler?: ContextAssembler;
  fetchTrace?: (conversationId: string) => Promise<{ spans: TraceSpan[] }>;
  knClient?: KnApiClient;
  skillClient?: SkillApiClient;
}

export class ExperimentCoordinator {
  private store: ExpStore;
  private heartbeatTimer?: ReturnType<typeof setInterval>;

  constructor(private opts: CoordinatorOpts) {
    this.store = new ExpStore(opts.expDir);
  }

  async run(): Promise<void> {
    const replayed = await this.store.replayState();

    if (replayed.isTerminal) {
      throw new Error(
        `Experiment is in terminal state ${replayed.currentState}. ` +
        `Use --new-run to start a fresh experiment in this directory.`
      );
    }

    const mission = await this.store.readMission();
    const expId = this.opts.experimentId ?? `exp_${Date.now()}`;

    if (replayed.currentRound === 0) {
      await this.store.initDir(mission);
    }

    await this.store.acquireLock();
    this.heartbeatTimer = setInterval(() => { void this.store.updateHeartbeat(); }, 10_000);
    const uninstallSignals = this.installSignalHandlers();

    // Layer 2 auto-recovery: prior holder died mid-round without writing step_failed
    // (typically SIGKILL/OOM/power — signal handlers can't help with these). FSM is
    // stuck in an executing-side phase with no lastFailure. Synthesize step_failed so
    // the startRound calc below rewinds to redo the round.
    const stuckMidRound = !replayed.lastFailure
      && replayed.currentRound > 0
      && replayed.currentState !== "Init"
      && replayed.currentState !== "Deciding"
      && !replayed.isTerminal;
    if (stuckMidRound) {
      await this.store.appendEvent({
        type: "step_failed",
        state: replayed.currentState,
        error: `auto-recovered: prior holder died mid-${replayed.currentState} at round ${replayed.currentRound}`,
        retryable: true,
      });
      process.stderr.write(
        `Recovered stale ${replayed.currentState} at round ${replayed.currentRound}; redoing round.\n`
      );
    }

    // If previous run failed mid-round (real failure OR auto-recovered above), retry that round.
    const startRound = (replayed.lastFailure || stuckMidRound) && replayed.currentRound > 0
      ? replayed.currentRound - 1
      : replayed.currentRound;

    try {
      await this.runLoop(mission, startRound, expId);
    } finally {
      uninstallSignals();
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
    const uninstallSignals = this.installSignalHandlers();
    try {
      const mission = await this.store.readMission();
      const expId = `exp_${replayed.currentRound}`;
      await this.runLoop(mission, replayed.currentRound, expId);
    } finally {
      uninstallSignals();
      clearInterval(this.heartbeatTimer);
      await this.store.releaseLock();
    }
  }

  /**
   * Install SIGINT/SIGHUP/SIGTERM handlers that flush a final event and release
   * the lock before exit. Returns an uninstaller that MUST be called in the
   * caller's finally block (otherwise normal exit would still fire the handler).
   *
   * Semantics:
   *   SIGINT  → user-intent abort       → emit `aborted` event (terminal)
   *   SIGHUP  → terminal closed         → emit `step_failed` retryable
   *   SIGTERM → external kill (ambig.)  → emit `step_failed` retryable
   *
   * SIGKILL / OOM / power loss can't be caught here — Layer 2 auto-recovery in
   * run() handles that case on the next start.
   */
  private installSignalHandlers(): () => void {
    let firing = false;
    const handler = (signal: NodeJS.Signals) => {
      if (firing) return;
      firing = true;
      // Process exits in the IIFE — Node won't await the handler itself, so we
      // must drive the async flow and then `process.exit` ourselves.
      void (async () => {
        try {
          const replayed = await this.store.replayState();
          if (signal === "SIGINT") {
            await this.store.appendEvent({
              type: "aborted",
              round: replayed.currentRound,
              reason: `interrupted by ${signal}`,
            });
          } else {
            // For non-terminal states only — if FSM was already Deciding/Init/terminal,
            // a step_failed would be a lie. Skip the event but still release the lock.
            const recoverable = !replayed.isTerminal
              && replayed.currentState !== "Init"
              && replayed.currentState !== "Deciding";
            if (recoverable) {
              await this.store.appendEvent({
                type: "step_failed",
                state: replayed.currentState,
                error: `process interrupted by ${signal}`,
                retryable: true,
              });
            }
          }
        } catch (err) {
          process.stderr.write(`signal handler: failed to append event: ${String(err)}\n`);
        }
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        try { await this.store.releaseLock(); } catch { /* best-effort */ }
        // Exit codes per shell convention (128 + signal number).
        const code = signal === "SIGINT" ? 130 : signal === "SIGHUP" ? 129 : 143;
        process.exit(code);
      })();
    };

    process.on("SIGINT", handler);
    process.on("SIGHUP", handler);
    process.on("SIGTERM", handler);

    return () => {
      process.off("SIGINT", handler);
      process.off("SIGHUP", handler);
      process.off("SIGTERM", handler);
    };
  }

  private async runLoop(mission: Mission, startRound: number, expId: string): Promise<void> {
    const round = startRound + 1;
    const maxRounds = mission.max_rounds ?? Infinity;

    if (await this.checkAbort(round)) return;

    // === Generating (Apply Phase) ===
    await this.store.appendEvent({ type: "state_transition", from: "Deciding", to: "Generating", round });
    const nextChange = mission.next_change;
    if (!nextChange) throw new Error("mission.md has no next_change — add one or let the planner suggest");

    if (!mission.enabled_targets.includes(nextChange.target)) {
      throw new Error(
        `next_change.target=${nextChange.target} is not in mission.enabled_targets=[${mission.enabled_targets.join(", ")}]. ` +
        `Either add the target to enabled_targets in mission.md, or change next_change to use an enabled target.`
      );
    }

    const prevRounds = await this.store.readAllRounds();

    // Load current candidate and apply patch via PatchApplier (handles agent.*/kn.*/skill.content).
    // PatchApplier may call external APIs (KN/skill) that throw on stubs or transient failures;
    // surface those as Generating-phase step_failed so the FSM stays observable and lineage
    // doesn't get stuck in "running". No auto-retry: patch side-effects (KN writes, skill version
    // publish) are not safe to blindly retry — user inspects step_failed and resumes manually.
    const currentCandidatePath = path.join(this.opts.expDir, mission.current_candidate.path);
    const currentCandidate = yaml.load(await fs.readFile(currentCandidatePath, "utf8")) as Record<string, unknown>;
    const patchApplier = new PatchApplier(this.opts.expDir, this.opts.knClient, this.opts.skillClient);
    let patched: Record<string, unknown>;
    try {
      const result = await patchApplier.apply(currentCandidate, nextChange);
      patched = result.candidate;
    } catch (err) {
      await this.store.appendEvent({
        type: "step_failed",
        state: "Generating",
        error: String(err),
        retryable: false,
      });
      process.stderr.write(`\nGenerating failed for target ${nextChange.target}: ${String(err)}\n`);
      return;
    }
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
        () => this.opts.runEval({ evalSetPaths, candidatePath: newCandidatePath, expDir: this.opts.expDir, round }),
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

    // === Triaging (merged: diagnose + propose in one LLM call) ===
    await this.store.appendEvent({ type: "state_transition", from: "Scoring", to: "Triaging", round });
    const currentRoundData = (await this.store.readAllRounds()).find(r => r.round === round) ?? { round, trial_version: round };
    const prevMemory = prevRounds.at(-1)?.triage_conclusion?.cross_round_memory_ref;

    const failureAnalysis = await analyzeFailures(
      currentRoundData.per_query_results ?? [],
      this.opts.fetchTrace,
    );

    // Pre-fetch all available context so the merged planner LLM can see KN schema
    // + bound skill content + data probes before deciding both verdict AND next_change.
    // We call assemble() twice (kn target + skill target) since each path fetches
    // distinct artifacts; total cost dominated by the LLM call that follows.
    const knId = (patched["kn"] as Record<string, unknown> | undefined)?.["id"] as string | undefined;
    const boundSkills = ((patched["agent"] as Record<string, unknown> | undefined)?.["skills"] as SkillBinding[] | undefined) ?? [];
    let kn_context: KnContext | undefined;
    let skill_context: SkillContext | undefined;
    if (this.opts.contextAssembler) {
      const assembler = this.opts.contextAssembler;
      const empty: { kn_context?: KnContext; skill_context?: SkillContext } = {};
      const [knRes, skillRes] = await Promise.all([
        knId
          ? assembler.assemble("kn.object_type", knId, boundSkills, failureAnalysis)
          : Promise.resolve(empty),
        boundSkills.length > 0
          ? assembler.assemble("skill.content", knId, boundSkills, failureAnalysis)
          : Promise.resolve(empty),
      ]);
      kn_context = knRes.kn_context;
      skill_context = skillRes.skill_context;
    }

    const updatedMission = await this.store.readMission();
    let triageResult: TriageResult;
    try {
      triageResult = await this.withRetry(
        () => this.opts.triage.triage({
          currentRound: currentRoundData,
          prevRounds,
          candidateConfig: patched,
          crossRoundMemoryRef: prevMemory,
          failureAnalysis,
          mission: updatedMission,
          kn_context,
          skill_context,
        }),
        "Triaging"
      );
    } catch {
      return;
    }

    // Persist triage_conclusion. Only "continue"/"publish" are valid in the typed schema;
    // "abort" is a runtime verdict mapped to "publish" for storage but routed to Aborted below.
    const storedVerdict: "continue" | "publish" = triageResult.verdict === "continue" ? "continue" : "publish";
    await this.store.writeRound(round, {
      triage_conclusion: {
        diagnoses: triageResult.diagnoses,
        hints: triageResult.hints,
        verdict: storedVerdict,
        cross_round_memory_ref: triageResult.new_memory_token,
      },
    });
    await this.store.appendEvent({ type: "round_completed", round, verdict: storedVerdict });

    // Persist failure_attribution in a TriageComplete event for downstream consumers (exp show, etc.)
    await this.store.appendEvent({
      type: "TriageComplete",
      round,
      verdict: triageResult.verdict,
      summary: triageResult.summary,
      failure_attribution: triageResult.failure_attribution,
    });

    // Abort: terminal state — no suggestion, no Deciding pause.
    if (triageResult.verdict === "abort") {
      await this.store.appendEvent({ type: "aborted", round, reason: `triage_abort: ${triageResult.summary ?? "no summary"}` });
      process.stdout.write(`\nExperiment aborted by triage: ${triageResult.summary ?? "(no reason)"}\n`);
      return;
    }

    // Continue: triageResult.next_change was produced in the same LLM call; write it as suggestion.
    if (triageResult.verdict === "continue" && round < maxRounds) {
      if (!triageResult.next_change) {
        // Parser already enforces presence when verdict=continue, but guard belt-and-braces.
        await this.store.appendEvent({
          type: "step_failed",
          state: "Triaging",
          error: "verdict=continue but next_change missing in triage output",
          retryable: true,
        });
        return;
      }
      await this.store.writeSuggestedChange(triageResult.next_change);
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
