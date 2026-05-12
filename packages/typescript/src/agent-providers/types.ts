/**
 * `agent-providers/` is a cross-trace-ai shared abstraction.
 *
 * Why it lives above `diagnose/`: future trace-ai modules (M6 Agent
 * Synthesizer, future Triage, scan-mode in issue #2) all need to invoke
 * an LLM/agent to render semantic judgments or narratives. They share
 * one Provider contract; only the prompt template + output schema differ.
 *
 * `diagnose/` adds thin domain bindings on top — `agent-binding.ts`
 * (rubric → Hit) and `synthesizer.ts` (findings → Summary) — both of
 * which call into the same `AgentProvider` resolved via this registry.
 */

import type { z } from "zod";

/**
 * A structured invocation against an LLM-backed agent.
 *
 * `outputSchema` is enforced by the provider: invalid JSON or schema
 * mismatch is treated as a provider error (with bounded retry), not
 * silently coerced. This is the contract that lets rubric rules and
 * the synthesizer trust the response shape.
 */
export interface JudgmentRequest<TOutput = unknown> {
  /** Fully-rendered prompt; provider does not template further. */
  prompt: string;
  /** Zod schema (or compatible parser) the response JSON must satisfy. */
  outputSchema: z.ZodType<TOutput>;
  /** Override default timeout (ms). Provider applies its own ceiling. */
  timeoutMs?: number;
  /** Free-form correlation tag for logs / telemetry. */
  correlationId?: string;
  /** Provider-specific overrides (e.g. model name); opaque here. */
  providerOpts?: Record<string, unknown>;
  /**
   * Task-difficulty intent for the LLM call. Providers map this to a concrete
   * model via their own configuration. `undefined` = use the provider's own
   * default; no model override is applied. (The ClaudeCodeSubprocessProvider
   * preserves PR-B behavior by omitting `--model` in this case.)
   */
  tier?: "fast" | "std";
}

export interface JudgmentResponse<TOutput = unknown> {
  /** Parsed + schema-validated output. */
  output: TOutput;
  /** Raw textual response, for logging / debugging. */
  rawText: string;
  /** Provider name that produced this response. */
  providerName: string;
  /** Wall-clock latency observed inside the provider. */
  latencyMs: number;
  /** Number of parse/validation retries the provider performed. */
  retryCount: number;
}

/**
 * Provider capability flags. Callers query these before resolving a
 * provider for a task that needs e.g. streaming or vision.
 *
 * PR-B requires only `structured_output`. Other flags are reserved.
 */
export type ProviderCapability =
  | "structured_output"  // returns JSON matching outputSchema
  | "streaming"
  | "vision"
  | "tool_use";

/**
 * The cross-module contract every LLM transport implements. A provider
 * is registered once at module load and resolved by name at invocation.
 *
 * Providers MUST throw `AgentProviderError` on transport / parse / validation
 * failures so callers can distinguish those from logic errors.
 */
export interface AgentProvider {
  readonly name: string;
  readonly capabilities: ReadonlySet<ProviderCapability>;

  /** Resolve once at registration: is `claude` on PATH? remote reachable? etc. */
  isAvailable(): Promise<boolean>;

  /** Issue one structured judgment. Schema-validated; bounded retries. */
  invoke<TOutput>(req: JudgmentRequest<TOutput>): Promise<JudgmentResponse<TOutput>>;
}

export class AgentProviderError extends Error {
  constructor(
    message: string,
    public readonly providerName: string,
    public readonly kind:
      | "not_available"     // isAvailable() === false; caller should skip + warn
      | "timeout"
      | "transport"          // subprocess crash, HTTP non-2xx, etc.
      | "invalid_json"       // response wasn't parseable JSON
      | "schema_violation"   // JSON parsed but didn't match outputSchema
      | "internal",          // bug inside the provider
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AgentProviderError";
  }
}

/**
 * Optional context for resolving a provider. PR-B uses only `preferred`
 * to pin the provider named in a rubric's `agent_binding.provider`.
 */
export interface ResolveContext {
  /** Provider name from rule YAML; takes precedence over default. */
  preferred?: string;
  /** Capabilities the use-case requires; resolution filters by these. */
  requiredCapabilities?: ProviderCapability[];
}
