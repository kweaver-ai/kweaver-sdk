import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  getTemplates,
  buildConfigFromPrompt,
  buildAgentCreateBody,
  extractJsonFromLLMResponse,
  validateComposerConfig,
  sanitizeAgentName,
} from "../../src/commands/composer-engine.js";

// ── 1. getTemplates ──────────────────────────────────────────────────────────

describe("getTemplates", () => {
  it("returns 3 or more templates", () => {
    const templates = getTemplates();
    assert.ok(templates.length >= 3, `expected >=3 templates, got ${templates.length}`);
  });

  it("each template has id, name, description, and config", () => {
    for (const t of getTemplates()) {
      assert.ok(typeof t.id === "string" && t.id.length > 0, "template.id must be a non-empty string");
      assert.ok(typeof t.name === "string" && t.name.length > 0, "template.name must be a non-empty string");
      assert.ok(typeof t.description === "string", "template.description must be a string");
      assert.ok(t.config && typeof t.config === "object", "template.config must be an object");
      assert.ok(typeof t.config.name === "string", "config.name must be a string");
      assert.ok(Array.isArray(t.config.agents), "config.agents must be an array");
      assert.ok(t.config.orchestrator && typeof t.config.orchestrator === "object", "config.orchestrator must be an object");
    }
  });
});

// ── 2. buildConfigFromPrompt ─────────────────────────────────────────────────

describe("buildConfigFromPrompt", () => {
  it("research keywords → research-synthesize template agents", () => {
    const config = buildConfigFromPrompt("research and analyze market trends");
    // research template has researcher_a, researcher_b, synthesizer
    const refs = config.agents.map((a) => a.ref);
    assert.ok(refs.includes("researcher_a") || refs.includes("synthesizer"), "expected research template agents");
  });

  it("code keywords → code-development template agents", () => {
    const config = buildConfigFromPrompt("implement a new TypeScript feature");
    const refs = config.agents.map((a) => a.ref);
    assert.ok(refs.includes("architect") || refs.includes("developer"), "expected code template agents");
  });

  it("description is set from the prompt", () => {
    const prompt = "build a recommendation engine";
    const config = buildConfigFromPrompt(prompt);
    assert.strictEqual(config.description, prompt);
  });

  it("config has required fields", () => {
    const config = buildConfigFromPrompt("something interesting");
    assert.ok(typeof config.name === "string" && config.name.length > 0);
    assert.ok(Array.isArray(config.agents));
    assert.ok(config.orchestrator && typeof config.orchestrator === "object");
  });
});

// ── 3. buildAgentCreateBody ──────────────────────────────────────────────────

describe("buildAgentCreateBody", () => {
  it("returns valid JSON string with name, profile, config.system_prompt", () => {
    const body = buildAgentCreateBody("My Agent", "My profile", "You are helpful.");
    const parsed = JSON.parse(body) as Record<string, unknown>;
    assert.ok(typeof parsed.name === "string");
    assert.ok(typeof parsed.profile === "string");
    const config = parsed.config as Record<string, unknown>;
    assert.strictEqual(config.system_prompt, "You are helpful.");
  });

  it("sanitizes agent name", () => {
    const body = buildAgentCreateBody("My Agent Name!", "p", "s");
    const parsed = JSON.parse(body) as { name: string };
    // should replace non-alphanum/underscore with _
    assert.ok(!/[^a-zA-Z0-9_\u4e00-\u9fff]/.test(parsed.name), `name should be sanitized: ${parsed.name}`);
  });

  it("dolphin mode: is_dolphin_mode=1 sets flag in config", () => {
    const body = buildAgentCreateBody("Orchestrator", "orch", "You orchestrate.", { is_dolphin_mode: 1, dolphin: "script" });
    const parsed = JSON.parse(body) as { config: Record<string, unknown> };
    assert.strictEqual(parsed.config.is_dolphin_mode, 1);
    assert.strictEqual(parsed.config.dolphin, "script");
    // dolphin mode should not have pre_dolphin steps
    const pre = parsed.config.pre_dolphin as unknown[];
    assert.strictEqual(pre.length, 0);
  });

  it("non-dolphin mode: pre_dolphin has context_organize", () => {
    const body = buildAgentCreateBody("Agent", "p", "s");
    const parsed = JSON.parse(body) as { config: Record<string, unknown> };
    const pre = parsed.config.pre_dolphin as Array<{ key: string }>;
    assert.ok(pre.some((p) => p.key === "context_organize"));
  });

  it("LLMs are included when provided", () => {
    const llms = [{ is_default: true, llm_config: { id: "test-model", name: "test-model" } }];
    const body = buildAgentCreateBody("Agent", "p", "s", undefined, llms);
    const parsed = JSON.parse(body) as { config: Record<string, unknown> };
    assert.ok(Array.isArray(parsed.config.llms));
    assert.strictEqual((parsed.config.llms as unknown[]).length, 1);
  });
});

