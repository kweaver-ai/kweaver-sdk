/**
 * AgentProvider that spawns the Claude Code CLI as a one-shot subprocess.
 *
 *   $ claude -p --output-format=json --dangerously-skip-permissions <prompt-on-stdin>
 *
 * Why subprocess + the `claude` CLI (vs an HTTP / SDK transport):
 *   - Zero remote service dependency for trace-ai diagnose — dogfoods
 *     the same CLI the user already authenticates / configures.
 *   - One binary to install across user laptops + CI.
 *   - `--output-format=json` returns a stable envelope (`{ result: <text> }`)
 *     so we can deterministically extract the model's answer.
 *
 * The model's textual response is expected to be JSON matching the
 * caller's `outputSchema`. The provider:
 *   1. spawns the CLI, pipes `prompt` to stdin
 *   2. parses the CLI's stdout envelope (json mode)
 *   3. extracts the inner text, parses it as JSON
 *   4. validates against `outputSchema`
 *   5. on parse / schema failure, retries the *whole* invocation once
 *      with a "fix the JSON" suffix appended (bounded; PR-B doesn't
 *      do exponential backoff)
 *
 * Failure modes surface as typed `AgentProviderError`:
 *   not_available   `claude` not on PATH, or `isAvailable()` was false
 *   timeout         subprocess exceeded timeoutMs
 *   transport       non-zero exit / no stdout
 *   invalid_json    envelope parsed but inner text wasn't JSON (after retry)
 *   schema_violation inner JSON didn't satisfy outputSchema (after retry)
 */

import { spawn } from "node:child_process";

import type {
  AgentProvider,
  JudgmentRequest,
  JudgmentResponse,
  ProviderCapability,
} from "../types.js";
import { AgentProviderError } from "../types.js";

export interface ClaudeCodeSubprocessProviderOpts {
  /** Override the binary on PATH (default: 'claude'). */
  binary?: string;
  /** Extra CLI args, prepended before our defaults. */
  extraArgs?: string[];
  /** Default timeout per invoke (ms). Per-call timeoutMs in JudgmentRequest takes precedence. */
  defaultTimeoutMs?: number;
  /** Working directory for the subprocess (default: process.cwd()). */
  cwd?: string;
  /** Environment overrides (merged with process.env). */
  env?: Record<string, string>;
  /** Override `name` reported on the provider (default: 'claude-code'). */
  name?: string;
  /**
   * Map the tier intent on a JudgmentRequest to a concrete claude model name.
   * Defaults: fast='haiku', std='sonnet'. `--model {value}` is appended to
   * spawn args only when `req.tier` is set; undefined tier omits the flag
   * and lets claude CLI pick its own default (preserves PR-B behavior).
   */
  modelByTier?: { fast?: string; std?: string };
}

const DEFAULT_TIMEOUT_MS = 60_000;

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

function runOnce(
  binary: string,
  args: string[],
  stdin: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const child = spawn(binary, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const killer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      // Hard-kill if it doesn't shut down promptly.
      setTimeout(() => child.kill("SIGKILL"), 2000).unref();
    }, timeoutMs);
    killer.unref();
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d: string) => { stdout += d; });
    child.stderr.on("data", (d: string) => { stderr += d; });
    child.on("error", (err) => {
      clearTimeout(killer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(killer);
      const durationMs = Date.now() - t0;
      if (timedOut) {
        reject(new AgentProviderError(
          `claude-code subprocess timed out after ${timeoutMs}ms`,
          "claude-code",
          "timeout",
        ));
        return;
      }
      resolve({ stdout, stderr, exitCode: code ?? -1, durationMs });
    });
    // The child may close stdin before we finish writing — happens whenever the
    // child path doesn't actually consume stdin (e.g. `claude --version` only
    // echoes a version and exits). On Linux that races our `.end(stdin)` and
    // surfaces as an uncaught EPIPE; on macOS the timing usually hides it.
    // The child's exit code is the real signal we care about; swallow EPIPE
    // here and let the `close` handler decide pass/fail.
    child.stdin.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EPIPE") return;
      clearTimeout(killer);
      reject(err);
    });
    child.stdin.end(stdin);
  });
}

