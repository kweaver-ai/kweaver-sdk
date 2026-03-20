/**
 * E2E: Agent CRUD lifecycle — create → get → update → publish → unpublish → delete.
 *
 * All tests are destructive (create/modify/delete real resources).
 * Requires: E2E_RUN_DESTRUCTIVE=1 and a valid auth token.
 *
 * The test auto-discovers an available LLM model from the model-factory
 * so it doesn't need a hardcoded model ID.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { runCli, shouldSkipE2e, shouldRunDestructive } from "./setup.js";
import { KWeaverClient } from "../../src/index.js";

const skip = !shouldRunDestructive() || shouldSkipE2e();
const TEST_PREFIX = `sdk_e2e_${Date.now()}`;

// ── Helper: discover first LLM model from model-factory ──────────────────────

async function findLlmModel(): Promise<{ model_id: string; model_name: string } | null> {
  let client: KWeaverClient;
  try {
    client = await KWeaverClient.connect();
  } catch {
    try { client = new KWeaverClient(); } catch { return null; }
  }
  const { baseUrl, accessToken } = client.base();
  const resp = await fetch(`${baseUrl}/api/mf-model-manager/v1/llm/list?page=1&size=100`, {
    headers: { authorization: `Bearer ${accessToken}`, token: accessToken },
  });
  if (!resp.ok) return null;
  const data = await resp.json() as { data?: Array<{ model_id: string; model_name: string; model_type: string }> };
  const llm = (data.data ?? []).find(m => m.model_type === "llm");
  return llm ? { model_id: llm.model_id, model_name: llm.model_name } : null;
}

// ── State shared across ordered tests ────────────────────────────────────────

let createdAgentId = "";
let createdAgentKey = "";

// ── Tests (order matters) ────────────────────────────────────────────────────

test("e2e: agent create via CLI", { skip }, async () => {
  const llm = await findLlmModel();
  if (!llm) {
    test.skip("no LLM model available in model-factory");
    return;
  }

  createdAgentKey = `${TEST_PREFIX}_key`;

  const { code, stdout, stderr } = await runCli([
    "agent", "create",
    "--name", `${TEST_PREFIX}_agent`,
    "--profile", "E2E test agent — will be deleted",
    "--key", createdAgentKey,
    "--system-prompt", "你是一个测试助手",
    "--llm-id", llm.model_id,
  ]);
  assert.equal(code, 0, `create failed: ${stderr}`);
  const result = JSON.parse(stdout) as { id?: string; version?: string };
  assert.ok(result.id, "create should return agent id");
  createdAgentId = result.id;
});

test("e2e: agent get returns created agent", { skip }, async () => {
  if (!createdAgentId) { test.skip("no agent created"); return; }

  const { code, stdout } = await runCli(["agent", "get", createdAgentId]);
  assert.equal(code, 0);
  const agent = JSON.parse(stdout) as Record<string, unknown>;
  assert.ok(String(agent.name).includes(TEST_PREFIX));
});

test("e2e: agent get-by-key returns same agent", { skip }, async () => {
  if (!createdAgentKey) { test.skip("no agent created"); return; }

  const { code, stdout } = await runCli(["agent", "get-by-key", createdAgentKey]);
  assert.equal(code, 0);
  const agent = JSON.parse(stdout) as Record<string, unknown>;
  assert.equal(agent.id, createdAgentId);
});

test("e2e: agent update changes name", { skip }, async () => {
  if (!createdAgentId) { test.skip("no agent created"); return; }

  const newName = `${TEST_PREFIX}_updated`;
  const { code, stderr } = await runCli([
    "agent", "update", createdAgentId,
    "--name", newName,
  ]);
  assert.equal(code, 0, `update failed: ${stderr}`);

  // Verify update
  const { stdout } = await runCli(["agent", "get", createdAgentId]);
  const agent = JSON.parse(stdout) as Record<string, unknown>;
  assert.equal(agent.name, newName);
});

// Known backend bug: publish crashes with nil pointer in umhttpaccess/names.go:32
// when the UM (user management) service returns (nil, nil).
// See: agent-factory FillPublishedByName → GetUserIDNameMap → GetOsnNames
// TODO: re-enable after decision-agent fixes nil check in names.go
test("e2e: agent publish", { skip, todo: "backend bug: nil pointer in FillPublishedByName" }, async () => {
  if (!createdAgentId) { test.skip("no agent created"); return; }

  const { code, stdout, stderr } = await runCli(["agent", "publish", createdAgentId]);
  assert.equal(code, 0, `publish failed: ${stderr}`);
  const result = JSON.parse(stdout) as Record<string, unknown>;
  assert.ok(result.version || result.release_id, "publish should return version or release_id");
});

test("e2e: published agent appears in list", { skip, todo: "depends on publish (backend bug)" }, async () => {
  if (!createdAgentId) { test.skip("no agent created"); return; }

  const { code, stdout } = await runCli(["agent", "list", "--limit", "100"]);
  assert.equal(code, 0);
  const list = JSON.parse(stdout) as Array<{ id?: string }>;
  const found = list.some(a => a.id === createdAgentId);
  assert.ok(found, "created agent should appear in published list");
});

test("e2e: agent unpublish", { skip, todo: "depends on publish (backend bug)" }, async () => {
  if (!createdAgentId) { test.skip("no agent created"); return; }

  const { code, stderr } = await runCli(["agent", "unpublish", createdAgentId]);
  assert.equal(code, 0, `unpublish failed: ${stderr}`);
});

test("e2e: agent delete", { skip }, async () => {
  if (!createdAgentId) { test.skip("no agent created"); return; }

  const { code, stderr } = await runCli(["agent", "delete", createdAgentId, "-y"]);
  assert.equal(code, 0, `delete failed: ${stderr}`);

  // Verify deleted
  const { code: getCode } = await runCli(["agent", "get", createdAgentId]);
  assert.notEqual(getCode, 0, "get should fail after delete");
  createdAgentId = "";
});
