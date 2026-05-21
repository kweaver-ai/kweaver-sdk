// src/trace-ai/exp/exp-store/expected-fingerprint.ts
//
// The loop-owned record of the agent configuration last seen under test.
// Re-captured by the preflight step every round (never hand-edited) — it is the
// per-round provenance fingerprint of exactly what config the round measured.
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import type { AgentFingerprint } from "../preflight.js";

function fingerprintPath(expDir: string): string {
  return path.join(expDir, ".trace-state", "expected-fingerprint.yaml");
}

export async function writeExpectedFingerprint(expDir: string, fingerprint: AgentFingerprint): Promise<void> {
  const p = fingerprintPath(expDir);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, yaml.dump(fingerprint, { lineWidth: -1 }), "utf8");
}

export async function readExpectedFingerprint(expDir: string): Promise<AgentFingerprint | undefined> {
  try {
    const raw = await fs.readFile(fingerprintPath(expDir), "utf8");
    const parsed = yaml.load(raw) as AgentFingerprint;
    // Fingerprints written before non_fixed_kn_bindings existed lack the field;
    // normalize so consumers can rely on it always being an array.
    if (parsed && !Array.isArray(parsed.non_fixed_kn_bindings)) {
      parsed.non_fixed_kn_bindings = [];
    }
    return parsed;
  } catch {
    return undefined;
  }
}