// ── 4. extractJsonFromLLMResponse ────────────────────────────────────────────

describe("extractJsonFromLLMResponse", () => {
  it("extracts JSON from markdown code block (```json)", () => {
    const text = '```json\n{"name":"test","agents":[],"orchestrator":{"name":"o","system_prompt":"s","dolphin":"d"}}\n```';
    const result = extractJsonFromLLMResponse(text);
    assert.ok(result !== null);
    assert.strictEqual(result!.name, "test");
  });

  it("extracts JSON from plain markdown code block (```)", () => {
    const text = '```\n{"name":"test2","agents":[],"orchestrator":{"name":"o","system_prompt":"s","dolphin":"d"}}\n```';
    const result = extractJsonFromLLMResponse(text);
    assert.ok(result !== null);
    assert.strictEqual(result!.name, "test2");
  });

  it("extracts raw JSON without code block", () => {
    const text = 'Here is the config: {"name":"raw","agents":[],"orchestrator":{"name":"o","system_prompt":"s","dolphin":"d"}} done.';
    const result = extractJsonFromLLMResponse(text);
    assert.ok(result !== null);
    assert.strictEqual(result!.name, "raw");
  });

  it("returns null for invalid/non-JSON input", () => {
    const result = extractJsonFromLLMResponse("This is just text with no JSON");
    assert.strictEqual(result, null);
  });

  it("returns null for malformed JSON", () => {
    const result = extractJsonFromLLMResponse("```json\n{invalid json here}\n```");
    assert.strictEqual(result, null);
  });
});

// ── 5. validateComposerConfig ────────────────────────────────────────────────

describe("validateComposerConfig", () => {
  const validFlow = {
    name: "Test",
    description: "desc",
    agents: [{ ref: "agent_a", name: "Agent A", profile: "p", system_prompt: "s" }],
    orchestrator: {
      name: "Orchestrator",
      system_prompt: "You orchestrate.",
      flow: { do: [{ call: "agent_a", input: "$query" }] },
    },
  };

  const validDolphin = {
    name: "Test2",
    description: "desc2",
    agents: [],
    orchestrator: {
      name: "Orchestrator2",
      system_prompt: "You orchestrate.",
      dolphin: "some script",
    },
  };

  it("valid config with flow → true", () => {
    assert.strictEqual(validateComposerConfig(validFlow), true);
  });

  it("valid config with dolphin → true", () => {
    assert.strictEqual(validateComposerConfig(validDolphin), true);
  });

  it("missing agents array → false", () => {
    const bad = { ...validFlow, agents: undefined };
    assert.strictEqual(validateComposerConfig(bad), false);
  });

  it("null → false", () => {
    assert.strictEqual(validateComposerConfig(null), false);
  });

  it("orchestrator with neither flow nor dolphin → false", () => {
    const bad = {
      name: "Test",
      agents: [],
      orchestrator: { name: "O", system_prompt: "s" },
    };
    assert.strictEqual(validateComposerConfig(bad), false);
  });

  it("agent missing ref → false", () => {
    const bad = {
      name: "Test",
      agents: [{ name: "Agent", profile: "p", system_prompt: "s" }], // missing ref
      orchestrator: { name: "O", system_prompt: "s", dolphin: "d" },
    };
    assert.strictEqual(validateComposerConfig(bad), false);
  });
});

