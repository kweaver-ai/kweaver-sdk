import fs from "node:fs/promises";
import path from "node:path";
import type { ExpEvent, ExpFsmState } from "../schemas.js";

export type EventInput = ExpEvent extends infer T ? T extends { ts: string } ? Omit<T, "ts"> : never : never;

export async function appendEvent(expDir: string, event: EventInput): Promise<void> {
  const filePath = path.join(expDir, ".trace-state", "events.jsonl");
  const line = JSON.stringify({ ts: new Date().toISOString(), ...event }) + "\n";
  await fs.appendFile(filePath, line, "utf8");
}

export interface ReplayedState {
  currentState: ExpFsmState;
  currentRound: number;
  lastEvent: ExpEvent | null;
  lastFailure: { state: ExpFsmState; error: string; retryable: boolean } | null;
  isTerminal: boolean;
}

const TERMINAL: Set<ExpFsmState> = new Set(["Published", "Aborted"]);

export async function replayState(expDir: string): Promise<ReplayedState> {
  const filePath = path.join(expDir, ".trace-state", "events.jsonl");
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    return { currentState: "Init", currentRound: 0, lastEvent: null, lastFailure: null, isTerminal: false };
  }

  const lines = raw.split("\n").filter(Boolean);
  if (lines.length === 0) {
    return { currentState: "Init", currentRound: 0, lastEvent: null, lastFailure: null, isTerminal: false };
  }

  let currentState: ExpFsmState = "Init";
  let currentRound = 0;
  let lastEvent: ExpEvent | null = null;
  let lastFailure: ReplayedState["lastFailure"] = null;

  for (const line of lines) {
    const ev = JSON.parse(line) as ExpEvent;
    lastEvent = ev;
    if (ev.type === "state_transition") {
      currentState = ev.to;
      currentRound = ev.round;
      lastFailure = null;
    } else if (ev.type === "step_failed") {
      currentState = ev.state;
      lastFailure = { state: ev.state, error: ev.error, retryable: ev.retryable };
    } else if (ev.type === "aborted") {
      currentState = "Aborted";
    } else if (ev.type === "round_completed") {
      currentRound = ev.round;
    }
  }

  return {
    currentState,
    currentRound,
    lastEvent,
    lastFailure,
    isTerminal: TERMINAL.has(currentState),
  };
}
