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

// ── Compiler: Flow JSON → DPH ───────────────────────────────────────────────

export function compileToDph(flow: FlowDo): string {
  const ctx: CompileContext = { mergeCounter: 0 };
  const lines = compileSteps(flow.do, 0, ctx);
  return lines.join("\n");
}

interface CompileContext {
  mergeCounter: number;
}

function compileSteps(steps: FlowStep[], indent: number, ctx: CompileContext): string[] {
  const lines: string[] = [];
  const pad = "    ".repeat(indent);

  for (const step of steps) {
    if (isCallStep(step)) {
      lines.push(...compileCallStep(step, pad, ctx));
    } else if (isSwitchStep(step)) {
      lines.push(...compileSwitchStep(step, indent, ctx));
    } else if (isParallelStep(step)) {
      lines.push(...compileParallelStep(step, indent, ctx));
    }
  }

  return lines;
}

function compileCallStep(step: CallStep, pad: string, ctx: CompileContext): string[] {
  const outputVar = step.output ?? step.call;
  const lines: string[] = [];

  if (typeof step.input === "string") {
    if (step.input.includes(" + ")) {
      const mergeVar = `_merged_${++ctx.mergeCounter}`;
      lines.push(`${pad}${step.input} -> ${mergeVar}`);
      lines.push(`${pad}@${step.call}(query=$${mergeVar}) -> ${outputVar}`);
    } else {
      lines.push(`${pad}@${step.call}(query=${step.input}) -> ${outputVar}`);
    }
  } else {
    const params = Object.entries(step.input)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
    lines.push(`${pad}@${step.call}(${params}) -> ${outputVar}`);
  }

  return lines;
}

function compileSwitchStep(step: SwitchStep, indent: number, ctx: CompileContext): string[] {
  const pad = "    ".repeat(indent);
  const lines: string[] = [];
  let isFirst = true;

  for (const branch of step.switch) {
    if (branch.if) {
      const keyword = isFirst ? "/if/" : "elif";
      lines.push(`${pad}${keyword} ${branch.if}:`);
      isFirst = false;
    } else if (branch.default) {
      lines.push(`${pad}else:`);
    }
    lines.push(...compileSteps(branch.do, indent + 1, ctx));
  }

  lines.push(`${pad}/end/`);
  return lines;
}

function compileParallelStep(step: ParallelStep, indent: number, ctx: CompileContext): string[] {
  const pad = "    ".repeat(indent);
  const lines: string[] = [];
  lines.push(`${pad}/parallel/`);
  lines.push(...compileSteps(step.parallel, indent + 1, ctx));
  lines.push(`${pad}/end/`);
  return lines;
}