// ── 6. End-to-end pipeline: ComposerConfig → validate → compile → DPH check ─

import { validateFlow, compileToDph, validateDphSyntax } from "../../src/commands/composer-flow.js";
import type { FlowDo } from "../../src/commands/composer-flow.js";

describe("e2e pipeline: buildConfigFromPrompt → validate → compile → DPH syntax", () => {
  it("research prompt produces a valid, compilable workflow", async () => {
    const config = buildConfigFromPrompt("research and compare cloud providers AWS vs GCP");
    const agentRefs = config.agents.map((a) => a.ref);

    // Gate 1: flow validation
    assert.ok(config.orchestrator.flow, "config should have a flow");
    const flowErrors = validateFlow(config.orchestrator.flow!, agentRefs);
    assert.deepEqual(flowErrors, [], `Gate 1 failed: ${flowErrors.join(", ")}`);

    // Gate 2: compile to DPH
    const compiled = compileToDph(config.orchestrator.flow!);
    assert.ok(compiled.dph.length > 0, "DPH should not be empty");
    assert.ok(compiled.answerVar.length > 0, "answerVar should not be empty");

    // Gate 3: DPH syntax check
    const syntaxResult = await validateDphSyntax(compiled.dph);
    if (!syntaxResult.skipped) {
      assert.ok(syntaxResult.is_valid, `DPH syntax error: ${syntaxResult.error_message} at line ${syntaxResult.line_number}`);
    }
  });

  it("code prompt produces a valid, compilable workflow", async () => {
    const config = buildConfigFromPrompt("implement a new REST API with authentication");
    const agentRefs = config.agents.map((a) => a.ref);

    assert.ok(config.orchestrator.flow);
    const flowErrors = validateFlow(config.orchestrator.flow!, agentRefs);
    assert.deepEqual(flowErrors, [], `Gate 1 failed: ${flowErrors.join(", ")}`);

    const compiled = compileToDph(config.orchestrator.flow!);
    assert.ok(compiled.dph.includes("@architect"), "DPH should reference architect agent");
    assert.ok(compiled.dph.includes("@developer"), "DPH should reference developer agent");

    const syntaxResult = await validateDphSyntax(compiled.dph);
    if (!syntaxResult.skipped) {
      assert.ok(syntaxResult.is_valid, `DPH syntax error: ${syntaxResult.error_message}`);
    }
  });
});

