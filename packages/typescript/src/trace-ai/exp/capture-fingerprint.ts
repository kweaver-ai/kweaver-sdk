// src/trace-ai/exp/capture-fingerprint.ts
//
// Read-back: fetch a live agent's full config and normalize it into an
// AgentFingerprint. The config fetcher is injected so this stays unit-testable
// and so the coordinator can bind it with the right baseUrl / token / domain.
import type { AgentFingerprint } from "./preflight.js";
import { fingerprintFromAgentConfig } from "./preflight.js";

/** Fetches the full raw config object of an agent at a given version. */
export type AgentConfigFetcher = (agentId: string, version: string) => Promise<Record<string, unknown>>;

/**
 * Capture the live agent's material configuration as an AgentFingerprint.
 * The version is resolved from the returned config body (so a "latest" request
 * records the concrete version actually fetched), falling back to the requested
 * version when the body omits it.
 */
export async function captureAgentFingerprint(
  fetchConfig: AgentConfigFetcher,
  agentId: string,
  version: string,
): Promise<AgentFingerprint> {
  const config = await fetchConfig(agentId, version);
  const resolvedVersion = typeof config["version"] === "string" ? config["version"] : version;
  return fingerprintFromAgentConfig(agentId, resolvedVersion, config);
}
