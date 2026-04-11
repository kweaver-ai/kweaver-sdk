import { IncomingMessage, ServerResponse } from "node:http";

import { createAgent, publishAgent, deleteAgent } from "../api/agent-list.js";
import { fetchAgentInfo, sendChatRequestStream } from "../api/agent-chat.js";
import { readBody, handleApiError, jsonResponse, type TokenProvider } from "./explore-bkn.js";
import { type FlowDo, compileToDph, validateFlow, validateDphSyntax } from "./composer-flow.js";

// ── Interfaces ──────────────────────────────────────────────────────────────

export interface ComposerAgentDef {
  ref: string;
  name: string;
  profile: string;
  system_prompt: string;
}

export interface ComposerConfig {
  name: string;
  description: string;
  agents: ComposerAgentDef[];
  orchestrator: {
    name: string;
    profile: string;
    system_prompt: string;
    dolphin?: string;         // computed from flow at create-time
    is_dolphin_mode?: number;
    flow?: FlowDo;            // structured flow definition
  };
}

interface ComposerTemplate {
  id: string;
  name: string;
  description: string;
  config: ComposerConfig;
}

// ── Hardcoded templates ─────────────────────────────────────────────────────

const TEMPLATES: ComposerTemplate[] = [
  {
    id: "blank",
    name: "Blank",
    description: "Start from scratch with an empty composer configuration.",
    config: {
      name: "Blank Composer",
      description: "An empty composer — add your own agents and orchestration logic.",
      agents: [],
      orchestrator: {
        name: "Orchestrator",
        profile: "Orchestrates agent collaboration",
        system_prompt: "You are an orchestrator agent. Coordinate the sub-agents to accomplish the user's goal.",
        dolphin: "",
        flow: { do: [] },
        is_dolphin_mode: 1,
      },
    },
  },
  {
    id: "code-development",
    name: "Code Development",
    description: "A 3-agent pipeline: architect designs the solution, developer implements it, reviewer validates quality.",
    config: {
      name: "Code Development Pipeline",
      description: "Architect, Developer, and Reviewer collaborate to produce high-quality code.",
      agents: [
        {
          ref: "architect",
          name: "Architect",
          profile: "Designs software architecture and specifications",
          system_prompt:
            "You are a senior software architect. Given a feature request or problem statement, " +
            "produce a clear technical design including component structure, API contracts, data models, " +
            "and key design decisions. Output a structured design document.",
        },
        {
          ref: "developer",
          name: "Developer",
          profile: "Implements code based on architecture specs",
          system_prompt:
            "You are an expert software developer. Given a technical design document, implement the " +
            "solution in clean, well-documented code. Follow best practices for the target language, " +
            "include error handling, and write unit test stubs.",
        },
        {
          ref: "reviewer",
          name: "Code Reviewer",
          profile: "Reviews code for correctness, security, and quality",
          system_prompt:
            "You are a meticulous code reviewer. Analyze the provided code for correctness, security " +
            "vulnerabilities, performance issues, and adherence to best practices. Provide specific, " +
            "actionable feedback with line-level suggestions.",
        },
      ],
      orchestrator: {
        name: "Code Dev Orchestrator",
        profile: "Orchestrates a three-stage code development pipeline",
        system_prompt:
          "You orchestrate a code development pipeline. Route the user's request through architect, " +
          "developer, and reviewer in sequence, passing each stage's output to the next.",
        flow: {
          do: [
            { call: "architect", input: "$query" },
            { call: "developer", input: "$architect" },
            { call: "reviewer", input: "$developer" },
          ],
        },
        is_dolphin_mode: 1,
      },
    },
  },
  {
    id: "research-synthesize",
    name: "Research & Synthesize",
    description: "Two researchers explore different angles on a topic, then a synthesizer merges their findings.",
    config: {
      name: "Research & Synthesize Pipeline",
      description: "Parallel research from two perspectives, merged into a comprehensive synthesis.",
      agents: [
        {
          ref: "researcher_a",
          name: "Researcher A",
          profile: "Researches from a technical/scientific perspective",
          system_prompt:
            "You are Research Analyst A. Investigate the given topic from a technical and quantitative " +
            "perspective. Focus on data, metrics, benchmarks, and empirical evidence. Provide structured " +
            "findings with sources where possible.",
        },
        {
          ref: "researcher_b",
          name: "Researcher B",
          profile: "Researches from a practical/business perspective",
          system_prompt:
            "You are Research Analyst B. Investigate the given topic from a qualitative and strategic " +
            "perspective. Focus on market trends, user impact, competitive landscape, and expert opinions. " +
            "Provide structured findings with context.",
        },
        {
          ref: "synthesizer",
          name: "Synthesizer",
          profile: "Synthesizes multiple research perspectives into a unified report",
          system_prompt:
            "You are a research synthesizer. Given findings from multiple research analysts, merge them " +
            "into a coherent, comprehensive report. Highlight agreements, contradictions, and gaps. " +
            "Produce an executive summary followed by detailed analysis.",
        },
      ],
      orchestrator: {
        name: "Research Orchestrator",
        profile: "Orchestrates multi-perspective research and synthesis",
        system_prompt:
          "You orchestrate a research pipeline. Send the user's query to both researchers in parallel, " +
          "then pass their combined findings to the synthesizer for a final report.",
        flow: {
          do: [
            { parallel: [
                { call: "researcher_a", input: "$query" },
                { call: "researcher_b", input: "$query" },
            ]},
            { call: "synthesizer", input: "$researcher_a + $researcher_b" },
          ],
        },
        is_dolphin_mode: 1,
      },
    },
  },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

function cloneComposerConfig(config: ComposerConfig): ComposerConfig {
  return JSON.parse(JSON.stringify(config)) as ComposerConfig;
}

function slugifyWords(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
    .join("-");
}

function titleCaseWords(input: string): string {
  return input
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .slice(0, 8)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function pickTemplateForPrompt(prompt: string): ComposerTemplate {
  const lower = prompt.toLowerCase();

  if (/(research|compare|analy[sz]e|investigate|summary|summari[sz]e|report|trend|competitor|market|video|videos|youtube)/.test(lower)) {
    return TEMPLATES.find((item) => item.id === "research-synthesize") ?? TEMPLATES[0];
  }

  if (/(code|develop|implement|feature|bug|fix|review|test|refactor|typescript|python|javascript|api|build|create|deploy|backend|frontend|server|endpoint|microservice|service|database)/.test(lower)) {
    return TEMPLATES.find((item) => item.id === "code-development") ?? TEMPLATES[0];
  }

  // Default to research-synthesize as it provides a usable multi-agent config
  return TEMPLATES.find((item) => item.id === "research-synthesize") ?? TEMPLATES[0];
}

function buildGeneratedComposerConfig(prompt: string): ComposerConfig {
  const normalizedPrompt = prompt.replace(/\s+/g, " ").trim();
  const template = pickTemplateForPrompt(normalizedPrompt);
  const config = cloneComposerConfig(template.config);
  const shortTitle = titleCaseWords(normalizedPrompt) || "Multi-Agent Workflow";
  const workflowSlug = slugifyWords(normalizedPrompt) || "workflow";

  config.name = `${shortTitle} Workflow`;
  config.description = normalizedPrompt;
  config.orchestrator.name = `${shortTitle} Orchestrator`;
  config.orchestrator.profile = `Coordinates the workflow for: ${normalizedPrompt}`;
  config.orchestrator.system_prompt += `\n\nUser request:\n${normalizedPrompt}`;

  for (const agent of config.agents) {
    agent.system_prompt += `\n\nPrimary task from user:\n${normalizedPrompt}`;
  }

  if (template.id === "research-synthesize") {
    config.orchestrator.flow = {
      do: [
        { parallel: [
            { call: "researcher_a", input: "$query" },
            { call: "researcher_b", input: "$query" },
        ]},
        { call: "synthesizer", input: "$researcher_a + $researcher_b" },
      ],
    };
    delete config.orchestrator.dolphin;
  } else if (template.id === "code-development") {
    config.orchestrator.flow = {
      do: [
        { call: "architect", input: "$query" },
        { call: "developer", input: "$architect" },
        { call: "reviewer", input: "$developer" },
      ],
    };
    delete config.orchestrator.dolphin;
  } else {
    config.name = `${shortTitle || "Blank"} Composer`;
    config.description = normalizedPrompt || "Generated from natural-language input.";
    config.orchestrator.name = `${shortTitle || "Blank"} Orchestrator`;
    config.orchestrator.profile = `Coordinates the workflow for ${workflowSlug}`;
    config.orchestrator.system_prompt =
      "You are an orchestrator agent. Coordinate the sub-agents to accomplish the user's goal." +
      `\n\nUser request:\n${normalizedPrompt}`;
    config.orchestrator.flow = { do: [] };
    delete config.orchestrator.dolphin;
  }

  return config;
}

function sanitizeAgentName(name: string): string {
  // API requires: 中英文、数字及下划线，且不能以数字开头
  return name.replace(/[^a-zA-Z0-9_\u4e00-\u9fff]/g, "_").replace(/^(\d)/, "_$1");
}


const DEFAULT_LLM_ID = "v3";
const DEFAULT_LLMS = [{ is_default: true, llm_config: { id: DEFAULT_LLM_ID, name: DEFAULT_LLM_ID, max_tokens: 4096 } }];

function buildAgentCreateBody(
  name: string,
  profile: string,
  systemPrompt: string,
  extra?: Record<string, unknown>,
  llms?: unknown[],
): string {
  const config: Record<string, unknown> = {
    input: { fields: [{ name: "user_input", type: "string" }] },
    output: { default_format: "markdown" },
    system_prompt: systemPrompt,
    ...extra,
  };
  if (llms && llms.length > 0) {
    config.llms = llms;
  }
  return JSON.stringify({
    name: sanitizeAgentName(name),
    profile,
    avatar_type: 1,
    avatar: "icon-dip-agent-default",
    product_key: "DIP",
    config,
  });
}

// ── LLM-powered ComposerConfig generation ───────────────────────────────────

const FLOW_GENERATION_PROMPT_VERSION = "1.0";

const FLOW_GENERATION_SYSTEM_PROMPT = `You are a multi-agent workflow designer. Given a user's natural language description, design a multi-agent workflow and output a ComposerConfig JSON.

## Flow Schema

Instead of writing orchestration scripts, define the workflow as a structured "flow" JSON object.

### Step Types

1. **call** — invoke an agent:
   { "call": "agent_ref", "input": "$variable" }

2. **parallel** — run steps concurrently:
   { "parallel": [ { "call": "a", "input": "$query" }, { "call": "b", "input": "$query" } ] }

3. **switch** — conditional branching:
   { "switch": [
     { "if": "$var.field == 'value'", "do": [{ "call": "x", "input": "$var" }] },
     { "default": true, "do": [{ "call": "y", "input": "$var" }] }
   ] }

### Rules

- Each \`call\` value must match an agent \`ref\` in the agents array
- \`input\` must be a \`$variable\` reference: \`$query\` (user input) or \`$agent_ref\` (output of a previous step)
- To combine results: \`"input": "$agent_a + $agent_b"\`
- Multi-param: \`"input": {"query": "$var1", "context": "$var2"}\`
- Output variable name defaults to the agent ref (e.g. call "triage" → output is \`$triage\`)
- \`switch\` conditions use Python comparison syntax
- \`switch\` must have at least one \`if\` case; \`default\` must be last

## ComposerConfig JSON Schema

\\\`\\\`\\\`json
{
  "name": "Workflow Name",
  "description": "What this workflow does",
  "agents": [
    { "ref": "snake_case_id", "name": "Display Name", "profile": "One-line role", "system_prompt": "Detailed instructions" }
  ],
  "orchestrator": {
    "name": "Orchestrator Name",
    "profile": "One-line description",
    "system_prompt": "How the orchestrator coordinates",
    "flow": {
      "do": [
        { "call": "agent_ref", "input": "$query" }
      ]
    }
  }
}
\\\`\\\`\\\`

## Example 1: Sequential Pipeline

User: "Code review with architect, developer, reviewer"
\\\`\\\`\\\`json
{
  "name": "Code Review Pipeline",
  "description": "Sequential code development pipeline",
  "agents": [
    { "ref": "architect", "name": "Architect", "profile": "Designs architecture", "system_prompt": "You are a senior architect. Produce a clear design." },
    { "ref": "developer", "name": "Developer", "profile": "Implements code", "system_prompt": "You are an expert developer. Implement clean code." },
    { "ref": "reviewer", "name": "Reviewer", "profile": "Reviews quality", "system_prompt": "You are a code reviewer. Provide actionable feedback." }
  ],
  "orchestrator": {
    "name": "Pipeline Orchestrator",
    "profile": "Coordinates sequential pipeline",
    "system_prompt": "Route through architect, developer, reviewer in sequence.",
    "flow": { "do": [
      { "call": "architect", "input": "$query" },
      { "call": "developer", "input": "$architect" },
      { "call": "reviewer", "input": "$developer" }
    ] }
  }
}
\\\`\\\`\\\`

## Example 2: Parallel Research

User: "Two researchers then synthesize"
\\\`\\\`\\\`json
{
  "name": "Research Pipeline",
  "description": "Parallel research with synthesis",
  "agents": [
    { "ref": "researcher_a", "name": "Researcher A", "profile": "Technical analysis", "system_prompt": "Research from a technical perspective." },
    { "ref": "researcher_b", "name": "Researcher B", "profile": "Business analysis", "system_prompt": "Research from a business perspective." },
    { "ref": "synthesizer", "name": "Synthesizer", "profile": "Merges findings", "system_prompt": "Merge findings into a report." }
  ],
  "orchestrator": {
    "name": "Research Orchestrator",
    "profile": "Coordinates parallel research",
    "system_prompt": "Send to both researchers, then synthesize.",
    "flow": { "do": [
      { "parallel": [
        { "call": "researcher_a", "input": "$query" },
        { "call": "researcher_b", "input": "$query" }
      ] },
      { "call": "synthesizer", "input": "$researcher_a + $researcher_b" }
    ] }
  }
}
\\\`\\\`\\\`

## Output Rules

1. Design 2-5 agents with clear, distinct roles
2. Output ONLY a single JSON code block. No other text.
3. System prompts should be detailed and specific.`;

/**
 * Extract JSON from an LLM response that may contain markdown code blocks.
 * Tries: ```json ... ```, ``` ... ```, or raw JSON parsing.
 */
function extractJsonFromLLMResponse(text: string): ComposerConfig | null {
  // Try markdown code block (```json ... ``` or ``` ... ```)
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim()) as ComposerConfig;
    } catch { /* fall through */ }
  }

  // Try raw JSON (find first { ... last })
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(text.slice(firstBrace, lastBrace + 1)) as ComposerConfig;
    } catch { /* fall through */ }
  }

  return null;
}

