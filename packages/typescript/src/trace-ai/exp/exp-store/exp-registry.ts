// src/trace-ai/exp/exp-store/exp-registry.ts
import fs from "node:fs/promises";
import path from "node:path";
import { getConfigDir } from "../../../config/store.js";

export interface RegistryEntry {
  path: string;
  last_active_ts: string;
}

interface Registry {
  schema_version: "exp-registry/v1";
  entries: RegistryEntry[];
}

function registryFilePath(): string {
  return path.join(getConfigDir(), "exp-registry.json");
}

async function readRegistry(): Promise<Registry> {
  try {
    const raw = await fs.readFile(registryFilePath(), "utf8");
    const parsed = JSON.parse(raw) as Registry;
    if (!Array.isArray(parsed.entries)) return { schema_version: "exp-registry/v1", entries: [] };
    return parsed;
  } catch {
    return { schema_version: "exp-registry/v1", entries: [] };
  }
}

export async function upsertRegistry(absPath: string, ts: string): Promise<void> {
  try {
    const reg = await readRegistry();
    const idx = reg.entries.findIndex((e) => e.path === absPath);
    if (idx >= 0) {
      reg.entries[idx].last_active_ts = ts;
    } else {
      reg.entries.push({ path: absPath, last_active_ts: ts });
    }
    const filePath = registryFilePath();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(reg, null, 2) + "\n", "utf8");
  } catch (e) {
    process.stderr.write(`warn: exp-registry write failed: ${(e as Error).message}\n`);
  }
}

export async function listRegistry(): Promise<RegistryEntry[]> {
  const reg = await readRegistry();
  return [...reg.entries].sort((a, b) =>
    b.last_active_ts.localeCompare(a.last_active_ts)
  );
}
