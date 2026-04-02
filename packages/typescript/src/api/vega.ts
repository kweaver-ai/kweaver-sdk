import { HttpError } from "../utils/http.js";
import { buildHeaders } from "./headers.js";

const VEGA_BASE = "/api/vega-backend/v1";

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

export interface CreateVegaCatalogOptions {
  baseUrl: string;
  accessToken: string;
  body: string;
  businessDomain?: string;
}

export async function createVegaCatalog(options: CreateVegaCatalogOptions): Promise<string> {
  const { baseUrl, accessToken, body: requestBody, businessDomain = "bd_public" } = options;
  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}${VEGA_BASE}/catalogs`;

  const response = await fetch(url, {
    method: "POST",
    headers: { ...buildHeaders(accessToken, businessDomain), "content-type": "application/json" },
    body: requestBody,
  });

  const body = await response.text();
  if (!response.ok) throw new HttpError(response.status, response.statusText, body);
  return body;
}

export interface UpdateVegaCatalogOptions {
  baseUrl: string;
  accessToken: string;
  id: string;
  body: string;
  businessDomain?: string;
}

export async function updateVegaCatalog(options: UpdateVegaCatalogOptions): Promise<string> {
  const { baseUrl, accessToken, id, body: requestBody, businessDomain = "bd_public" } = options;
  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}${VEGA_BASE}/catalogs/${encodeURIComponent(id)}`;

  const response = await fetch(url, {
    method: "PUT",
    headers: { ...buildHeaders(accessToken, businessDomain), "content-type": "application/json" },
    body: requestBody,
  });

  const body = await response.text();
  if (!response.ok) throw new HttpError(response.status, response.statusText, body);
  return body;
}

export interface DeleteVegaCatalogsOptions {
  baseUrl: string;
  accessToken: string;
  ids: string;
  businessDomain?: string;
}

export async function deleteVegaCatalogs(options: DeleteVegaCatalogsOptions): Promise<string> {
  const { baseUrl, accessToken, ids, businessDomain = "bd_public" } = options;
  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}${VEGA_BASE}/catalogs/${ids}`;

  const response = await fetch(url, {
    method: "DELETE",
    headers: buildHeaders(accessToken, businessDomain),
  });

  const body = await response.text();
  if (!response.ok) throw new HttpError(response.status, response.statusText, body);
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
  // ids go in the path segment: GET /catalogs/{ids}/health-status
  const url = new URL(`${base}${VEGA_BASE}/catalogs/${ids}/health-status`);

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
      "x-http-method-override": "GET",
    },
    body: requestBody,
  });

  const body = await response.text();
  if (!response.ok) {
    throw new HttpError(response.status, response.statusText, body);
  }
  return body;
}

export interface CreateVegaResourceOptions {
  baseUrl: string;
  accessToken: string;
  body: string;
  businessDomain?: string;
}

export async function createVegaResource(options: CreateVegaResourceOptions): Promise<string> {
  const { baseUrl, accessToken, body: requestBody, businessDomain = "bd_public" } = options;
  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}${VEGA_BASE}/resources`;

  const response = await fetch(url, {
    method: "POST",
    headers: { ...buildHeaders(accessToken, businessDomain), "content-type": "application/json" },
    body: requestBody,
  });

  const body = await response.text();
  if (!response.ok) throw new HttpError(response.status, response.statusText, body);
  return body;
}

export interface UpdateVegaResourceOptions {
  baseUrl: string;
  accessToken: string;
  id: string;
  body: string;
  businessDomain?: string;
}

export async function updateVegaResource(options: UpdateVegaResourceOptions): Promise<string> {
  const { baseUrl, accessToken, id, body: requestBody, businessDomain = "bd_public" } = options;
  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}${VEGA_BASE}/resources/${encodeURIComponent(id)}`;

  const response = await fetch(url, {
    method: "PUT",
    headers: { ...buildHeaders(accessToken, businessDomain), "content-type": "application/json" },
    body: requestBody,
  });

  const body = await response.text();
  if (!response.ok) throw new HttpError(response.status, response.statusText, body);
  return body;
}

export interface DeleteVegaResourcesOptions {
  baseUrl: string;
  accessToken: string;
  ids: string;
  businessDomain?: string;
}

export async function deleteVegaResources(options: DeleteVegaResourcesOptions): Promise<string> {
  const { baseUrl, accessToken, ids, businessDomain = "bd_public" } = options;
  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}${VEGA_BASE}/resources/${ids}`;

  const response = await fetch(url, {
    method: "DELETE",
    headers: buildHeaders(accessToken, businessDomain),
  });

  const body = await response.text();
  if (!response.ok) throw new HttpError(response.status, response.statusText, body);
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

export interface RegisterVegaConnectorTypeOptions {
  baseUrl: string;
  accessToken: string;
  body: string;
  businessDomain?: string;
}

