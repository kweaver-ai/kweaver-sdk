/**
 * Composer LLM-level accuracy harness (Option A — pass-rate, no gold answers).
 *
 * For each prompt, replicates the production gate loop:
 *   - Gate 1 (validateFlow): up to 3 LLM attempts with feedback
 *   - Gate 2 (validateDphSyntax): up to 1 retry with feedback
 *
 * Records per-prompt: which attempt passed each gate, total time, DPH lines,
 * topology shape (call/switch/parallel counts), and failure mode if any.
 *
 * Run:
 *   node --import tsx test/composer/eval/run-accuracy.ts
 *   node --import tsx test/composer/eval/run-accuracy.ts --concurrency=4
 */
import fs from "node:fs";
import path from "node:path";

import { ensureValidToken } from "../../../src/auth/oauth.js";
import { resolveBusinessDomain } from "../../../src/config/store.js";
import { sendChatRequestStream } from "../../../src/api/agent-chat.js";
import {
  FLOW_GENERATION_SYSTEM_PROMPT,
  extractJsonFromLLMResponse,
  validateComposerConfig,
  findRelayAgent,
  type ComposerConfig,
} from "../../../src/commands/composer-engine.js";
import {
  validateFlow,
  compileToDph,
  validateDphSyntax,
  type FlowDo,
  type FlowStep,
} from "../../../src/commands/composer-flow.js";

interface ExpectedShape {
  calls: [number, number]; // [min, max]
  switches: number;
  parallels: number;
}

interface PromptCase {
  id: string;
  topology_hint: string;
  prompt: string;
  expected_shape: ExpectedShape | null;
}

type FailureMode =
  | "pass"
  | "gate1_json_parse"
  | "gate1_validate"
  | "gate2_syntax"
  | "exception";

type ShapeMatch = "match" | "mismatch" | "n/a" | "skipped";

interface AttemptRecord {
  type: "gate1" | "gate2";
  ok: boolean;
  errors?: string[];
  duration_ms: number;
}

interface PromptResult {
  id: string;
  topology_hint: string;
  final: FailureMode;
  gate1_pass_attempt: number; // 1..3, or 0 if all 3 failed
  gate2_pass_attempt: number; // 1..2, or 0 if not reached/all failed
  total_duration_ms: number;
  dph_lines: number;
  shape: { calls: number; switches: number; parallels: number };
  expected_shape: ExpectedShape | null;
  shape_match: ShapeMatch;
  shape_mismatch_reason?: string;
  attempts: AttemptRecord[];
  last_error?: string;
}

function checkShapeMatch(
  actual: { calls: number; switches: number; parallels: number },
  expected: ExpectedShape | null,
): { result: ShapeMatch; reason?: string } {
  if (expected === null) return { result: "n/a" };
  const reasons: string[] = [];
  if (actual.calls < expected.calls[0] || actual.calls > expected.calls[1]) {
    reasons.push(`calls=${actual.calls} not in [${expected.calls[0]},${expected.calls[1]}]`);
  }
  if (actual.switches !== expected.switches) {
    reasons.push(`switches=${actual.switches} ≠ ${expected.switches}`);
  }
  if (actual.parallels !== expected.parallels) {
    reasons.push(`parallels=${actual.parallels} ≠ ${expected.parallels}`);
  }
  return reasons.length === 0 ? { result: "match" } : { result: "mismatch", reason: reasons.join("; ") };
}

function shapeOf(flow: FlowDo): { calls: number; switches: number; parallels: number } {
  let calls = 0, switches = 0, parallels = 0;
  const walk = (steps: FlowStep[]) => {
    for (const s of steps) {
      if ("call" in s) calls++;
      else if ("switch" in s) {
        switches++;
        for (const c of s.switch) walk(c.do);
      } else if ("parallel" in s) {
        parallels++;
      }
    }
  };
  walk(flow.do);
  return { calls, switches, parallels };
}