/**
 * Validate that a parsed object has the required ComposerConfig structure.
 */
function validateComposerConfig(obj: unknown): obj is ComposerConfig {
  if (!obj || typeof obj !== "object") return false;
  const c = obj as Record<string, unknown>;
  if (typeof c.name !== "string") return false;
  if (!Array.isArray(c.agents)) return false;
  for (const agent of c.agents) {
    if (!agent || typeof agent !== "object") return false;
    const a = agent as Record<string, unknown>;
    if (typeof a.ref !== "string" || typeof a.name !== "string") return false;
    if (typeof a.system_prompt !== "string" || typeof a.profile !== "string") return false;
  }
  if (!c.orchestrator || typeof c.orchestrator !== "object") return false;
  const o = c.orchestrator as Record<string, unknown>;
  // Accept either flow or dolphin (flow is preferred, dolphin is legacy)
  const hasFlow = o.flow && typeof o.flow === "object" && Array.isArray((o.flow as Record<string, unknown>).do);
  const hasDolphin = typeof o.dolphin === "string";
  if (!hasFlow && !hasDolphin) return false;
  if (typeof o.name !== "string" || typeof o.system_prompt !== "string") return false;
  return true;
}

/**
 * Find a usable published agent to relay LLM requests through.
 * Picks the first published agent from the agent list.
 */
