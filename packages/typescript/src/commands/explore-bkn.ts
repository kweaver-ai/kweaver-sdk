import { IncomingMessage, ServerResponse } from "node:http";

import { HttpError } from "../utils/http.js";
import {
  getKnowledgeNetwork,
  listObjectTypes,
  listRelationTypes,
  listActionTypes,
} from "../api/knowledge-networks.js";
import { objectTypeQuery, objectTypeProperties, subgraph } from "../api/ontology-query.js";
import { semanticSearch } from "../api/semantic-search.js";

// ── Interfaces ──────────────────────────────────────────────────────────────

export interface ExploreMeta {
  bkn: { id: string; name: string };
  statistics: { object_count: number; relation_count: number };
  objectTypes: Array<{
    id: string;
    name: string;
    displayKey: string;
    propertyCount: number;
    properties: Array<{ name: string; type?: string }>;
  }>;
  relationTypes: Array<{
    id: string;
    name: string;
    sourceOtId: string;
    targetOtId: string;
    sourceOtName: string;
    targetOtName: string;
  }>;
  actionTypes: Array<{ id: string; name: string }>;
}

export interface ExploreOt {
  id: string;
  name: string;
  displayKey: string;
  propertyCount: number;
  properties: Array<{ name: string; type?: string }>;
}

export interface ExploreRt {
  id: string;
  name: string;
  sourceOtId: string;
  targetOtId: string;
  sourceOtName: string;
  targetOtName: string;
}

export interface ExploreAt {
  id: string;
  name: string;
}

export interface ExploreBkn {
  id: string;
  name: string;
}

export interface ExploreStats {
  object_count: number;
  relation_count: number;
}

// ── Constants ───────────────────────────────────────────────────────────────

export const EXPLORE_BOOTSTRAP_RETRY_DELAY_MS = 300;
export const EXPLORE_BOOTSTRAP_MAX_ATTEMPTS = 2;

// ── Meta builder ────────────────────────────────────────────────────────────

export function buildMeta(
  knRaw: string,
  otRaw: string,
  rtRaw: string,
  atRaw: string,
): ExploreMeta {
  const kn = JSON.parse(knRaw) as {
    id: string;
    name: string;
    statistics?: { object_count?: number; relation_count?: number };
  };
  const otParsed = JSON.parse(otRaw) as Record<string, unknown>;
  const otItems = (
    Array.isArray(otParsed) ? otParsed
    : Array.isArray(otParsed.entries) ? otParsed.entries
    : Array.isArray(otParsed.object_types) ? otParsed.object_types
    : []
  ) as Array<{
    id: string;
    name: string;
    display_key?: string;
    properties?: Array<{ name: string; type?: string }>;
    data_properties?: Array<{ name: string; type?: string }>;
  }>;
  const rtParsed = JSON.parse(rtRaw) as Record<string, unknown>;
  const rtItems = (
    Array.isArray(rtParsed) ? rtParsed
    : Array.isArray(rtParsed.entries) ? rtParsed.entries
    : Array.isArray(rtParsed.relation_types) ? rtParsed.relation_types
    : []
  ) as Array<{
    id: string;
    name: string;
    source_object_type_id: string;
    target_object_type_id: string;
    source_object_type?: { name: string };
    target_object_type?: { name: string };
  }>;
  const atParsed = JSON.parse(atRaw) as Record<string, unknown>;
  const atItems = (
    Array.isArray(atParsed) ? atParsed
    : Array.isArray(atParsed.entries) ? atParsed.entries
    : Array.isArray(atParsed.action_types) ? atParsed.action_types
    : []
  ) as Array<{ id: string; name: string }>;

  return {
    bkn: { id: kn.id, name: kn.name },
    statistics: {
      object_count: kn.statistics?.object_count ?? 0,
      relation_count: kn.statistics?.relation_count ?? 0,
    },
    objectTypes: otItems.map((o) => {
      const props = o.properties ?? o.data_properties ?? [];
      return {
        id: o.id,
        name: o.name,
        displayKey: o.display_key ?? "",
        propertyCount: props.length,
        properties: props.map((p) => ({
          name: p.name,
          ...(p.type !== undefined ? { type: p.type } : {}),
        })),
      };
    }),
    relationTypes: rtItems.map((r) => ({
      id: r.id,
      name: r.name,
      sourceOtId: r.source_object_type_id,
      targetOtId: r.target_object_type_id,
      sourceOtName: r.source_object_type?.name ?? "",
      targetOtName: r.target_object_type?.name ?? "",
    })),
    actionTypes: atItems.map((a) => ({
      id: a.id,
      name: a.name,
    })),
  };
}

// ── Bootstrap helpers ───────────────────────────────────────────────────────

function getErrorMessage(error: unknown): string {
  const parts: string[] = [];

  if (error instanceof Error) {
    if (error.message) {
      parts.push(error.message);
    }
    const cause = "cause" in error && error.cause instanceof Error ? error.cause.message : "";
    if (cause) {
      parts.push(cause);
    }
  } else {
    parts.push(String(error));
  }

  return parts.join(" ").toLowerCase();
}