describe("e2e pipeline: complex hand-crafted flow (parallel + switch + merge)", () => {
  // Scenario: customer support triage system
  // 1. Triage classifies the ticket
  // 2. Switch on classification:
  //    - technical → parallel: code_analyzer + log_analyzer → synthesize
  //    - billing → billing_agent
  //    - default → general_agent
  const agents = ["triage", "code_analyzer", "log_analyzer", "synthesizer", "billing_agent", "general_agent"];
  const complexFlow: FlowDo = {
    do: [
      { call: "triage", input: "$query" },
      {
        switch: [
          {
            if: "$triage.category == 'technical'",
            do: [
              {
                parallel: [
                  { call: "code_analyzer", input: "$triage" },
                  { call: "log_analyzer", input: "$triage" },
                ],
              },
              { call: "synthesizer", input: "$code_analyzer + $log_analyzer" },
            ],
          },
          {
            if: "$triage.category == 'billing'",
            do: [{ call: "billing_agent", input: "$triage" }],
          },
          {
            default: true as const,
            do: [{ call: "general_agent", input: "$triage" }],
          },
        ],
      },
    ],
  };

  it("Gate 1: validateFlow passes for complex flow", () => {
    const errors = validateFlow(complexFlow, agents);
    assert.deepEqual(errors, [], `Validation errors: ${errors.join(", ")}`);
  });

  it("Gate 2: compileToDph produces correct DPH structure", () => {
    const compiled = compileToDph(complexFlow);

    // Should have triage call
    assert.ok(compiled.dph.includes("@triage(query=$_user_query.q) -> triage"), `Missing triage call. DPH:\n${compiled.dph}`);

    // Should have if/elif/else structure
    assert.ok(compiled.dph.includes("/if/"), `Missing /if/. DPH:\n${compiled.dph}`);
    assert.ok(compiled.dph.includes("elif"), `Missing elif. DPH:\n${compiled.dph}`);
    assert.ok(compiled.dph.includes("else:"), `Missing else. DPH:\n${compiled.dph}`);
    assert.ok(compiled.dph.includes("/end/"), `Missing /end/. DPH:\n${compiled.dph}`);

    // Should have parallel block inside the technical branch
    assert.ok(compiled.dph.includes("/parallel/"), `Missing /parallel/. DPH:\n${compiled.dph}`);

    // Should have merge expression for synthesizer
    // Merge is emitted as a /prompt/ template block (not a `+` expression)
    assert.ok(compiled.dph.includes("$code_analyzer.answer.answer"), `Missing code_analyzer merge ref. DPH:\n${compiled.dph}`);
    assert.ok(compiled.dph.includes("$log_analyzer.answer.answer"), `Missing log_analyzer merge ref. DPH:\n${compiled.dph}`);

    // Should have all agents referenced
    for (const agent of agents) {
      assert.ok(compiled.dph.includes(`@${agent}`), `Missing @${agent} in DPH:\n${compiled.dph}`);
    }
  });

  it("Gate 3: compiled DPH passes Dolphin syntax check", async () => {
    const compiled = compileToDph(complexFlow);
    const result = await validateDphSyntax(compiled.dph);
    if (!result.skipped) {
      assert.ok(result.is_valid, `DPH syntax error at line ${result.line_number}: ${result.error_message}\nDPH:\n${compiled.dph}`);
    }
  });

  it("buildAgentCreateBody produces valid orchestrator config for complex flow", () => {
    const compiled = compileToDph(complexFlow);

    // Simulate what createAgents does: build orchestrator body with compiled DPH
    const orchBody = buildAgentCreateBody(
      "Support Orchestrator",
      "Orchestrates customer support triage",
      "You are a support orchestrator.",
      {
        dolphin: compiled.dph,
        is_dolphin_mode: 1,
        skills: { tools: [], agents: agents.map((a) => ({ agent_key: `key_${a}` })), mcps: [] },
        _answerVar: compiled.answerVar,
      },
    );

    const parsed = JSON.parse(orchBody);
    assert.equal(parsed.config.is_dolphin_mode, 1);
    assert.equal(parsed.config.dolphin, compiled.dph);
    assert.equal(parsed.config.output.variables.answer_var, compiled.answerVar);
    assert.equal(parsed.config.skills.agents.length, agents.length);
    // Verify no pre_dolphin in dolphin mode
    assert.deepEqual(parsed.config.pre_dolphin, []);
  });
});

// ── 7. compileAndValidateWithRetry (Gate 2 retry loop) ──────────────────────

import { compileAndValidateWithRetry } from "../../src/commands/composer-engine.js";
import type { ComposerConfig } from "../../src/commands/composer-engine.js";
import type { DphValidationResult } from "../../src/commands/composer-flow.js";

