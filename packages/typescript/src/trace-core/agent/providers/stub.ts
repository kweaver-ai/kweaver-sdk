/**
 * Fixture-replay provider for tests / CI.
 *
 * Tests register `StubAgentProvider` with a queue of pre-canned responses
 * (one per expected invocation, in order) or a `responseFn` that picks
 * based on the prompt. The provider validates each response against the
 * caller's `outputSchema` exactly like a real provider would, so schema
 * mismatches in fixtures surface as the same `AgentProviderError`
 * production code already handles.
 *
 * Two modes:
 *   - Queue: `enqueue(response)` per expected call; throws "queue empty"
 *     on over-invocation (so tests notice unexpected calls).
 *   - Function: `new StubAgentProvider({ responseFn })` lets tests
 *     condition on prompt content.
 */

import type {
  AgentProvider,
  JudgmentRequest,
  JudgmentResponse,
  ProviderCapability,
} from "../types.js";
import { AgentProviderError } from "../types.js";

export type StubResponseFn = (prompt: string) => unknown | Promise<unknown>;

export interface StubAgentProviderOpts {
  /** Override name (default: "stub"). */
  name?: string;
  /** Capabilities to advertise (default: structured_output). */
  capabilities?: ProviderCapability[];
  /** Per-call output lookup; falls back to FIFO queue if undefined. */
  responseFn?: StubResponseFn;
  /** Pre-fill responses into the queue. */
  responses?: unknown[];
  /** Force isAvailable() to return false (simulates "claude not on PATH"). */
  unavailable?: boolean;
  /** Optional per-invoke artificial delay, for timeout tests. */
  delayMs?: number;
}

export class StubAgentProvider implements AgentProvider {
  readonly name: string;
  readonly capabilities: ReadonlySet<ProviderCapability>;
  private queue: unknown[];
  private responseFn?: StubResponseFn;
  private unavailable: boolean;
  private delayMs: number;
  public calls: JudgmentRequest<unknown>[] = [];

  constructor(opts: StubAgentProviderOpts = {}) {
    this.name = opts.name ?? "stub";
    this.capabilities = new Set(opts.capabilities ?? ["structured_output"]);
    this.queue = [...(opts.responses ?? [])];
    this.responseFn = opts.responseFn;
    this.unavailable = opts.unavailable ?? false;
    this.delayMs = opts.delayMs ?? 0;
  }

  enqueue(response: unknown): void {
    this.queue.push(response);
  }

  /** Pre-canned response count remaining in the queue. */
  pending(): number {
    return this.queue.length;
  }

  async isAvailable(): Promise<boolean> {
    return !this.unavailable;
  }

  async invoke<TOutput>(req: JudgmentRequest<TOutput>): Promise<JudgmentResponse<TOutput>> {
    this.calls.push(req as JudgmentRequest<unknown>);
    if (this.unavailable) {
      throw new AgentProviderError(
        `stub provider '${this.name}' configured as unavailable`,
        this.name,
        "not_available",
      );
    }
    if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs));

    let raw: unknown;
    if (this.responseFn) {
      raw = await this.responseFn(req.prompt);
    } else {
      if (this.queue.length === 0) {
        throw new AgentProviderError(
          `stub provider '${this.name}' invoked but response queue is empty (${this.calls.length} call(s) so far)`,
          this.name,
          "internal",
        );
      }
      raw = this.queue.shift();
    }

    const rawText = typeof raw === "string" ? raw : JSON.stringify(raw);
    // The agent contract: provider returns an object the caller's schema
    // can parse. We still pass it through Zod so test responses surface
    // schema bugs the same way production responses would.
    const parsed = req.outputSchema.safeParse(raw);
    if (!parsed.success) {
      throw new AgentProviderError(
        `stub provider response failed schema validation: ${parsed.error.message}`,
        this.name,
        "schema_violation",
        parsed.error,
      );
    }
    return {
      output: parsed.data,
      rawText,
      providerName: this.name,
      latencyMs: this.delayMs,
      retryCount: 0,
    };
  }
}
