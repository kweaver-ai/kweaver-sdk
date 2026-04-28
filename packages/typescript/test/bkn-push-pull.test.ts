import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/** Shared BKN examples at repo root (examples/bkn/). Resolved from packages/typescript. */
const FIXTURES_ROOT = resolve(process.cwd(), "..", "..", "examples", "bkn");

let savedConfigDir: string | undefined;
before(() => {
  savedConfigDir = process.env.KWEAVERC_CONFIG_DIR;
  process.env.KWEAVERC_CONFIG_DIR = mkdtempSync(join(tmpdir(), "kweaver-bkn-push-test-"));
});
after(() => {
  if (savedConfigDir !== undefined) {
    process.env.KWEAVERC_CONFIG_DIR = savedConfigDir;
  } else {
    delete process.env.KWEAVERC_CONFIG_DIR;
  }
});

import {
  parseKnPushArgs,
  parseKnPullArgs,
  packDirectoryToTar,
  extractTarToDirectory,
  runKnCommand,
  pollWithBackoff,
} from "../src/commands/bkn.js";
import { downloadBkn, uploadBkn } from "../src/api/bkn-backend.js";

function collectBknFiles(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  const entries = readdirSync(join(dir, prefix), { withFileTypes: true });
  for (const e of entries) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) {
      out.push(...collectBknFiles(dir, rel));
    } else if (e.name.endsWith(".bkn")) {
      out.push(rel);
    }
  }
  return out.sort();
}

test("parseKnPushArgs: requires directory", () => {
  assert.throws(
    () => parseKnPushArgs([]),
    /Missing directory/
  );
});

test("parseKnPushArgs: parses directory and flags", () => {
  const opts = parseKnPushArgs(["my-bkn", "--branch", "dev", "-bd", "bd_public"]);
  assert.equal(opts.directory, "my-bkn");
  assert.equal(opts.branch, "dev");
  assert.equal(opts.businessDomain, "bd_public");
  assert.equal(opts.encodingOptions.detectEncoding, true);
  assert.equal(opts.encodingOptions.sourceEncoding, null);
});

test("parseKnPushArgs: defaults", () => {
  const opts = parseKnPushArgs(["."]);
  assert.equal(opts.directory, ".");
  assert.equal(opts.branch, "main");
  assert.equal(opts.businessDomain, "bd_public");
  assert.equal(opts.encodingOptions.detectEncoding, true);
});

test("parseKnPushArgs: encoding flags", () => {
  const opts = parseKnPushArgs(["dir", "--no-detect-encoding", "--source-encoding", "gbk"]);
  assert.equal(opts.encodingOptions.detectEncoding, false);
  assert.equal(opts.encodingOptions.sourceEncoding, "gbk");
});

test("parseKnPushArgs: --help throws", () => {
  assert.throws(() => parseKnPushArgs(["--help"]), /help/);
  assert.throws(() => parseKnPushArgs(["-h"]), /help/);
});

test("parseKnPushArgs: throws on unknown flag", () => {
  assert.throws(() => parseKnPushArgs(["dir", "--unknown"]), /Unsupported bkn push argument/);
});

test("parseKnPullArgs: requires kn-id", () => {
  assert.throws(
    () => parseKnPullArgs([]),
    /Missing kn-id/
  );
});

test("parseKnPullArgs: parses kn-id and optional directory", () => {
  const opts = parseKnPullArgs(["kn-123", "out-dir", "--branch", "main"]);
  assert.equal(opts.knId, "kn-123");
  assert.equal(opts.directory, "out-dir");
  assert.equal(opts.branch, "main");
});

test("parseKnPullArgs: defaults directory to kn-id", () => {
  const opts = parseKnPullArgs(["kn-456"]);
  assert.equal(opts.knId, "kn-456");
  assert.equal(opts.directory, "kn-456");
});

test("parseKnPullArgs: parses -bd and --biz-domain", () => {
  const opts = parseKnPullArgs(["kn-1", "-bd", "bd_custom"]);
  assert.equal(opts.businessDomain, "bd_custom");
  const opts2 = parseKnPullArgs(["kn-2", "out", "--biz-domain", "bd_other"]);
  assert.equal(opts2.businessDomain, "bd_other");
});

test("parseKnPullArgs: --help throws", () => {
  assert.throws(() => parseKnPullArgs(["--help"]), /help/);
});

