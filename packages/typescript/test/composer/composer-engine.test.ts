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
    assert.ok(compiled.dph.includes("@triage(query=$query) -> triage"), `Missing triage call. DPH:\n${compiled.dph}`);

    // Should have if/elif/else structure
    assert.ok(compiled.dph.includes("/if/"), `Missing /if/. DPH:\n${compiled.dph}`);
    assert.ok(compiled.dph.includes("elif"), `Missing elif. DPH:\n${compiled.dph}`);
    assert.ok(compiled.dph.includes("else:"), `Missing else. DPH:\n${compiled.dph}`);
    assert.ok(compiled.dph.includes("/end/"), `Missing /end/. DPH:\n${compiled.dph}`);

    // Should have parallel block inside the technical branch
    assert.ok(compiled.dph.includes("/parallel/"), `Missing /parallel/. DPH:\n${compiled.dph}`);

    // Should have merge expression for synthesizer
    assert.ok(compiled.dph.includes("$code_analyzer + $log_analyzer"), `Missing merge expression. DPH:\n${compiled.dph}`);

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

// ── 7. sanitizeAgentName ─────────────────────────────────────────────────────

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
});
