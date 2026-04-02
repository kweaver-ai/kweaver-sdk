import { HttpError } from "../utils/http.js";
import { buildHeaders } from "./headers.js";

export interface ListKnowledgeNetworksOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
  offset?: number;
  limit?: number;
  sort?: string;
  direction?: "asc" | "desc";
  name_pattern?: string;
  tag?: string;
}

export async function listKnowledgeNetworks(
  options: ListKnowledgeNetworksOptions
): Promise<string> {
  const {
    baseUrl,
    accessToken,
    businessDomain = "bd_public",
    offset = 0,
    limit = 50,
    sort = "update_time",
    direction = "desc",
    name_pattern,
    tag,
  } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const url = new URL(`${base}/api/ontology-manager/v1/knowledge-networks`);
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("direction", direction);
  url.searchParams.set("sort", sort);
  if (name_pattern !== undefined && name_pattern !== "") {
    url.searchParams.set("name_pattern", name_pattern);
  }
  if (tag !== undefined && tag !== "") {
    url.searchParams.set("tag", tag);
  }

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

export interface GetKnowledgeNetworkOptions {
  baseUrl: string;
  accessToken: string;
  knId: string;
  businessDomain?: string;
  mode?: "export" | "";
  include_statistics?: boolean;
}

export async function getKnowledgeNetwork(
  options: GetKnowledgeNetworkOptions
): Promise<string> {
  const {
    baseUrl,
    accessToken,
    knId,
    businessDomain = "bd_public",
    mode,
    include_statistics,
  } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const url = new URL(`${base}/api/ontology-manager/v1/knowledge-networks/${encodeURIComponent(knId)}`);
  if (mode === "export") {
    url.searchParams.set("mode", "export");
  }
  if (include_statistics === true) {
    url.searchParams.set("include_statistics", "true");
  }

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

export interface CreateKnowledgeNetworkOptions {
  baseUrl: string;
  accessToken: string;
  body: string;
  businessDomain?: string;
  import_mode?: "normal" | "ignore" | "overwrite";
  validate_dependency?: boolean;
}

export async function createKnowledgeNetwork(
  options: CreateKnowledgeNetworkOptions
): Promise<string> {
  const {
    baseUrl,
    accessToken,
    body,
    businessDomain = "bd_public",
    import_mode,
    validate_dependency,
  } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const url = new URL(`${base}/api/ontology-manager/v1/knowledge-networks`);
  if (import_mode) {
    url.searchParams.set("import_mode", import_mode);
  }
  if (validate_dependency !== undefined) {
    url.searchParams.set("validate_dependency", String(validate_dependency));
  }

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      ...buildHeaders(accessToken, businessDomain),
      "content-type": "application/json",
    },
    body,
  });

  const responseBody = await response.text();
  if (!response.ok) {
    throw new HttpError(response.status, response.statusText, responseBody);
  }
  return responseBody;
}

export interface UpdateKnowledgeNetworkOptions {
  baseUrl: string;
  accessToken: string;
  knId: string;
  body: string;
  businessDomain?: string;
}

export async function updateKnowledgeNetwork(
  options: UpdateKnowledgeNetworkOptions
): Promise<string> {
  const {
    baseUrl,
    accessToken,
    knId,
    body,
    businessDomain = "bd_public",
  } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}/api/ontology-manager/v1/knowledge-networks/${encodeURIComponent(knId)}`;

  const response = await fetch(url, {
    method: "PUT",
    headers: {
      ...buildHeaders(accessToken, businessDomain),
      "content-type": "application/json",
    },
    body,
  });

  const responseBody = await response.text();
  if (!response.ok) {
    throw new HttpError(response.status, response.statusText, responseBody);
  }
  return responseBody;
}

export interface DeleteKnowledgeNetworkOptions {
  baseUrl: string;
  accessToken: string;
  knId: string;
  businessDomain?: string;
}

export async function deleteKnowledgeNetwork(
  options: DeleteKnowledgeNetworkOptions
): Promise<void> {
  const {
    baseUrl,
    accessToken,
    knId,
    businessDomain = "bd_public",
  } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}/api/ontology-manager/v1/knowledge-networks/${encodeURIComponent(knId)}`;

  const response = await fetch(url, {
    method: "DELETE",
    headers: buildHeaders(accessToken, businessDomain),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new HttpError(response.status, response.statusText, body);
  }
}

