/**
 * In-process registry mapping provider name → AgentProvider instance.
 *
 * Why a registry and not a direct import: rules carry the provider name
 * as a string in YAML (`agent_binding.provider: claude-code`), and the
 * synthesizer accepts an optional `defaultProvider` argument — both
 * lookups happen at runtime, not at compile time. Decoupling also lets
 * tests register a stub provider in place of `claude-code` without
 * touching consumer code.
 */

import type { AgentProvider, ResolveContext } from "./types.js";
import { AgentProviderError } from "./types.js";

export class AgentRegistry {
  private providers = new Map<string, AgentProvider>();
  private defaultName: string | null = null;

  /**
   * Register a provider. Overwrites any prior registration with the same
   * name — tests rely on this to swap claude-code for a stub.
   */
  register(provider: AgentProvider, opts?: { setAsDefault?: boolean }): void {
    this.providers.set(provider.name, provider);
    if (opts?.setAsDefault || this.defaultName === null) {
      this.defaultName = provider.name;
    }
  }

  /** Remove a registration (testing utility). */
  unregister(name: string): void {
    this.providers.delete(name);
    if (this.defaultName === name) {
      this.defaultName = this.providers.keys().next().value ?? null;
    }
  }

  has(name: string): boolean {
    return this.providers.has(name);
  }

  list(): string[] {
    return [...this.providers.keys()];
  }

  /**
   * Resolve a provider for an invocation.
   *
   * Precedence:
   *   1. `ctx.preferred` (e.g. rubric's `agent_binding.provider`) — fail
   *      if named but missing, so authors notice typos / unregistered names.
   *   2. The registry's default (first registered or the one passed
   *      `setAsDefault: true`).
   *
   * If `requiredCapabilities` is set, the chosen provider must declare
   * every requested capability — caller decides what to do on miss
   * (skip + warn vs hard fail).
   */
  resolve(ctx: ResolveContext = {}): AgentProvider | null {
    let chosen: AgentProvider | undefined;
    if (ctx.preferred) {
      chosen = this.providers.get(ctx.preferred);
      if (!chosen) {
        throw new AgentProviderError(
          `agent provider '${ctx.preferred}' not registered; available: [${this.list().join(", ") || "(none)"}]`,
          ctx.preferred,
          "not_available",
        );
      }
    } else if (this.defaultName) {
      chosen = this.providers.get(this.defaultName);
    }
    if (!chosen) return null;

    if (ctx.requiredCapabilities && ctx.requiredCapabilities.length > 0) {
      for (const cap of ctx.requiredCapabilities) {
        if (!chosen.capabilities.has(cap)) return null;
      }
    }
    return chosen;
  }
}

/**
 * Convenience singleton. Tests and consumers that want isolation should
 * instantiate `new AgentRegistry()` directly instead.
 */
export const defaultRegistry = new AgentRegistry();
