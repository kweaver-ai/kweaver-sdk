import { HttpError } from "../utils/http.js";
import { buildHeaders } from "./headers.js";

const VEGA_BASE = "/api/vega-backend/v1";

function extractViewId(data: unknown): string | null {
  if (Array.isArray(data) && data.length > 0) {
    const item = data[0];
    if (typeof item === "string") return item;
    if (item && typeof item === "object" && "id" in item) {
      return String((item as Record<string, unknown>).id ?? "");
    }
  }
  if (data && typeof data === "object" && "id" in data) {
    return String((data as Record<string, unknown>).id ?? "");
  }
  return null;
}

/** Field metadata returned by the resources API. */
export interface ViewField {
  name: string;
  type: string;
  display_name?: string;
  comment?: string;
}

/** Normalized data view model (vega-backend resource). */
export interface DataView {
  id: string;
  name: string;
  query_type: string;
  datasource_id: string;
  /** View type, e.g. "atomic" or "custom". */
  type?: string;
  /** Underlying data source engine, e.g. "mysql", "postgresql". */
  data_source_type?: string;
  /** Human-readable data source name. */
  data_source_name?: string;
  /** Full SQL expression stored in the view definition (Trino catalog.schema.table). */
  sql_str?: string;
  /** Fully-qualified table reference (catalog."schema"."table"). */
  meta_table_name?: string;
  /** Field metadata. Populated by `get`; absent (`undefined`) in `list` results. */
  fields?: ViewField[];
}

export function parseDataView(raw: Record<string, unknown>): DataView {
  // Vega resources store columns in source_metadata.columns; fall back to raw.fields
  const srcMeta = raw.source_metadata as Record<string, unknown> | undefined;
  const fieldsRaw = srcMeta?.columns ?? raw.fields;
  let fields: ViewField[] | undefined;
  if (Array.isArray(fieldsRaw) && fieldsRaw.length > 0) {
    fields = [];
    for (const f of fieldsRaw) {
      if (f && typeof f === "object") {
        const fr = f as Record<string, unknown>;
        fields.push({
          name: String(fr.name ?? ""),
          type: String(fr.type ?? "varchar"),
          display_name: fr.display_name != null ? String(fr.display_name) : undefined,
          comment: fr.comment != null ? String(fr.comment) : undefined,
        });
      }
    }
  }
  const dv: DataView = {
    id: String(raw.id ?? ""),
    name: String(raw.name ?? ""),
    query_type: String(raw.query_type ?? "SQL"),
    datasource_id: String(raw.catalog_id ?? raw.data_source_id ?? raw.group_id ?? ""),
  };
  if (raw.type != null) dv.type = String(raw.type);
  if (raw.data_source_type != null) dv.data_source_type = String(raw.data_source_type);
  if (raw.data_source_name != null) dv.data_source_name = String(raw.data_source_name);
  if (raw.sql_str != null) dv.sql_str = String(raw.sql_str);
  if (raw.meta_table_name != null) dv.meta_table_name = String(raw.meta_table_name);
  if (fields) dv.fields = fields;
  return dv;
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

export interface CreateDataViewOptions {
  baseUrl: string;
  accessToken: string;
  name: string;
  datasourceId: string;
  table: string;
  fields?: Array<{ name: string; type: string }>;
  businessDomain?: string;
}

export async function createDataView(options: CreateDataViewOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    name,
    datasourceId,
    table,
    fields = [],
    businessDomain = "bd_public",
  } = options;

  const body = JSON.stringify({
    name,
    catalog_id: datasourceId,
    technical_name: table,
    type: "atomic",
    query_type: "SQL",
    category: "table",
    fields,
  });

  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}${VEGA_BASE}/resources`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      ...buildHeaders(accessToken, businessDomain),
      "content-type": "application/json",
    },
    body,
  });

  const responseBody = await response.text();
  if (!response.ok) {
    // If resource already exists (409 or 403), try to find and return its ID
    if (response.status === 409 || response.status === 403) {
      try {
        const errBody = JSON.parse(responseBody) as { error_code?: string };
        if (errBody.error_code?.includes("Existed") || response.status === 409) {
          const actualId = await findDataViewByName({ baseUrl, accessToken, name, groupId: datasourceId, businessDomain });
          if (actualId && fields.length > 0) {
            await deleteDataView({ baseUrl, accessToken, id: actualId, businessDomain });
            const retryResponse = await fetch(url, {
              method: "POST",
              headers: { ...buildHeaders(accessToken, businessDomain), "content-type": "application/json" },
              body,
            });
            if (retryResponse.ok) {
              const retryBody = await retryResponse.text();
              const retryId = extractViewId(JSON.parse(retryBody));
              return retryId ?? actualId;
            }
          }
          if (actualId) return actualId;
        }
      } catch { /* fall through to throw */ }
    }
    throw new HttpError(response.status, response.statusText, responseBody);
  }

  const createdId = extractViewId(JSON.parse(responseBody));
  return createdId ?? "";
}

async function findDataViewByName(options: {
  baseUrl: string;
  accessToken: string;
  name: string;
  groupId: string;
  businessDomain: string;
}): Promise<string | null> {
  const list = await listDataViews({
    baseUrl: options.baseUrl,
    accessToken: options.accessToken,
    businessDomain: options.businessDomain,
    name: options.name,
    datasourceId: options.groupId,
  });
  const match = list.find((e) => e.name === options.name && e.datasource_id === options.groupId);
  return match?.id ?? null;
}

export interface ListDataViewsOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
  /** Filter by catalog (datasource) id. */
  datasourceId?: string;
  /** Server-side keyword filter (fuzzy). */
  name?: string;
  /** View type filter (e.g. atomic, custom). */
  type?: string;
  /** Max items; default 30. */
  limit?: number;
}

export async function listDataViews(options: ListDataViewsOptions): Promise<DataView[]> {
  const {
    baseUrl,
    accessToken,
    businessDomain = "bd_public",
    datasourceId,
    name,
    type,
    limit = 30,
  } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const url = new URL(`${base}${VEGA_BASE}/resources`);
  url.searchParams.set("limit", String(limit));
  if (datasourceId) url.searchParams.set("catalog_id", datasourceId);
  if (name) url.searchParams.set("keyword", name);
  if (type) url.searchParams.set("type", type);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: buildHeaders(accessToken, businessDomain),
  });

  const bodyText = await response.text();
  if (!response.ok) {
    throw new HttpError(response.status, response.statusText, bodyText);
  }

  const parsed = JSON.parse(bodyText) as unknown;
  const items = extractListPayload(parsed);
  const out: DataView[] = [];
  for (const item of items) {
    if (item && typeof item === "object") {
      out.push(parseDataView(item as Record<string, unknown>));
    }
  }
  return out;
}

export interface DeleteDataViewOptions {
  baseUrl: string;
  accessToken: string;
  id: string;
  businessDomain?: string;
}

export async function deleteDataView(options: DeleteDataViewOptions): Promise<void> {
  const { baseUrl, accessToken, id, businessDomain = "bd_public" } = options;
  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}${VEGA_BASE}/resources/${encodeURIComponent(id)}`;
  const response = await fetch(url, {
    method: "DELETE",
    headers: buildHeaders(accessToken, businessDomain),
  });
  const bodyText = await response.text();
  if (!response.ok) {
    throw new HttpError(response.status, response.statusText, bodyText);
  }
}

