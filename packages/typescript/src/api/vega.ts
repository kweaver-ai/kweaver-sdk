import { HttpError } from "../utils/http.js";

const VEGA_BASE = "/api/vega-backend/v1";

function buildHeaders(accessToken: string, businessDomain: string): Record<string, string> {
  return {
    accept: "application/json, text/plain, */*",
    "accept-language": "zh-cn",
    authorization: `Bearer ${accessToken}`,
    token: accessToken,
    "x-business-domain": businessDomain,
    "x-language": "zh-cn",
  };
}

export interface VegaHealthOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
}

export async function vegaHealth(options: VegaHealthOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    businessDomain = "bd_public",
  } = options;

  const base = baseUrl.replace(/\/+$/, "");

  // Vega backend has no dedicated /health endpoint.
  // Probe the catalogs list as a lightweight reachability check.
  const url = new URL(`${base}${VEGA_BASE}/catalogs`);
  url.searchParams.set("limit", "1");

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: buildHeaders(accessToken, businessDomain),
  });

  const body = await response.text();
  if (!response.ok) {
    throw new HttpError(response.status, response.statusText, body);
  }

  return JSON.stringify({ status: "healthy", probe: "catalogs", statusCode: response.status });
}

export interface ListVegaCatalogsOptions {
  baseUrl: string;
  accessToken: string;
  status?: string;
  limit?: number;
  offset?: number;
  businessDomain?: string;
}

export async function listVegaCatalogs(options: ListVegaCatalogsOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    status,
    limit,
    offset,
    businessDomain = "bd_public",
  } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const url = new URL(`${base}${VEGA_BASE}/catalogs`);
  if (status) url.searchParams.set("status", status);
  if (limit !== undefined) url.searchParams.set("limit", String(limit));
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

export interface GetVegaCatalogOptions {
  baseUrl: string;
  accessToken: string;
  id: string;
  businessDomain?: string;
}

export async function getVegaCatalog(options: GetVegaCatalogOptions): Promise<string> {
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

export interface VegaCatalogHealthStatusOptions {
  baseUrl: string;
  accessToken: string;
  ids: string;
  businessDomain?: string;
}

export async function vegaCatalogHealthStatus(options: VegaCatalogHealthStatusOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    ids,
    businessDomain = "bd_public",
  } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const url = new URL(`${base}${VEGA_BASE}/catalogs/health-status`);
  url.searchParams.set("ids", ids);

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

export interface TestVegaCatalogConnectionOptions {
  baseUrl: string;
  accessToken: string;
  id: string;
  businessDomain?: string;
}

export async function testVegaCatalogConnection(options: TestVegaCatalogConnectionOptions): Promise<string> {
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

  const body = await response.text();
  if (!response.ok) {
    throw new HttpError(response.status, response.statusText, body);
  }
  return body;
}

export interface DiscoverVegaCatalogOptions {
  baseUrl: string;
  accessToken: string;
  id: string;
  wait?: boolean;
  businessDomain?: string;
}

export async function discoverVegaCatalog(options: DiscoverVegaCatalogOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    id,
    wait,
    businessDomain = "bd_public",
  } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const endpoint = `${base}${VEGA_BASE}/catalogs/${encodeURIComponent(id)}/discover`;

  let url: string;
  if (wait !== undefined) {
    const u = new URL(endpoint);
    u.searchParams.set("wait", String(wait));
    url = u.toString();
  } else {
    url = endpoint;
  }

  const response = await fetch(url, {
    method: "POST",
    headers: buildHeaders(accessToken, businessDomain),
  });

  const body = await response.text();
  if (!response.ok) {
    throw new HttpError(response.status, response.statusText, body);
  }
  return body;
}

export interface ListVegaCatalogResourcesOptions {
  baseUrl: string;
  accessToken: string;
  id: string;
  category?: string;
  limit?: number;
  offset?: number;
  businessDomain?: string;
}

export async function listVegaCatalogResources(options: ListVegaCatalogResourcesOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    id,
    category,
    limit,
    offset,
    businessDomain = "bd_public",
  } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const url = new URL(`${base}${VEGA_BASE}/catalogs/${encodeURIComponent(id)}/resources`);
  if (category) url.searchParams.set("category", category);
  if (limit !== undefined) url.searchParams.set("limit", String(limit));
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

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

export interface ListVegaResourcesOptions {
  baseUrl: string;
  accessToken: string;
  catalogId?: string;
  category?: string;
  status?: string;
  limit?: number;
  offset?: number;
  businessDomain?: string;
}

export async function listVegaResources(options: ListVegaResourcesOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    catalogId,
    category,
    status,
    limit,
    offset,
    businessDomain = "bd_public",
  } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const url = new URL(`${base}${VEGA_BASE}/resources`);
  if (catalogId) url.searchParams.set("catalog_id", catalogId);
  if (category) url.searchParams.set("category", category);
  if (status) url.searchParams.set("status", status);
  if (limit !== undefined) url.searchParams.set("limit", String(limit));
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

export interface GetVegaResourceOptions {
  baseUrl: string;
  accessToken: string;
  id: string;
  businessDomain?: string;
}

export async function getVegaResource(options: GetVegaResourceOptions): Promise<string> {
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
  return body;
}

export interface QueryVegaResourceDataOptions {
  baseUrl: string;
  accessToken: string;
  id: string;
  body: string;
  businessDomain?: string;
}

export async function queryVegaResourceData(options: QueryVegaResourceDataOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    id,
    body: requestBody,
    businessDomain = "bd_public",
  } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}${VEGA_BASE}/resources/${encodeURIComponent(id)}/data`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      ...buildHeaders(accessToken, businessDomain),
      "content-type": "application/json",
    },
    body: requestBody,
  });

  const body = await response.text();
  if (!response.ok) {
    throw new HttpError(response.status, response.statusText, body);
  }
  return body;
}

export interface PreviewVegaResourceOptions {
  baseUrl: string;
  accessToken: string;
  id: string;
  limit?: number;
  businessDomain?: string;
}

export async function previewVegaResource(options: PreviewVegaResourceOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    id,
    limit = 50,
    businessDomain = "bd_public",
  } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const url = new URL(`${base}${VEGA_BASE}/resources/${encodeURIComponent(id)}/preview`);
  url.searchParams.set("limit", String(limit));

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

// ---------------------------------------------------------------------------
// Connector Types
// ---------------------------------------------------------------------------

export interface ListVegaConnectorTypesOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
}

export async function listVegaConnectorTypes(options: ListVegaConnectorTypesOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    businessDomain = "bd_public",
  } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}${VEGA_BASE}/connector-types?sort=name&order=asc`;

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

export interface GetVegaConnectorTypeOptions {
  baseUrl: string;
  accessToken: string;
  type: string;
  businessDomain?: string;
}

export async function getVegaConnectorType(options: GetVegaConnectorTypeOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    type,
    businessDomain = "bd_public",
  } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}${VEGA_BASE}/connector-types/${encodeURIComponent(type)}`;

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

// ---------------------------------------------------------------------------
// Discover Tasks
// ---------------------------------------------------------------------------

export interface ListVegaDiscoverTasksOptions {
  baseUrl: string;
  accessToken: string;
  status?: string;
  limit?: number;
  offset?: number;
  businessDomain?: string;
}

export async function listVegaDiscoverTasks(options: ListVegaDiscoverTasksOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    status,
    limit,
    offset,
    businessDomain = "bd_public",
  } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const url = new URL(`${base}${VEGA_BASE}/discover-tasks`);
  if (status) url.searchParams.set("status", status);
  if (limit !== undefined) url.searchParams.set("limit", String(limit));
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