/**
 * Extract the model's response text from `claude -p --output-format=json`'s
 * stdout envelope. The envelope shape (as of claude-code 2.1.x):
 *   { type: 'result', subtype: 'success', is_error: false, result: '<text>', ... }
 * Older versions used `text`; accept both. Stream-json mode is not supported
 * here (multi-line ndjson would need a different parser).
 */
function extractEnvelopeResult(stdout: string): string {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new AgentProviderError(
      "claude-code returned empty stdout",
      "claude-code",
      "transport",
    );
  }
  let env: Record<string, unknown>;
  try {
    env = JSON.parse(trimmed);
  } catch (e) {
    throw new AgentProviderError(
      `claude-code envelope is not valid JSON: ${(e as Error).message}`,
      "claude-code",
      "transport",
      e,
    );
  }
  if (env.is_error) {
    throw new AgentProviderError(
      `claude-code reported is_error=true: ${String(env.result ?? env.error ?? "<no detail>")}`,
      "claude-code",
      "transport",
    );
  }
  const result = env.result ?? env.text;
  if (typeof result !== "string") {
    throw new AgentProviderError(
      `claude-code envelope missing 'result' string (keys: ${Object.keys(env).join(", ")})`,
      "claude-code",
      "transport",
    );
  }
  return result;
}

/**
 * Inner model text is expected to be a JSON object. The model often wraps
 * it in markdown fences ```json ... ``` or in prose preamble; strip those
 * before parsing to give the JSON-mode pipeline a fair chance before the
 * retry kicks in.
 */
function parseModelJson(text: string): unknown {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fence ? fence[1] : text).trim();
  // Some responses include a leading "Here is the JSON:" — find first '{' or '['.
  const firstObj = candidate.indexOf("{");
  const firstArr = candidate.indexOf("[");
  const start = firstObj === -1 ? firstArr : firstArr === -1 ? firstObj : Math.min(firstObj, firstArr);
  const slice = start > 0 ? candidate.slice(start) : candidate;
  return JSON.parse(slice);
}

export class ClaudeCodeSubprocessProvider implements AgentProvider {
  readonly name: string;
  readonly capabilities: ReadonlySet<ProviderCapability> = new Set<ProviderCapability>(["structured_output"]);
  private binary: string;
  private extraArgs: string[];
  private defaultTimeoutMs: number;
  private cwd: string;
  private env: Record<string, string>;
  private availabilityCache: { ok: boolean; checkedAt: number } | null = null;
  private modelByTier: { fast: string; std: string };

  constructor(opts: ClaudeCodeSubprocessProviderOpts = {}) {
    this.name = opts.name ?? "claude-code";
    this.binary = opts.binary ?? "claude";
    this.extraArgs = opts.extraArgs ?? [];
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.cwd = opts.cwd ?? process.cwd();
    this.env = opts.env ?? {};
    this.modelByTier = {
      fast: opts.modelByTier?.fast ?? "haiku",
      std: opts.modelByTier?.std ?? "sonnet",
    };
  }

  /** Visible for testing. Builds the spawn args list including --model when tier is set. */
  buildSpawnArgs(tier: 'fast' | 'std' | undefined): string[] {
    const args = [
      ...this.extraArgs,
      "-p",
      "--output-format=json",
      "--dangerously-skip-permissions",
    ];
    if (tier !== undefined) {
      args.push("--model", this.modelByTier[tier]);
    }
    return args;
  }

  /**
   * Cached for 60s — repeated rubric rules don't each pay the spawn cost
   * of `claude --version`. Cache is per-instance, not process-wide.
   */
  async isAvailable(): Promise<boolean> {
    const now = Date.now();
    if (this.availabilityCache && now - this.availabilityCache.checkedAt < 60_000) {
      return this.availabilityCache.ok;
    }
    try {
      const res = await runOnce(
        this.binary,
        ["--version"],
        "",
        this.cwd,
        { ...process.env, ...this.env },
        5_000,
      );
      const ok = res.exitCode === 0;
      this.availabilityCache = { ok, checkedAt: now };
      return ok;
    } catch {
      this.availabilityCache = { ok: false, checkedAt: now };
      return false;
    }
  }

