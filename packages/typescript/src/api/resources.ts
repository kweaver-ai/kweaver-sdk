import { HttpError } from "../utils/http.js";
import { buildHeaders } from "./headers.js";

export const RESOURCE_LIST_DEFAULT_LIMIT = 30;

/** Field metadata for a resource schema. */
export interface ViewField {
  name: string;
  type: string;
  display_name?: string;
  comment?: string;
}

/** Normalized vega-backend Resource model. */
export interface Resource {
  id: string;
  name: string;
  catalog_id: string;
  category: string;
  source_identifier?: string;
  status?: string;
  schema_definition?: ViewField[];
  logic_definition?: unknown;
}

export function parseResource(raw: Record<string, unknown>): Resource {
  const res: Resource = {
    id: String(raw.id ?? ""),
    name: String(raw.name ?? ""),
    catalog_id: String(raw.catalog_id ?? ""),
    category: String(raw.category ?? ""),
  };
  if (raw.source_identifier != null) res.source_identifier = String(raw.source_identifier);
  if (raw.status != null) res.status = String(raw.status);
  if (Array.isArray(raw.schema_definition) && raw.schema_definition.length > 0) {
    res.schema_definition = (raw.schema_definition as Record<string, unknown>[]).map((f) => ({
      name: String(f.name ?? ""),
      type: String(f.type ?? "varchar"),
      display_name: f.display_name != null ? String(f.display_name) : undefined,
      comment: f.comment != null ? String(f.comment) : undefined,
    }));
  }
  if (raw.logic_definition !== undefined) res.logic_definition = raw.logic_definition;
  return res;
}

function extractListPayload(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    const items = obj.entries ?? obj.data;
    if (Array.isArray(items)) return items;
  }
  return [];
}

export interface CreateResourceOptions {
  baseUrl: string;
  accessToken: string;
  name: string;
  datasourceId: string;
  table: string;
  fields?: Array<{ name: string; type: string }>;
  businessDomain?: string;
}

export async function createResource(options: CreateResourceOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    name,
    datasourceId,
    table,
    fields = [],
    businessDomain = "bd_public",
  } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}/api/vega-backend/v1/resources`;

  const body: Record<string, unknown> = {
    name,
    catalog_id: datasourceId,
    category: "table",
    source_identifier: table,
  };
  if (fields.length > 0) body.schema_definition = fields;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      ...buildHeaders(accessToken, businessDomain),
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const responseBody = await response.text();
  if (!response.ok) {
    throw new HttpError(response.status, response.statusText, responseBody);
  }

  const data = JSON.parse(responseBody) as Record<string, unknown>;
  return String(data.id ?? "");
}

export interface ListResourcesOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
  /** Filter by catalog (data source) id. */
  datasourceId?: string;
  /** Server-side name filter. */
  name?: string;
  /** Category filter (e.g. "table", "logicview"). */
  category?: string;
  /** Max items; ignored when <= 0. */
  limit?: number;
}

export async function listResources(options: ListResourcesOptions): Promise<Resource[]> {
  const {
    baseUrl,
    accessToken,
    businessDomain = "bd_public",
    datasourceId,
    name,
    category,
    limit = RESOURCE_LIST_DEFAULT_LIMIT,
  } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const url = new URL(`${base}/api/vega-backend/v1/resources`);
  if (datasourceId) url.searchParams.set("catalog_id", datasourceId);
  if (name) url.searchParams.set("name", name);
  if (category) url.searchParams.set("category", category);
  if (limit && limit > 0) url.searchParams.set("limit", String(limit));

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: buildHeaders(accessToken, businessDomain),
  });

  const bodyText = await response.text();
  if (!response.ok) throw new HttpError(response.status, response.statusText, bodyText);

  const parsed = JSON.parse(bodyText) as unknown;
  const items = extractListPayload(parsed);
  return items
    .filter((item): item is Record<string, unknown> => item != null && typeof item === "object")
    .map(parseResource);
}

export interface DeleteResourceOptions {
  baseUrl: string;
  accessToken: string;
  id: string;
  businessDomain?: string;
}

export async function deleteResource(options: DeleteResourceOptions): Promise<void> {
  const { baseUrl, accessToken, id, businessDomain = "bd_public" } = options;
  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}/api/vega-backend/v1/resources/${encodeURIComponent(id)}`;
  const response = await fetch(url, {
    method: "DELETE",
    headers: buildHeaders(accessToken, businessDomain),
  });
  const bodyText = await response.text();
  if (!response.ok) throw new HttpError(response.status, response.statusText, bodyText);
}