export function isRetryableExploreBootstrapError(error: unknown): boolean {
  if (error instanceof HttpError) {
    return false;
  }

  const message = getErrorMessage(error);
  if (!message) {
    return false;
  }

  return [
    "fetch failed",
    "client network socket disconnected",
    "socket hang up",
    "econnreset",
    "econnrefused",
    "etimedout",
    "tls",
    "secure tls connection",
  ].some((token) => message.includes(token));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function loadExploreMetaWithRetry(
  token: { baseUrl: string; accessToken: string },
  knId: string,
  businessDomain: string,
): Promise<ExploreMeta> {
  for (let attempt = 1; attempt <= EXPLORE_BOOTSTRAP_MAX_ATTEMPTS; attempt++) {
    try {
      const [knRaw, otRaw, rtRaw, atRaw] = await Promise.all([
        getKnowledgeNetwork({
          baseUrl: token.baseUrl,
          accessToken: token.accessToken,
          knId,
          businessDomain,
          include_statistics: true,
        }),
        listObjectTypes({
          baseUrl: token.baseUrl,
          accessToken: token.accessToken,
          knId,
          businessDomain,
        }),
        listRelationTypes({
          baseUrl: token.baseUrl,
          accessToken: token.accessToken,
          knId,
          businessDomain,
        }),
        listActionTypes({
          baseUrl: token.baseUrl,
          accessToken: token.accessToken,
          knId,
          businessDomain,
        }),
      ]);

      return buildMeta(knRaw, otRaw, rtRaw, atRaw);
    } catch (error) {
      if (attempt >= EXPLORE_BOOTSTRAP_MAX_ATTEMPTS || !isRetryableExploreBootstrapError(error)) {
        throw error;
      }
      await sleep(EXPLORE_BOOTSTRAP_RETRY_DELAY_MS);
    }
  }

  throw new Error("Failed to load explorer metadata.");
}

// ── HTTP helpers ────────────────────────────────────────────────────────────

export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function jsonResponse(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

// ── BKN route handlers ──────────────────────────────────────────────────────

export function registerBknRoutes(
  meta: ExploreMeta,
  token: { baseUrl: string; accessToken: string },
  businessDomain: string,
): Map<string, (req: IncomingMessage, res: ServerResponse) => void> {
  const knId = meta.bkn.id;
  const routes = new Map<string, (req: IncomingMessage, res: ServerResponse) => void>();

  routes.set("GET /api/bkn/meta", (_req, res) => {
    jsonResponse(res, 200, meta);
  });

  routes.set("POST /api/bkn/instances", async (req, res) => {
    try {
      const bodyStr = await readBody(req);
      const body = JSON.parse(bodyStr) as {
        otId: string;
        limit?: number;
        search_after?: unknown[];
        condition?: unknown;
        _instance_identities?: unknown[];
      };
      const queryBody = JSON.stringify({
        limit: body.limit ?? 50,
        ...(body.search_after ? { search_after: body.search_after } : {}),
        ...(body.condition ? { condition: body.condition } : {}),
        ...(body._instance_identities ? { _instance_identities: body._instance_identities } : {}),
      });
      const result = await objectTypeQuery({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        knId,
        otId: body.otId,
        body: queryBody,
        businessDomain,
      });
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(result);
    } catch (error) {
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
  });

  routes.set("POST /api/bkn/subgraph", async (req, res) => {
    const bodyStr = await readBody(req);
    console.error("[subgraph] request body:", bodyStr);
    try {
      const parsed = JSON.parse(bodyStr);
      const hasRelationPaths = Array.isArray(parsed.relation_type_paths);
      const result = await subgraph({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        knId,
        body: bodyStr,
        businessDomain,
        ...(hasRelationPaths ? { queryType: "relation_path" } : {}),
      });
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(result);
    } catch (err: unknown) {
      const e = err as { status?: number; body?: string; message?: string };
      console.error("[subgraph] error:", e.status, e.body ?? e.message);
      const status = e.status ?? 500;
      const errBody = e.body ?? e.message ?? "subgraph error";
      res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: typeof errBody === "string" ? errBody : JSON.stringify(errBody) }));
    }
  });

  routes.set("POST /api/bkn/search", async (req, res) => {
    try {
      const bodyStr = await readBody(req);
      const body = JSON.parse(bodyStr) as { query: string; maxConcepts?: number };
      const result = await semanticSearch({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        knId,
        query: body.query,
        businessDomain,
        maxConcepts: body.maxConcepts,
      });
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(result);
    } catch (error) {
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
  });

  routes.set("POST /api/bkn/properties", async (req, res) => {
    try {
      const bodyStr = await readBody(req);
      const body = JSON.parse(bodyStr) as { otId: string; [key: string]: unknown };
      const { otId, ...rest } = body;
      const result = await objectTypeProperties({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        knId,
        otId,
        body: JSON.stringify(rest),
        businessDomain,
      });
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(result);
    } catch (error) {
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
  });

  return routes;
}