  async invoke<TOutput>(req: JudgmentRequest<TOutput>): Promise<JudgmentResponse<TOutput>> {
    if (!(await this.isAvailable())) {
      throw new AgentProviderError(
        `claude CLI not available at '${this.binary}'`,
        this.name,
        "not_available",
      );
    }
    const timeoutMs = req.timeoutMs ?? this.defaultTimeoutMs;
    // `-p` print mode + json envelope. `--dangerously-skip-permissions` so the
    // subscription/OAuth flow doesn't block on a TTY permission prompt that we
    // can't answer from a subprocess. We deliberately do NOT pass `--bare`:
    // `--bare` forces ANTHROPIC_API_KEY / apiKeyHelper and refuses to read
    // OAuth or keychain — that breaks Claude Code subscription users.
    const args = this.buildSpawnArgs(req.tier);
    const env = { ...process.env, ...this.env };

    // Attempt 1: as-is.
    let firstErr: unknown;
    let firstRaw = "";
    try {
      const res = await runOnce(this.binary, args, req.prompt, this.cwd, env, timeoutMs);
      if (res.exitCode !== 0) {
        throw new AgentProviderError(
          `claude-code exited ${res.exitCode}: ${res.stderr.slice(0, 200)}`,
          this.name,
          "transport",
        );
      }
      firstRaw = res.stdout;
      const inner = extractEnvelopeResult(res.stdout);
      const parsed = parseModelJson(inner);
      const validated = req.outputSchema.safeParse(parsed);
      if (validated.success) {
        return {
          output: validated.data as TOutput,
          rawText: inner,
          providerName: this.name,
          latencyMs: res.durationMs,
          retryCount: 0,
        };
      }
      firstErr = new AgentProviderError(
        `response failed schema validation: ${validated.error.message}`,
        this.name,
        "schema_violation",
        validated.error,
      );
    } catch (e) {
      if (e instanceof AgentProviderError && (e.kind === "timeout" || e.kind === "not_available" || e.kind === "transport")) {
        // Don't retry timeouts / transport / not_available — they're not
        // model-output errors and retrying just doubles the wall time.
        throw e;
      }
      firstErr = e;
    }

    // Attempt 2: ask the model to emit ONLY the JSON, no fences / prose.
    // Suffix is appended to the same prompt so the conversation logic
    // (the model deciding what to say) sees the original task + the
    // formatting demand together — that matches what `claude-code` is
    // optimized for.
    const retryPrompt =
      req.prompt +
      "\n\n[retry] Your previous response could not be parsed. Reply with ONLY a single JSON object that satisfies the schema. " +
      "Do not include markdown code fences, headers, or prose. Begin your reply with '{' and end with '}'.";
    const res2 = await runOnce(this.binary, args, retryPrompt, this.cwd, env, timeoutMs);
    if (res2.exitCode !== 0) {
      throw new AgentProviderError(
        `claude-code retry exited ${res2.exitCode}: ${res2.stderr.slice(0, 200)}`,
        this.name,
        "transport",
      );
    }
    let inner2: string;
    try {
      inner2 = extractEnvelopeResult(res2.stdout);
    } catch (e) {
      throw e;
    }
    let parsed2: unknown;
    try {
      parsed2 = parseModelJson(inner2);
    } catch (e) {
      throw new AgentProviderError(
        `retry response still not valid JSON: ${(e as Error).message}`,
        this.name,
        "invalid_json",
        e,
      );
    }
    const validated2 = req.outputSchema.safeParse(parsed2);
    if (!validated2.success) {
      throw new AgentProviderError(
        `retry response failed schema validation: ${validated2.error.message}`,
        this.name,
        "schema_violation",
        firstErr ?? validated2.error,
      );
    }
    return {
      output: validated2.data as TOutput,
      rawText: inner2,
      providerName: this.name,
      latencyMs: res2.durationMs,
      retryCount: 1,
    };
  }
}
