import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

import { ClaudeCodeSubprocessProvider } from "../src/trace-core/agent/providers/claude-code-subprocess.js";
import { AgentProviderError } from "../src/trace-core/agent/types.js";

/**
 * The provider shells out to `claude`. Tests inject a fake script via the
 * `binary` opt — much more honest than mocking child_process internals.
 * Each script reads stdin and emits a canned envelope on stdout (the same
 * shape `claude -p --output-format=json` produces).
 */

async function makeFakeClaude(body: string): Promise<{ binary: string; dir: string; cleanup: () => Promise<void> }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fake-claude-"));
  const binary = path.join(dir, "fake-claude");
  await fs.writeFile(binary, body, { mode: 0o755 });
  return {
    binary,
    dir,
    cleanup: async () => fs.rm(dir, { recursive: true, force: true }),
  };
}

const OutputSchema = z.object({ category: z.enum(["a", "b"]), reasoning: z.string() });

test("ClaudeCodeSubprocessProvider: --version probe drives isAvailable=true", async () => {
  const fake = await makeFakeClaude(`#!/usr/bin/env bash
if [ "$1" = "--version" ]; then echo "fake 0.0.1"; exit 0; fi
exit 1
`);
  try {
    const p = new ClaudeCodeSubprocessProvider({ binary: fake.binary });
    assert.equal(await p.isAvailable(), true);
  } finally { await fake.cleanup(); }
});

test("ClaudeCodeSubprocessProvider: missing binary surfaces isAvailable=false", async () => {
  const p = new ClaudeCodeSubprocessProvider({ binary: "/no/such/path/claude-x" });
  assert.equal(await p.isAvailable(), false);
});

test("ClaudeCodeSubprocessProvider: invoke parses {result: <json>} envelope on success", async () => {
  const fake = await makeFakeClaude(`#!/usr/bin/env bash
if [ "$1" = "--version" ]; then echo "fake 0.0.1"; exit 0; fi
# emit a claude-style json envelope; inner result is itself JSON
cat <<'EOF'
{"type":"result","subtype":"success","is_error":false,"result":"{\\"category\\":\\"a\\",\\"reasoning\\":\\"hello\\"}"}
EOF
exit 0
`);
  try {
    const p = new ClaudeCodeSubprocessProvider({ binary: fake.binary });
    const r = await p.invoke({ prompt: "judge me", outputSchema: OutputSchema });
    assert.equal(r.output.category, "a");
    assert.equal(r.output.reasoning, "hello");
    assert.equal(r.retryCount, 0);
    assert.equal(r.providerName, "claude-code");
  } finally { await fake.cleanup(); }
});

test("ClaudeCodeSubprocessProvider: strips markdown code fences from inner text", async () => {
  const fake = await makeFakeClaude(`#!/usr/bin/env bash
if [ "$1" = "--version" ]; then echo "fake"; exit 0; fi
cat <<'EOF'
{"type":"result","subtype":"success","is_error":false,"result":"Here is the JSON:\\n\\n\`\`\`json\\n{\\"category\\":\\"b\\",\\"reasoning\\":\\"x\\"}\\n\`\`\`"}
EOF
exit 0
`);
  try {
    const p = new ClaudeCodeSubprocessProvider({ binary: fake.binary });
    const r = await p.invoke({ prompt: "judge me", outputSchema: OutputSchema });
    assert.equal(r.output.category, "b");
  } finally { await fake.cleanup(); }
});