export interface GetDataViewOptions {
  baseUrl: string;
  accessToken: string;
  id: string;
  businessDomain?: string;
}

export async function getDataView(options: GetDataViewOptions): Promise<DataView> {
  const {
    baseUrl,
    accessToken,
    id,
    businessDomain = "bd_public",
  } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}${VEGA_BASE}/resources/${encodeURIComponent(id)}`;

  const response = await fetch(url, {
    method: "GET",
    headers: buildHeaders(accessToken, businessDomain),
  });

  const body = await response.text();
  if (!response.ok) {
    throw new HttpError(response.status, response.statusText, body);
  }

  let parsed: unknown = JSON.parse(body);
  if (Array.isArray(parsed) && parsed.length > 0) {
    parsed = parsed[0];
  }
  if (!parsed || typeof parsed !== "object") {
    throw new HttpError(500, "Invalid response", body);
  }
  return parseDataView(parsed as Record<string, unknown>);
}

export interface FindDataViewOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
  /** View name to search for (sent as keyword to server). */
  name: string;
  /** Filter by catalog (datasource) id. */
  datasourceId?: string;
  /** When true, apply client-side exact name match after keyword search (default false). */
  exact?: boolean;
  /** When true, poll until a result appears or timeout (default false). */
  wait?: boolean;
  /** Total wait budget in ms (default 30000). Only used when wait is true. */
  timeoutMs?: number;
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Find data views by name. Uses server-side keyword filtering; when `exact` is true,
 * applies client-side `name ===` filter. Optional polling with exponential backoff.
 */
export async function findDataView(options: FindDataViewOptions): Promise<DataView[]> {
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
    const list = await listDataViews({
      baseUrl,
      accessToken,
      businessDomain,
      datasourceId,
      name,
      limit: -1,
    });
    const results = exact ? list.filter((v) => v.name === name) : list;
    if (results.length > 0 || !wait || Date.now() >= deadline) return results;
    const delayMs = Math.min(5000, 1000 * 2 ** attempt);
    attempt += 1;
    await sleepMs(delayMs);
  }
}

/** Options for querying data view rows via vega-backend resources. */
export interface QueryDataViewOptions {
  baseUrl: string;
  accessToken: string;
  id: string;
  sql?: string;
  offset?: number;
  limit?: number;
  needTotal?: boolean;
  outputFields?: string[];
  filters?: Record<string, unknown>;
  sort?: Array<Record<string, unknown>>;
  businessDomain?: string;
}

/** Query result from vega-backend resources data endpoint. */
export interface DataViewQueryResult {
  columns?: Array<{ name: string; type?: string; vega_type?: string }>;
  entries?: unknown;
  total_count?: number;
}

/**
 * Execute a query against a data view (POST /api/vega-backend/v1/resources/:id/data).
 * When `sql` is omitted, the server uses the view's stored SQL definition.
 */
export async function queryDataView(options: QueryDataViewOptions): Promise<DataViewQueryResult> {
  const {
    baseUrl,
    accessToken,
    id,
    sql,
    offset = 0,
    limit = 50,
    needTotal = false,
    outputFields,
    filters,
    sort,
    businessDomain = "bd_public",
  } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}${VEGA_BASE}/resources/${encodeURIComponent(id)}/data`;

  const body: Record<string, unknown> = {
    offset,
    limit,
    need_total: needTotal,
  };
  if (sql !== undefined && sql !== "") body.sql = sql;
  if (outputFields !== undefined) body.output_fields = outputFields;
  if (filters !== undefined) body.filters = filters;
  if (sort !== undefined) body.sort = sort;

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
  if (!response.ok) {
    throw new HttpError(response.status, response.statusText, bodyText);
  }

  const parsed = JSON.parse(bodyText) as unknown;
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed as DataViewQueryResult;
  }
  return {};
}