/** List object types, relation types, or action types (ontology-manager). */
export interface ListSchemaTypesOptions {
  baseUrl: string;
  accessToken: string;
  knId: string;
  businessDomain?: string;
  branch?: string;
  limit?: number;
}

export async function listObjectTypes(
  options: ListSchemaTypesOptions
): Promise<string> {
  const {
    baseUrl,
    accessToken,
    knId,
    businessDomain = "bd_public",
    branch = "main",
    limit = -1,
  } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const url = new URL(
    `${base}/api/ontology-manager/v1/knowledge-networks/${encodeURIComponent(knId)}/object-types`
  );
  url.searchParams.set("branch", branch);
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

export async function listRelationTypes(
  options: ListSchemaTypesOptions
): Promise<string> {
  const {
    baseUrl,
    accessToken,
    knId,
    businessDomain = "bd_public",
    branch = "main",
    limit = -1,
  } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const url = new URL(
    `${base}/api/ontology-manager/v1/knowledge-networks/${encodeURIComponent(knId)}/relation-types`
  );
  url.searchParams.set("branch", branch);
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

export async function listActionTypes(
  options: ListSchemaTypesOptions
): Promise<string> {
  const {
    baseUrl,
    accessToken,
    knId,
    businessDomain = "bd_public",
    branch = "main",
    limit = -1,
  } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const url = new URL(
    `${base}/api/ontology-manager/v1/knowledge-networks/${encodeURIComponent(knId)}/action-types`
  );
  url.searchParams.set("branch", branch);
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

export interface GetActionTypeOptions {
  baseUrl: string;
  accessToken: string;
  knId: string;
  atId: string;
  businessDomain?: string;
  branch?: string;
}

export async function getActionType(options: GetActionTypeOptions): Promise<string> {
  const { baseUrl, accessToken, knId, atId, businessDomain = "bd_public", branch = "main" } = options;
  const base = baseUrl.replace(/\/+$/, "");
  const url = new URL(`${base}/api/ontology-manager/v1/knowledge-networks/${encodeURIComponent(knId)}/action-types/${encodeURIComponent(atId)}`);
  url.searchParams.set("branch", branch);
  const response = await fetch(url.toString(), { method: "GET", headers: buildHeaders(accessToken, businessDomain) });
  const body = await response.text();
  if (!response.ok) throw new HttpError(response.status, response.statusText, body);
  return body;
}

export interface CreateActionTypesOptions {
  baseUrl: string;
  accessToken: string;
  knId: string;
  body: string;
  businessDomain?: string;
  branch?: string;
}

export async function createActionTypes(options: CreateActionTypesOptions): Promise<string> {
  const { baseUrl, accessToken, knId, body, businessDomain = "bd_public", branch = "main" } = options;
  const base = baseUrl.replace(/\/+$/, "");
  const url = new URL(`${base}/api/ontology-manager/v1/knowledge-networks/${encodeURIComponent(knId)}/action-types`);
  url.searchParams.set("branch", branch);
  const response = await fetch(url.toString(), {
    method: "POST",
    headers: { ...buildHeaders(accessToken, businessDomain), "content-type": "application/json" },
    body,
  });
  const responseBody = await response.text();
  if (!response.ok) throw new HttpError(response.status, response.statusText, responseBody);
  return responseBody;
}

export interface UpdateActionTypeOptions {
  baseUrl: string;
  accessToken: string;
  knId: string;
  atId: string;
  body: string;
  businessDomain?: string;
}

export async function updateActionType(options: UpdateActionTypeOptions): Promise<string> {
  const { baseUrl, accessToken, knId, atId, body, businessDomain = "bd_public" } = options;
  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}/api/ontology-manager/v1/knowledge-networks/${encodeURIComponent(knId)}/action-types/${encodeURIComponent(atId)}`;
  const response = await fetch(url, {
    method: "PUT",
    headers: { ...buildHeaders(accessToken, businessDomain), "content-type": "application/json" },
    body,
  });
  const responseBody = await response.text();
  if (!response.ok) throw new HttpError(response.status, response.statusText, responseBody);
  return responseBody;
}

export interface DeleteActionTypesOptions {
  baseUrl: string;
  accessToken: string;
  knId: string;
  atIds: string;
  businessDomain?: string;
}

export async function deleteActionTypes(options: DeleteActionTypesOptions): Promise<void> {
  const { baseUrl, accessToken, knId, atIds, businessDomain = "bd_public" } = options;
  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}/api/ontology-manager/v1/knowledge-networks/${encodeURIComponent(knId)}/action-types/${encodeURIComponent(atIds)}`;
  const response = await fetch(url, { method: "DELETE", headers: buildHeaders(accessToken, businessDomain) });
  if (!response.ok) {
    const body = await response.text();
    throw new HttpError(response.status, response.statusText, body);
  }
}

export interface GetObjectTypeOptions {
  baseUrl: string;
  accessToken: string;
  knId: string;
  otId: string;
  businessDomain?: string;
  branch?: string;
}

export async function getObjectType(options: GetObjectTypeOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    knId,
    otId,
    businessDomain = "bd_public",
    branch = "main",
  } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const url = new URL(
    `${base}/api/ontology-manager/v1/knowledge-networks/${encodeURIComponent(knId)}/object-types/${encodeURIComponent(otId)}`
  );
  url.searchParams.set("branch", branch);

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

export interface CreateObjectTypesOptions {
  baseUrl: string;
  accessToken: string;
  knId: string;
  body: string;
  businessDomain?: string;
  branch?: string;
}

export async function createObjectTypes(options: CreateObjectTypesOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    knId,
    body,
    businessDomain = "bd_public",
    branch = "main",
  } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const url = new URL(
    `${base}/api/ontology-manager/v1/knowledge-networks/${encodeURIComponent(knId)}/object-types`
  );
  url.searchParams.set("branch", branch);

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      ...buildHeaders(accessToken, businessDomain),
      "content-type": "application/json",
    },
    body,
  });

  const responseBody = await response.text();
  if (!response.ok) {
    throw new HttpError(response.status, response.statusText, responseBody);
  }
  return responseBody;
}