export async function registerVegaConnectorType(options: RegisterVegaConnectorTypeOptions): Promise<string> {
  const { baseUrl, accessToken, body: requestBody, businessDomain = "bd_public" } = options;
  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}${VEGA_BASE}/connector-types`;

  const response = await fetch(url, {
    method: "POST",
    headers: { ...buildHeaders(accessToken, businessDomain), "content-type": "application/json" },
    body: requestBody,
  });

  const body = await response.text();
  if (!response.ok) throw new HttpError(response.status, response.statusText, body);
  return body;
}

export interface UpdateVegaConnectorTypeOptions {
  baseUrl: string;
  accessToken: string;
  type: string;
  body: string;
  businessDomain?: string;
}

export async function updateVegaConnectorType(options: UpdateVegaConnectorTypeOptions): Promise<string> {
  const { baseUrl, accessToken, type, body: requestBody, businessDomain = "bd_public" } = options;
  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}${VEGA_BASE}/connector-types/${encodeURIComponent(type)}`;

  const response = await fetch(url, {
    method: "PUT",
    headers: { ...buildHeaders(accessToken, businessDomain), "content-type": "application/json" },
    body: requestBody,
  });

  const body = await response.text();
  if (!response.ok) throw new HttpError(response.status, response.statusText, body);
  return body;
}

export interface DeleteVegaConnectorTypeOptions {
  baseUrl: string;
  accessToken: string;
  type: string;
  businessDomain?: string;
}

export async function deleteVegaConnectorType(options: DeleteVegaConnectorTypeOptions): Promise<string> {
  const { baseUrl, accessToken, type, businessDomain = "bd_public" } = options;
  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}${VEGA_BASE}/connector-types/${encodeURIComponent(type)}`;

  const response = await fetch(url, {
    method: "DELETE",
    headers: buildHeaders(accessToken, businessDomain),
  });

  const body = await response.text();
  if (!response.ok) throw new HttpError(response.status, response.statusText, body);
  return body;
}

export interface SetVegaConnectorTypeEnabledOptions {
  baseUrl: string;
  accessToken: string;
  type: string;
  enabled: boolean;
  businessDomain?: string;
}

export async function setVegaConnectorTypeEnabled(options: SetVegaConnectorTypeEnabledOptions): Promise<string> {
  const { baseUrl, accessToken, type, enabled, businessDomain = "bd_public" } = options;
  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}${VEGA_BASE}/connector-types/${encodeURIComponent(type)}/enabled`;

  const response = await fetch(url, {
    method: "POST",
    headers: { ...buildHeaders(accessToken, businessDomain), "content-type": "application/json" },
    body: JSON.stringify({ enabled }),
  });

  const body = await response.text();
  if (!response.ok) throw new HttpError(response.status, response.statusText, body);
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

// ── Dataset Docs CRUD ────────────────────────────────────────────────────────

export interface CreateVegaDatasetDocsOptions {
  baseUrl: string;
  accessToken: string;
  id: string;
  body: string;
  businessDomain?: string;
}

export async function createVegaDatasetDocs(options: CreateVegaDatasetDocsOptions): Promise<string> {
  const { baseUrl, accessToken, id, body: requestBody, businessDomain = "bd_public" } = options;
  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}${VEGA_BASE}/resources/dataset/${encodeURIComponent(id)}/docs`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      ...buildHeaders(accessToken, businessDomain),
      "content-type": "application/json",
    },
    body: requestBody,
  });

  const body = await response.text();
  if (!response.ok) throw new HttpError(response.status, response.statusText, body);
  return body;
}

export interface UpdateVegaDatasetDocsOptions {
  baseUrl: string;
  accessToken: string;
  id: string;
  body: string;
  businessDomain?: string;
}

export async function updateVegaDatasetDocs(options: UpdateVegaDatasetDocsOptions): Promise<string> {
  const { baseUrl, accessToken, id, body: requestBody, businessDomain = "bd_public" } = options;
  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}${VEGA_BASE}/resources/dataset/${encodeURIComponent(id)}/docs`;

  const response = await fetch(url, {
    method: "PUT",
    headers: {
      ...buildHeaders(accessToken, businessDomain),
      "content-type": "application/json",
    },
    body: requestBody,
  });

  const body = await response.text();
  if (!response.ok) throw new HttpError(response.status, response.statusText, body);
  return body;
}

export interface DeleteVegaDatasetDocsOptions {
  baseUrl: string;
  accessToken: string;
  id: string;
  docIds: string;
  businessDomain?: string;
}

