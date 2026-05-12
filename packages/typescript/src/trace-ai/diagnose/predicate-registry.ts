import type { Predicate } from "./types.js";

export class PredicateNotFoundError extends Error {
  constructor(name: string) {
    super(`predicate not registered: ${name}`);
    this.name = "PredicateNotFoundError";
  }
}

const REGISTRY = new Map<string, Predicate>();

export function registerPredicate(name: string, fn: Predicate): void {
  if (REGISTRY.has(name)) {
    throw new Error(`predicate already registered: ${name}`);
  }
  REGISTRY.set(name, fn);
}

export function resolvePredicate(ref: string): Predicate {
  const m = ref.match(/^([a-z-]+):(.+)$/);
  if (!m) throw new Error(`malformed predicate ref: ${ref}`);
  const [, scheme, name] = m;
  if (scheme !== "builtin") {
    throw new Error(`unsupported predicate scheme: ${scheme} (only 'builtin:' is allowed in PR-A)`);
  }
  const fn = REGISTRY.get(name);
  if (!fn) throw new PredicateNotFoundError(name);
  return fn;
}

// Test-only escape hatch.
export function clearRegistry(): void {
  REGISTRY.clear();
}
