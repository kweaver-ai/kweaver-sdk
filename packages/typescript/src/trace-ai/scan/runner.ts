import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";

import { ReportSchema } from "../diagnose/schemas.js";

export interface DiagnoseInvocation {
  /** Invoked by runPerTracePipeline. MUST write the per-trace yaml to `partialPath`;
   *  the runner then atomic-renames to `<conv_id>.yaml`. */
  (convId: string, partialPath: string): Promise<{ traceId: string; agentId: string | null }>;
}

export interface RunPerTracePipelineOpts {
  convId: string;
  outDir: string;
  runDiagnose: DiagnoseInvocation;
}

export interface RunPerTracePipelineResult {
  reused: boolean;
  traceId?: string;
  agentId?: string | null;
}

async function safeReadYaml(filePath: string): Promise<unknown | null> {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return yaml.load(text);
  } catch {
    return null;
  }
}

async function isValidExistingReport(filePath: string): Promise<boolean> {
  const obj = await safeReadYaml(filePath);
  if (obj === null) return false;
  return ReportSchema.safeParse(obj).success;
}

/**
 * Process one conv_id: skip if the per-trace yaml already exists and parses;
 * otherwise invoke runDiagnose (which writes to a .partial path), then
 * atomic-rename to the final path on success. Corrupt existing yaml is
 * logged + overwritten.
 */
export async function runPerTracePipeline(opts: RunPerTracePipelineOpts): Promise<RunPerTracePipelineResult> {
  const finalPath = path.join(opts.outDir, `${opts.convId}.yaml`);
  const partialPath = `${finalPath}.partial`;

  const existed = await fs.stat(finalPath).then(() => true).catch(() => false);
  if (existed) {
    if (await isValidExistingReport(finalPath)) {
      return { reused: true };
    }
    process.stderr.write(`warning: existing ${finalPath} is corrupt or schema-incompatible; re-diagnosing\n`);
    await fs.rm(finalPath, { force: true });
  }

  await fs.mkdir(opts.outDir, { recursive: true });
  const result = await opts.runDiagnose(opts.convId, partialPath);
  // Atomic rename .partial → final
  await fs.rename(partialPath, finalPath);
  return { reused: false, traceId: result.traceId, agentId: result.agentId };
}
