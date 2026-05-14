// src/trace-ai/exp/index.ts
import path from "node:path";
import fs from "node:fs/promises";
import { ExpStore } from "./exp-store/index.js";
import { ExperimentCoordinator } from "./coordinator.js";
import { ClaudeCodeSynthesizer } from "./providers/synthesizer-client.js";
import { ClaudeCodeTriageClient } from "./providers/triage-client.js";
import { runEval } from "./eval-runner.js";
import { defaultRegistry } from "../../agent-providers/registry.js";
import { ClaudeCodeSubprocessProvider } from "../../agent-providers/providers/claude-code-subprocess.js";

function ensureProvider() {
  if (!defaultRegistry.has("claude-code")) {
    defaultRegistry.register(new ClaudeCodeSubprocessProvider(), { setAsDefault: true });
  }
}

export interface ParsedExpArgs {
  subcommand: "run" | "resume" | "show" | "status" | "abort" | "doctor";
  expDir: string;
  newRun?: boolean;
}

export function parseExpArgs(argv: string[]): ParsedExpArgs {
  const [sub, dir = ".", ...flags] = argv;
  const validSubs = ["run", "resume", "show", "status", "abort", "doctor"] as const;
  if (!validSubs.includes(sub as never)) {
    throw new Error(`Unknown exp subcommand: ${sub}. Use: ${validSubs.join(", ")}`);
  }
  return {
    subcommand: sub as ParsedExpArgs["subcommand"],
    expDir: path.resolve(dir),
    newRun: flags.includes("--new-run"),
  };
}

export async function runExpCommand(argv: string[]): Promise<number> {
  const args = parseExpArgs(argv);
  const store = new ExpStore(args.expDir);

  switch (args.subcommand) {
    case "run": {
      ensureProvider();
      const replayed = await store.replayState();
      if (!replayed.isTerminal && replayed.currentRound > 0) {
        process.stderr.write(`Error: experiment in progress (state: ${replayed.currentState}). Use exp resume.\n`);
        return 2;
      }
      if (replayed.isTerminal && !args.newRun) {
        process.stderr.write(`Error: experiment already in terminal state ${replayed.currentState}. Use --new-run to start fresh.\n`);
        return 2;
      }
      if (replayed.isTerminal && args.newRun) {
        await store.archiveState();
      }
      const coord = makeCoordinator(args.expDir);
      await coord.run();
      return 0;
    }

    case "resume": {
      ensureProvider();
      const replayed = await store.replayState();
      if (replayed.currentState !== "Deciding") {
        process.stderr.write(`Error: cannot resume — experiment is in state ${replayed.currentState}. Only Deciding state supports resume.\n`);
        return 2;
      }
      const coord = makeCoordinator(args.expDir);
      await coord.resume();
      return 0;
    }

    case "show": {
      const replayed = await store.replayState();
      const rounds = await store.readAllRounds();
      const lineage = await store.readLineage();
      const mission = await store.readMission().catch(() => null);
      process.stdout.write(`State: ${replayed.currentState}  Round: ${replayed.currentRound}\n`);
      if (mission?.next_change) {
        process.stdout.write(`Suggested next change:\n  target: ${mission.next_change.target}\n  hypothesis: ${mission.next_change.hypothesis}\n`);
      }
      if (rounds.length > 0) {
        const last = rounds.at(-1)!;
        process.stdout.write(`Last round scores: outcome=${last.scores?.outcome.toFixed(2) ?? "?"}, trajectory=${last.scores?.trajectory.toFixed(2) ?? "?"}\n`);
        if (last.triage_conclusion) {
          process.stdout.write(`Triage: ${last.triage_conclusion.diagnoses.join("; ")}\n`);
        }
      }
      process.stdout.write(`Lineage: ${lineage.length} versions\n`);
      return 0;
    }

    case "status": {
      const replayed = await store.replayState();
      process.stdout.write(`${args.expDir}: ${replayed.currentState} (round ${replayed.currentRound})\n`);
      return 0;
    }

    case "abort": {
      await store.writeAbortSignal();
      process.stdout.write(`Abort signal written. Running process will stop at next checkpoint.\n`);
      return 0;
    }

    case "doctor": {
      return runDoctor(args.expDir, store);
    }
  }
}

async function runDoctor(expDir: string, store: ExpStore): Promise<number> {
  let ok = true;
  const check = (label: string, pass: boolean, msg: string) => {
    process.stdout.write(`${pass ? "✓" : "✗"} ${label}${pass ? "" : `: ${msg}`}\n`);
    if (!pass) ok = false;
  };

  try {
    const mission = await store.readMission();
    check("mission.md valid", true, "");
    for (const es of mission.eval_sets) {
      const esPath = path.join(expDir, es.path);
      await fs.access(esPath).then(() => check(`eval_set ${es.path}`, true, "")).catch(() => check(`eval_set ${es.path}`, false, `not found: ${esPath}`));
    }
    const candPath = path.join(expDir, mission.current_candidate.path);
    await fs.access(candPath).then(() => check("current_candidate readable", true, "")).catch(() => check("current_candidate readable", false, `not found: ${candPath}`));
  } catch (e) {
    check("mission.md valid", false, String(e));
  }

  let providerOk = false;
  try {
    providerOk = defaultRegistry.resolve({ preferred: "claude-code" }) !== null;
  } catch {
    providerOk = false;
  }
  check("claude-code provider available", providerOk, "run: npx @anthropic-ai/claude-code --version");

  const replayed = await store.replayState();
  if (replayed.lastFailure) check("no step_failed in events", false, `last failure: ${replayed.lastFailure.error}`);
  else check("no step_failed in events", true, "");

  return ok ? 0 : 1;
}

function makeCoordinator(expDir: string): ExperimentCoordinator {
  return new ExperimentCoordinator({
    expDir,
    synthesizer: new ClaudeCodeSynthesizer(),
    triage: new ClaudeCodeTriageClient(),
    runEval: ({ evalSetPaths, candidatePath }) => runEval({
      evalSetPaths,
      candidatePath,
      expDir,
      deps: {
        fetchAgent: async (id) => ({ id, key: id, version: "latest" }),
        sendChat: async () => { throw new Error("sendChat not configured — provide RunnerDeps"); },
        fetchTrace: async () => ({ spans: [] }),
      },
    }),
  });
}
