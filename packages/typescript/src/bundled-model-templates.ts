/**
 * Static JSON templates shipped with the CLI under ``src/templates/model`` (copied to ``dist/templates/model``).
 * Read-only convenience until mf-model-manager exposes template APIs.
 */

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface BundledModelTemplateEntry {
  id: string;
  file: string;
  summary: string;
}

export interface BundledModelTemplateManifest {
  llm: BundledModelTemplateEntry[];
  small: BundledModelTemplateEntry[];
}

/** Resolve ``…/dist/templates/model`` (or ``…/src/templates/model`` when running via tsx from src). */
export function bundledModelTemplatesDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "templates", "model");
}

export async function loadBundledModelTemplateManifest(): Promise<BundledModelTemplateManifest> {
  const raw = await readFile(join(bundledModelTemplatesDir(), "manifest.json"), "utf-8");
  return JSON.parse(raw) as BundledModelTemplateManifest;
}

export async function readBundledModelTemplateFile(branch: "llm" | "small", templateId: string): Promise<string> {
  const manifest = await loadBundledModelTemplateManifest();
  const entries = branch === "llm" ? manifest.llm : manifest.small;
  const hit = entries.find((e) => e.id === templateId);
  if (!hit) {
    throw new Error(
      `Unknown bundled template "${templateId}". Run: kweaver model ${branch} --template`,
    );
  }
  return readFile(join(bundledModelTemplatesDir(), hit.file), "utf-8");
}
