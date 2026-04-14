import { IncomingMessage, ServerResponse } from "node:http";

import { listAgents } from "../api/agent-list.js";
import { fetchAgentInfo, sendChatRequestStream } from "../api/agent-chat.js";
import { getTracesByConversation } from "../api/conversations.js";
import { readBody, handleApiError, jsonResponse, type TokenProvider } from "./explore-bkn.js";

// ── Chat route handlers ──────────────────────────────────────────────────────

export function registerChatRoutes(
  getToken: TokenProvider,
  businessDomain: string,
): Map<string, (req: IncomingMessage, res: ServerResponse) => void> {
  const routes = new Map<string, (req: IncomingMessage, res: ServerResponse) => void>();

  // GET /api/chat/agents — list published agents
  routes.set("GET /api/chat/agents", async (_req, res) => {
    try {
      const t = await getToken();
      const raw = await listAgents({
        baseUrl: t.baseUrl,
        accessToken: t.accessToken,
        businessDomain,
        limit: 50,
        is_to_square: 0,
      });
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(raw);
    } catch (error) {
      handleApiError(res, error);
    }
  });

  // POST /api/chat/send — stream a chat response via SSE
  routes.set("POST /api/chat/send", async (req, res) => {
    let bodyStr: string;
    try {
      bodyStr = await readBody(req);
    } catch {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Failed to read request body" }));
      return;
    }

    let agentId: string;
    let message: string;
    let conversationId: string | undefined;
    let version: string | undefined;

    try {
      const body = JSON.parse(bodyStr) as {
        agentId?: string;
        message?: string;
        conversationId?: string;
        version?: string;
      };
      agentId = body.agentId ?? "";
      message = body.message ?? "";
      conversationId = body.conversationId;
      version = body.version;
    } catch {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Invalid JSON body" }));
      return;
    }

    if (!agentId || !message) {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "agentId and message are required" }));
      return;
    }

    // Fetch agent info to get key + version
    const t = await getToken();
    let agentInfo: { id: string; key: string; version: string };
    try {
      agentInfo = await fetchAgentInfo({
        baseUrl: t.baseUrl,
        accessToken: t.accessToken,
        agentId,
        version: version ?? "v0",
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
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: errMsg, detail: errDetail }));
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

  // GET /api/chat/trace?agentId=X&conversationId=Y — fetch trace data
  routes.set("GET /api/chat/trace", async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const agentId = url.searchParams.get("agentId") || "";
      const conversationId = url.searchParams.get("conversationId") || "";
      if (!agentId || !conversationId) {
        jsonResponse(res, 400, { error: "agentId and conversationId are required" });
        return;
      }
      const t = await getToken();
      const raw = await getTracesByConversation({
        baseUrl: t.baseUrl,
        accessToken: t.accessToken,
        agentId,
        conversationId,
        businessDomain,
      });
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(raw);
    } catch (error) {
      handleApiError(res, error);
    }
  });

  return routes;
}