export interface GetResourceOptions {
  baseUrl: string;
  accessToken: string;
  id: string;
  businessDomain?: string;
}

export async function getResource(options: GetResourceOptions): Promise<Resource> {
  const { baseUrl, accessToken, id, businessDomain = "bd_public" } = options;
  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}/api/vega-backend/v1/resources/${encodeURIComponent(id)}`;

  const response = await fetch(url, {
    method: "GET",
    headers: buildHeaders(accessToken, businessDomain),
  });

  const body = await response.text();
  if (!response.ok) throw new HttpError(response.status, response.statusText, body);

  const parsed = JSON.parse(body) as unknown;
  // vega-backend GET /:id returns { entries: [...] } (supports comma-separated ids)
  const items = extractListPayload(parsed);
  const raw = items.length > 0 ? items[0] : (parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null);
  if (!raw || typeof raw !== "object") throw new HttpError(500, "Invalid response", body);
  return parseResource(raw as Record<string, unknown>);
}

export interface FindResourceOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
  /** Resource name to search for. */
  name: string;
  /** Filter by catalog (data source) id. */
  datasourceId?: string;
  /** When true, apply client-side exact name match after server filter (default false). */
  exact?: boolean;
  /** When true, poll until a result appears or timeout (default false). */
  wait?: boolean;
  /** Total wait budget in ms (default 30000). Only used when wait is true. */
  timeoutMs?: number;
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function findResource(options: FindResourceOptions): Promise<Resource[]> {
  const {
    baseUrl,
    accessToken,
    businessDomain = "bd_public",
    name,
    datasourceId,
    exact = false,
    wait = false,
    timeoutMs = 30_000,
  } = options;

  const deadline = Date.now() + timeoutMs;
  let attempt = 0;

  while (true) {
    const list = await listResources({ baseUrl, accessToken, businessDomain, datasourceId, name });
    const results = exact ? list.filter((v) => v.name === name) : list;
    if (results.length > 0 || !wait || Date.now() >= deadline) return results;
    const delayMs = Math.min(5000, 1000 * 2 ** attempt);
    attempt += 1;
    await sleepMs(delayMs);
  }
}

export interface QueryResourceOptions {
  baseUrl: string;
  accessToken: string;
  id: string;
  offset?: number;
  limit?: number;
  needTotal?: boolean;
  filterCondition?: unknown;
  sort?: string;
  direction?: "asc" | "desc";
  businessDomain?: string;
}

export interface ResourceQueryResult {
  entries?: unknown;
  total_count?: number;
}

export async function queryResource(options: QueryResourceOptions): Promise<ResourceQueryResult> {
  const {
    baseUrl,
    accessToken,
    id,
    offset = 0,
    limit = 50,
    needTotal = false,
    filterCondition,
    sort,
    direction,
    businessDomain = "bd_public",
  } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}/api/vega-backend/v1/resources/${encodeURIComponent(id)}/data`;

  const body: Record<string, unknown> = { offset, limit, need_total: needTotal };
  if (filterCondition !== undefined) body.filter_condition = filterCondition;
  if (sort !== undefined) body.sort = sort;
  if (direction !== undefined) body.direction = direction;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      ...buildHeaders(accessToken, businessDomain),
      "content-type": "application/json",
      "x-http-method-override": "GET",
    },
    body: JSON.stringify(body),
  });

  const bodyText = await response.text();
  if (!response.ok) throw new HttpError(response.status, response.statusText, bodyText);

  const parsed = JSON.parse(bodyText) as unknown;
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed as ResourceQueryResult;
  }
  return {};
}
