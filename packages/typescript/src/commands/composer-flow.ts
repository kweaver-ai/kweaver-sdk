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

// ── Validator: Flow Schema Checking ─────────────────────────────────────────

export function validateFlow(flow: FlowDo, agentRefs: string[]): string[] {
  const errors: string[] = [];
  const refSet = new Set(agentRefs);
  const availableVars = new Set(["$query"]);

  if (!flow || !Array.isArray(flow.do) || flow.do.length === 0) {
    errors.push("flow.do must be a non-empty array");
    return errors;
  }

  validateSteps(flow.do, refSet, availableVars, errors, "flow.do");
  return errors;
}

function validateSteps(
  steps: FlowStep[],
  agentRefs: Set<string>,
  availableVars: Set<string>,
  errors: string[],
  path: string,
): void {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const stepPath = `${path}[${i}]`;

    if (isCallStep(step)) {
      validateCallStep(step, agentRefs, availableVars, errors, stepPath);
    } else if (isSwitchStep(step)) {
      validateSwitchStep(step, agentRefs, availableVars, errors, stepPath);
    } else if (isParallelStep(step)) {
      validateParallelStep(step, agentRefs, availableVars, errors, stepPath);
    } else {
      errors.push(`${stepPath}: step must have exactly one of call, switch, or parallel`);
    }
  }
}

function validateCallStep(
  step: CallStep,
  agentRefs: Set<string>,
  availableVars: Set<string>,
  errors: string[],
  path: string,
): void {
  if (!agentRefs.has(step.call)) {
    errors.push(`${path}: unknown agent ref "${step.call}"`);
  }

  if (typeof step.input === "string") {
    validateInputString(step.input, availableVars, errors, path);
  } else if (step.input && typeof step.input === "object") {
    for (const [key, val] of Object.entries(step.input)) {
      if (!val.startsWith("$")) {
        errors.push(`${path}: input.${key} must start with $ (got "${val}")`);
      } else {
        checkVarDefined(val, availableVars, errors, path);
      }
    }
  } else {
    errors.push(`${path}: input is required`);
  }

  const outputVar = `$${step.output ?? step.call}`;
  availableVars.add(outputVar);
}

function validateInputString(
  input: string,
  availableVars: Set<string>,
  errors: string[],
  path: string,
): void {
  if (input.includes(" + ")) {
    const parts = input.split(/\s*\+\s*/);
    for (const part of parts) {
      if (!part.startsWith("$")) {
        errors.push(`${path}: each part of merge expression must start with $ (got "${part}")`);
      } else {
        checkVarDefined(part, availableVars, errors, path);
      }
    }
  } else if (!input.startsWith("$")) {
    errors.push(`${path}: input must be a $variable reference (got "${input}")`);
  } else {
    checkVarDefined(input, availableVars, errors, path);
  }
}

function checkVarDefined(varRef: string, availableVars: Set<string>, errors: string[], path: string): void {
  const baseName = varRef.split(".")[0];
  if (!availableVars.has(baseName)) {
    errors.push(`${path}: variable "${varRef}" is not defined (available: ${[...availableVars].join(", ")})`);
  }
}

function validateSwitchStep(
  step: SwitchStep,
  agentRefs: Set<string>,
  availableVars: Set<string>,
  errors: string[],
  path: string,
): void {
  const cases = step.switch;
  const ifCases = cases.filter((c) => c.if);
  const defaultCases = cases.filter((c) => c.default);

  if (ifCases.length === 0) {
    errors.push(`${path}: switch must have at least one "if" case`);
  }
  if (defaultCases.length > 1) {
    errors.push(`${path}: switch can have at most one "default" case`);
  }
  if (defaultCases.length === 1 && cases[cases.length - 1] !== defaultCases[0]) {
    errors.push(`${path}: "default" case must be last`);
  }

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    if (c.if && typeof c.if !== "string") {
      errors.push(`${path}.switch[${i}]: "if" condition must be a string`);
    }
    const branchVars = new Set(availableVars);
    validateSteps(c.do, agentRefs, branchVars, errors, `${path}.switch[${i}].do`);
  }
}

function validateParallelStep(
  step: ParallelStep,
  agentRefs: Set<string>,
  availableVars: Set<string>,
  errors: string[],
  path: string,
): void {
  if (step.parallel.length < 2) {
    errors.push(`${path}: parallel must have at least 2 steps`);
  }

  for (let i = 0; i < step.parallel.length; i++) {
    const sub = step.parallel[i];
    if (isCallStep(sub)) {
      validateCallStep(sub, agentRefs, availableVars, errors, `${path}.parallel[${i}]`);
    } else {
      errors.push(`${path}.parallel[${i}]: parallel steps must be call steps`);
    }
  }
}