test("parseKnPullArgs: throws on unknown flag", () => {
  assert.throws(() => parseKnPullArgs(["kn-1", "--unknown"]), /Unsupported bkn pull argument/);
});

test("tar pack and extract round-trip with temp dir (no examples dependency)", () => {
  const srcDir = mkdtempSync(join(tmpdir(), "bkn-push-"));
  writeFileSync(join(srcDir, "index.bkn"), "---\ntype: network\nid: test\n---\n# Test");
  writeFileSync(join(srcDir, "entities.bkn"), "---\ntype: data\n---\n# Entities");

  const tarBuffer = packDirectoryToTar(srcDir);
  assert.ok(Buffer.isBuffer(tarBuffer));
  assert.ok(tarBuffer.length > 0);

  const outDir = mkdtempSync(join(tmpdir(), "bkn-pull-"));
  extractTarToDirectory(tarBuffer, outDir);

  const before = collectBknFiles(srcDir);
  const after = collectBknFiles(outDir);
  assert.deepEqual(after, before);
  assert.equal(readFileSync(join(outDir, "index.bkn"), "utf8"), "---\ntype: network\nid: test\n---\n# Test");
  assert.equal(readFileSync(join(outDir, "entities.bkn"), "utf8"), "---\ntype: data\n---\n# Entities");
});

test("tar pack and extract round-trip for football-league", () => {
  const footballLeague = join(FIXTURES_ROOT, "football-league");
  if (!existsSync(footballLeague)) {
    test.skip("BKN examples not found at " + footballLeague);
    return;
  }

  const tarBuffer = packDirectoryToTar(footballLeague);
  assert.ok(Buffer.isBuffer(tarBuffer));
  assert.ok(tarBuffer.length > 0);

  const outDir = mkdtempSync(join(tmpdir(), "bkn-pull-"));
  extractTarToDirectory(tarBuffer, outDir);

  const before = collectBknFiles(footballLeague);
  const after = collectBknFiles(outDir);
  assert.deepEqual(after, before, "BKN files should match after round-trip");

  for (const rel of before) {
    const a = readFileSync(join(footballLeague, rel), "utf8");
    const b = readFileSync(join(outDir, rel), "utf8");
    assert.equal(b, a, `Content of ${rel} should match`);
  }
});