describe("compileAndValidateWithRetry", () => {
  const baseConfig: ComposerConfig = {
    name: "Test",
    description: "desc",
    agents: [{ ref: "agent_a", name: "Agent A", profile: "p", system_prompt: "s" }],
    orchestrator: {
      name: "Orch",
      profile: "orch",
      system_prompt: "You orchestrate.",
      flow: { do: [{ call: "agent_a", input: "$query" }] },
    },
  };

  const okValidator = async (_dph: string): Promise<DphValidationResult> =>
    ({ is_valid: true, error_message: "", line_number: 0 });

  it("initial compile+validate succeeds → regenerate not called", async () => {
    let regenerateCalls = 0;
    const result = await compileAndValidateWithRetry(
      baseConfig,
      async () => { regenerateCalls++; return null; },
      okValidator,
      1,
    );
    assert.ok(result.ok, `expected ok, got ${JSON.stringify(result)}`);
    if (result.ok) {
      assert.ok(result.dph.length > 0);
      assert.ok(result.answerVar.length > 0);
      assert.strictEqual(result.validatorSkipped, false);
    }
    assert.strictEqual(regenerateCalls, 0, "regenerate should not be called when first attempt succeeds");
  });

  it("Gate 2 fails, regenerate succeeds, second attempt valid → returns second result", async () => {
    let validatorCalls = 0;
    const flakyValidator = async (_dph: string): Promise<DphValidationResult> => {
      validatorCalls++;
      return validatorCalls === 1
        ? { is_valid: false, error_message: "bad syntax near @foo", line_number: 3 }
        : { is_valid: true, error_message: "", line_number: 0 };
    };

    let regenerateCalls = 0;
    let capturedHint = "";
    const regenerate = async (hint: string): Promise<ComposerConfig | null> => {
      regenerateCalls++;
      capturedHint = hint;
      // Return a different config so we can tell which attempt won
      return { ...baseConfig, name: "TestRetry" };
    };

    const result = await compileAndValidateWithRetry(baseConfig, regenerate, flakyValidator, 1);
    assert.ok(result.ok, `expected ok, got ${JSON.stringify(result)}`);
    if (result.ok) {
      assert.strictEqual(result.config.name, "TestRetry", "should use regenerated config");
    }
    assert.strictEqual(regenerateCalls, 1);
    assert.strictEqual(validatorCalls, 2);
    assert.ok(capturedHint.includes("bad syntax near @foo"), `hint missing error: ${capturedHint}`);
    assert.ok(capturedHint.includes("3"), `hint missing line number: ${capturedHint}`);
  });

  it("all attempts fail → returns ok:false with last error", async () => {
    const badValidator = async (_dph: string): Promise<DphValidationResult> =>
      ({ is_valid: false, error_message: "still broken", line_number: 7 });

    let regenerateCalls = 0;
    const result = await compileAndValidateWithRetry(
      baseConfig,
      async () => { regenerateCalls++; return { ...baseConfig, name: "Retry" }; },
      badValidator,
      1,
    );
    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.ok(result.error.includes("still broken"));
      assert.strictEqual(result.lineNumber, 7);
    }
    assert.strictEqual(regenerateCalls, 1, "regenerate called once for maxRetries=1");
  });

  it("regenerate returns null → returns ok:false without further tries", async () => {
    let validatorCalls = 0;
    const badValidator = async (_dph: string): Promise<DphValidationResult> => {
      validatorCalls++;
      return { is_valid: false, error_message: "broken", line_number: 1 };
    };

    const result = await compileAndValidateWithRetry(
      baseConfig,
      async () => null,
      badValidator,
      2,
    );
    assert.strictEqual(result.ok, false);
    assert.strictEqual(validatorCalls, 1, "no second validation when regenerate returned null");
  });

  it("validator returns skipped=true → treated as valid, flag exposed", async () => {
    const skippedValidator = async (_dph: string): Promise<DphValidationResult> =>
      ({ is_valid: true, error_message: "", line_number: 0, skipped: true });

    let regenerateCalls = 0;
    const result = await compileAndValidateWithRetry(
      baseConfig,
      async () => { regenerateCalls++; return null; },
      skippedValidator,
      1,
    );
    assert.ok(result.ok);
    if (result.ok) {
      assert.strictEqual(result.validatorSkipped, true);
    }
    assert.strictEqual(regenerateCalls, 0, "skipped should not trigger retry");
  });

  it("maxRetries=2: first two fail, third succeeds → ok", async () => {
    let validatorCalls = 0;
    const validator = async (_dph: string): Promise<DphValidationResult> => {
      validatorCalls++;
      return validatorCalls < 3
        ? { is_valid: false, error_message: `fail ${validatorCalls}`, line_number: validatorCalls }
        : { is_valid: true, error_message: "", line_number: 0 };
    };

    let regenerateCalls = 0;
    const result = await compileAndValidateWithRetry(
      baseConfig,
      async () => { regenerateCalls++; return baseConfig; },
      validator,
      2,
    );
    assert.ok(result.ok, `expected ok, got ${JSON.stringify(result)}`);
    assert.strictEqual(regenerateCalls, 2);
    assert.strictEqual(validatorCalls, 3);
  });
});

