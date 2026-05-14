// src/trace-ai/exp/exp-store/candidate-lineage-yaml.ts
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import type { LineageEntry } from "../schemas.js";

function lineagePath(expDir: string) {
  return path.join(expDir, ".trace-state", "candidate-lineage.yaml");
}

export async function appendLineage(expDir: string, entry: Omit<LineageEntry, "appended_at">): Promise<void> {
  const p = lineagePath(expDir);
  let entries: LineageEntry[] = [];
  try {
    entries = (yaml.load(await fs.readFile(p, "utf8")) as LineageEntry[]) ?? [];
  } catch {}
  entries.push({ ...entry, appended_at: new Date().toISOString() });
  await fs.writeFile(p, yaml.dump(entries, { lineWidth: -1 }), "utf8");
}

export async function updateLineage(expDir: string, version: number, patch: Partial<LineageEntry>): Promise<void> {
  const p = lineagePath(expDir);
  const entries: LineageEntry[] = (yaml.load(await fs.readFile(p, "utf8")) as LineageEntry[]) ?? [];
  const idx = entries.findIndex(e => e.version === version);
  if (idx >= 0) Object.assign(entries[idx], patch);
  await fs.writeFile(p, yaml.dump(entries, { lineWidth: -1 }), "utf8");
}

export async function readLineage(expDir: string): Promise<LineageEntry[]> {
  try {
    return (yaml.load(await fs.readFile(lineagePath(expDir), "utf8")) as LineageEntry[]) ?? [];
  } catch {
    return [];
  }
}
