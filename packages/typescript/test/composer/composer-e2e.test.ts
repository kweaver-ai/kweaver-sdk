/**
 * E2E: Composer engine full pipeline — real API calls, no mocks.
 *
 * Tests the complete lifecycle:
 *   1. buildConfigFromPrompt → validate → compile (pure logic)
 *   2. createAgents → platform creates real agents + orchestrator
 *   3. Single agent chat (non-DPH) — verifies agent creation was correct
 *   4. cleanupAgents → deletes all created agents
 *
 * Note: DPH orchestrator execution (multi-agent routing) requires publish
 * permission on the platform. The orchestrator agent is created and verified
 * structurally, but the DPH run test is skipped when publish is unavailable.
 *
 * Run:
 *   bun test test/composer/composer-e2e.test.ts
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";

import { ensureValidToken } from "../../src/auth/oauth.js";
import { resolveBusinessDomain } from "../../src/config/store.js";
import { fetchAgentInfo, sendChatRequestStream } from "../../src/api/agent-chat.js";
import {
  buildConfigFromPrompt,
  createAgents,
  runOrchestrator,
  cleanupAgents,
  type TokenProvider,
  type ComposerConfig,
  type CreateResult,
} from "../../src/commands/composer-engine.js";
import { validateFlow, compileToDph } from "../../src/commands/composer-flow.js";

// ── Auth setup (top-level await so `canRun` is resolved before describe) ───

let canRun = false;
let getToken: TokenProvider = () => { throw new Error("auth not initialized"); };
let businessDomain = "bd_public";

try {
  const t = await ensureValidToken();
  canRun = true;
  getToken = () => ensureValidToken();
  businessDomain = resolveBusinessDomain("") || "bd_public";
  console.error(`[composer-e2e] Connected to ${t.baseUrl}, bd=${businessDomain}`);
} catch (err) {
  console.error(`[composer-e2e] Skipping: no valid auth token (${err instanceof Error ? err.message : err})`);
}

// ── Test: full pipeline with code-development template ─────────────────────

describe("e2e: composer engine pipeline", () => {
  let config: ComposerConfig;
  let createResult: CreateResult;

  // Step 1: build + validate + compile (pure logic, but uses real template)
  it("builds config, validates flow, compiles DPH", { skip: !canRun }, () => {
    config = buildConfigFromPrompt("implement a fibonacci function");

    // Should pick code-development template
    assert.equal(config.agents.length, 3);
    const refs = config.agents.map((a) => a.ref);
    assert.ok(refs.includes("architect"));
    assert.ok(refs.includes("developer"));
    assert.ok(refs.includes("reviewer"));

    // Validate flow
    const errors = validateFlow(config.orchestrator.flow!, refs);
    assert.deepEqual(errors, [], `Flow validation: ${errors.join(", ")}`);

    // Compile to DPH
    const compiled = compileToDph(config.orchestrator.flow!);
    assert.ok(compiled.dph.length > 0, "DPH should not be empty");
    assert.equal(compiled.answerVar, "reviewer");
    console.error(`[composer-e2e] DPH (${compiled.dph.split("\n").length} lines):\n${compiled.dph}`);
  });

  // Step 2: create real agents on platform
  it("creates 3 sub-agents + 1 orchestrator on platform", { skip: !canRun, timeout: 60000 }, async () => {
    assert.ok(config, "config required from step 1");

    createResult = await createAgents(config, getToken, businessDomain);

    assert.ok(createResult.orchestratorId, "orchestratorId");
    assert.ok(createResult.agentIds.architect, "architect id");
    assert.ok(createResult.agentIds.developer, "developer id");
    assert.ok(createResult.agentIds.reviewer, "reviewer id");
    assert.equal(createResult.allAgentIds.length, 4);

    console.error(`[composer-e2e] Created: ${JSON.stringify(createResult.agentIds)}`);
    console.error(`[composer-e2e] Orchestrator: ${createResult.orchestratorId}`);
  });

  // Step 3: verify sub-agent is callable (direct chat, not via DPH)
  it("sub-agent responds to direct chat", { skip: !canRun, timeout: 60000 }, async () => {
    assert.ok(createResult?.agentIds?.architect, "architect id required from step 2");

    const t = await getToken();
    const info = await fetchAgentInfo({
      baseUrl: t.baseUrl,
      accessToken: t.accessToken,
      agentId: createResult.agentIds.architect,
      version: "v0",
      businessDomain,
    });

    let fullText = "";
    await sendChatRequestStream(
      {
        baseUrl: t.baseUrl,
        accessToken: t.accessToken,
        agentId: info.id,
        agentKey: info.key,
        agentVersion: info.version,
        query: "Design a simple key-value store API. Reply in under 100 words.",
        stream: true,
        businessDomain,
      },
      { onTextDelta: (ft) => { fullText = ft; } },
    );

    console.error(`[composer-e2e] Architect response (${fullText.length} chars): ${fullText.slice(0, 200)}...`);
    assert.ok(fullText.length > 20, `Sub-agent response too short (${fullText.length} chars): ${fullText}`);
  });

  // Step 4: verify orchestrator config was stored correctly
  it("orchestrator has correct DPH config on platform", { skip: !canRun, timeout: 15000 }, async () => {
    assert.ok(createResult?.orchestratorId, "orchestrator id required");

    const t = await getToken();
    const url = `${t.baseUrl}/api/agent-factory/v3/agent-market/agent/${createResult.orchestratorId}/version/v0?is_visit=true`;
    const resp = await fetch(url, {
      headers: {
        accept: "application/json",
        Authorization: `Bearer ${t.accessToken}`,
        "x-business-domain": businessDomain,
      },
    });
    assert.ok(resp.ok, `Failed to fetch orchestrator: ${resp.status}`);

    const data = await resp.json() as { config?: Record<string, unknown> };
    const storedConfig = data.config ?? {};

    assert.equal(storedConfig.is_dolphin_mode, 1, "should be dolphin mode");
    assert.ok(typeof storedConfig.dolphin === "string" && (storedConfig.dolphin as string).length > 0, "dolphin script should be non-empty");

    const skills = storedConfig.skills as { agents?: unknown[] } | undefined;
    assert.ok(skills?.agents && skills.agents.length === 3, `should have 3 sub-agent skills, got ${skills?.agents?.length}`);

    const output = storedConfig.output as { variables?: { answer_var?: string } } | undefined;
    assert.equal(output?.variables?.answer_var, "reviewer", "answer_var should be reviewer");

    console.error(`[composer-e2e] Orchestrator DPH stored: ${(storedConfig.dolphin as string).slice(0, 200)}`);
  });

  // Step 5: orchestrator DPH routing produces real streamed text
  it("orchestrator returns response via DPH routing", { skip: !canRun, timeout: 300000 }, async () => {
    assert.ok(createResult?.orchestratorId, "orchestrator required");

    let fullText = "";
    const result = await runOrchestrator(
      createResult.orchestratorId,
      "Write a hello world function. Keep it very short.",
      getToken,
      businessDomain,
      { onTextDelta: (ft) => { fullText = ft; } },
    );

    console.error(`[composer-e2e] Orchestrator response: ${fullText.length} chars — ${fullText.slice(0, 200)}…`);
    assert.ok(fullText.length > 100, `Response too short (${fullText.length} chars): ${fullText}`);
    assert.ok(result.conversationId.length > 0, "should have conversation ID");
  });

  // Cleanup: always delete all created agents
  after(async () => {
    if (!createResult?.allAgentIds?.length) return;

    console.error(`[composer-e2e] Cleaning up ${createResult.allAgentIds.length} agents...`);
    const result = await cleanupAgents(createResult.allAgentIds, getToken, businessDomain);
    console.error(`[composer-e2e] Deleted: ${result.deleted.length}, errors: ${result.errors.length}`);

    if (result.deleted.length < createResult.allAgentIds.length) {
      console.error(
        `[composer-e2e] WARNING: only deleted ${result.deleted.length}/${createResult.allAgentIds.length} agents. ` +
        `Remaining agents may need manual cleanup.`,
      );
      for (const e of result.errors) {
        console.error(`[composer-e2e]   cleanup error: ${e.agentId} → ${e.error}`);
      }
    }
  });
});