// ── 8. Composer relay agent (auto-provisioned LLM relay) ───────────────────

import {
  COMPOSER_RELAY_NAME,
  COMPOSER_RELAY_METADATA_PURPOSE,
  findRelayByName,
  buildComposerRelayCreateBody,
} from "../../src/commands/composer-engine.js";

describe("findRelayByName", () => {
  it("empty list → null", () => {
    assert.strictEqual(findRelayByName([], COMPOSER_RELAY_NAME), null);
  });

  it("no match → null", () => {
    assert.strictEqual(
      findRelayByName([{ id: "a", name: "other" }, { id: "b", name: "__other__" }], COMPOSER_RELAY_NAME),
      null,
    );
  });

  it("single match → returns that id", () => {
    const found = findRelayByName(
      [{ id: "a", name: "other" }, { id: "b", name: COMPOSER_RELAY_NAME }],
      COMPOSER_RELAY_NAME,
    );
    assert.strictEqual(found, "b");
  });

  it("multiple matches → returns first (list order)", () => {
    const found = findRelayByName(
      [
        { id: "first", name: COMPOSER_RELAY_NAME },
        { id: "second", name: COMPOSER_RELAY_NAME },
      ],
      COMPOSER_RELAY_NAME,
    );
    assert.strictEqual(found, "first");
  });

  it("entry missing id → skipped", () => {
    const found = findRelayByName(
      [{ name: COMPOSER_RELAY_NAME }, { id: "b", name: COMPOSER_RELAY_NAME }],
      COMPOSER_RELAY_NAME,
    );
    assert.strictEqual(found, "b");
  });

  it("entry missing name → skipped", () => {
    const found = findRelayByName(
      [{ id: "a" }, { id: "b", name: COMPOSER_RELAY_NAME }],
      COMPOSER_RELAY_NAME,
    );
    assert.strictEqual(found, "b");
  });
});

describe("buildComposerRelayCreateBody", () => {
  it("name is the reserved constant", () => {
    const body = JSON.parse(buildComposerRelayCreateBody());
    assert.strictEqual(body.name, COMPOSER_RELAY_NAME);
  });

  it("metadata.purpose carries the canary tag", () => {
    const body = JSON.parse(buildComposerRelayCreateBody());
    assert.strictEqual(body.config.metadata.purpose, COMPOSER_RELAY_METADATA_PURPOSE);
  });

  it("system_prompt is neutral (no role / domain bias)", () => {
    const body = JSON.parse(buildComposerRelayCreateBody());
    const sp = body.config.system_prompt as string;
    assert.ok(sp.length > 0, "system_prompt must not be empty");
    // Bias detectors: any prompt that claims a specific expertise is a relay anti-pattern
    assert.ok(!/market|research|analyst|engineer|专家|分析师/i.test(sp),
      `system_prompt looks biased (contains role keyword): ${sp}`);
  });

  it("llms field set when provided", () => {
    const llms = [{ is_default: true, llm_config: { id: "mid-123", name: "test-model" } }];
    const body = JSON.parse(buildComposerRelayCreateBody(llms));
    assert.ok(Array.isArray(body.config.llms));
    assert.strictEqual((body.config.llms as unknown[]).length, 1);
  });

  it("llms field absent when not provided", () => {
    const body = JSON.parse(buildComposerRelayCreateBody());
    assert.strictEqual(body.config.llms, undefined);
  });

  it("non-dolphin chat mode (pre_dolphin has context_organize)", () => {
    const body = JSON.parse(buildComposerRelayCreateBody());
    const pre = body.config.pre_dolphin as Array<{ key: string }>;
    assert.ok(pre.some((p) => p.key === "context_organize"),
      "relay must be a standard chat agent (pre_dolphin includes context_organize)");
  });
});

// ── 9. ensureComposerRelay (auto-provision orchestration) ──────────────────

import { ensureComposerRelay } from "../../src/commands/composer-engine.js";
import type { AgentInfo } from "../../src/api/agent-chat.js";

