import { IncomingMessage, ServerResponse } from "node:http";

import { readBody, handleApiError, jsonResponse, type TokenProvider } from "./explore-bkn.js";
import {
  getTemplates,
  generateConfig,
  createAgents,
  runOrchestrator,
  cleanupAgents,
  type ComposerConfig,
} from "./composer-engine.js";

// Re-export types for backward compatibility
export type { ComposerConfig, ComposerAgentDef, ComposerTemplate } from "./composer-engine.js";

// ── SSE helpers ──────────────────────────────────────────────────────────────

function sseHeaders(res: ServerResponse): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
}

function sseSend(res: ServerResponse, payload: Record<string, unknown>): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

// ── Route registration ────────────────────────────────────────────────────────

export function registerComposerRoutes(
  getToken: TokenProvider,
  businessDomain: string,
): Map<string, (req: IncomingMessage, res: ServerResponse) => void> {
  const routes = new Map<string, (req: IncomingMessage, res: ServerResponse) => void>();

  // ── GET /api/composer/templates ──────────────────────────────────────────
  routes.set("GET /api/composer/templates", (_req, res) => {
    jsonResponse(res, 200, { templates: getTemplates() });
  });

  // ── POST /api/composer/generate (SSE) ────────────────────────────────────
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

    sseHeaders(res);

    try {
      const config = await generateConfig(prompt, getToken, businessDomain, (event) => {
        sseSend(res, event as Record<string, unknown>);
      });
      sseSend(res, { type: "composer_config", config });
      sseSend(res, {
        type: "progress",
        items: [
          { agent_name: "Initializing workflow designer...", status: "completed", description: "Done" },
          { agent_name: "Designing agent roles and DPH script...", status: "completed", description: "Done" },
          { agent_name: "Finalizing configuration...", status: "completed", description: "Done" },
        ],
      });
      sseSend(res, { type: "done" });
      res.end();
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      sseSend(res, { type: "error", error: errMsg });
      res.end();
    }
  });

  // ── POST /api/composer/create ─────────────────────────────────────────────
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

    try {
      const result = await createAgents(config, getToken, businessDomain);
      jsonResponse(res, 200, result);
    } catch (error) {
      handleApiError(res, error);
    }
  });

  // ── POST /api/composer/run (SSE) ──────────────────────────────────────────
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

    // Pre-fetch token to validate it before starting SSE stream
    try {
      await getToken();
    } catch (error) {
      handleApiError(res, error);
      return;
    }

    sseHeaders(res);

    // SSE heartbeat — keeps connection alive and lets client detect stalls
    const heartbeat = setInterval(() => {
      try { res.write(": heartbeat\n\n"); } catch { /* connection gone */ }
    }, 15000);

    try {
      const result = await runOrchestrator(
        orchestratorId,
        message,
        getToken,
        businessDomain,
        {
          onTextDelta: (fullText: string, currentSegmentText: string) => {
            sseSend(res, { type: "text", fullText, currentText: currentSegmentText });
          },
          onProgress: (items) => {
            sseSend(res, { type: "progress", items });
          },
          onSegmentComplete: (segmentText: string, segmentIndex: number) => {
            sseSend(res, { type: "segment", text: segmentText, index: segmentIndex });
          },
          onStepMeta: (meta: Record<string, unknown>) => {
            sseSend(res, { type: "step_meta", meta });
          },
          onConversationId: (convId: string) => {
            sseSend(res, { type: "conversation_id", conversationId: convId });
          },
        },
        conversationId,
      );

      clearInterval(heartbeat);
      sseSend(res, { type: "done", conversationId: result.conversationId ?? conversationId ?? "" });
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
        sseSend(res, { type: "error", error: errMsg, detail: errDetail });
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

    try {
      const result = await cleanupAgents(agentIds, getToken, businessDomain);
      jsonResponse(res, 200, result);
    } catch (error) {
      handleApiError(res, error);
    }
  });

  return routes;
}
