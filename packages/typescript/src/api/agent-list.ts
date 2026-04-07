import { HttpError } from "../utils/http.js";
import { buildHeaders } from "./headers.js";

// ── List published agents ────────────────────────────────────────────────────

export interface ListAgentsOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
  name?: string;
  pagination_marker_str?: string;
  size?: number;
  category_id?: string;
  custom_space_id?: string;
  is_to_square?: number;
}

export async function listAgents(options: ListAgentsOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    businessDomain = "bd_public",
    name = "",
    pagination_marker_str = "",
    size = 48,
    category_id = "",
    custom_space_id = "",
    is_to_square = 1,
  } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}/api/agent-factory/v3/published/agent`;

  const body = JSON.stringify({
    pagination_marker_str,
    size,
    category_id,
    name,
    custom_space_id,
    is_to_square,
  });

  const response = await fetch(url, {
    method: "POST",
    headers: { ...buildHeaders(accessToken, businessDomain), "content-type": "application/json" },
    body,
  });

  const responseBody = await response.text();
  if (!response.ok) {
    throw new HttpError(response.status, response.statusText, responseBody);
  }
  return responseBody;
}

// ── Get agent by ID ──────────────────────────────────────────────────────────

export interface GetAgentOptions {
  baseUrl: string;
  accessToken: string;
  agentId: string;
  businessDomain?: string;
}

export async function getAgent(options: GetAgentOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    agentId,
    businessDomain = "bd_public",
  } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}/api/agent-factory/v3/agent/${encodeURIComponent(agentId)}`;

  const response = await fetch(url, {
    method: "GET",
    headers: buildHeaders(accessToken, businessDomain),
  });

  const responseBody = await response.text();
  if (!response.ok) {
    throw new HttpError(response.status, response.statusText, responseBody);
  }
  return responseBody;
}

// ── Get agent by key ─────────────────────────────────────────────────────────

export interface GetAgentByKeyOptions {
  baseUrl: string;
  accessToken: string;
  key: string;
  businessDomain?: string;
}

export async function getAgentByKey(options: GetAgentByKeyOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    key,
    businessDomain = "bd_public",
  } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}/api/agent-factory/v3/agent/by-key/${encodeURIComponent(key)}`;

  const response = await fetch(url, {
    method: "GET",
    headers: buildHeaders(accessToken, businessDomain),
  });

  const responseBody = await response.text();
  if (!response.ok) {
    throw new HttpError(response.status, response.statusText, responseBody);
  }
  return responseBody;
}

// ── Create agent ─────────────────────────────────────────────────────────────

export interface CreateAgentOptions {
  baseUrl: string;
  accessToken: string;
  body: string;
  businessDomain?: string;
}

export async function createAgent(options: CreateAgentOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    body,
    businessDomain = "bd_public",
  } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}/api/agent-factory/v3/agent`;

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
    throw new HttpError(response.status, response.statusText, responseBody);
  }
  return responseBody;
}

// ── Update agent ─────────────────────────────────────────────────────────────

export interface UpdateAgentOptions {
  baseUrl: string;
  accessToken: string;
  agentId: string;
  body: string;
  businessDomain?: string;
}

export async function updateAgent(options: UpdateAgentOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    agentId,
    body,
    businessDomain = "bd_public",
  } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}/api/agent-factory/v3/agent/${encodeURIComponent(agentId)}`;

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

// ── Delete agent ─────────────────────────────────────────────────────────────

export interface DeleteAgentOptions {
  baseUrl: string;
  accessToken: string;
  agentId: string;
  businessDomain?: string;
}

export async function deleteAgent(options: DeleteAgentOptions): Promise<void> {
  const {
    baseUrl,
    accessToken,
    agentId,
    businessDomain = "bd_public",
  } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}/api/agent-factory/v3/agent/${encodeURIComponent(agentId)}`;

  const response = await fetch(url, {
    method: "DELETE",
    headers: buildHeaders(accessToken, businessDomain),
  });

  if (!response.ok) {
    const responseBody = await response.text();
    throw new HttpError(response.status, response.statusText, responseBody);
  }
}

// ── Publish agent ────────────────────────────────────────────────────────────

export interface PublishAgentOptions {
  baseUrl: string;
  accessToken: string;
  agentId: string;
  body?: string;
  categoryId?: string;
  businessDomain?: string;
}

