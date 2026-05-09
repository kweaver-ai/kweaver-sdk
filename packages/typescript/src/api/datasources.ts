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

// ── Vega catalog re-exports (backward compatibility) ─────────────────────────
//
// listTablesWithColumns, scanMetadata, and scanDatasourceMetadata now live in
// vega.ts (they talk exclusively to vega-backend, not data-connection).
// Re-exported here so existing callers don't break — new code should import
// from "../api/vega.js" directly.
export {
  listTablesWithColumns,
  scanMetadata,
  scanDatasourceMetadata,
} from "./vega.js";

export type {
  ListTablesWithColumnsOptions,
  ScanMetadataOptions,
  ScanDatasourceMetadataOptions,
} from "./vega.js";