async function findRelayAgent(
  baseUrl: string,
  accessToken: string,
  businessDomain: string,
): Promise<{ id: string; key: string; version: string } | null> {
  try {
    const { listAgents } = await import("../api/agent-list.js");
    const raw = await listAgents({ baseUrl, accessToken, businessDomain, limit: 20 });
    const list = JSON.parse(raw) as { entries?: Array<{ id?: string; name?: string; is_built_in?: number }> };
    const entries = list.entries ?? [];

    // Prefer non-built-in agents (less likely to have special behavior like planning)
    const sorted = [...entries].sort((a, b) => (a.is_built_in ?? 0) - (b.is_built_in ?? 0));

    for (const entry of sorted) {
      if (!entry.id) continue;
      try {
        const info = await fetchAgentInfo({ baseUrl, accessToken, agentId: entry.id, version: "v0", businessDomain });
        console.error(`[composer] Using relay agent "${entry.name}" (${entry.id})`);
        return info;
      } catch { /* try next */ }
    }
  } catch (err) {
    console.error(`[composer] findRelayAgent failed: ${err instanceof Error ? err.message : err}`);
  }
  return null;
}

function logBadCase(gate: string, prompt: string, llmOutput: unknown, error: string): void {
  const entry = {
    date: new Date().toISOString().slice(0, 10),
    gate, prompt,
    llm_output: typeof llmOutput === "string" ? llmOutput.slice(0, 500) : JSON.stringify(llmOutput).slice(0, 500),
    error_message: error,
    status: "open",
  };
  console.error(`[composer/badcase] ${JSON.stringify(entry)}`);
}

