import { IncomingMessage, ServerResponse } from "node:http";

import { HttpError } from "../utils/http.js";
import { listAgents } from "../api/agent-list.js";
import { fetchAgentInfo, sendChatRequestStream } from "../api/agent-chat.js";
import { with401RefreshRetry } from "../auth/oauth.js";
import { readBody } from "./explore-bkn.js";

// ── Chat route handlers ──────────────────────────────────────────────────────

export function registerChatRoutes(
  token: { baseUrl: string; accessToken: string },
  businessDomain: string,
): Map<string, (req: IncomingMessage, res: ServerResponse) => void> {
  const routes = new Map<string, (req: IncomingMessage, res: ServerResponse) => void>();

  // GET /api/chat/agents — list published agents
  routes.set("GET /api/chat/agents", async (_req, res) => {
    try {
      const raw = await with401RefreshRetry(() =>
        listAgents({
          baseUrl: token.baseUrl,
          accessToken: token.accessToken,
          businessDomain,
        }),
      );
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(raw);
    } catch (error) {
      if (error instanceof HttpError) {
        res.writeHead(error.status, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: error.message, upstream_status: error.status }));
      } else {
        const message = error instanceof Error ? error.message : String(error);
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: message }));
      }
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
    let agentInfo: { id: string; key: string; version: string };
    try {
      agentInfo = await with401RefreshRetry(() =>
        fetchAgentInfo({
          baseUrl: token.baseUrl,
          accessToken: token.accessToken,
          agentId,
          version: version ?? "1",
          businessDomain,
        }),
      );
    } catch (error) {
      if (error instanceof HttpError) {
        res.writeHead(error.status, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: error.message, upstream_status: error.status }));
      } else {
        const message2 = error instanceof Error ? error.message : String(error);
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: message2 }));
      }
      return;
    }

    // Set SSE response headers
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    // Stream chat response
    try {
      const result = await sendChatRequestStream(
        {
          baseUrl: token.baseUrl,
          accessToken: token.accessToken,
          agentId: agentInfo.id,
          agentKey: agentInfo.key,
          agentVersion: agentInfo.version,
          query: message,
          conversationId,
          stream: true,
          businessDomain,
        },
        {
          onTextDelta: (fullText: string) => {
            const event = JSON.stringify({ type: "text", fullText });
            res.write(`data: ${event}\n\n`);
          },
        },
      );

      const doneEvent = JSON.stringify({
        type: "done",
        conversationId: result.conversationId ?? conversationId ?? "",
      });
      res.write(`data: ${doneEvent}\n\n`);
      res.end();
    } catch (error) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
      } else {
        const errEvent = JSON.stringify({
          type: "error",
          error: error instanceof Error ? error.message : String(error),
        });
        res.write(`data: ${errEvent}\n\n`);
        res.end();
      }
    }
  });

  return routes;
}
