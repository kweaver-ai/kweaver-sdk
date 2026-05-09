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

// ── Resources SQL Query ──────────────────────────────────────────────────────

export interface VegaSQLQueryOptions {
  baseUrl: string;
  accessToken: string;
  body: string;
  businessDomain?: string;
}

/** POST /api/vega-backend/v1/resources/query — direct SQL (or OpenSearch DSL) against catalog-backed resources. */
export async function vegaSQLQuery(options: VegaSQLQueryOptions): Promise<string> {
  const { baseUrl, accessToken, body: requestBody, businessDomain = "bd_public" } = options;
  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}${VEGA_BASE}/resources/query`;

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

/** List all Vega resources (no catalog filter). Uses GET /resources — not /resources/list, which
 * conflicts with GET /resources/{id} on some gateways (path segment "list" is treated as an id). */
export async function listAllVegaResources(options: ListAllVegaResourcesOptions): Promise<string> {
  const { baseUrl, accessToken, limit, offset, businessDomain = "bd_public" } = options;
  return listVegaResources({
    baseUrl,
    accessToken,
    limit,
    offset,
    businessDomain,
  });
}

// ── Catalog Table Listing & Scan ─────────────────────────────────────────────
//
// These functions operate on vega catalog ids (short slugs like
// `d7nicrcjto2s73d9g67g`), never legacy data-connection datasource UUIDs.
// They were originally in datasources.ts but belong here because they talk
// exclusively to vega-backend.

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
    return Array.isArray(parsed) ? parsed : (parsed.entries ?? parsed.data ?? []);
  }

  let summaries = await listResourceSummaries();
  if (summaries.length === 0 && autoScan) {
    await scanMetadata({ baseUrl, accessToken, id, businessDomain });
    summaries = await listResourceSummaries();
  }

  // Keyword filter applied after autoScan guard: if the catalog has tables but
  // keyword matches none, we must NOT trigger a redundant discover.
  if (keyword) {
    const k = keyword.toLowerCase();
    summaries = summaries.filter((it) => it.name.toLowerCase().includes(k));
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
 * @deprecated Use {@link scanMetadata} directly. This wrapper exists only for
 * backward compatibility with callers that used the old data-connection-based
 * `scanDatasourceMetadata` signature.
 */
export async function scanDatasourceMetadata(
  options: ScanDatasourceMetadataOptions,
): Promise<string> {
  return scanMetadata(options);
}

