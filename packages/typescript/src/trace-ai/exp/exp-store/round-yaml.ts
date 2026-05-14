// src/trace-ai/exp/exp-store/round-yaml.ts
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import type { RoundData } from "../schemas.js";

function roundPath(expDir: string, n: number) {
  return path.join(expDir, ".trace-state", "rounds", `round-${n}.yaml`);
}

export async function writeRound(expDir: string, n: number, data: Partial<RoundData>): Promise<void> {
  const p = roundPath(expDir, n);
  await fs.mkdir(path.dirname(p), { recursive: true });
  let existing: Partial<RoundData> = {};
  try {
    existing = yaml.load(await fs.readFile(p, "utf8")) as Partial<RoundData>;
  } catch {}
  const merged = { ...existing, round: n, ...data };
  await fs.writeFile(p, yaml.dump(merged, { lineWidth: -1 }), "utf8");
}

export async function readAllRounds(expDir: string): Promise<RoundData[]> {
  const roundsDir = path.join(expDir, ".trace-state", "rounds");
  try {
    const files = await fs.readdir(roundsDir);
    const rounds: RoundData[] = [];
    for (const f of files.filter(f => f.endsWith(".yaml")).sort()) {
      const raw = await fs.readFile(path.join(roundsDir, f), "utf8");
      rounds.push(yaml.load(raw) as RoundData);
    }
    return rounds;
  } catch {
    return [];
  }
}