export async function publishAgent(options: PublishAgentOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    agentId,
    body,
    categoryId,
    businessDomain = "bd_public",
  } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}/api/agent-factory/v3/agent/${encodeURIComponent(agentId)}/publish`;

  // Build default body if not provided
  const requestBody = body || JSON.stringify({
    business_domain_id: "bd_public",
    category_ids: categoryId ? [categoryId] : [],
    description: "",
    publish_to_where: ["square"],
    publish_to_bes: ["skill_agent"],
    pms_control: null,
  });

  const response = await fetch(url, {
    method: "POST",
    headers: {
      ...buildHeaders(accessToken, businessDomain),
      "content-type": "application/json",
    },
    body: requestBody,
  });

  const responseBody = await response.text();
  if (!response.ok) {
    throw new HttpError(response.status, response.statusText, responseBody);
  }
  return responseBody;
}

// ── Unpublish agent ──────────────────────────────────────────────────────────

export interface UnpublishAgentOptions {
  baseUrl: string;
  accessToken: string;
  agentId: string;
  businessDomain?: string;
}

export async function unpublishAgent(options: UnpublishAgentOptions): Promise<void> {
  const {
    baseUrl,
    accessToken,
    agentId,
    businessDomain = "bd_public",
  } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}/api/agent-factory/v3/agent/${encodeURIComponent(agentId)}/unpublish`;

  const response = await fetch(url, {
    method: "PUT",
    headers: buildHeaders(accessToken, businessDomain),
  });

  if (!response.ok) {
    const responseBody = await response.text();
    throw new HttpError(response.status, response.statusText, responseBody);
  }
}

// ── List personal space agents ───────────────────────────────────────────────

export interface ListPersonalAgentsOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
  name?: string;
  pagination_marker_str?: string;
  publish_status?: string;
  publish_to_be?: string;
  size?: number;
}

export async function listPersonalAgents(options: ListPersonalAgentsOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    businessDomain = "bd_public",
    name = "",
    pagination_marker_str = "",
    publish_status = "",
    publish_to_be = "",
    size = 48,
  } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const params = new URLSearchParams();
  if (name) params.append("name", name);
  if (pagination_marker_str) params.append("pagination_marker_str", pagination_marker_str);
  if (publish_status) params.append("publish_status", publish_status);
  if (publish_to_be) params.append("publish_to_be", publish_to_be);
  params.append("size", String(size));

  const url = `${base}/api/agent-factory/v3/personal-space/agent-list?${params.toString()}`;

  const response = await fetch(url, {
    method: "GET",
    headers: buildHeaders(accessToken, businessDomain),
  });

  const responseBody = await response.text();
  if (!response.ok) {
    throw new HttpError(response.status, response.statusText, responseBody);
  }
  return responseBody;
}

// ── List published agent templates ────────────────────────────────────────────

export interface ListPublishedAgentTemplatesOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
  category_id?: string;
  name?: string;
  pagination_marker_str?: string;
  size?: number;
}

export async function listPublishedAgentTemplates(options: ListPublishedAgentTemplatesOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    businessDomain = "bd_public",
    category_id = "",
    name = "",
    pagination_marker_str = "",
    size = 48,
  } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const params = new URLSearchParams();
  if (category_id) params.append("category_id", category_id);
  if (name) params.append("name", name);
  if (pagination_marker_str) params.append("pagination_marker_str", pagination_marker_str);
  params.append("size", String(size));

  const url = `${base}/api/agent-factory/v3/published/agent-tpl?${params.toString()}`;

  const response = await fetch(url, {
    method: "GET",
    headers: buildHeaders(accessToken, businessDomain),
  });

  const responseBody = await response.text();
  if (!response.ok) {
    throw new HttpError(response.status, response.statusText, responseBody);
  }
  return responseBody;
}

// ── Get published agent template by ID ───────────────────────────────────────

export interface GetPublishedAgentTemplateOptions {
  baseUrl: string;
  accessToken: string;
  templateId: string;
  businessDomain?: string;
}

export async function getPublishedAgentTemplate(options: GetPublishedAgentTemplateOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    templateId,
    businessDomain = "bd_public",
  } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}/api/agent-factory/v3/published/agent-tpl/${encodeURIComponent(templateId)}`;

  const response = await fetch(url, {
    method: "GET",
    headers: buildHeaders(accessToken, businessDomain),
  });

  const responseBody = await response.text();
  if (!response.ok) {
    throw new HttpError(response.status, response.statusText, responseBody);
  }
  return responseBody;
}

// ── List agent categories ─────────────────────────────────────────────────────

export interface ListAgentCategoriesOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
}

export async function listAgentCategories(options: ListAgentCategoriesOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    businessDomain = "bd_public",
  } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}/api/agent-factory/v3/category`;

  const response = await fetch(url, {
    method: "GET",
    headers: buildHeaders(accessToken, businessDomain),
  });

  const responseBody = await response.text();
  if (!response.ok) {
    throw new HttpError(response.status, response.statusText, responseBody);
  }
  return responseBody;
}