async function callLlm(
  baseUrl: string,
  accessToken: string,
  relayAgent: { id: string; key: string; version: string },
  query: string,
  businessDomain: string,
): Promise<string> {
  let fullText = "";
  await sendChatRequestStream(
    {
      baseUrl,
      accessToken,
      agentId: relayAgent.id,
      agentKey: relayAgent.key,
      agentVersion: relayAgent.version,
      query,
      stream: true,
      businessDomain,
    },
    { onTextDelta: (ft: string) => { fullText = ft; } },
  );
  return fullText;
}

async function evaluatePrompt(
  c: PromptCase,
  baseUrl: string,
  getAccessToken: () => Promise<string>,
  relayAgent: { id: string; key: string; version: string },
  businessDomain: string,
): Promise<PromptResult> {
  const r: PromptResult = {
    id: c.id,
    topology_hint: c.topology_hint,
    final: "exception",
    gate1_pass_attempt: 0,
    gate2_pass_attempt: 0,
    total_duration_ms: 0,
    dph_lines: 0,
    shape: { calls: 0, switches: 0, parallels: 0 },
    expected_shape: c.expected_shape,
    shape_match: "skipped",
    attempts: [],
  };
  const t0 = Date.now();
  try {
    let config: ComposerConfig | null = null;
    let lastErrors: string[] = [];

    // Gate 1: up to 3 attempts
    for (let attempt = 1; attempt <= 3; attempt++) {
      const aStart = Date.now();
      let q = `${FLOW_GENERATION_SYSTEM_PROMPT}\n\n---\n\nUser request: ${c.prompt}`;
      if (attempt > 1 && lastErrors.length > 0) {
        q += `\n\nYour previous output had these errors:\n${lastErrors.join("\n")}\n\nPlease fix and output again.`;
      }
      const text = await callLlm(baseUrl, await getAccessToken(), relayAgent, q, businessDomain);
      const parsed = extractJsonFromLLMResponse(text);
      if (!parsed || !validateComposerConfig(parsed)) {
        lastErrors = ["Output is not a valid ComposerConfig JSON"];
        r.attempts.push({ type: "gate1", ok: false, errors: lastErrors, duration_ms: Date.now() - aStart });
        continue;
      }
      if (parsed.orchestrator.flow) {
        const refs = parsed.agents.map((a) => a.ref);
        const errs = validateFlow(parsed.orchestrator.flow, refs);
        if (errs.length > 0) {
          lastErrors = errs;
          r.attempts.push({ type: "gate1", ok: false, errors: errs, duration_ms: Date.now() - aStart });
          continue;
        }
      }
      r.attempts.push({ type: "gate1", ok: true, duration_ms: Date.now() - aStart });
      config = parsed;
      r.gate1_pass_attempt = attempt;
      break;
    }

    if (!config) {
      r.final = lastErrors[0]?.startsWith("Output is not") ? "gate1_json_parse" : "gate1_validate";
      r.last_error = lastErrors.join("; ");
      return r;
    }

    // Gate 2: up to 1 retry
    if (config.orchestrator.flow && config.orchestrator.flow.do.length > 0) {
      r.shape = shapeOf(config.orchestrator.flow);
      let current = config;
      for (let attempt = 1; attempt <= 2; attempt++) {
        const aStart = Date.now();
        const compiled = compileToDph(current.orchestrator.flow!);
        const v = await validateDphSyntax(compiled.dph);
        if (v.is_valid) {
          r.attempts.push({ type: "gate2", ok: true, duration_ms: Date.now() - aStart });
          r.gate2_pass_attempt = attempt;
          r.dph_lines = compiled.dph.split("\n").length;
          r.shape = shapeOf(current.orchestrator.flow!);
          const m = checkShapeMatch(r.shape, c.expected_shape);
          r.shape_match = m.result;
          if (m.reason) r.shape_mismatch_reason = m.reason;
          r.final = "pass";
          return r;
        }
        const lineNo = v.line_number;
        const errMsg = v.error_message;
        r.attempts.push({
          type: "gate2",
          ok: false,
          errors: [`line ${lineNo}: ${errMsg}`],
          duration_ms: Date.now() - aStart,
        });
        if (attempt === 2) break;

        const hint = `Your compiled DPH had a syntax error at line ${lineNo}: ${errMsg}. Please fix and output again.`;
        const q = `${FLOW_GENERATION_SYSTEM_PROMPT}\n\n---\n\nUser request: ${c.prompt}\n\n${hint}`;
        const text = await callLlm(baseUrl, await getAccessToken(), relayAgent, q, businessDomain);
        const parsed = extractJsonFromLLMResponse(text);
        if (!parsed || !validateComposerConfig(parsed) || !parsed.orchestrator.flow) {
          r.final = "gate2_syntax";
          r.last_error = `regenerate produced invalid config (${errMsg})`;
          return r;
        }
        const refs = parsed.agents.map((a) => a.ref);
        const errs = validateFlow(parsed.orchestrator.flow, refs);
        if (errs.length > 0) {
          r.final = "gate2_syntax";
          r.last_error = `regenerate failed gate1: ${errs.join("; ")}`;
          return r;
        }
        current = parsed;
      }
      r.final = "gate2_syntax";
      r.last_error = r.attempts.filter((a) => a.type === "gate2" && !a.ok).slice(-1)[0]?.errors?.join("; ");
      return r;
    }

    // No flow at all (single-agent or empty) — count as pass
    r.final = "pass";
    return r;
  } catch (err) {
    r.final = "exception";
    r.last_error = err instanceof Error ? err.message : String(err);
    return r;
  } finally {
    r.total_duration_ms = Date.now() - t0;
  }
}

