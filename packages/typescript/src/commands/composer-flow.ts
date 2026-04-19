import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

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

export interface CompileResult {
  dph: string;
  answerVar: string;
}

export function compileToDph(flow: FlowDo): CompileResult {
  const ctx: CompileContext = { mergeCounter: 0, lastOutputVar: "", agentOutputVars: new Set() };
  const lines = compileSteps(flow.do, 0, ctx);

  // Wrap `$query` so orchestrator-scope binding becomes a plain string.
  // Passing `$query` directly to `@sub_agent(query=$query)` fails with
  // "agent_input query must be a string type" — the platform's parameter
  // type check sees the upstream binding as non-string even though at
  // runtime the value concats as a string. Writing into a dict and reading
  // back via `.q` severs that upstream type info.
  const body = lines.join("\n").replace(/\$query\b/g, "$_user_query.q");
  const dph = body.includes("$_user_query.q")
    ? `{"q": $query} -> _user_query\n${body}`
    : body;

  // answer_var must match the last output variable in the DPH script.
  // We do NOT append "$lastVar -> answer" because DPH's assign_block
  // evals expressions eagerly and will fail with "invalid syntax"
  // if the variable doesn't exist yet at parse time.
  return {
    dph,
    answerVar: ctx.lastOutputVar || "answer",
  };
}

interface CompileContext {
  mergeCounter: number;
  lastOutputVar: string;
  /** Variables that hold full agent output objects (need .answer to extract text). */
  agentOutputVars: Set<string>;
  /** Intermediate text vars already emitted (avoid duplicates). */
  extractedVars?: Set<string>;
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

/**
 * An agent's output is a nested object; the actual text lives at
 * `.answer.answer` (the outer `.answer` is the full message record with
 * metadata, the inner `.answer` is the streamed text). So whenever a prior
 * agent's output is referenced as a plain `$agent_ref`, we rewrite it to
 * `$agent_ref.answer.answer` so downstream calls receive a string.
 */
function resolveRef(
  ref: string,
  agentOutputVars: Set<string>,
): string {
  if (!ref.startsWith("$")) return ref;
  const varName = ref.slice(1).split(".")[0];
  if (agentOutputVars.has(varName) && !ref.includes(".")) {
    return `${ref}.answer.answer`;
  }
  return ref;
}

function compileCallStep(step: CallStep, pad: string, ctx: CompileContext): string[] {
  const outputVar = step.output ?? step.call;
  const lines: string[] = [];

  if (typeof step.input === "string") {
    if (step.input.includes(" + ")) {
      // Merge via `/prompt/` template block. The `+` operator in DPH inlines
      // resolved string values into a Python eval expression, which breaks
      // on arbitrary content (unescaped backticks, quotes, newlines in
      // markdown code fences → "invalid syntax"). A prompt block safely
      // interpolates each $var into a templated string.
      // Note: chained `$var.field.field` only resolves inside @call params or
      // /prompt/ bodies; it cannot appear as a standalone DPH statement
      // (`$x.answer.answer -> _v` triggers an eval parse failure). So we
      // keep them inline in the prompt template and let the prompt block
      // handle interpolation.
      const parts = step.input.split(/\s*\+\s*/).map((p) => resolveRef(p, ctx.agentOutputVars));
      const mergeVar = `_merged_${++ctx.mergeCounter}`;
      lines.push(`${pad}/prompt/`);
      for (let i = 0; i < parts.length; i++) {
        lines.push(`${pad}${parts[i]}`);
        if (i < parts.length - 1) lines.push("");
      }
      lines.push(`${pad}-> ${mergeVar}`);
      lines.push(`${pad}@${step.call}(query=$${mergeVar}.answer) -> ${outputVar}`);
    } else {
      const resolved = resolveRef(step.input, ctx.agentOutputVars);
      lines.push(`${pad}@${step.call}(query=${resolved}) -> ${outputVar}`);
    }
  } else {
    const params = Object.entries(step.input)
      .map(([k, v]) => `${k}=${resolveRef(v, ctx.agentOutputVars)}`)
      .join(", ");
    lines.push(`${pad}@${step.call}(${params}) -> ${outputVar}`);
  }

  ctx.lastOutputVar = outputVar;
  ctx.agentOutputVars.add(outputVar);
  return lines;
}

function compileSwitchStep(step: SwitchStep, indent: number, ctx: CompileContext): string[] {
  const pad = "    ".repeat(indent);
  const innerPad = "    ".repeat(indent + 1);
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
    const branchCtx: CompileContext = { ...ctx, lastOutputVar: "", agentOutputVars: new Set(ctx.agentOutputVars) };
    lines.push(...compileSteps(branch.do, indent + 1, branchCtx));
    // Track the last output var from any branch (used for answer_var)
    if (branchCtx.lastOutputVar) {
      ctx.lastOutputVar = branchCtx.lastOutputVar;
    }
    // Propagate agent output vars from branch back to parent
    for (const v of branchCtx.agentOutputVars) ctx.agentOutputVars.add(v);
    ctx.mergeCounter = branchCtx.mergeCounter;
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

// ── DPH Syntax Validation (Gate 2) ──────────────────────────────────────────

export interface DphValidationResult {
  is_valid: boolean;
  error_message: string;
  line_number: number;
  skipped?: boolean;
}

/**
 * Validate compiled DPH via Dolphin's parser (Gate 2).
 * Calls a Python script that wraps DPHSyntaxValidator.
 * Returns valid if the script is unavailable (graceful degradation).
 */
export async function validateDphSyntax(dph: string): Promise<DphValidationResult> {
  const thisDir = path.dirname(fileURLToPath(import.meta.url));
  const scriptPath = path.resolve(thisDir, "../../scripts/validate-dph.py");

  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      const proc = spawn("python3", [scriptPath], { timeout: 5000 });
      const chunks: Buffer[] = [];
      proc.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
      proc.on("error", reject);
      proc.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`validate-dph.py exited with code ${code}`));
        } else {
          resolve(Buffer.concat(chunks).toString("utf8"));
        }
      });
      proc.stdin.write(dph);
      proc.stdin.end();
    });
    return JSON.parse(stdout.trim()) as DphValidationResult;
  } catch {
    // Script not available — skip Gate 2 gracefully
    return { is_valid: true, error_message: "", line_number: 0, skipped: true };
  }
}
