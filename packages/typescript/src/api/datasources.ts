import { HttpError } from "../utils/http.js";
import { buildHeaders } from "./headers.js";

const VEGA_BASE = "/api/vega-backend/v1";

function makeConnectorConfig(
  host: string,
  port: number,
  database: string,
  account: string,
  password: string,
  schema?: string
): Record<string, unknown> {
  const cfg: Record<string, unknown> = {
    host,
    port,
    databases: [database],
    username: account,
    password,
  };
  if (schema !== undefined && schema !== "") {
    cfg.schema = schema;
  }
  return cfg;
}

export interface TestDatasourceOptions {
  baseUrl: string;
  accessToken: string;
  id: string;
  businessDomain?: string;
}

export async function testDatasource(options: TestDatasourceOptions): Promise<void> {
  const {
    baseUrl,
    accessToken,
    id,
    businessDomain = "bd_public",
  } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}${VEGA_BASE}/catalogs/${encodeURIComponent(id)}/test-connection`;

  const response = await fetch(url, {
    method: "POST",
    headers: buildHeaders(accessToken, businessDomain),
  });

  if (!response.ok) {
    const responseBody = await response.text();
    throw new HttpError(response.status, response.statusText, responseBody);
  }
}

export interface CreateDatasourceOptions {
  baseUrl: string;
  accessToken: string;
  name: string;
  type: string;
  host: string;
  port: number;
  database: string;
  account: string;
  password: string;
  schema?: string;
  comment?: string;
  businessDomain?: string;
}

export async function createDatasource(options: CreateDatasourceOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    name,
    type,
    host,
    port,
    database,
    account,
    password,
    schema,
    comment,
    businessDomain = "bd_public",
  } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}${VEGA_BASE}/catalogs`;

  const bodyObj: Record<string, unknown> = {
    name,
    connector_type: type,
    connector_config: makeConnectorConfig(host, port, database, account, password, schema),
  };
  if (comment) {
    bodyObj.comment = comment;
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      ...buildHeaders(accessToken, businessDomain),
      "content-type": "application/json",
    },
    body: JSON.stringify(bodyObj),
  });

  const responseBody = await response.text();
  if (!response.ok) {
    throw new HttpError(response.status, response.statusText, responseBody);
  }
  return responseBody;
}

export interface ListDatasourcesOptions {
  baseUrl: string;
  accessToken: string;
  keyword?: string;
  type?: string;
  businessDomain?: string;
}

export async function listDatasources(options: ListDatasourcesOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    keyword,
    type,
    businessDomain = "bd_public",
  } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const url = new URL(`${base}${VEGA_BASE}/catalogs`);
  if (keyword) url.searchParams.set("keyword", keyword);
  if (type) url.searchParams.set("type", type);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: buildHeaders(accessToken, businessDomain),
  });

  const body = await response.text();
  if (!response.ok) {
    throw new HttpError(response.status, response.statusText, body);
  }
  return body;
}

export interface GetDatasourceOptions {
  baseUrl: string;
  accessToken: string;
  id: string;
  businessDomain?: string;
}

export async function getDatasource(options: GetDatasourceOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    id,
    businessDomain = "bd_public",
  } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}${VEGA_BASE}/catalogs/${encodeURIComponent(id)}`;

  const response = await fetch(url, {
    method: "GET",
    headers: buildHeaders(accessToken, businessDomain),
  });

  const body = await response.text();
  if (!response.ok) {
    throw new HttpError(response.status, response.statusText, body);
  }
  return body;
}

export interface DeleteDatasourceOptions {
  baseUrl: string;
  accessToken: string;
  id: string;
  businessDomain?: string;
}

export async function deleteDatasource(options: DeleteDatasourceOptions): Promise<void> {
  const {
    baseUrl,
    accessToken,
    id,
    businessDomain = "bd_public",
  } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}${VEGA_BASE}/catalogs/${encodeURIComponent(id)}`;

  const response = await fetch(url, {
    method: "DELETE",
    headers: buildHeaders(accessToken, businessDomain),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new HttpError(response.status, response.statusText, body);
  }
}

export interface ListTablesOptions {
  baseUrl: string;
  accessToken: string;
  id: string;
  keyword?: string;
  limit?: number;
  offset?: number;
  businessDomain?: string;
}

