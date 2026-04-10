import { IncomingMessage, ServerResponse } from "node:http";

import { createAgent, publishAgent, deleteAgent } from "../api/agent-list.js";
import { fetchAgentInfo, sendChatRequestStream } from "../api/agent-chat.js";
import { readBody, handleApiError, jsonResponse, type TokenProvider } from "./explore-bkn.js";

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
    dolphin: string;
    is_dolphin_mode?: number;
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
        dolphin: [
          "design = @architect(user_request)",
          "code = @developer(design)",
          "review = @reviewer(code)",
          "RETURN review",
        ].join("\n"),
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
        dolphin: [
          "findings_a = @researcher_a(user_request)",
          "findings_b = @researcher_b(user_request)",
          "report = @synthesizer(findings_a + findings_b)",
          "RETURN report",
        ].join("\n"),
        is_dolphin_mode: 1,
      },
    },
  },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

function buildAgentCreateBody(name: string, profile: string, systemPrompt: string, extra?: Record<string, unknown>): string {
  return JSON.stringify({
    name,
    profile,
    avatar_type: 1,
    avatar: "icon-dip-agent-default",
    product_key: "DIP",
    config: {
      input: { fields: [{ name: "user_input", type: "string" }] },
      output: { default_format: "markdown" },
      system_prompt: systemPrompt,
      ...extra,
    },
  });
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
      // 1. Create, publish, and fetch info for each sub-agent
      for (const agentDef of config.agents) {
        const createBody = buildAgentCreateBody(agentDef.name, agentDef.profile, agentDef.system_prompt);
        const createRaw = await createAgent({ baseUrl: t.baseUrl, accessToken: t.accessToken, body: createBody, businessDomain });
        const createResult = JSON.parse(createRaw) as { data?: { id?: string } };
        const agentId = createResult.data?.id;
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
      let processedDphScript = config.orchestrator.dolphin;
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
      );
      const orchRaw = await createAgent({ baseUrl: t.baseUrl, accessToken: t.accessToken, body: orchBody, businessDomain });
      const orchResult = JSON.parse(orchRaw) as { data?: { id?: string } };
      const orchestratorId = orchResult.data?.id;
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
