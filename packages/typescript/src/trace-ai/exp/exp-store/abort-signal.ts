// src/trace-ai/exp/exp-store/abort-signal.ts
import fs from "node:fs/promises";
import path from "node:path";

function signalPath(expDir: string) {
  return path.join(expDir, ".trace-state", "abort.signal");
}

export async function isAborted(expDir: string): Promise<boolean> {
  try {
    await fs.access(signalPath(expDir));
    return true;
  } catch {
    return false;
  }
}

export async function writeAbortSignal(expDir: string): Promise<void> {
  await fs.writeFile(signalPath(expDir), new Date().toISOString(), "utf8");
}

export async function clearAbortSignal(expDir: string): Promise<void> {
  try {
    await fs.unlink(signalPath(expDir));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}
