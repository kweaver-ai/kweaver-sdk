// ── Flow JSON Schema Types ──────────────────────────────────────────────────

/** Top-level flow container */
export interface FlowDo {
  do: FlowStep[];
}

/** A single step in the flow */
export type FlowStep = CallStep | SwitchStep | ParallelStep;

/** Invoke an agent */
export interface CallStep {
  call: string;
  input: string | Record<string, string>;
  output?: string;
}

/** Conditional branching */
export interface SwitchStep {
  switch: SwitchCase[];
}

export interface SwitchCase {
  if?: string;
  default?: true;
  do: FlowStep[];
}

/** Parallel execution */
export interface ParallelStep {
  parallel: FlowStep[];
}

// ── Type guards ─────────────────────────────────────────────────────────────

export function isCallStep(step: FlowStep): step is CallStep {
  return "call" in step;
}

export function isSwitchStep(step: FlowStep): step is SwitchStep {
  return "switch" in step;
}

export function isParallelStep(step: FlowStep): step is ParallelStep {
  return "parallel" in step;
}
