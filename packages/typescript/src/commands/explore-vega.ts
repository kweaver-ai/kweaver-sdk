import { IncomingMessage, ServerResponse } from "node:http";

import {
  listVegaCatalogs,
  vegaCatalogHealthStatus,
  listVegaCatalogResources,
  queryVegaResourceData,
} from "../api/vega.js";
import { with401RefreshRetry } from "../auth/oauth.js";
import { readBody, jsonResponse, handleApiError } from "./explore-bkn.js";

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
      handleApiError(res, error);
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
      handleApiError(res, error);
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
      handleApiError(res, error);
    }
  });

  return routes;
}