export async function deleteVegaDatasetDocs(options: DeleteVegaDatasetDocsOptions): Promise<string> {
  const { baseUrl, accessToken, id, docIds, businessDomain = "bd_public" } = options;
  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}${VEGA_BASE}/resources/dataset/${encodeURIComponent(id)}/docs/${encodeURIComponent(docIds)}`;

  const response = await fetch(url, {
    method: "DELETE",
    headers: buildHeaders(accessToken, businessDomain),
  });

  const body = await response.text();
  if (!response.ok) throw new HttpError(response.status, response.statusText, body);
  return body;
}

export interface DeleteVegaDatasetDocsQueryOptions {
  baseUrl: string;
  accessToken: string;
  id: string;
  body: string;
  businessDomain?: string;
}

export async function deleteVegaDatasetDocsQuery(options: DeleteVegaDatasetDocsQueryOptions): Promise<string> {
  const { baseUrl, accessToken, id, body: requestBody, businessDomain = "bd_public" } = options;
  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}${VEGA_BASE}/resources/dataset/${encodeURIComponent(id)}/docs/query`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      ...buildHeaders(accessToken, businessDomain),
      "content-type": "application/json",
      "x-http-method-override": "DELETE",
    },
    body: requestBody,
  });

  const body = await response.text();
  if (!response.ok) throw new HttpError(response.status, response.statusText, body);
  return body;
}

// ── Dataset Build ────────────────────────────────────────────────────────────

export interface BuildVegaDatasetOptions {
  baseUrl: string;
  accessToken: string;
  id: string;
  mode?: string;
  businessDomain?: string;
}

export async function buildVegaDataset(options: BuildVegaDatasetOptions): Promise<string> {
  const { baseUrl, accessToken, id, mode = "full", businessDomain = "bd_public" } = options;
  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}${VEGA_BASE}/resources/${encodeURIComponent(id)}/build`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      ...buildHeaders(accessToken, businessDomain),
      "content-type": "application/json",
    },
    body: JSON.stringify({ mode }),
  });

  const body = await response.text();
  if (!response.ok) throw new HttpError(response.status, response.statusText, body);
  return body;
}

export interface GetVegaDatasetBuildStatusOptions {
  baseUrl: string;
  accessToken: string;
  id: string;
  taskId: string;
  businessDomain?: string;
}

export async function getVegaDatasetBuildStatus(options: GetVegaDatasetBuildStatusOptions): Promise<string> {
  const { baseUrl, accessToken, id, taskId, businessDomain = "bd_public" } = options;
  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}${VEGA_BASE}/resources/dataset/${encodeURIComponent(id)}/build/${encodeURIComponent(taskId)}`;

  const response = await fetch(url, {
    method: "GET",
    headers: buildHeaders(accessToken, businessDomain),
  });

  const body = await response.text();
  if (!response.ok) throw new HttpError(response.status, response.statusText, body);
  return body;
}

// ── Query Execute ────────────────────────────────────────────────────────────

export interface ExecuteVegaQueryOptions {
  baseUrl: string;
  accessToken: string;
  body: string;
  businessDomain?: string;
}

export async function executeVegaQuery(options: ExecuteVegaQueryOptions): Promise<string> {
  const { baseUrl, accessToken, body: requestBody, businessDomain = "bd_public" } = options;
  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}${VEGA_BASE}/query/execute`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      ...buildHeaders(accessToken, businessDomain),
      "content-type": "application/json",
    },
    body: requestBody,
  });

  const body = await response.text();
  if (!response.ok) throw new HttpError(response.status, response.statusText, body);
  return body;
}

// ── Resource List All ────────────────────────────────────────────────────────

export interface ListAllVegaResourcesOptions {
  baseUrl: string;
  accessToken: string;
  limit?: number;
  offset?: number;
  businessDomain?: string;
}

export async function listAllVegaResources(options: ListAllVegaResourcesOptions): Promise<string> {
  const { baseUrl, accessToken, limit, offset, businessDomain = "bd_public" } = options;
  const base = baseUrl.replace(/\/+$/, "");
  const url = new URL(`${base}${VEGA_BASE}/resources/list`);
  if (limit !== undefined) url.searchParams.set("limit", String(limit));
  if (offset !== undefined) url.searchParams.set("offset", String(offset));

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: buildHeaders(accessToken, businessDomain),
  });

  const body = await response.text();
  if (!response.ok) throw new HttpError(response.status, response.statusText, body);
  return body;
}

export interface GetVegaDiscoverTaskOptions {
  baseUrl: string;
  accessToken: string;
  id: string;
  businessDomain?: string;
}

export async function getVegaDiscoverTask(options: GetVegaDiscoverTaskOptions): Promise<string> {
  const { baseUrl, accessToken, id, businessDomain = "bd_public" } = options;
  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}${VEGA_BASE}/discover-tasks/${encodeURIComponent(id)}`;

  const response = await fetch(url, {
    method: "GET",
    headers: buildHeaders(accessToken, businessDomain),
  });

  const body = await response.text();
  if (!response.ok) throw new HttpError(response.status, response.statusText, body);
  return body;
}
