import { HttpError } from "../utils/http.js";
import { buildHeaders } from "./headers.js";

// ── List published agents ────────────────────────────────────────────────────

export interface ListAgentsOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
  name?: string;
  offset?: number;
  limit?: number;
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
    offset = 0,
    limit = 50,
    category_id = "",
    custom_space_id = "",
    is_to_square = 1,
  } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}/api/agent-factory/v3/published/agent`;

  const body = JSON.stringify({
    offset,
    limit,
    category_id,
    name,
    custom_space_id,
    is_to_square,
  });

  const response = await fetch(url, {
    method: "POST",
    headers: buildHeaders(accessToken, businessDomain),
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
  businessDomain?: string;
}

export async function publishAgent(options: PublishAgentOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    agentId,
    body = "{}",
    businessDomain = "bd_public",
  } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}/api/agent-factory/v3/agent/${encodeURIComponent(agentId)}/publish`;

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