/**
 * Generate a ComposerConfig by calling an LLM via an existing published agent.
 * Uses Flow schema generation with Gate 1 (validateFlow) retry loop + Gate 2 (validateDphSyntax).
 * Falls back to buildGeneratedComposerConfig on failure.
 */
async function generateComposerConfigViaLLM(
  prompt: string,
  getToken: TokenProvider,
  businessDomain: string,
  sendEvent: (payload: Record<string, unknown>) => void,
): Promise<ComposerConfig> {
  let t: { baseUrl: string; accessToken: string };
  try {
    t = await getToken();
  } catch {
    return buildGeneratedComposerConfig(prompt);
  }

  try {
    // Phase 1: Find relay agent
    sendEvent({ type: "progress", items: [
      { agent_name: "Initializing...", status: "running", description: "Finding available agent" },
      { agent_name: "Designing workflow...", status: "pending", description: "Waiting" },
      { agent_name: "Validating...", status: "pending", description: "Waiting" },
    ] });

    const relayAgent = await findRelayAgent(t.baseUrl, t.accessToken, businessDomain);
    if (!relayAgent) throw new Error("No available agent found");

    // Phase 2: LLM generation + Gate 1 retry loop
    sendEvent({ type: "progress", items: [
      { agent_name: "Initializing...", status: "completed", description: "Agent ready" },
      { agent_name: "Designing workflow...", status: "running", description: "LLM is designing" },
      { agent_name: "Validating...", status: "pending", description: "Waiting" },
    ] });

    let config: ComposerConfig | null = null;
    let lastErrors: string[] = [];

    for (let attempt = 0; attempt < 3; attempt++) {
      let fullQuery = `${FLOW_GENERATION_SYSTEM_PROMPT}\n\n---\n\nUser request: ${prompt}`;
      if (attempt > 0 && lastErrors.length > 0) {
        fullQuery += `\n\nYour previous output had these errors:\n${lastErrors.join("\n")}\n\nPlease fix and output again.`;
        sendEvent({ type: "progress", items: [
          { agent_name: "Initializing...", status: "completed", description: "Agent ready" },
          { agent_name: "Designing workflow...", status: "running", description: `Retrying (attempt ${attempt + 1}/3)` },
          { agent_name: "Validating...", status: "pending", description: "Waiting" },
        ] });
      }

      let fullText = "";
      await sendChatRequestStream(
        { baseUrl: t.baseUrl, accessToken: t.accessToken, agentId: relayAgent.id, agentKey: relayAgent.key, agentVersion: relayAgent.version, query: fullQuery, stream: true, businessDomain },
        { onTextDelta: (ft: string, seg: string) => { fullText = ft; sendEvent({ type: "text", fullText: ft, currentText: seg }); } },
      );

      const parsed = extractJsonFromLLMResponse(fullText);
      if (!parsed || !validateComposerConfig(parsed)) {
        lastErrors = ["Output is not a valid ComposerConfig JSON"];
        logBadCase(`gate1-attempt${attempt}`, prompt, fullText, lastErrors[0]);
        continue;
      }

      // Gate 1: Validate flow
      if (parsed.orchestrator.flow) {
        const agentRefs = parsed.agents.map((a) => a.ref);
        const flowErrors = validateFlow(parsed.orchestrator.flow, agentRefs);
        if (flowErrors.length > 0) {
          lastErrors = flowErrors;
          logBadCase(`gate1-attempt${attempt}`, prompt, parsed, flowErrors.join("; "));
          continue;
        }
      }

      config = parsed;
      break;
    }

    if (!config) {
      sendEvent({ type: "text", fullText: "⚠️ Flow validation failed after 3 attempts.\n\nUsing template fallback.", currentText: "" });
      return buildGeneratedComposerConfig(prompt);
    }

    // Phase 3: Gate 2 — compile flow → DPH + Dolphin syntax check
    sendEvent({ type: "progress", items: [
      { agent_name: "Initializing...", status: "completed", description: "Agent ready" },
      { agent_name: "Designing workflow...", status: "completed", description: "Design complete" },
      { agent_name: "Validating...", status: "running", description: "Compiling & validating" },
    ] });

    if (config.orchestrator.flow && config.orchestrator.flow.do.length > 0) {
      const dph = compileToDph(config.orchestrator.flow);
      const syntaxResult = await validateDphSyntax(dph);

      if (!syntaxResult.is_valid) {
        logBadCase("gate2", prompt, config, `DPH syntax error at line ${syntaxResult.line_number}: ${syntaxResult.error_message}`);
        sendEvent({ type: "text", fullText: `⚠️ Compiled DPH failed syntax check: ${syntaxResult.error_message}\n\nUsing template fallback.`, currentText: "" });
        return buildGeneratedComposerConfig(prompt);
      }

      config.orchestrator.dolphin = dph;
    }

    if (config.orchestrator.is_dolphin_mode === undefined) {
      config.orchestrator.is_dolphin_mode = 1;
    }

    return config;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logBadCase("exception", prompt, null, errMsg);
    sendEvent({ type: "text", fullText: `⚠️ Generation failed: ${errMsg}\n\nUsing template fallback.`, currentText: "" });
    return buildGeneratedComposerConfig(prompt);
  }
}