export async function listTables(options: ListTablesOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    id,
    keyword,
    limit = -1,
    offset,
    businessDomain = "bd_public",
  } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const url = new URL(`${base}${VEGA_BASE}/catalogs/${encodeURIComponent(id)}/resources`);
  if (keyword) url.searchParams.set("keyword", keyword);
  url.searchParams.set("limit", String(limit));
  if (offset !== undefined) url.searchParams.set("offset", String(offset));

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: buildHeaders(accessToken, businessDomain),
  });

  const body = await response.text();
  if (!response.ok) {
    throw new HttpError(response.status, response.statusText, body);
  }
  return body;
}

export interface ListTablesWithColumnsOptions extends ListTablesOptions {
  autoScan?: boolean;
}

/** List tables with column details. Optionally triggers catalog discover if no resources found. */
export async function listTablesWithColumns(options: ListTablesWithColumnsOptions): Promise<string> {
  const { id, autoScan = true, ...rest } = options;
  let body = await listTables({ ...rest, id });

  const parsed = JSON.parse(body) as
    | Array<Record<string, unknown>>
    | { entries?: Array<Record<string, unknown>>; data?: Array<Record<string, unknown>> };
  let items = Array.isArray(parsed) ? parsed : (parsed.entries ?? parsed.data ?? []);

  if (items.length === 0 && autoScan) {
    await scanMetadata({
      baseUrl: rest.baseUrl,
      accessToken: rest.accessToken,
      id,
      businessDomain: rest.businessDomain,
    });
    body = await listTables({ ...rest, id });
    const parsed2 = JSON.parse(body) as
      | Array<Record<string, unknown>>
      | { entries?: Array<Record<string, unknown>>; data?: Array<Record<string, unknown>> };
    items = Array.isArray(parsed2) ? parsed2 : (parsed2.entries ?? parsed2.data ?? []);
  }

  const base = rest.baseUrl.replace(/\/+$/, "");
  const tables: Array<{ name: string; columns: Array<{ name: string; type: string; comment?: string }> }> = [];

  for (const t of items) {
    const tableName = String(t.name ?? "");
    const resourceId = String(t.id ?? "");
    let columnsRaw = (t.columns ?? t.fields ?? []) as Array<Record<string, unknown>>;

    // Vega catalog resources list doesn't include columns;
    // fetch individual resource detail to get source_metadata.columns
    if (columnsRaw.length === 0 && resourceId) {
      const detailUrl = `${base}${VEGA_BASE}/resources/${encodeURIComponent(resourceId)}`;
      const detailResp = await fetch(detailUrl, {
        method: "GET",
        headers: buildHeaders(rest.accessToken, rest.businessDomain ?? "bd_public"),
      });
      if (detailResp.ok) {
        const raw = (await detailResp.json()) as Record<string, unknown>;
        // Vega-backend may wrap response in { entries: [...] }
        const detail = (Array.isArray(raw.entries) && raw.entries.length > 0
          ? raw.entries[0]
          : raw) as Record<string, unknown>;
        const srcMeta = detail.source_metadata as Record<string, unknown> | undefined;
        const detailCols = srcMeta?.columns ?? detail.columns ?? detail.fields;
        if (Array.isArray(detailCols)) {
          columnsRaw = detailCols as Array<Record<string, unknown>>;
        }
      }
    }

    const columns = columnsRaw.map((c) => ({
      name: String(c.name ?? c.field_name ?? ""),
      type: String(c.type ?? c.field_type ?? "varchar"),
      comment: typeof c.comment === "string" ? c.comment : undefined,
    }));

    tables.push({ name: tableName, columns });
  }

  return JSON.stringify(tables);
}

export interface ScanMetadataOptions {
  baseUrl: string;
  accessToken: string;
  id: string;
  dsType?: string;
  businessDomain?: string;
}

export async function scanMetadata(options: ScanMetadataOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    id,
    businessDomain = "bd_public",
  } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const url = new URL(`${base}${VEGA_BASE}/catalogs/${encodeURIComponent(id)}/discover`);
  url.searchParams.set("wait", "true");

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: buildHeaders(accessToken, businessDomain),
  });

  const body = await response.text();
  if (!response.ok) {
    throw new HttpError(response.status, response.statusText, body);
  }
  return body;
}
