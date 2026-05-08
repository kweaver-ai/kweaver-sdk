import { HttpError } from "../utils/http.js";
import { encryptPassword } from "../utils/crypto.js";
import { buildHeaders } from "./headers.js";
import { discoverVegaCatalog, getVegaResource, listVegaCatalogResources } from "./vega.js";

const HTTPS_PROTOCOLS = new Set(["maxcompute", "anyshare7", "opensearch"]);

function connectProtocol(dsType: string): string {
  return HTTPS_PROTOCOLS.has(dsType) ? "https" : "jdbc";
}

function makeBinData(
  type: string,
  host: string,
  port: number,
  database: string,
  account: string,
  password: string,
  schema?: string
): Record<string, unknown> {
  const d: Record<string, unknown> = {
    host,
    port,
    database_name: database,
    connect_protocol: connectProtocol(type),
    account,
    password: encryptPassword(password),
  };
  if (schema !== undefined && schema !== "") {
    d.schema = schema;
  }
  return d;
}

export interface TestDatasourceOptions {
  baseUrl: string;
  accessToken: string;
  type: string;
  host: string;
  port: number;
  database: string;
  account: string;
  password: string;
  schema?: string;
  businessDomain?: string;
}

export async function testDatasource(options: TestDatasourceOptions): Promise<void> {
  const {
    baseUrl,
    accessToken,
    type,
    host,
    port,
    database,
    account,
    password,
    schema,
    businessDomain = "bd_public",
  } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}/api/data-connection/v1/datasource/test`;

  const body = JSON.stringify({
    type,
    bin_data: makeBinData(type, host, port, database, account, password, schema),
  });

  const response = await fetch(url, {
    method: "POST",
    headers: {
      ...buildHeaders(accessToken, businessDomain),
      "content-type": "application/json",
    },
    body,
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
  const url = `${base}/api/data-connection/v1/datasource`;

  const bodyObj: Record<string, unknown> = {
    name,
    type,
    bin_data: makeBinData(type, host, port, database, account, password, schema),
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
  const url = new URL(`${base}/api/data-connection/v1/datasource`);
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
  const url = `${base}/api/data-connection/v1/datasource/${encodeURIComponent(id)}`;

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
  const url = `${base}/api/data-connection/v1/datasource/${encodeURIComponent(id)}`;

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
  const url = new URL(`${base}/api/data-connection/v1/metadata/data-source/${encodeURIComponent(id)}`);
  url.searchParams.set("limit", String(limit));
  if (keyword) url.searchParams.set("keyword", keyword);
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

export interface ListTablesWithColumnsOptions {
  baseUrl: string;
  accessToken: string;
  /** A vega catalog id, not a legacy data-connection datasource UUID. */
  id: string;
  keyword?: string;
  limit?: number;
  offset?: number;
  businessDomain?: string;
  autoScan?: boolean;
}

interface VegaResourceListEntry {
  id: string;
  name: string;
  category?: string;
}

interface VegaResourceDetail {
  id: string;
  name: string;
  source_metadata?: { columns?: Array<Record<string, unknown>> };
  primary_keys?: string[];
  [key: string]: unknown;
}

/**
 * List tables with column details from a vega catalog.
 *
 * Two-stage fetch:
 *   1. GET /api/vega-backend/v1/catalogs/{id}/resources?category=table — list summaries
 *   2. For each resource: GET /api/vega-backend/v1/resources/{rid} — pull source_metadata.columns
 *
 * If the catalog has no resources and `autoScan=true`, triggers a discover and
 * retries the list once. The optional `keyword` filters summaries client-side
 * before the per-resource detail fetches — useful to keep N+1 down to k+1.
 *
 * `id` is a vega catalog id.
 */
export async function listTablesWithColumns(
  options: ListTablesWithColumnsOptions,
): Promise<string> {
  const {
    baseUrl,
    accessToken,
    id,
    keyword,
    limit,
    offset,
    businessDomain = "bd_public",
    autoScan = true,
  } = options;

  async function listResourceSummaries(): Promise<VegaResourceListEntry[]> {
    const body = await listVegaCatalogResources({
      baseUrl,
      accessToken,
      id,
      category: "table",
      limit,
      offset,
      businessDomain,
    });
    const parsed = JSON.parse(body) as
      | Array<VegaResourceListEntry>
      | { entries?: VegaResourceListEntry[]; data?: VegaResourceListEntry[] };
    let items = Array.isArray(parsed) ? parsed : (parsed.entries ?? parsed.data ?? []);
    if (keyword) {
      const k = keyword.toLowerCase();
      items = items.filter((it) => it.name.toLowerCase().includes(k));
    }
    return items;
  }

  let summaries = await listResourceSummaries();
  if (summaries.length === 0 && autoScan) {
    await scanMetadata({ baseUrl, accessToken, id, businessDomain });
    summaries = await listResourceSummaries();
  }

  const details = await Promise.all(
    summaries.map(async (s) => {
      let body: string;
      try {
        body = await getVegaResource({
          baseUrl,
          accessToken,
          id: s.id,
          businessDomain,
        });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        throw new Error(`vega resource ${s.id} fetch failed: ${reason}`);
      }
      const parsed = JSON.parse(body) as
        | VegaResourceDetail
        | { entries?: VegaResourceDetail[]; data?: VegaResourceDetail[] };
      if (Array.isArray((parsed as { entries?: unknown }).entries)) {
        const arr = (parsed as { entries: VegaResourceDetail[] }).entries;
        if (arr.length === 0) {
          throw new Error(`vega resource ${s.id} returned empty entries`);
        }
        return arr[0]!;
      }
      if (Array.isArray((parsed as { data?: unknown }).data)) {
        const arr = (parsed as { data: VegaResourceDetail[] }).data;
        if (arr.length === 0) {
          throw new Error(`vega resource ${s.id} returned empty data`);
        }
        return arr[0]!;
      }
      return parsed as VegaResourceDetail;
    }),
  );

  const tables: Array<{
    name: string;
    columns: Array<{ name: string; type: string; comment?: string; isPrimaryKey?: boolean }>;
    primaryKeys?: string[];
  }> = [];

  for (const d of details) {
    const columnsRaw = (d.source_metadata?.columns ?? []) as Array<Record<string, unknown>>;
    const tablePkArray = extractPrimaryKeys(d as unknown as Record<string, unknown>);
    const columns = columnsRaw.map((c) => {
      const name = String(c.name ?? c.field_name ?? "");
      const flagged = isColumnPrimaryKey(c) || tablePkArray.includes(name);
      return {
        name,
        type: String(c.type ?? c.field_type ?? "varchar"),
        comment: typeof c.description === "string"
          ? c.description
          : (typeof c.comment === "string" ? c.comment : undefined),
        ...(flagged ? { isPrimaryKey: true } : {}),
      };
    });
    const synthesizedPks = tablePkArray.length > 0
      ? tablePkArray
      : columns.filter((c) => c.isPrimaryKey).map((c) => c.name);

    tables.push({
      name: d.name,
      columns,
      ...(synthesizedPks.length > 0 ? { primaryKeys: synthesizedPks } : {}),
    });
  }

  return JSON.stringify(tables);
}

// Two PK metadata shapes are recognized — both confirmed conventions:
//   - per-column `is_primary_key: true` (data-connection metadata standard)
//   - per-column `column_key === "PRI"` (MySQL INFORMATION_SCHEMA pass-through)
//   - table-level `primary_keys: string[]` (composite-PK carrier)
// Other plausible spellings (camelCase, singular keys, SQLite `pk` integer) are
// intentionally NOT recognized here — adding them speculatively risks false
// matches and creates code paths the test suite can't pin down. Extend only when
// a real backend response demonstrates the need.
function isColumnPrimaryKey(col: Record<string, unknown>): boolean {
  if (col.is_primary_key === true) return true;
  if (typeof col.column_key === "string" && col.column_key.toUpperCase() === "PRI") return true;
  return false;
}

function extractPrimaryKeys(table: Record<string, unknown>): string[] {
  const arr = table.primary_keys;
  if (Array.isArray(arr)) {
    return arr.filter((x): x is string => typeof x === "string");
  }
  return [];
}

export interface ScanMetadataOptions {
  baseUrl: string;
  accessToken: string;
  id: string;
  /** Retained for signature compatibility; ignored — vega catalog already knows its connector_type. */
  dsType?: string;
  businessDomain?: string;
}

/**
 * Trigger a metadata scan for a vega catalog and wait for completion.
 * `id` is a vega catalog id (e.g. `d7nicrcjto2s73d9g67g`), not a legacy
 * data-connection datasource UUID.
 */
export async function scanMetadata(options: ScanMetadataOptions): Promise<string> {
  const { baseUrl, accessToken, id, businessDomain = "bd_public" } = options;
  return discoverVegaCatalog({
    baseUrl,
    accessToken,
    id,
    wait: true,
    businessDomain,
  });
}

export interface ScanDatasourceMetadataOptions {
  baseUrl: string;
  accessToken: string;
  id: string;
  businessDomain?: string;
}

/**
 * Trigger a metadata scan and wait for completion. `id` is a vega catalog id.
 *
 * Historically this looked up the legacy `ds_type` to build a data-connection
 * scan body; vega catalogs already carry their own `connector_type`, so the
 * lookup is gone.
 */
export async function scanDatasourceMetadata(
  options: ScanDatasourceMetadataOptions,
): Promise<string> {
  return scanMetadata(options);
}
