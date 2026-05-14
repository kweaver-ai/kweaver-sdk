import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

interface LockData {
  hostname: string;
  pid: number;
  started_at: string;
  last_heartbeat_ts: string;
}

const STALE_THRESHOLD_MS = 30_000;

function lockPath(expDir: string) {
  return path.join(expDir, ".trace-state", "lock.json");
}

export async function acquireLock(expDir: string): Promise<void> {
  const p = lockPath(expDir);
  try {
    const raw = await fs.readFile(p, "utf8");
    const existing = JSON.parse(raw) as LockData;
    const age = Date.now() - new Date(existing.last_heartbeat_ts).getTime();
    if (age < STALE_THRESHOLD_MS) {
      throw new Error(
        `Experiment is locked by pid ${existing.pid} on ${existing.hostname} (heartbeat ${Math.floor(age / 1000)}s ago). Use exp resume or wait.`
      );
    }
    // Stale — fall through to overwrite
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    // No lock file — fall through to create
  }

  const lock: LockData = {
    hostname: os.hostname(),
    pid: process.pid,
    started_at: new Date().toISOString(),
    last_heartbeat_ts: new Date().toISOString(),
  };
  await fs.writeFile(p, JSON.stringify(lock, null, 2), "utf8");
}

export async function releaseLock(expDir: string): Promise<void> {
  try {
    await fs.unlink(lockPath(expDir));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

export async function updateHeartbeat(expDir: string): Promise<void> {
  const p = lockPath(expDir);
  try {
    const raw = await fs.readFile(p, "utf8");
    const lock = JSON.parse(raw) as LockData;
    lock.last_heartbeat_ts = new Date().toISOString();
    await fs.writeFile(p, JSON.stringify(lock, null, 2), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}
