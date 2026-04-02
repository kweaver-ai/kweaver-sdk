import { HttpError } from "../utils/http.js";
import { encryptPassword } from "../utils/crypto.js";
import { buildHeaders } from "./headers.js";

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

export interface ListTablesWithColumnsOptions extends ListTablesOptions {
  autoScan?: boolean;
}

/** List tables with column details. Optionally triggers metadata scan if no tables found. */
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
    const tableId = String(t.id ?? "");
    const tableName = String(t.name ?? "");
    let columnsRaw = (t.columns ?? t.fields ?? []) as Array<Record<string, unknown>>;

    if (columnsRaw.length === 0 && tableId) {
      const tableUrl = `${base}/api/data-connection/v1/metadata/table/${encodeURIComponent(tableId)}?limit=-1`;
      const colResponse = await fetch(tableUrl, {
        method: "GET",
        headers: buildHeaders(rest.accessToken, rest.businessDomain ?? "bd_public"),
      });
      const colData = (await colResponse.json()) as
        | Array<Record<string, unknown>>
        | { entries?: Array<Record<string, unknown>>; data?: Array<Record<string, unknown>> };
      columnsRaw = Array.isArray(colData) ? colData : (colData.entries ?? colData.data ?? []);
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
    dsType = "mysql",
    businessDomain = "bd_public",
  } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const scanUrl = `${base}/api/data-connection/v1/metadata/scan`;
  const statusUrl = (taskId: string) => `${base}/api/data-connection/v1/metadata/scan/${taskId}`;

  const scanBody = JSON.stringify({
    scan_name: `sdk_scan_${id.slice(0, 8)}`,
    type: 0,
    ds_info: { ds_id: id, ds_type: dsType },
    use_default_template: true,
    use_multi_threads: true,
    status: "open",
  });

  const scanResponse = await fetch(scanUrl, {
    method: "POST",
    headers: {
      ...buildHeaders(accessToken, businessDomain),
      "content-type": "application/json",
    },
    body: scanBody,
  });

  const scanResult = await scanResponse.json() as { id?: string };
  const taskId = scanResult.id ?? "";

  for (let i = 0; i < 30; i += 1) {
    const delay = Math.min(2000 * Math.pow(1.5, i), 15000);
    await new Promise((r) => setTimeout(r, delay));
    const statusResponse = await fetch(statusUrl(taskId), {
      method: "GET",
      headers: buildHeaders(accessToken, businessDomain),
    });
    const statusData = (await statusResponse.json()) as { status?: string };
    if (statusData.status === "success" || statusData.status === "fail") {
      break;
    }
  }

  return taskId;
}