describe("ensureComposerRelay", () => {
  const fakeInfo: AgentInfo = { id: "existing-relay", key: "k", version: "v0" };

  it("returns existing relay when found by reserved name — no create", async () => {
    let createCalls = 0;
    let publishCalls = 0;
    const info = await ensureComposerRelay({
      listAgents: async () => [{ id: "existing-relay", name: COMPOSER_RELAY_NAME }],
      fetchAgentInfo: async (id) => ({ ...fakeInfo, id }),
      createAgent: async () => { createCalls++; return "never"; },
      publishAgent: async () => { publishCalls++; },
      llms: [],
    });
    assert.strictEqual(info.id, "existing-relay");
    assert.strictEqual(createCalls, 0, "create must not be called when relay exists");
    assert.strictEqual(publishCalls, 0, "publish must not be called when relay exists");
  });

  it("creates + publishes relay when not found, returns info of the new relay", async () => {
    let createdBody: string | null = null;
    let publishedId: string | null = null;
    const info = await ensureComposerRelay({
      listAgents: async () => [{ id: "other", name: "Other Agent" }],
      fetchAgentInfo: async (id) => ({ ...fakeInfo, id }),
      createAgent: async (body) => { createdBody = body; return "new-relay-id"; },
      publishAgent: async (id) => { publishedId = id; },
      llms: [{ is_default: true, llm_config: { id: "m", name: "m" } }],
    });
    assert.strictEqual(info.id, "new-relay-id");
    assert.ok(createdBody, "createAgent must be called");
    const parsed = JSON.parse(createdBody!);
    assert.strictEqual(parsed.name, COMPOSER_RELAY_NAME);
    assert.strictEqual(parsed.config.metadata.purpose, COMPOSER_RELAY_METADATA_PURPOSE);
    assert.strictEqual(publishedId, "new-relay-id", "publish must target new relay id");
  });

  it("skips agents missing id when scanning", async () => {
    const info = await ensureComposerRelay({
      listAgents: async () => [
        { name: COMPOSER_RELAY_NAME }, // missing id
        { id: "real", name: COMPOSER_RELAY_NAME },
      ],
      fetchAgentInfo: async (id) => ({ ...fakeInfo, id }),
      createAgent: async () => "should-not-be-called",
      publishAgent: async () => { throw new Error("should not publish"); },
      llms: [],
    });
    assert.strictEqual(info.id, "real");
  });

  it("tolerates publish failure (non-fatal) and still returns created info", async () => {
    let publishAttempts = 0;
    const info = await ensureComposerRelay({
      listAgents: async () => [],
      fetchAgentInfo: async (id) => ({ ...fakeInfo, id }),
      createAgent: async () => "created",
      publishAgent: async () => { publishAttempts++; throw new Error("403 forbidden"); },
      llms: [],
    });
    assert.strictEqual(info.id, "created");
    assert.strictEqual(publishAttempts, 1);
  });
});

// ── 10. sanitizeAgentName ────────────────────────────────────────────────────

describe("sanitizeAgentName", () => {
  it("replaces special chars with underscore", () => {
    assert.strictEqual(sanitizeAgentName("My Agent!"), "My_Agent_");
  });

  it("prepends underscore if name starts with digit", () => {
    assert.strictEqual(sanitizeAgentName("1agent"), "_1agent");
  });

  it("allows letters, digits, underscore, Chinese chars", () => {
    const name = "my_agent_名字";
    assert.strictEqual(sanitizeAgentName(name), name);
  });

  it("strips chars that break DPH @tool-call syntax (& ! ? @ # $ %)", () => {
    // Regression: LLM-generated agent names sometimes contain '&'
    // ("Legal & Compliance Officer"). Dolphin's parser rejects
    // @Legal_&_... as "Invalid tool call format", so this sanitization
    // must remove anything outside [a-zA-Z0-9_ + CJK].
    for (const ch of ["&", "!", "?", "@", "#", "$", "%"]) {
      const out = sanitizeAgentName(`A${ch}B`);
      assert.ok(!out.includes(ch), `leaked '${ch}' → ${out}`);
    }
  });
});