// ── Route registration ──────────────────────────────────────────────────────

export function registerComposerRoutes(
  getToken: TokenProvider,
  businessDomain: string,
): Map<string, (req: IncomingMessage, res: ServerResponse) => void> {
  const routes = new Map<string, (req: IncomingMessage, res: ServerResponse) => void>();

  // ── GET /api/composer/templates ─────────────────────────────────────────
  routes.set("GET /api/composer/templates", (_req, res) => {
    jsonResponse(res, 200, { templates: TEMPLATES });
  });

  // ── POST /api/composer/generate (SSE) ───────────────────────────────────
  routes.set("POST /api/composer/generate", async (req, res) => {
    let bodyStr: string;
    try {
      bodyStr = await readBody(req);
    } catch {
      jsonResponse(res, 400, { error: "Failed to read request body" });
      return;
    }

    let prompt = "";
    try {
      const parsed = JSON.parse(bodyStr) as { prompt?: string };
      prompt = (parsed.prompt ?? "").trim();
    } catch {
      jsonResponse(res, 400, { error: "Invalid JSON body" });
      return;
    }

    if (!prompt) {
      jsonResponse(res, 400, { error: "prompt is required" });
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const sendEvent = (payload: Record<string, unknown>): void => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    try {
      const config = await generateComposerConfigViaLLM(prompt, getToken, businessDomain, sendEvent);
      sendEvent({ type: "composer_config", config });
      sendEvent({
        type: "progress",
        items: [
          { agent_name: "Initializing workflow designer...", status: "completed", description: "Done" },
          { agent_name: "Designing agent roles and DPH script...", status: "completed", description: "Done" },
          { agent_name: "Finalizing configuration...", status: "completed", description: "Done" },
        ],
      });
      sendEvent({ type: "done" });
      res.end();
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      sendEvent({ type: "error", error: errMsg });
      res.end();
    }
  });

  // ── POST /api/composer/create ───────────────────────────────────────────
  routes.set("POST /api/composer/create", async (req, res) => {
    let bodyStr: string;
    try {
      bodyStr = await readBody(req);
    } catch {
      jsonResponse(res, 400, { error: "Failed to read request body" });
      return;
    }

    let config: ComposerConfig;
    try {
      const parsed = JSON.parse(bodyStr) as { config?: ComposerConfig };
      if (!parsed.config) {
        jsonResponse(res, 400, { error: "Missing config in request body" });
        return;
      }
      config = parsed.config;
    } catch {
      jsonResponse(res, 400, { error: "Invalid JSON body" });
      return;
    }

    const createdAgentIds: string[] = [];
    const agentIdMap: Record<string, string> = {};
    const agentKeyMap: Record<string, string> = {};

    // Rollback helper — delete all agents created so far
    const rollback = async (token: { baseUrl: string; accessToken: string }): Promise<void> => {
      for (const id of createdAgentIds) {
        try {
          await deleteAgent({ baseUrl: token.baseUrl, accessToken: token.accessToken, agentId: id, businessDomain });
        } catch { /* best effort */ }
      }
    };

    let t: { baseUrl: string; accessToken: string };
    try {
      t = await getToken();
    } catch (error) {
      handleApiError(res, error);
      return;
    }

    try {
      const defaultLlms = DEFAULT_LLMS;

      // 1. Create, publish, and fetch info for each sub-agent
      for (const agentDef of config.agents) {
        const createBody = buildAgentCreateBody(agentDef.name, agentDef.profile, agentDef.system_prompt, undefined, defaultLlms);
        const createRaw = await createAgent({ baseUrl: t.baseUrl, accessToken: t.accessToken, body: createBody, businessDomain });
        const createResult = JSON.parse(createRaw) as { id?: string; data?: { id?: string } };
        const agentId = createResult.id ?? createResult.data?.id;
        if (!agentId) {
          throw new Error(`Failed to create agent "${agentDef.name}": no id in response`);
        }
        createdAgentIds.push(agentId);
        agentIdMap[agentDef.ref] = agentId;

        await publishAgent({ baseUrl: t.baseUrl, accessToken: t.accessToken, agentId, businessDomain });

        const info = await fetchAgentInfo({ baseUrl: t.baseUrl, accessToken: t.accessToken, agentId, version: "v0", businessDomain });
        agentKeyMap[agentDef.ref] = info.key;
      }

      // 2. Process DPH script — replace @ref with actual @agent_key
      let processedDphScript: string;
      if (config.orchestrator.flow && config.orchestrator.flow.do.length > 0) {
        processedDphScript = compileToDph(config.orchestrator.flow);
      } else {
        processedDphScript = config.orchestrator.dolphin ?? "";
      }
      for (const [ref, key] of Object.entries(agentKeyMap)) {
        processedDphScript = processedDphScript.replace(
          new RegExp(`@${ref}\\b`, "g"),
          `@${key}`,
        );
      }

      // 3. Create orchestrator agent with processed DPH script
      const isDolphinMode = config.orchestrator.is_dolphin_mode ?? 1;
      const orchBody = buildAgentCreateBody(
        config.orchestrator.name,
        config.orchestrator.profile,
        config.orchestrator.system_prompt,
        {
          dolphin: processedDphScript,
          is_dolphin_mode: isDolphinMode,
        },
        defaultLlms,
      );
      const orchRaw = await createAgent({ baseUrl: t.baseUrl, accessToken: t.accessToken, body: orchBody, businessDomain });
      const orchResult = JSON.parse(orchRaw) as { id?: string; data?: { id?: string } };
      const orchestratorId = orchResult.id ?? orchResult.data?.id;
      if (!orchestratorId) {
        throw new Error("Failed to create orchestrator agent: no id in response");
      }
      createdAgentIds.push(orchestratorId);

      // 4. Publish orchestrator
      await publishAgent({ baseUrl: t.baseUrl, accessToken: t.accessToken, agentId: orchestratorId, businessDomain });

      // 5. Return result
      jsonResponse(res, 200, {
        orchestratorId,
        agentIds: agentIdMap,
        allAgentIds: createdAgentIds,
      });
    } catch (error) {
      // Rollback all created agents on failure
      await rollback(t);
      handleApiError(res, error);
    }
  });

  // ── POST /api/composer/run (SSE) ────────────────────────────────────────
  routes.set("POST /api/composer/run", async (req, res) => {
    let bodyStr: string;
    try {
      bodyStr = await readBody(req);
    } catch {
      jsonResponse(res, 400, { error: "Failed to read request body" });
      return;
    }

    let orchestratorId: string;
    let message: string;
    let conversationId: string | undefined;
    try {
      const body = JSON.parse(bodyStr) as {
        orchestratorId?: string;
        message?: string;
        conversationId?: string;
      };
      orchestratorId = body.orchestratorId ?? "";
      message = body.message ?? "";
      conversationId = body.conversationId;
    } catch {
      jsonResponse(res, 400, { error: "Invalid JSON body" });
      return;
    }

    if (!orchestratorId || !message) {
      jsonResponse(res, 400, { error: "orchestratorId and message are required" });
      return;
    }

    // Fetch agent info to get key + version
    let t: { baseUrl: string; accessToken: string };
    let agentInfo: { id: string; key: string; version: string };
    try {
      t = await getToken();
      agentInfo = await fetchAgentInfo({
        baseUrl: t.baseUrl,
        accessToken: t.accessToken,
        agentId: orchestratorId,
        version: "v0",
        businessDomain,
      });
    } catch (error) {
      handleApiError(res, error);
      return;
    }

    // Set SSE response headers
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    // SSE heartbeat — keeps connection alive and lets client detect stalls
    const heartbeat = setInterval(() => {
      try { res.write(": heartbeat\n\n"); } catch { /* connection gone */ }
    }, 15000);

    // Stream chat response
    try {
      const result = await sendChatRequestStream(
        {
          baseUrl: t.baseUrl,
          accessToken: t.accessToken,
          agentId: agentInfo.id,
          agentKey: agentInfo.key,
          agentVersion: agentInfo.version,
          query: message,
          conversationId,
          stream: true,
          businessDomain,
        },
        {
          onTextDelta: (fullText: string, currentSegmentText: string) => {
            const event = JSON.stringify({ type: "text", fullText, currentText: currentSegmentText });
            res.write(`data: ${event}\n\n`);
          },
          onProgress: (items) => {
            const event = JSON.stringify({ type: "progress", items });
            res.write(`data: ${event}\n\n`);
          },
          onSegmentComplete: (segmentText: string, segmentIndex: number) => {
            const event = JSON.stringify({ type: "segment", text: segmentText, index: segmentIndex });
            res.write(`data: ${event}\n\n`);
          },
          onStepMeta: (meta: Record<string, unknown>) => {
            const event = JSON.stringify({ type: "step_meta", meta });
            res.write(`data: ${event}\n\n`);
          },
          onConversationId: (convId: string) => {
            const event = JSON.stringify({ type: "conversation_id", conversationId: convId });
            res.write(`data: ${event}\n\n`);
          },
        },
      );

      clearInterval(heartbeat);
      const doneEvent = JSON.stringify({
        type: "done",
        conversationId: result.conversationId ?? conversationId ?? "",
      });
      res.write(`data: ${doneEvent}\n\n`);
      res.end();
    } catch (error) {
      clearInterval(heartbeat);
      // Extract detailed error info — HttpError carries the upstream response body
      let errMsg = error instanceof Error ? error.message : String(error);
      let errDetail: string | undefined;
      if (error && typeof error === "object" && "body" in error) {
        const body = (error as { body: string }).body;
        if (body) {
          errDetail = body;
          // Try to extract a human-readable message from JSON body
          try {
            const parsed = JSON.parse(body) as Record<string, unknown>;
            const desc = parsed.description || parsed.detail || parsed.message || parsed.error;
            if (desc) errMsg += `: ${desc}`;
            if (parsed.solution) errMsg += ` (${parsed.solution})`;
          } catch { errMsg += `: ${body.slice(0, 500)}`; }
        }
      }
      if (!res.headersSent) {
        jsonResponse(res, 500, { error: errMsg, detail: errDetail });
      } else {
        const errEvent = JSON.stringify({
          type: "error",
          error: errMsg,
          detail: errDetail,
        });
        res.write(`data: ${errEvent}\n\n`);
        res.end();
      }
    }
  });

  // ── DELETE /api/composer/cleanup ─────────────────────────────────────────
  routes.set("DELETE /api/composer/cleanup", async (req, res) => {
    let bodyStr: string;
    try {
      bodyStr = await readBody(req);
    } catch {
      jsonResponse(res, 400, { error: "Failed to read request body" });
      return;
    }

    let agentIds: string[];
    try {
      const body = JSON.parse(bodyStr) as { agentIds?: string[] };
      if (!Array.isArray(body.agentIds)) {
        jsonResponse(res, 400, { error: "agentIds array is required" });
        return;
      }
      agentIds = body.agentIds;
    } catch {
      jsonResponse(res, 400, { error: "Invalid JSON body" });
      return;
    }

    let t: { baseUrl: string; accessToken: string };
    try {
      t = await getToken();
    } catch (error) {
      handleApiError(res, error);
      return;
    }

    const deleted: string[] = [];
    const errors: Array<{ agentId: string; error: string }> = [];

    for (const agentId of agentIds) {
      try {
        await deleteAgent({ baseUrl: t.baseUrl, accessToken: t.accessToken, agentId, businessDomain });
        deleted.push(agentId);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        errors.push({ agentId, error: msg });
      }
    }

    jsonResponse(res, 200, { deleted, errors });
  });

  return routes;
}