test("ClaudeCodeSubprocessProvider: retries on first-attempt JSON parse failure", async () => {
  // Counter-state file: bash script increments it across invocations.
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fake-claude-"));
  const counter = path.join(dir, "n");
  const binary = path.join(dir, "fake-claude");
  await fs.writeFile(counter, "0");
  await fs.writeFile(binary, `#!/usr/bin/env bash
if [ "$1" = "--version" ]; then echo "fake"; exit 0; fi
n=$(cat "${counter}")
n=$((n+1))
echo -n "$n" > "${counter}"
if [ "$n" = "1" ]; then
  # first call: broken inner
  cat <<'EOF'
{"type":"result","subtype":"success","is_error":false,"result":"not a json"}
EOF
else
  cat <<'EOF'
{"type":"result","subtype":"success","is_error":false,"result":"{\\"category\\":\\"a\\",\\"reasoning\\":\\"fixed\\"}"}
EOF
fi
exit 0
`, { mode: 0o755 });
  try {
    const p = new ClaudeCodeSubprocessProvider({ binary });
    const r = await p.invoke({ prompt: "judge me", outputSchema: OutputSchema });
    assert.equal(r.output.category, "a");
    assert.equal(r.retryCount, 1);
    // Verify the retry prompt suffix actually got sent (would be hard to
    // assert end-to-end without changing the script API, so we infer via
    // the counter — 2 invocations total).
    const finalN = await fs.readFile(counter, "utf8");
    assert.equal(finalN, "2");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("ClaudeCodeSubprocessProvider: non-zero exit becomes AgentProviderError(kind=transport)", async () => {
  const fake = await makeFakeClaude(`#!/usr/bin/env bash
if [ "$1" = "--version" ]; then echo "fake"; exit 0; fi
echo "boom" >&2
exit 2
`);
  try {
    const p = new ClaudeCodeSubprocessProvider({ binary: fake.binary });
    await assert.rejects(
      () => p.invoke({ prompt: "x", outputSchema: OutputSchema }),
      (err: unknown) => err instanceof AgentProviderError && (err as AgentProviderError).kind === "transport",
    );
  } finally { await fake.cleanup(); }
});

test("ClaudeCodeSubprocessProvider: is_error envelope surfaces as transport error", async () => {
  const fake = await makeFakeClaude(`#!/usr/bin/env bash
if [ "$1" = "--version" ]; then echo "fake"; exit 0; fi
echo '{"type":"result","subtype":"error","is_error":true,"result":"upstream timeout"}'
exit 0
`);
  try {
    const p = new ClaudeCodeSubprocessProvider({ binary: fake.binary });
    await assert.rejects(
      () => p.invoke({ prompt: "x", outputSchema: OutputSchema }),
      (err: unknown) => err instanceof AgentProviderError && (err as AgentProviderError).kind === "transport",
    );
  } finally { await fake.cleanup(); }
});

test("ClaudeCodeSubprocessProvider: timeout aborts and surfaces kind=timeout", async () => {
  const fake = await makeFakeClaude(`#!/usr/bin/env bash
if [ "$1" = "--version" ]; then echo "fake"; exit 0; fi
sleep 5
echo '{"result":"too late"}'
`);
  try {
    const p = new ClaudeCodeSubprocessProvider({ binary: fake.binary });
    await assert.rejects(
      () => p.invoke({ prompt: "x", outputSchema: OutputSchema, timeoutMs: 200 }),
      (err: unknown) => err instanceof AgentProviderError && (err as AgentProviderError).kind === "timeout",
    );
  } finally { await fake.cleanup(); }
});

test("ClaudeCodeSubprocessProvider: persistent schema mismatch (both attempts) surfaces kind=schema_violation", async () => {
  const fake = await makeFakeClaude(`#!/usr/bin/env bash
if [ "$1" = "--version" ]; then echo "fake"; exit 0; fi
cat <<'EOF'
{"type":"result","subtype":"success","is_error":false,"result":"{\\"category\\":\\"NOT_IN_ENUM\\",\\"reasoning\\":\\"x\\"}"}
EOF
exit 0
`);
  try {
    const p = new ClaudeCodeSubprocessProvider({ binary: fake.binary });
    await assert.rejects(
      () => p.invoke({ prompt: "x", outputSchema: OutputSchema }),
      (err: unknown) => err instanceof AgentProviderError && (err as AgentProviderError).kind === "schema_violation",
    );
  } finally { await fake.cleanup(); }
});
