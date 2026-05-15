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
  const lock: LockData = {
    hostname: os.hostname(),
    pid: process.pid,
    started_at: new Date().toISOString(),
    last_heartbeat_ts: new Date().toISOString(),
  };
  const data = JSON.stringify(lock, null, 2);

  // O_EXCL: atomic create — fails with EEXIST if a lock file already exists.
  try {
    await fs.writeFile(p, data, { encoding: "utf8", flag: "wx" });
    return;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  }

  // Lock file exists — check freshness.
  let existing: LockData;
  try {
    existing = JSON.parse(await fs.readFile(p, "utf8")) as LockData;
  } catch {
    // Unreadable lock (e.g. partial write) — treat as stale.
    existing = { hostname: "", pid: 0, started_at: "", last_heartbeat_ts: new Date(0).toISOString() };
  }
  const age = Date.now() - new Date(existing.last_heartbeat_ts).getTime();
  if (age < STALE_THRESHOLD_MS) {
    throw new Error(
      `Experiment is locked by pid ${existing.pid} on ${existing.hostname} (heartbeat ${Math.floor(age / 1000)}s ago). Use exp resume or wait.`
    );
  }

  // Stale — unlink then retry O_EXCL. If another process beats us here, we'll
  // get EEXIST again and throw a clear error rather than silently overwriting.
  await fs.unlink(p).catch(() => { /* already gone is fine */ });
  try {
    await fs.writeFile(p, data, { encoding: "utf8", flag: "wx" });
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error("Lock acquired by another process during stale recovery. Try again.");
    }
    throw err;
  }
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