function fmt(n: number, w: number): string {
  return String(n).padStart(w);
}

function summarize(results: PromptResult[]): void {
  const total = results.length;
  const passed = results.filter((r) => r.final === "pass").length;
  const gate1AtN = (n: number) => results.filter((r) => r.gate1_pass_attempt === n).length;
  const gate2AtN = (n: number) => results.filter((r) => r.gate2_pass_attempt === n).length;
  const allGate2Ok = results.filter((r) => r.gate2_pass_attempt > 0).length;

  // pass@1 = gate1 passed on attempt 1 AND gate2 passed on attempt 1
  const passAt1 = results.filter((r) => r.gate1_pass_attempt === 1 && r.gate2_pass_attempt === 1).length;
  const passEventual = passed;

  // Shape-match accounting (only over labeled prompts)
  const labeled = results.filter((r) => r.shape_match !== "n/a");
  const labeledTotal = labeled.length;
  const shapeMatched = labeled.filter((r) => r.shape_match === "match").length;
  const shapeMismatched = labeled.filter((r) => r.shape_match === "mismatch").length;
  const shapeSkipped = labeled.filter((r) => r.shape_match === "skipped").length;

  console.log("\n=== Composer DPH accuracy ===");
  console.log(`Total prompts:         ${total}  (labeled=${labeledTotal}, ambiguous=${total - labeledTotal})`);
  console.log(`syntax pass@1:         ${passAt1}/${total}  (${((passAt1 / total) * 100).toFixed(1)}%)`);
  console.log(`syntax pass@retry:     ${passEventual}/${total}  (${((passEventual / total) * 100).toFixed(1)}%)`);
  console.log(`shape match:           ${shapeMatched}/${labeledTotal}  (${labeledTotal ? ((shapeMatched / labeledTotal) * 100).toFixed(1) : "0.0"}%)  [mismatch=${shapeMismatched}, skipped=${shapeSkipped}]`);
  console.log("");
  console.log(`Gate 1 pass distribution:  attempt-1=${gate1AtN(1)}  attempt-2=${gate1AtN(2)}  attempt-3=${gate1AtN(3)}  fail=${results.filter((r) => r.gate1_pass_attempt === 0).length}`);
  console.log(`Gate 2 pass distribution:  attempt-1=${gate2AtN(1)}  attempt-2=${gate2AtN(2)}  not-reached/fail=${total - allGate2Ok}`);
  console.log("");
  console.log("Per-prompt:");
  const header = "id                       topo                     g1  g2  dph   shape   expected      match   ms       final";
  console.log(header);
  console.log("-".repeat(header.length));
  for (const r of results) {
    const idCell = r.id.padEnd(24).slice(0, 24);
    const topo = r.topology_hint.padEnd(24).slice(0, 24);
    const g1 = fmt(r.gate1_pass_attempt, 2);
    const g2 = fmt(r.gate2_pass_attempt, 2);
    const dph = fmt(r.dph_lines, 4);
    const shape = `${r.shape.calls}/${r.shape.switches}/${r.shape.parallels}`.padEnd(7);
    const exp = r.expected_shape
      ? `${r.expected_shape.calls[0]}-${r.expected_shape.calls[1]}/${r.expected_shape.switches}/${r.expected_shape.parallels}`.padEnd(13)
      : "—".padEnd(13);
    const matchTag = (r.shape_match === "match" ? "✓" : r.shape_match === "mismatch" ? "✗" : "·").padEnd(7);
    const ms = fmt(r.total_duration_ms, 6);
    const tag = r.final === "pass" ? "✓ pass" : `✗ ${r.final}`;
    console.log(`${idCell} ${topo} ${g1}  ${g2}  ${dph}  ${shape} ${exp} ${matchTag} ${ms}   ${tag}`);
    if (r.shape_mismatch_reason) {
      console.log(`    └─ shape: ${r.shape_mismatch_reason}`);
    }
    if (r.last_error) {
      console.log(`    └─ ${r.last_error.slice(0, 140)}`);
    }
  }
  console.log("");
  // Failure-mode counts
  const modes = new Map<string, number>();
  for (const r of results) modes.set(r.final, (modes.get(r.final) ?? 0) + 1);
  console.log("Outcome counts:");
  for (const [k, v] of [...modes.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(20)} ${v}`);
  }
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const concArg = [...args].find((a) => a.startsWith("--concurrency="));
  const concurrency = concArg ? Math.max(1, parseInt(concArg.split("=")[1], 10) || 1) : 2;
  const onlyArg = [...args].find((a) => a.startsWith("--only="));
  const onlyIds = onlyArg ? new Set(onlyArg.split("=")[1].split(",")) : null;

  const promptsPath = path.join(import.meta.dirname, "prompts.json");
  const cases = JSON.parse(fs.readFileSync(promptsPath, "utf-8")) as PromptCase[];
  const filtered = onlyIds ? cases.filter((c) => onlyIds.has(c.id)) : cases;

  const t = await ensureValidToken();
  const baseUrl = t.baseUrl;
  const businessDomain = resolveBusinessDomain("") || "bd_public";
  const getAccessToken = async () => (await ensureValidToken()).accessToken;

  console.error(`[eval] Connected to ${baseUrl}, bd=${businessDomain}`);
  console.error(`[eval] Resolving relay agent...`);
  const relayAgent = await findRelayAgent(baseUrl, t.accessToken, businessDomain);
  if (!relayAgent) {
    console.error("[eval] Failed to resolve relay agent");
    process.exit(2);
  }
  console.error(`[eval] Relay: ${relayAgent.id}`);
  console.error(`[eval] Running ${filtered.length} prompt(s) with concurrency=${concurrency}...`);

  const results: PromptResult[] = [];
  let idx = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const i = idx++;
      if (i >= filtered.length) break;
      const c = filtered[i];
      console.error(`[eval] [${i + 1}/${filtered.length}] ${c.id}: ${c.prompt.slice(0, 60)}...`);
      const r = await evaluatePrompt(c, baseUrl, getAccessToken, relayAgent, businessDomain);
      results.push(r);
      console.error(`[eval]   → ${r.final} (g1=${r.gate1_pass_attempt} g2=${r.gate2_pass_attempt} ${r.total_duration_ms}ms)`);
    }
  });
  await Promise.all(workers);

  // Sort results by original prompt order
  const order = new Map(filtered.map((c, i) => [c.id, i]));
  results.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

  summarize(results);

  const outPath = path.join(import.meta.dirname, "results.json");
  fs.writeFileSync(outPath, JSON.stringify({ timestamp: new Date().toISOString(), baseUrl, businessDomain, results }, null, 2));
  console.error(`\n[eval] Results saved to ${outPath}`);

  process.exit(results.every((r) => r.final === "pass") ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
