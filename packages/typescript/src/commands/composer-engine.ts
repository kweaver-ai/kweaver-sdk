import { createAgent, publishAgent, unpublishAgent, deleteAgent } from "../api/agent-list.js";
import { fetchAgentInfo, sendChatRequestStream, type ProgressItem } from "../api/agent-chat.js";
import { type FlowDo, type DphValidationResult, compileToDph, validateFlow, validateDphSyntax } from "./composer-flow.js";

export type { FlowDo } from "./composer-flow.js";

// ── Types ────────────────────────────────────────────────────────────────────

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

export interface ComposerTemplate {
  id: string;
  name: string;
  description: string;
  config: ComposerConfig;
}

export type TokenProvider = () => Promise<{ baseUrl: string; accessToken: string }>;

export type ComposerEvent =
  | { type: "progress"; items: Array<{ agent_name: string; status: string; description: string }> }
  | { type: "text"; fullText: string; currentText: string }
  | { type: "composer_config"; config: ComposerConfig }
  | { type: "done" }
  | { type: "error"; error: string; detail?: string };

export type ComposerEventHandler = (event: ComposerEvent) => void;

export interface CreateResult {
  orchestratorId: string;
  agentIds: Record<string, string>;
  allAgentIds: string[];
}

export interface CleanupResult {
  deleted: string[];
  errors: Array<{ agentId: string; error: string }>;
}

export interface RunCallbacks {
  onTextDelta?: (fullText: string, currentText: string) => void;
  onProgress?: (items: ProgressItem[]) => void;
  onSegmentComplete?: (segmentText: string, segmentIndex: number) => void;
  onStepMeta?: (meta: Record<string, unknown>) => void;
  onConversationId?: (conversationId: string) => void;
}

export interface RunResult {
  conversationId: string;
}

