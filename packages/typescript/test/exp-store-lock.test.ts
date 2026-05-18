import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { acquireLock, releaseLock, updateHeartbeat } from "../src/trace-ai/exp/exp-store/lock.js";

async function makeTmpDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "trace-exp-lock-"));
  await fs.mkdir(path.join(dir, ".trace-state"), { recursive: true });
  return dir;
}

test("acquireLock: creates lock.json", async () => {
  const dir = await makeTmpDir();
  await acquireLock(dir);
  const raw = await fs.readFile(path.join(dir, ".trace-state", "lock.json"), "utf8");
  const lock = JSON.parse(raw);
  assert.ok(lock.pid > 0);
  assert.ok(lock.hostname.length > 0);
  await releaseLock(dir);
});

test("acquireLock: fails if fresh lock exists (heartbeat < 30s)", async () => {
  const dir = await makeTmpDir();
  await acquireLock(dir);
  await assert.rejects(() => acquireLock(dir), /locked/i);
  await releaseLock(dir);
});

test("acquireLock: steals stale lock (heartbeat > 30s)", async () => {
  const dir = await makeTmpDir();
  const stale = {
    hostname: "other-host",
    pid: 99999,
    started_at: new Date(Date.now() - 60_000).toISOString(),
    last_heartbeat_ts: new Date(Date.now() - 35_000).toISOString(),
  };
  await fs.writeFile(path.join(dir, ".trace-state", "lock.json"), JSON.stringify(stale));
  await acquireLock(dir);  // should not throw
  const raw = await fs.readFile(path.join(dir, ".trace-state", "lock.json"), "utf8");
  const lock = JSON.parse(raw);
  assert.equal(lock.pid, process.pid);
  await releaseLock(dir);
});

test("releaseLock: removes lock.json", async () => {
  const dir = await makeTmpDir();
  await acquireLock(dir);
  await releaseLock(dir);
  await assert.rejects(
    () => fs.access(path.join(dir, ".trace-state", "lock.json")),
    "lock.json should not exist after release"
  );
});

test("updateHeartbeat: updates last_heartbeat_ts", async () => {
  const dir = await makeTmpDir();
  await acquireLock(dir);
  const before = Date.now();
  await updateHeartbeat(dir);
  const raw = await fs.readFile(path.join(dir, ".trace-state", "lock.json"), "utf8");
  const lock = JSON.parse(raw);
  assert.ok(new Date(lock.last_heartbeat_ts).getTime() >= before);
  await releaseLock(dir);
});