export interface UpdateObjectTypeOptions {
  baseUrl: string;
  accessToken: string;
  knId: string;
  otId: string;
  body: string;
  businessDomain?: string;
}

export async function updateObjectType(options: UpdateObjectTypeOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    knId,
    otId,
    body,
    businessDomain = "bd_public",
  } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}/api/ontology-manager/v1/knowledge-networks/${encodeURIComponent(knId)}/object-types/${encodeURIComponent(otId)}`;

  const response = await fetch(url, {
    method: "PUT",
    headers: {
      ...buildHeaders(accessToken, businessDomain),
      "content-type": "application/json",
    },
    body,
  });

  const responseBody = await response.text();
  if (!response.ok) {
    throw new HttpError(response.status, response.statusText, responseBody);
  }
  return responseBody;
}

export interface DeleteObjectTypesOptions {
  baseUrl: string;
  accessToken: string;
  knId: string;
  otIds: string;
  businessDomain?: string;
}

export async function deleteObjectTypes(options: DeleteObjectTypesOptions): Promise<void> {
  const {
    baseUrl,
    accessToken,
    knId,
    otIds,
    businessDomain = "bd_public",
  } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}/api/ontology-manager/v1/knowledge-networks/${encodeURIComponent(knId)}/object-types/${encodeURIComponent(otIds)}`;

  const response = await fetch(url, {
    method: "DELETE",
    headers: buildHeaders(accessToken, businessDomain),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new HttpError(response.status, response.statusText, body);
  }
}