test("uploadBkn sends multipart/form-data POST with correct URL and headers", async () => {
  const origFetch = globalThis.fetch;
  let capturedUrl: string | null = null;
  let capturedMethod: string | null = null;
  let capturedHeaders: Headers | null = null;
  let capturedBody: unknown = null;

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    capturedUrl = typeof input === "string" ? input : input.toString();
    capturedMethod = init?.method ?? "GET";
    capturedHeaders = init?.headers instanceof Headers ? init.headers : new Headers(init?.headers as HeadersInit);
    capturedBody = init?.body;
    return new Response('{"kn_id":"test-kn-123"}', {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    await uploadBkn({
      baseUrl: "https://example.com",
      accessToken: "token-xyz",
      tarBuffer: Buffer.from("fake-tar-content"),
      businessDomain: "bd_public",
      branch: "main",
    });

    assert.ok(capturedUrl?.startsWith("https://example.com/api/bkn-backend/v1/bkns"));
    assert.ok(capturedUrl?.includes("branch=main"));
    assert.equal(capturedMethod, "POST");
    assert.equal(capturedHeaders?.get("authorization"), "Bearer token-xyz");
    assert.equal(capturedHeaders?.get("x-business-domain"), "bd_public");
    assert.ok(capturedBody instanceof FormData, "body should be FormData");
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("downloadBkn sends GET with correct URL and returns Buffer", async () => {
  const origFetch = globalThis.fetch;
  let capturedUrl: string | null = null;
  const fakeTar = Buffer.from("fake-tar-bytes");

  globalThis.fetch = async (input: RequestInfo | URL) => {
    capturedUrl = typeof input === "string" ? input : input.toString();
    return new Response(fakeTar, {
      status: 200,
      headers: { "content-type": "application/octet-stream" },
    });
  };

  try {
    const result = await downloadBkn({
      baseUrl: "https://api.example.com",
      accessToken: "token-abc",
      knId: "kn-xyz",
      businessDomain: "bd_public",
      branch: "dev",
    });

    assert.ok(capturedUrl?.startsWith("https://api.example.com/api/bkn-backend/v1/bkns/kn-xyz"));
    assert.ok(capturedUrl?.includes("branch=dev"));
    assert.ok(Buffer.isBuffer(result));
    assert.equal(result.toString(), "fake-tar-bytes");
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("tar pack and extract round-trip for k8s-network", () => {
  const k8sNetwork = join(FIXTURES_ROOT, "k8s-network");
  if (!existsSync(k8sNetwork)) {
    test.skip("BKN examples not found at " + k8sNetwork);
    return;
  }

  const tarBuffer = packDirectoryToTar(k8sNetwork);
  assert.ok(Buffer.isBuffer(tarBuffer));
  assert.ok(tarBuffer.length > 0);

  const outDir = mkdtempSync(join(tmpdir(), "bkn-pull-"));
  extractTarToDirectory(tarBuffer, outDir);

  const before = collectBknFiles(k8sNetwork);
  const after = collectBknFiles(outDir);
  assert.deepEqual(after, before, "BKN files should match after round-trip");
});

// ---------------------------------------------------------------------------
// bkn validate
// ---------------------------------------------------------------------------

test("validate: succeeds on valid k8s-network example", async () => {
  const k8sNetwork = join(FIXTURES_ROOT, "k8s-network");
  if (!existsSync(k8sNetwork)) {
    test.skip("BKN examples not found at " + k8sNetwork);
    return;
  }
  const code = await runKnCommand(["validate", k8sNetwork]);
  assert.equal(code, 0);
});

test("validate: succeeds on valid football-league example", async () => {
  const footballLeague = join(FIXTURES_ROOT, "football-league");
  if (!existsSync(footballLeague)) {
    test.skip("BKN examples not found at " + footballLeague);
    return;
  }
  const code = await runKnCommand(["validate", footballLeague]);
  assert.equal(code, 0);
});

test("validate: succeeds on valid supplychain-hd example", async () => {
  const supplychain = join(FIXTURES_ROOT, "supplychain-hd");
  if (!existsSync(supplychain)) {
    test.skip("BKN examples not found at " + supplychain);
    return;
  }
  const code = await runKnCommand(["validate", supplychain]);
  assert.equal(code, 0);
});

test("validate: fails on non-existent directory", async () => {
  const code = await runKnCommand(["validate", "/tmp/nonexistent-bkn-dir-xyz"]);
  assert.equal(code, 1);
});

test("validate: fails with no arguments", async () => {
  const code = await runKnCommand(["validate"]);
  assert.equal(code, 1);
});

test("validate: --help returns 0", async () => {
  const code = await runKnCommand(["validate", "--help"]);
  assert.equal(code, 0);
});

test("validate: fails on empty directory", async () => {
  const emptyDir = mkdtempSync(join(tmpdir(), "bkn-validate-empty-"));
  const code = await runKnCommand(["validate", emptyDir]);
  assert.equal(code, 1);
});

test("validate: fails on directory without network.bkn", async () => {
  const badDir = mkdtempSync(join(tmpdir(), "bkn-validate-bad-"));
  const otDir = join(badDir, "object_types");
  const { mkdirSync: mkdir } = await import("node:fs");
  mkdir(otDir, { recursive: true });
  writeFileSync(join(otDir, "item.bkn"), "---\ntype: object_type\nid: item\nname: Item\n---\n# Item\n");
  const code = await runKnCommand(["validate", badDir]);
  assert.equal(code, 1);
});

// ── pollWithBackoff ──────────────────────────────────────────────────────────

test("pollWithBackoff uses exponential backoff", async () => {
  const sleepDurations: number[] = [];
  let callCount = 0;

  const result = await pollWithBackoff({
    fn: async () => {
      callCount++;
      if (callCount < 3) return { done: false, value: undefined };
      return { done: true, value: "completed" };
    },
    interval: 2000,
    timeout: 60000,
    _sleep: async (ms: number) => { sleepDurations.push(ms); },
  });

  assert.equal(result, "completed");
  assert.deepEqual(sleepDurations, [2000, 4000]);
});

test("pollWithBackoff throws on timeout", async () => {
  await assert.rejects(
    () => pollWithBackoff({
      fn: async () => ({ done: false, value: undefined }),
      interval: 100,
      timeout: 0,
      _sleep: async () => {},
    }),
    /timed out/i,
  );
});

