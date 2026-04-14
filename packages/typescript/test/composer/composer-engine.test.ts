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

// ── 6. sanitizeAgentName ─────────────────────────────────────────────────────

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