export interface GetRelationTypeOptions {
  baseUrl: string;
  accessToken: string;
  knId: string;
  rtId: string;
  businessDomain?: string;
  branch?: string;
}

export async function getRelationType(options: GetRelationTypeOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    knId,
    rtId,
    businessDomain = "bd_public",
    branch = "main",
  } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const url = new URL(
    `${base}/api/ontology-manager/v1/knowledge-networks/${encodeURIComponent(knId)}/relation-types/${encodeURIComponent(rtId)}`
  );
  url.searchParams.set("branch", branch);

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

export interface CreateRelationTypesOptions {
  baseUrl: string;
  accessToken: string;
  knId: string;
  body: string;
  businessDomain?: string;
  branch?: string;
}

export async function createRelationTypes(options: CreateRelationTypesOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    knId,
    body,
    businessDomain = "bd_public",
    branch = "main",
  } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const url = new URL(
    `${base}/api/ontology-manager/v1/knowledge-networks/${encodeURIComponent(knId)}/relation-types`
  );
  url.searchParams.set("branch", branch);

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      ...buildHeaders(accessToken, businessDomain),
      "content-type": "application/json",
    },
    body,
  });

  const responseBody = await response.text();
  if (!response.ok) {
    throw new HttpError(response.status, response.statusText, responseBody);
  }
  return responseBody;
}

export interface UpdateRelationTypeOptions {
  baseUrl: string;
  accessToken: string;
  knId: string;
  rtId: string;
  body: string;
  businessDomain?: string;
}

export async function updateRelationType(options: UpdateRelationTypeOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    knId,
    rtId,
    body,
    businessDomain = "bd_public",
  } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}/api/ontology-manager/v1/knowledge-networks/${encodeURIComponent(knId)}/relation-types/${encodeURIComponent(rtId)}`;

  const response = await fetch(url, {
    method: "PUT",
    headers: {
      ...buildHeaders(accessToken, businessDomain),
      "content-type": "application/json",
    },
    body,
  });

  const responseBody = await response.text();
  if (!response.ok) {
    throw new HttpError(response.status, response.statusText, responseBody);
  }
  return responseBody;
}

export interface DeleteRelationTypesOptions {
  baseUrl: string;
  accessToken: string;
  knId: string;
  rtIds: string;
  businessDomain?: string;
}

export async function deleteRelationTypes(options: DeleteRelationTypesOptions): Promise<void> {
  const {
    baseUrl,
    accessToken,
    knId,
    rtIds,
    businessDomain = "bd_public",
  } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}/api/ontology-manager/v1/knowledge-networks/${encodeURIComponent(knId)}/relation-types/${encodeURIComponent(rtIds)}`;

  const response = await fetch(url, {
    method: "DELETE",
    headers: buildHeaders(accessToken, businessDomain),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new HttpError(response.status, response.statusText, body);
  }
}

export interface BuildKnowledgeNetworkOptions {
  baseUrl: string;
  accessToken: string;
  knId: string;
  businessDomain?: string;
}

export async function buildKnowledgeNetwork(options: BuildKnowledgeNetworkOptions): Promise<void> {
  const {
    baseUrl,
    accessToken,
    knId,
    businessDomain = "bd_public",
  } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}/api/ontology-manager/v1/knowledge-networks/${encodeURIComponent(knId)}/jobs`;

  const body = JSON.stringify({
    name: `sdk_build_${knId.slice(0, 8)}`,
    job_type: "full",
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

export interface GetBuildStatusOptions {
  baseUrl: string;
  accessToken: string;
  knId: string;
  businessDomain?: string;
}

export async function getBuildStatus(options: GetBuildStatusOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    knId,
    businessDomain = "bd_public",
  } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const url = new URL(
    `${base}/api/ontology-manager/v1/knowledge-networks/${encodeURIComponent(knId)}/jobs`
  );
  url.searchParams.set("limit", "1");
  url.searchParams.set("direction", "desc");

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
