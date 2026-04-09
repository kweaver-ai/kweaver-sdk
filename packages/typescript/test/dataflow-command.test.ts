import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { runDataflowCommand } from "../src/commands/dataflow.js";

function createConfigDir(): string {
  return mkdtempSync(join(tmpdir(), "kweaver-dataflow-cmd-"));
}

async function importStoreModule(configDir: string) {
  process.env.KWEAVERC_CONFIG_DIR = configDir;
  const moduleUrl = pathToFileURL(join(process.cwd(), "src/config/store.ts")).href;
  return import(`${moduleUrl}?t=${Date.now()}-${Math.random()}`);
}

async function setupToken(configDir: string, baseUrl = "https://mock.kweaver.test"): Promise<void> {
  const store = await importStoreModule(configDir);
  store.saveTokenConfig({
    baseUrl,
    accessToken: "token-abc",
    tokenType: "Bearer",
    scope: "openid offline all",
    obtainedAt: new Date().toISOString(),
  });
  store.setCurrentPlatform(baseUrl);
}

async function runCommand(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...values: unknown[]) => stdout.push(values.map(String).join(" "));
  console.error = (...values: unknown[]) => stderr.push(values.map(String).join(" "));
  try {
    const code = await runDataflowCommand(args);
    return { code, stdout: stdout.join("\n"), stderr: stderr.join("\n") };
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
}

test("dataflow list renders selected summary fields", async () => {
  const configDir = createConfigDir();
  await setupToken(configDir);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        dags: [
          {
            id: "dag-001",
            title: "Demo",
            status: "normal",
            trigger: "event",
            creator: "Celia",
            updated_at: 1775616096,
            version_id: "v-001",
          },
        ],
      }),
      { status: 200 },
    );

  try {
    const result = await runCommand(["list"]);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /dag-001/);
    assert.match(result.stdout, /Demo/);
    assert.match(result.stdout, /normal/);
    assert.match(result.stdout, /event/);
    assert.match(result.stdout, /Celia/);
    assert.match(result.stdout, /1775616096/);
    assert.match(result.stdout, /v-001/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("dataflow run --file validates the file and prints dag_instance_id", async () => {
  const configDir = createConfigDir();
  await setupToken(configDir);
  const filePath = join(configDir, "demo.pdf");
  writeFileSync(filePath, "demo");

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    assert.ok(init?.body instanceof FormData);
    return new Response(JSON.stringify({ dag_instance_id: "ins-001" }), { status: 200 });
  };

  try {
    const result = await runCommand(["run", "dag-001", "--file", filePath]);
    assert.equal(result.code, 0);
    assert.equal(result.stdout.trim(), "ins-001");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("dataflow run --url --name prints dag_instance_id", async () => {
  const configDir = createConfigDir();
  await setupToken(configDir);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    assert.equal(
      init?.body,
      JSON.stringify({ source_from: "remote", url: "https://example.com/demo.pdf", name: "demo.pdf" }),
    );
    return new Response(JSON.stringify({ dag_instance_id: "ins-remote-001" }), { status: 200 });
  };

  try {
    const result = await runCommand([
      "run",
      "dag-001",
      "--url",
      "https://example.com/demo.pdf",
      "--name",
      "demo.pdf",
    ]);
    assert.equal(result.code, 0);
    assert.equal(result.stdout.trim(), "ins-remote-001");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("dataflow run rejects invalid source argument combinations", async () => {
  const configDir = createConfigDir();
  await setupToken(configDir);

  const missing = await runCommand(["run", "dag-001"]);
  assert.equal(missing.code, 1);

  const both = await runCommand([
    "run",
    "dag-001",
    "--file",
    "/tmp/demo.pdf",
    "--url",
    "https://example.com/demo.pdf",
    "--name",
    "demo.pdf",
  ]);
  assert.equal(both.code, 1);

  const missingName = await runCommand([
    "run",
    "dag-001",
    "--url",
    "https://example.com/demo.pdf",
  ]);
  assert.equal(missingName.code, 1);
});

test("dataflow runs renders selected run summary fields", async () => {
  const configDir = createConfigDir();
  await setupToken(configDir);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        results: [
          {
            id: "run-001",
            status: "success",
            started_at: 1775616539,
            ended_at: 1775616845,
            source: {
              name: "Lewis_Hamilton.pdf",
              content_type: "application/pdf",
              size: 5930061,
            },
            reason: null,
          },
        ],
      }),
      { status: 200 },
    );

  try {
    const result = await runCommand(["runs", "dag-001"]);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /run-001/);
    assert.match(result.stdout, /success/);
    assert.match(result.stdout, /1775616539/);
    assert.match(result.stdout, /1775616845/);
    assert.match(result.stdout, /Lewis_Hamilton\.pdf/);
    assert.match(result.stdout, /application\/pdf/);
    assert.match(result.stdout, /5930061/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("dataflow logs fetches pages internally and prints compact log blocks", async () => {
  const configDir = createConfigDir();
  await setupToken(configDir);
  const seenUrls: string[] = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input.toString();
    seenUrls.push(url);
    if (url.includes("page=0")) {
      return new Response(
        JSON.stringify({
          total: 2,
          results: [
            {
              id: "0",
              operator: "@trigger/dataflow-doc",
              started_at: 1775616541,
              updated_at: 1775616541,
              status: "success",
              inputs: {},
              outputs: { _type: "file", name: "Lewis_Hamilton.pdf" },
              taskId: "0",
              metadata: { duration: 0 },
            },
          ],
        }),
        { status: 200 },
      );
    }

    if (url.includes("page=1")) {
      return new Response(
        JSON.stringify({
          total: 2,
          results: [
            {
              id: "1",
              operator: "@content/file_parse",
              started_at: 1775616542,
              updated_at: 1775616545,
              status: "success",
              inputs: { name: "Lewis_Hamilton.pdf" },
              outputs: { text: "parsed" },
              taskId: "1",
              metadata: { duration: 3 },
            },
          ],
        }),
        { status: 200 },
      );
    }

    return new Response(JSON.stringify({ total: 2, results: [] }), { status: 200 });
  };

  try {
    const result = await runCommand(["logs", "dag-001", "ins-001"]);
    assert.equal(result.code, 0);
    assert.equal(seenUrls.length, 3);
    assert.match(result.stdout, /\[0\] success @trigger\/dataflow-doc started_at=1775616541 updated_at=1775616541 duration=0 taskId=0/);
    assert.match(result.stdout, /input: \{\}/);
    assert.match(result.stdout, /output: \{"_type":"file","name":"Lewis_Hamilton\.pdf"\}/);
    assert.match(result.stdout, /\[1\] success @content\/file_parse started_at=1775616542 updated_at=1775616545 duration=3 taskId=1/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
