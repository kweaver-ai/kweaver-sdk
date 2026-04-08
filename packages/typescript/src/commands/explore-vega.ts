import { IncomingMessage, ServerResponse } from "node:http";

import { HttpError } from "../utils/http.js";
import {
  listVegaCatalogs,
  vegaCatalogHealthStatus,
  listVegaCatalogResources,
  queryVegaResourceData,
  listVegaDiscoverTasks,
} from "../api/vega.js";
import { with401RefreshRetry } from "../auth/oauth.js";
import { readBody } from "./explore-bkn.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function jsonResponse(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

function handleError(res: ServerResponse, error: unknown): void {
  if (error instanceof HttpError) {
    let detail = "";
    try {
      const parsed = JSON.parse(error.body) as Record<string, unknown>;
      detail = typeof parsed.description === "string" ? parsed.description : "";
    } catch { /* ignore */ }
    jsonResponse(res, error.status, {
      error: detail || error.message,
      upstream_status: error.status,
    });
  } else {
    const message = error instanceof Error ? error.message : String(error);
    jsonResponse(res, 500, { error: message });
  }
}

// ── Vega route handlers ──────────────────────────────────────────────────────

export function registerVegaRoutes(
  token: { baseUrl: string; accessToken: string },
  businessDomain: string,
): Map<string, (req: IncomingMessage, res: ServerResponse) => void> {
  const routes = new Map<string, (req: IncomingMessage, res: ServerResponse) => void>();

  // GET /api/vega/catalogs — list catalogs + health status in parallel
  routes.set("GET /api/vega/catalogs", async (_req, res) => {
    try {
      const [catalogsResult, healthResult] = await Promise.allSettled([
        with401RefreshRetry(() =>
          listVegaCatalogs({
            baseUrl: token.baseUrl,
            accessToken: token.accessToken,
            businessDomain,
          }),
        ),
        with401RefreshRetry(() =>
          vegaCatalogHealthStatus({
            baseUrl: token.baseUrl,
            accessToken: token.accessToken,
            businessDomain,
            ids: "all",
          }),
        ),
      ]);

      const catalogs =
        catalogsResult.status === "fulfilled"
          ? JSON.parse(catalogsResult.value)
          : { error: String(catalogsResult.reason) };

      const health =
        healthResult.status === "fulfilled"
          ? JSON.parse(healthResult.value)
          : { error: String(healthResult.reason) };

      jsonResponse(res, 200, { catalogs, health });
    } catch (error) {
      handleError(res, error);
    }
  });

  // GET /api/vega/catalog-resources?catalogId=<id> — list resources in a catalog
  routes.set("GET /api/vega/catalog-resources", async (req, res) => {
    try {
      const catalogId = new URL(req.url ?? "/", "http://localhost").searchParams.get("catalogId");
      if (!catalogId) {
        jsonResponse(res, 400, { error: "catalogId query parameter is required" });
        return;
      }
      const raw = await with401RefreshRetry(() =>
        listVegaCatalogResources({
          baseUrl: token.baseUrl,
          accessToken: token.accessToken,
          businessDomain,
          id: catalogId,
        }),
      );
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(raw);
    } catch (error) {
      handleError(res, error);
    }
  });

  // POST /api/vega/query — query resource data
  routes.set("POST /api/vega/query", async (req, res) => {
    try {
      const bodyStr = await readBody(req);
      const body = JSON.parse(bodyStr) as { resourceId: string; query?: unknown };
      if (!body.resourceId) {
        jsonResponse(res, 400, { error: "resourceId is required" });
        return;
      }
      const raw = await with401RefreshRetry(() =>
        queryVegaResourceData({
          baseUrl: token.baseUrl,
          accessToken: token.accessToken,
          businessDomain,
          id: body.resourceId,
          body: JSON.stringify(body.query ?? {}),
        }),
      );
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(raw);
    } catch (error) {
      handleError(res, error);
    }
  });

  // GET /api/vega/tasks — list discover tasks
  routes.set("GET /api/vega/tasks", async (_req, res) => {
    try {
      const raw = await with401RefreshRetry(() =>
        listVegaDiscoverTasks({
          baseUrl: token.baseUrl,
          accessToken: token.accessToken,
          businessDomain,
        }),
      );
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(raw);
    } catch (error) {
      handleError(res, error);
    }
  });

  return routes;
}
