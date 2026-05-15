// test/exp-registry.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

async function makeTmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "exp-registry-"));
}

function withConfigDir<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const prev = process.env["KWEAVERC_CONFIG_DIR"];
  process.env["KWEAVERC_CONFIG_DIR"] = dir;
  return fn().finally(() => {
    if (prev === undefined) delete process.env["KWEAVERC_CONFIG_DIR"];
    else process.env["KWEAVERC_CONFIG_DIR"] = prev;
  });
}

test("listRegistry: returns [] when file missing", async () => {
  const dir = await makeTmpDir();
  const { listRegistry } = await import("../src/trace-ai/exp/exp-store/exp-registry.js");
  const entries = await withConfigDir(dir, () => listRegistry());
  assert.deepEqual(entries, []);
});

test("upsertRegistry: creates file and adds entry", async () => {
  const dir = await makeTmpDir();
  const { upsertRegistry, listRegistry } = await import("../src/trace-ai/exp/exp-store/exp-registry.js");
  await withConfigDir(dir, async () => {
    await upsertRegistry("/some/exp/path", "2026-05-15T10:00:00.000Z");
    const entries = await listRegistry();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].path, "/some/exp/path");
    assert.equal(entries[0].last_active_ts, "2026-05-15T10:00:00.000Z");
  });
});

test("upsertRegistry: deduplicates by path, updates timestamp", async () => {
  const dir = await makeTmpDir();
  const { upsertRegistry, listRegistry } = await import("../src/trace-ai/exp/exp-store/exp-registry.js");
  await withConfigDir(dir, async () => {
    await upsertRegistry("/same/path", "2026-05-15T09:00:00.000Z");
    await upsertRegistry("/same/path", "2026-05-15T10:00:00.000Z");
    const entries = await listRegistry();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].last_active_ts, "2026-05-15T10:00:00.000Z");
  });
});

test("listRegistry: sorted by last_active_ts descending", async () => {
  const dir = await makeTmpDir();
  const { upsertRegistry, listRegistry } = await import("../src/trace-ai/exp/exp-store/exp-registry.js");
  await withConfigDir(dir, async () => {
    await upsertRegistry("/old/path", "2026-05-14T10:00:00.000Z");
    await upsertRegistry("/new/path", "2026-05-15T10:00:00.000Z");
    const entries = await listRegistry();
    assert.equal(entries[0].path, "/new/path");
    assert.equal(entries[1].path, "/old/path");
  });
});

test("upsertRegistry: swallows errors silently (read-only dir)", async () => {
  const dir = await makeTmpDir();
  const { upsertRegistry } = await import("../src/trace-ai/exp/exp-store/exp-registry.js");
  const badDir = path.join(dir, "not-a-dir");
  await fs.writeFile(badDir, "blocking file");
  await assert.doesNotReject(() =>
    withConfigDir(badDir, () => upsertRegistry("/exp/path", "2026-05-15T10:00:00.000Z"))
  );
});

test("listRegistry: returns [] on malformed JSON", async () => {
  const dir = await makeTmpDir();
  const { listRegistry } = await import("../src/trace-ai/exp/exp-store/exp-registry.js");
  await fs.writeFile(path.join(dir, "exp-registry.json"), "{ not json }", "utf8");
  const entries = await withConfigDir(dir, () => listRegistry());
  assert.deepEqual(entries, []);
});