// ── Hardcoded templates ──────────────────────────────────────────────────────

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
          name: "Code_Reviewer",
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
          name: "Researcher_A",
          profile: "Researches from a technical/scientific perspective",
          system_prompt:
            "You are Research Analyst A. Investigate the given topic from a technical and quantitative " +
            "perspective. Focus on data, metrics, benchmarks, and empirical evidence. Provide structured " +
            "findings with sources where possible.",
        },
        {
          ref: "researcher_b",
          name: "Researcher_B",
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

export function getTemplates(): ComposerTemplate[] {
  return TEMPLATES;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

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

export function buildConfigFromPrompt(prompt: string): ComposerConfig {
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

export function sanitizeAgentName(name: string): string {
  // API requires: 中英文、数字及下划线，且不能以数字开头，长度不超过50
  return name
    .replace(/[^a-zA-Z0-9_\u4e00-\u9fff]/g, "_")
    .replace(/^(\d)/, "_$1")
    .slice(0, 50);
}

// ── Agent body builder ───────────────────────────────────────────────────────

/**
 * Fetch the first available LLM model from the model factory.
 * Caches the result for the lifetime of the process.
 */
let cachedDefaultLlms: unknown[] | undefined;

export async function getDefaultLlms(baseUrl: string, accessToken: string, businessDomain: string): Promise<unknown[]> {
  if (cachedDefaultLlms) return cachedDefaultLlms;

  try {
    const { fetchWithRetry } = await import("../utils/http.js");
    const { buildHeaders } = await import("../api/headers.js");
    const base = baseUrl.replace(/\/+$/, "");
    const url = `${base}/api/mf-model-manager/v1/llm/list?page=1&size=50&order=desc&rule=update_time&series=all`;
    const res = await fetchWithRetry(url, { method: "GET", headers: buildHeaders(accessToken, businessDomain) });
    const body = await res.text();
    const parsed = JSON.parse(body) as { data?: Array<{ model_name?: string; model_id?: string; model_type?: string }> };
    const models = (parsed.data ?? []).filter((m) => m.model_type === "llm");
    // Prefer known-good models, fall back to first available
    const priority = ["qwen3-80b", "deepseek_v3", "deepseek"];
    const picked = priority.reduce<(typeof models)[0] | undefined>(
      (found, p) => found ?? models.find((m) => m.model_name === p),
      undefined,
    ) ?? models[0];
    if (picked?.model_name) {
      const name = picked.model_name;
      const modelId = picked.model_id ?? name;
      cachedDefaultLlms = [{ is_default: true, llm_config: { id: modelId, name, model_type: "llm", temperature: 0.7, top_p: 0.9, top_k: 1, max_tokens: 4096 } }];
      console.error(`[composer] Using LLM model: ${name} (id=${modelId})`);
      return cachedDefaultLlms;
    }
  } catch (err) {
    console.error(`[composer] Failed to fetch LLM list: ${err instanceof Error ? err.message : err}`);
  }

  // Fallback to a generic name. This model id is rarely accepted by the platform's
  // model router, so sub-agents built from it will 500 with ModelFactory.Router.ParamError
  // at runtime. Warn so the user isn't left debugging post-create.
  console.error('[composer] warning: no usable LLM on platform, using "v3" fallback — sub-agents may fail at runtime. Check /api/mf-model-manager/v1/llm/list for this business_domain.');
  cachedDefaultLlms = [{ is_default: true, llm_config: { id: "v3", name: "v3", max_tokens: 4096 } }];
  return cachedDefaultLlms;
}

export function buildAgentCreateBody(
  name: string,
  profile: string,
  systemPrompt: string,
  extra?: Record<string, unknown>,
  llms?: unknown[],
): string {
  const isDolphin = extra?.is_dolphin_mode === 1;
  const answerVar = (extra?._answerVar as string) || "answer";
  // Remove internal-only field from extra before spreading
  if (extra?._answerVar) { delete extra._answerVar; }

  // Build full agent config following kweaver platform conventions
  const config: Record<string, unknown> = {
    input: {
      fields: [
        { name: "query", type: "string", desc: "" },
        { name: "history", type: "object", desc: "" },
        { name: "tool", type: "object", desc: "" },
        { name: "header", type: "object", desc: "" },
        { name: "self_config", type: "object", desc: "" },
      ],
      is_temp_zone_enabled: 0,
    },
    output: {
      default_format: "markdown",
      variables: {
        answer_var: answerVar,
        doc_retrieval_var: "doc_retrieval_res",
        graph_retrieval_var: "graph_retrieval_res",
        related_questions_var: "related_questions",
      },
    },
    system_prompt: systemPrompt,
    dolphin: "",
    is_dolphin_mode: 0,
    pre_dolphin: isDolphin ? [] : [
      {
        key: "context_organize",
        name: "上下文组织模块",
        value: '\n{"query": "用户的问题为: "+$query} -> context\n',
        enabled: true,
        edited: false,
      },
    ],
    post_dolphin: [],
    data_source: { kg: [], doc: [], metric: [], kn_entry: [], knowledge_network: [], advanced_config: { kg: null, doc: null } },
    skills: { tools: [], agents: [], mcps: [] },
    is_data_flow_set_enabled: 0,
    memory: { is_enabled: false },
    related_question: { is_enabled: false },
    plan_mode: { is_enabled: false },
    metadata: { config_version: "v1" },
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
    product_name: "DIP",
    config,
  });
}

// ── LLM generation ───────────────────────────────────────────────────────────

export const FLOW_GENERATION_SYSTEM_PROMPT = `You are a multi-agent workflow designer. Given a user's natural language description, design a multi-agent workflow and output a ComposerConfig JSON.

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
export function extractJsonFromLLMResponse(text: string): ComposerConfig | null {
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
export function validateComposerConfig(obj: unknown): obj is ComposerConfig {
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

// ── Composer relay agent (auto-provisioned LLM relay) ───────────────────────
// Composer's --prompt path calls an LLM via an existing agent (the "relay").
// Previously the relay was picked heuristically from listAgents — which broke
// on empty accounts and biased flow generation when the picked agent had a
// domain-specific system prompt. Instead we reserve a well-known agent name
// and lazily provision it on first use. It is intentionally minimal (neutral
// system prompt, standard chat mode) to act as a clean LLM pipe.

export const COMPOSER_RELAY_NAME = "__kweaver_composer_relay__";
export const COMPOSER_RELAY_METADATA_PURPOSE = "composer-relay";

export function findRelayByName(
  entries: Array<{ id?: string; name?: string }>,
  name: string,
): string | null {
  for (const e of entries) {
    if (!e.id || !e.name) continue;
    if (e.name === name) return e.id;
  }
  return null;
}

export function buildComposerRelayCreateBody(llms?: unknown[]): string {
  return buildAgentCreateBody(
    COMPOSER_RELAY_NAME,
    "Internal LLM relay for KWeaver Composer — do not delete",
    "You are a helpful assistant. Follow the user's instructions exactly, including any instructions embedded in the user's message.",
    { metadata: { config_version: "v1", purpose: COMPOSER_RELAY_METADATA_PURPOSE } },
    llms,
  );
}

export interface EnsureRelayDeps {
  listAgents: () => Promise<Array<{ id?: string; name?: string }>>;
  fetchAgentInfo: (agentId: string) => Promise<{ id: string; key: string; version: string }>;
  createAgent: (body: string) => Promise<string>;
  publishAgent: (agentId: string) => Promise<void>;
  llms: unknown[];
}

export async function ensureComposerRelay(
  deps: EnsureRelayDeps,
): Promise<{ id: string; key: string; version: string }> {
  const entries = await deps.listAgents();
  const existing = findRelayByName(entries, COMPOSER_RELAY_NAME);
  if (existing) {
    return await deps.fetchAgentInfo(existing);
  }

  const body = buildComposerRelayCreateBody(deps.llms);
  const newId = await deps.createAgent(body);
  try {
    await deps.publishAgent(newId);
  } catch (err) {
    console.error(`[composer] relay publish failed (non-fatal): ${err instanceof Error ? err.message : err}`);
  }
  return await deps.fetchAgentInfo(newId);
}

/**
 * Resolve the LLM relay agent for Composer's --prompt path. Auto-provisions a
 * reserved-name relay when absent (solves "fresh account" bootstrap and
 * eliminates the heuristic bias of picking an arbitrary domain-specific agent
 * from listAgents).
 */
async function findRelayAgent(
  baseUrl: string,
  accessToken: string,
  businessDomain: string,
): Promise<{ id: string; key: string; version: string } | null> {
  try {
    const { listAgents, createAgent, publishAgent } = await import("../api/agent-list.js");
    const llms = await getDefaultLlms(baseUrl, accessToken, businessDomain);

    const info = await ensureComposerRelay({
      listAgents: async () => {
        const raw = await listAgents({ baseUrl, accessToken, businessDomain, limit: 20 });
        const list = JSON.parse(raw) as { entries?: Array<{ id?: string; name?: string }> };
        return list.entries ?? [];
      },
      fetchAgentInfo: (agentId) =>
        fetchAgentInfo({ baseUrl, accessToken, agentId, version: "v0", businessDomain }),
      createAgent: async (body) => {
        console.error(`[composer] provisioning relay agent "${COMPOSER_RELAY_NAME}" (first use on this account)`);
        const raw = await createAgent({ baseUrl, accessToken, body, businessDomain });
        const parsed = JSON.parse(raw) as { id?: string; data?: { id?: string } };
        const id = parsed.id ?? parsed.data?.id;
        if (!id) throw new Error("createAgent returned no id for relay");
        return id;
      },
      publishAgent: async (agentId) => {
        await publishAgent({ baseUrl, accessToken, agentId, businessDomain });
      },
      llms,
    });
    console.error(`[composer] Using relay agent "${COMPOSER_RELAY_NAME}" (${info.id})`);
    return info;
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

export type CompileValidateResult =
  | { ok: true; config: ComposerConfig; dph: string; answerVar: string; validatorSkipped: boolean }
  | { ok: false; error: string; lineNumber: number };

/**
 * Compile the flow in `initialConfig` to DPH and validate its syntax (Gate 2).
 * On syntax failure, invokes `regenerate(hint)` to obtain a new config (LLM feedback
 * loop) and retries up to `maxRetries` times. `regenerate` returning null aborts.
 * A `skipped: true` validator result is treated as valid but surfaced via
 * `validatorSkipped` so callers can warn the user.
 */
export async function compileAndValidateWithRetry(
  initialConfig: ComposerConfig,
  regenerate: (errorHint: string) => Promise<ComposerConfig | null>,
  validator: (dph: string) => Promise<DphValidationResult>,
  maxRetries: number,
): Promise<CompileValidateResult> {
  let current = initialConfig;
  let lastError = "unknown";
  let lastLine = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const flow = current.orchestrator.flow;
    if (!flow) return { ok: false, error: "config has no flow to compile", lineNumber: 0 };

    const compiled = compileToDph(flow);
    const syntaxResult = await validator(compiled.dph);

    if (syntaxResult.is_valid) {
      return {
        ok: true,
        config: current,
        dph: compiled.dph,
        answerVar: compiled.answerVar,
        validatorSkipped: syntaxResult.skipped === true,
      };
    }

    lastError = syntaxResult.error_message;
    lastLine = syntaxResult.line_number;

    if (attempt === maxRetries) break;
    const hint = `Your compiled DPH had a syntax error at line ${lastLine}: ${lastError}. Please fix and output again.`;
    const next = await regenerate(hint);
    if (!next) break;
    current = next;
  }

  return { ok: false, error: lastError, lineNumber: lastLine };
}

/**
 * Generate a ComposerConfig by calling an LLM via an existing published agent.
 * Uses Flow schema generation with Gate 1 (validateFlow) retry loop + Gate 2 (validateDphSyntax).
 * Falls back to buildConfigFromPrompt on failure.
 */
export async function generateConfig(
  prompt: string,
  getToken: TokenProvider,
  businessDomain: string,
  onEvent?: ComposerEventHandler,
): Promise<ComposerConfig> {
  const emit = onEvent ?? (() => {});

  let t: { baseUrl: string; accessToken: string };
  try {
    t = await getToken();
  } catch {
    return buildConfigFromPrompt(prompt);
  }

  try {
    // Phase 1: Find relay agent
    emit({ type: "progress", items: [
      { agent_name: "Initializing...", status: "running", description: "Finding available agent" },
      { agent_name: "Designing workflow...", status: "pending", description: "Waiting" },
      { agent_name: "Validating...", status: "pending", description: "Waiting" },
    ] });

    const relayAgent = await findRelayAgent(t.baseUrl, t.accessToken, businessDomain);
    if (!relayAgent) throw new Error("No available agent found");

    // Phase 2: LLM generation + Gate 1 retry loop
    emit({ type: "progress", items: [
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
        emit({ type: "progress", items: [
          { agent_name: "Initializing...", status: "completed", description: "Agent ready" },
          { agent_name: "Designing workflow...", status: "running", description: `Retrying (attempt ${attempt + 1}/3)` },
          { agent_name: "Validating...", status: "pending", description: "Waiting" },
        ] });
      }

      let fullText = "";
      await sendChatRequestStream(
        { baseUrl: t.baseUrl, accessToken: t.accessToken, agentId: relayAgent.id, agentKey: relayAgent.key, agentVersion: relayAgent.version, query: fullQuery, stream: true, businessDomain },
        { onTextDelta: (ft: string, seg: string) => { fullText = ft; emit({ type: "text", fullText: ft, currentText: seg }); } },
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
      emit({ type: "text", fullText: "⚠️ Flow validation failed after 3 attempts.\n\nUsing template fallback.", currentText: "" });
      return buildConfigFromPrompt(prompt);
    }

    // Phase 3: Gate 2 — compile flow → DPH + Dolphin syntax check
    emit({ type: "progress", items: [
      { agent_name: "Initializing...", status: "completed", description: "Agent ready" },
      { agent_name: "Designing workflow...", status: "completed", description: "Design complete" },
      { agent_name: "Validating...", status: "running", description: "Compiling & validating" },
    ] });

    if (config.orchestrator.flow && config.orchestrator.flow.do.length > 0) {
      const regenerateForGate2 = async (hint: string): Promise<ComposerConfig | null> => {
        emit({ type: "progress", items: [
          { agent_name: "Initializing...", status: "completed", description: "Agent ready" },
          { agent_name: "Designing workflow...", status: "running", description: "Fixing DPH syntax error" },
          { agent_name: "Validating...", status: "pending", description: "Waiting" },
        ] });

        const retryQuery = `${FLOW_GENERATION_SYSTEM_PROMPT}\n\n---\n\nUser request: ${prompt}\n\n${hint}`;
        let fullText = "";
        await sendChatRequestStream(
          { baseUrl: t.baseUrl, accessToken: t.accessToken, agentId: relayAgent.id, agentKey: relayAgent.key, agentVersion: relayAgent.version, query: retryQuery, stream: true, businessDomain },
          { onTextDelta: (ft: string, seg: string) => { fullText = ft; emit({ type: "text", fullText: ft, currentText: seg }); } },
        );

        const parsed = extractJsonFromLLMResponse(fullText);
        if (!parsed || !validateComposerConfig(parsed)) {
          logBadCase("gate2-retry", prompt, fullText, "regenerated output is not valid ComposerConfig JSON");
          return null;
        }
        if (parsed.orchestrator.flow) {
          const agentRefs = parsed.agents.map((a) => a.ref);
          const flowErrors = validateFlow(parsed.orchestrator.flow, agentRefs);
          if (flowErrors.length > 0) {
            logBadCase("gate2-retry", prompt, parsed, flowErrors.join("; "));
            return null;
          }
        }
        return parsed;
      };

      const result = await compileAndValidateWithRetry(config, regenerateForGate2, validateDphSyntax, 1);

      if (!result.ok) {
        logBadCase("gate2", prompt, config, `DPH syntax error at line ${result.lineNumber}: ${result.error}`);
        emit({ type: "text", fullText: `⚠️ Compiled DPH failed syntax check: ${result.error}\n\nUsing template fallback.`, currentText: "" });
        return buildConfigFromPrompt(prompt);
      }

      if (result.validatorSkipped) {
        console.error("[composer] warning: Gate 2 (DPH syntax check) skipped — dolphin parser unavailable");
      }

      config = result.config;
      config.orchestrator.dolphin = result.dph;
    }

    if (config.orchestrator.is_dolphin_mode === undefined) {
      config.orchestrator.is_dolphin_mode = 1;
    }

    return config;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logBadCase("exception", prompt, null, errMsg);
    emit({ type: "text", fullText: `⚠️ Generation failed: ${errMsg}\n\nUsing template fallback.`, currentText: "" });
    return buildConfigFromPrompt(prompt);
  }
}

// ── Create / Run / Cleanup operations ────────────────────────────────────────

export async function createAgents(
  config: ComposerConfig,
  getToken: TokenProvider,
  businessDomain: string,
): Promise<CreateResult> {
  const t = await getToken();
  const createdAgentIds: string[] = [];
  const agentIdMap: Record<string, string> = {};
  const agentKeyMap: Record<string, string> = {};
  const agentNameMap: Record<string, string> = {};

  // Rollback helper — delete all agents created so far
  const rollback = async (): Promise<void> => {
    for (const id of createdAgentIds) {
      try {
        await deleteAgent({ baseUrl: t.baseUrl, accessToken: t.accessToken, agentId: id, businessDomain });
      } catch { /* best effort */ }
    }
  };

  try {
    const defaultLlms = await getDefaultLlms(t.baseUrl, t.accessToken, businessDomain);

    // 1. Create, publish, and fetch info for each sub-agent
    for (const agentDef of config.agents) {
      // Agent name doubles as DPH tool identifier — spaces break @name() parsing
      const safeName = agentDef.name.replace(/\s+/g, "_");
      const createBody = buildAgentCreateBody(safeName, agentDef.profile, agentDef.system_prompt, undefined, defaultLlms);
      console.error(`[composer/create] subAgentBody: ${createBody.slice(0, 600)}`);
      const createRaw = await createAgent({ baseUrl: t.baseUrl, accessToken: t.accessToken, body: createBody, businessDomain });
      const createResult = JSON.parse(createRaw) as { id?: string; data?: { id?: string } };
      const agentId = createResult.id ?? createResult.data?.id;
      if (!agentId) {
        throw new Error(`Failed to create agent "${agentDef.name}": no id in response`);
      }
      createdAgentIds.push(agentId);
      agentIdMap[agentDef.ref] = agentId;

      // Publish if permitted (non-fatal — unpublished agents can still be used)
      try {
        const pubRes = await publishAgent({ baseUrl: t.baseUrl, accessToken: t.accessToken, agentId, businessDomain });
        console.error(`[composer/publish] ${agentDef.name} ok: ${pubRes.slice(0, 200)}`);
      } catch (err) {
        const body = err && typeof err === "object" && "body" in err ? (err as { body: string }).body : "";
        console.error(`[composer/publish] ${agentDef.name} FAILED: ${err instanceof Error ? err.message : err} — ${body.slice(0, 300)}`);
      }

      const info = await fetchAgentInfo({ baseUrl: t.baseUrl, accessToken: t.accessToken, agentId, version: "v0", businessDomain });
      agentKeyMap[agentDef.ref] = info.key;
      // Agent names are used as DPH identifiers (@name) — must not contain spaces
      agentNameMap[agentDef.ref] = agentDef.name.replace(/\s+/g, "_");
    }

    console.error(`[composer/create] agentIdMap: ${JSON.stringify(agentIdMap)}`);
    console.error(`[composer/create] agentKeyMap: ${JSON.stringify(agentKeyMap)}`);
    console.error(`[composer/create] agentNameMap: ${JSON.stringify(agentNameMap)}`);

    // 2. Process DPH script — replace @ref with actual agent name
    //    Platform registers tools by agent name (tool.py:104), so DPH @xxx must match the name.
    let processedDphScript: string;
    let answerVar = "answer";
    if (config.orchestrator.flow && config.orchestrator.flow.do.length > 0) {
      const compiled = compileToDph(config.orchestrator.flow);
      processedDphScript = compiled.dph;
      answerVar = compiled.answerVar;
    } else {
      processedDphScript = config.orchestrator.dolphin ?? "";
    }
    for (const [ref, name] of Object.entries(agentNameMap)) {
      processedDphScript = processedDphScript.replace(
        new RegExp(`@${ref}\\b`, "g"),
        `@${name}`,
      );
    }

    // 3. Create orchestrator agent with processed DPH script
    const isDolphinMode = config.orchestrator.is_dolphin_mode ?? 1;
    // Register sub-agents as callable skills in the orchestrator. The
    // `agent_input` schema declaration is REQUIRED — without it the platform
    // falls back to wrapping the parameter in an object, and @sub(query=$query)
    // fails at runtime with "agent_input query must be a string type".
    const agentSkills = Object.values(agentKeyMap).map((key) => ({
      agent_key: key,
      agent_version: "v0",
      agent_input: [
        {
          enable: true,
          map_type: "auto",
          input_name: "query",
          input_type: "string",
          input_desc: "query变量",
        },
      ],
      intervention: false,
      intervention_confirmation_message: "",
      data_source_config: { type: "self_configured", specific_inherit: "" },
      llm_config: { type: "self_configured" },
      agent_timeout: 0,
    }));
    const orchBody = buildAgentCreateBody(
      config.orchestrator.name,
      config.orchestrator.profile,
      config.orchestrator.system_prompt,
      {
        dolphin: processedDphScript,
        is_dolphin_mode: isDolphinMode,
        skills: { tools: [], agents: agentSkills, mcps: [] },
        _answerVar: answerVar,
      },
      defaultLlms,
    );
    const orchParsed = JSON.parse(orchBody);
    console.error(`[composer/create] dolphin (${orchParsed.config.dolphin.split("\n").length} lines): ${JSON.stringify(orchParsed.config.dolphin)}`);
    console.error(`[composer/create] answer_var: ${orchParsed.config.output?.variables?.answer_var}`);
    const orchRaw = await createAgent({ baseUrl: t.baseUrl, accessToken: t.accessToken, body: orchBody, businessDomain });
    const orchResult = JSON.parse(orchRaw) as { id?: string; data?: { id?: string } };
    const orchestratorId = orchResult.id ?? orchResult.data?.id;
    if (!orchestratorId) {
      throw new Error("Failed to create orchestrator agent: no id in response");
    }
    createdAgentIds.push(orchestratorId);

    // 4. Publish orchestrator (non-fatal)
    try {
      await publishAgent({ baseUrl: t.baseUrl, accessToken: t.accessToken, agentId: orchestratorId, businessDomain });
    } catch { /* permission may be restricted */ }

    return {
      orchestratorId,
      agentIds: agentIdMap,
      allAgentIds: createdAgentIds,
    };
  } catch (error) {
    // Log full error for debugging
    if (error && typeof error === "object" && "body" in error) {
      console.error(`[composer/create] Error: ${(error as { body: string }).body}`);
    } else if (error instanceof Error) {
      console.error(`[composer/create] Error: ${error.message}`);
    }
    // Rollback all created agents on failure
    await rollback();
    throw error;
  }
}

export async function runOrchestrator(
  orchestratorId: string,
  message: string,
  getToken: TokenProvider,
  businessDomain: string,
  callbacks: RunCallbacks,
  conversationId?: string,
): Promise<RunResult> {
  const t = await getToken();
  const agentInfo = await fetchAgentInfo({
    baseUrl: t.baseUrl,
    accessToken: t.accessToken,
    agentId: orchestratorId,
    version: "v0",
    businessDomain,
  });

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
      verbose: true,
      businessDomain,
    },
    {
      onTextDelta: callbacks.onTextDelta ?? (() => {}),
      onProgress: callbacks.onProgress,
      onSegmentComplete: callbacks.onSegmentComplete,
      onStepMeta: callbacks.onStepMeta,
      onConversationId: callbacks.onConversationId,
    },
  );

  return { conversationId: result.conversationId ?? conversationId ?? "" };
}

// ── Reverse lookup helpers (for stateless CLI operations) ────────────────────

/**
 * Fetch the full stored config of an orchestrator (or any agent).
 * Returns the `config` object from /agent-market/agent/{id}/version/v0.
 */
export async function fetchOrchestratorConfig(
  orchestratorId: string,
  getToken: TokenProvider,
  businessDomain: string,
): Promise<Record<string, unknown>> {
  const t = await getToken();
  const { fetchWithRetry } = await import("../utils/http.js");
  const { buildHeaders } = await import("../api/headers.js");
  const base = t.baseUrl.replace(/\/+$/, "");
  const url = `${base}/api/agent-factory/v3/agent-market/agent/${encodeURIComponent(orchestratorId)}/version/v0?is_visit=true`;
  const res = await fetchWithRetry(url, { method: "GET", headers: buildHeaders(t.accessToken, businessDomain) });
  const body = await res.text();
  if (!res.ok) {
    const { HttpError } = await import("../utils/http.js");
    throw new HttpError(res.status, res.statusText, body);
  }
  const parsed = JSON.parse(body) as { config?: Record<string, unknown> };
  return parsed.config ?? {};
}

/**
 * Given an orchestrator id, resolve its sub-agent ids by reading
 * `config.skills.agents[].agent_key` and reverse-looking-up each key.
 * Returns ids of sub-agents that could be resolved; silently skips any
 * that fail to resolve (e.g. already deleted, permission denied).
 */
export async function listSubAgentIds(
  orchestratorId: string,
  getToken: TokenProvider,
  businessDomain: string,
): Promise<string[]> {
  const config = await fetchOrchestratorConfig(orchestratorId, getToken, businessDomain);
  const skills = config.skills as { agents?: Array<{ agent_key?: string }> } | undefined;
  const keys = (skills?.agents ?? [])
    .map((a) => a.agent_key)
    .filter((k): k is string => typeof k === "string" && k.length > 0);
  if (keys.length === 0) return [];

  const t = await getToken();
  const { getAgentByKey } = await import("../api/agent-list.js");
  const ids: string[] = [];
  for (const key of keys) {
    try {
      const raw = await getAgentByKey({ baseUrl: t.baseUrl, accessToken: t.accessToken, key, businessDomain });
      const parsed = JSON.parse(raw) as { id?: string; data?: { id?: string } };
      const id = parsed.id ?? parsed.data?.id;
      if (id) ids.push(id);
    } catch { /* skip unresolvable */ }
  }
  return ids;
}

export async function cleanupAgents(
  agentIds: string[],
  getToken: TokenProvider,
  businessDomain: string,
): Promise<CleanupResult> {
  const t = await getToken();
  const deleted: string[] = [];
  const errors: Array<{ agentId: string; error: string }> = [];

  for (const agentId of agentIds) {
    try {
      // Unpublish first — platform rejects deletion of published agents (409)
      try {
        await unpublishAgent({ baseUrl: t.baseUrl, accessToken: t.accessToken, agentId, businessDomain });
      } catch { /* may already be unpublished */ }
      await deleteAgent({ baseUrl: t.baseUrl, accessToken: t.accessToken, agentId, businessDomain });
      deleted.push(agentId);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const body = error && typeof error === "object" && "body" in error ? (error as { body: string }).body : "";
      errors.push({ agentId, error: body ? `${msg} — ${body}` : msg });
    }
  }

  return { deleted, errors };
}
