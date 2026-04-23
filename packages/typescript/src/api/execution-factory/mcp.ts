import { HttpError } from "../../utils/http.js";
import { buildHeaders } from "../headers.js";
import type {
  MCPServerRegisterRequest,
  MCPServerUpdateRequest,
  MCPServerListResponse,
  MCPServerDetailResponse,
  MCPServerReleaseListResponse,
  MCPServerReleaseDetailResponse,
  MCPParseSSERequest,
  MCPParseSSEResponse,
  MCPToolDebugRequest,
  MCPToolDebugResponse,
  McpProxyCallToolRequest,
  McpProxyCallToolResponse,
  McpProxyToolListResponse,
} from "./types.js";

const API_PREFIX = "/api/agent-operator-integration/v1";

function getBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

export interface ListMCPServersOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
  page?: number;
  page_size?: number;
  mcp_id?: string;
  name?: string;
  status?: string;
  creation_type?: string;
  mode?: string;
  source?: string;
  create_user?: string;
}

export async function listMCPServers(options: ListMCPServersOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    businessDomain = "bd_public",
    page = 1,
    page_size = 30,
    mcp_id,
    name,
    status = "published",
    creation_type,
    mode,
    source,
    create_user,
  } = options;

  const base = getBaseUrl(baseUrl);
  const params = new URLSearchParams();
  params.append("page", String(page));
  params.append("page_size", String(page_size));
  if (mcp_id) params.append("mcp_id", mcp_id);
  if (name) params.append("name", name);
  if (status) params.append("status", status);
  if (creation_type) params.append("creation_type", creation_type);
  if (mode) params.append("mode", mode);
  if (source) params.append("source", source);
  if (create_user) params.append("create_user", create_user);

  const url = `${base}${API_PREFIX}/mcp/list?${params.toString()}`;

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

export interface GetMCPServerOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
  mcpId: string;
}

export async function getMCPServer(options: GetMCPServerOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    businessDomain = "bd_public",
    mcpId,
  } = options;

  const base = getBaseUrl(baseUrl);
  const url = `${base}${API_PREFIX}/mcp/${encodeURIComponent(mcpId)}`;

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

export interface RegisterMCPServerOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
  body: MCPServerRegisterRequest;
}

export async function registerMCPServer(options: RegisterMCPServerOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    businessDomain = "bd_public",
    body,
  } = options;

  const base = getBaseUrl(baseUrl);
  const url = `${base}${API_PREFIX}/mcp`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      ...buildHeaders(accessToken, businessDomain),
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const responseBody = await response.text();
  if (!response.ok) {
    throw new HttpError(response.status, response.statusText, responseBody);
  }
  return responseBody;
}

export interface UpdateMCPServerOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
  mcpId: string;
  body: MCPServerUpdateRequest;
}

export async function updateMCPServer(options: UpdateMCPServerOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    businessDomain = "bd_public",
    mcpId,
    body,
  } = options;

  const base = getBaseUrl(baseUrl);
  const url = `${base}${API_PREFIX}/mcp/${encodeURIComponent(mcpId)}`;

  const response = await fetch(url, {
    method: "PUT",
    headers: {
      ...buildHeaders(accessToken, businessDomain),
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const responseBody = await response.text();
  if (!response.ok) {
    throw new HttpError(response.status, response.statusText, responseBody);
  }
  return responseBody;
}

export interface DeleteMCPServerOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
  mcpId: string;
}

export async function deleteMCPServer(options: DeleteMCPServerOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    businessDomain = "bd_public",
    mcpId,
  } = options;

  const base = getBaseUrl(baseUrl);
  const url = `${base}${API_PREFIX}/mcp/${encodeURIComponent(mcpId)}`;

  const response = await fetch(url, {
    method: "DELETE",
    headers: buildHeaders(accessToken, businessDomain),
  });

  const responseBody = await response.text();
  if (!response.ok) {
    throw new HttpError(response.status, response.statusText, responseBody);
  }
  return responseBody;
}

export interface UpdateMCPServerStatusOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
  mcpId: string;
  status: "unpublish" | "published" | "offline";
}

export async function updateMCPServerStatus(options: UpdateMCPServerStatusOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    businessDomain = "bd_public",
    mcpId,
    status,
  } = options;

  const base = getBaseUrl(baseUrl);
  const url = `${base}${API_PREFIX}/mcp/${encodeURIComponent(mcpId)}/status`;

  const response = await fetch(url, {
    method: "PUT",
    headers: {
      ...buildHeaders(accessToken, businessDomain),
      "content-type": "application/json",
    },
    body: JSON.stringify({ status }),
  });

  const responseBody = await response.text();
  if (!response.ok) {
    throw new HttpError(response.status, response.statusText, responseBody);
  }
  return responseBody;
}

export interface ParseMCPSSERequestOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
  body: MCPParseSSERequest;
}

export async function parseMCPSSERequest(options: ParseMCPSSERequestOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    businessDomain = "bd_public",
    body,
  } = options;

  const base = getBaseUrl(baseUrl);
  const url = `${base}${API_PREFIX}/mcp/parse/sse`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      ...buildHeaders(accessToken, businessDomain),
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const responseBody = await response.text();
  if (!response.ok) {
    throw new HttpError(response.status, response.statusText, responseBody);
  }
  return responseBody;
}

export interface DebugMCPToolOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
  mcpId: string;
  toolName: string;
  body: MCPToolDebugRequest;
}

export async function debugMCPTool(options: DebugMCPToolOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    businessDomain = "bd_public",
    mcpId,
    toolName,
    body,
  } = options;

  const base = getBaseUrl(baseUrl);
  const url = `${base}${API_PREFIX}/mcp/${encodeURIComponent(mcpId)}/tools/${encodeURIComponent(toolName)}/debug`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      ...buildHeaders(accessToken, businessDomain),
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const responseBody = await response.text();
  if (!response.ok) {
    throw new HttpError(response.status, response.statusText, responseBody);
  }
  return responseBody;
}

export interface ListMCPMarketOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
  page?: number;
  page_size?: number;
  mcp_id?: string;
  name?: string;
  source?: string;
  category?: string;
}

export async function listMCPMarket(options: ListMCPMarketOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    businessDomain = "bd_public",
    page = 1,
    page_size = 30,
    mcp_id,
    name,
    source,
    category,
  } = options;

  const base = getBaseUrl(baseUrl);
  const params = new URLSearchParams();
  params.append("page", String(page));
  params.append("page_size", String(page_size));
  if (mcp_id) params.append("mcp_id", mcp_id);
  if (name) params.append("name", name);
  if (source) params.append("source", source);
  if (category) params.append("category", category);

  const url = `${base}${API_PREFIX}/mcp/market/list?${params.toString()}`;

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

export interface GetMCPMarketOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
  mcpId: string;
}

export async function getMCPMarket(options: GetMCPMarketOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    businessDomain = "bd_public",
    mcpId,
  } = options;

  const base = getBaseUrl(baseUrl);
  const url = `${base}${API_PREFIX}/mcp/market/${encodeURIComponent(mcpId)}`;

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

export interface ListMCPCategoriesOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
}

export async function listMCPCategories(options: ListMCPCategoriesOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    businessDomain = "bd_public",
  } = options;

  const base = getBaseUrl(baseUrl);
  const url = `${base}${API_PREFIX}/mcp/categories`;

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

export interface McpProxyCallToolOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
  mcpId: string;
  body: McpProxyCallToolRequest;
}

export async function mcpProxyCallTool(options: McpProxyCallToolOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    businessDomain = "bd_public",
    mcpId,
    body,
  } = options;

  const base = getBaseUrl(baseUrl);
  const url = `${base}${API_PREFIX}/mcp/${encodeURIComponent(mcpId)}/proxy/call-tool`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      ...buildHeaders(accessToken, businessDomain),
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const responseBody = await response.text();
  if (!response.ok) {
    throw new HttpError(response.status, response.statusText, responseBody);
  }
  return responseBody;
}

export interface McpProxyListToolsOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
  mcpId: string;
}

export async function mcpProxyListTools(options: McpProxyListToolsOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    businessDomain = "bd_public",
    mcpId,
  } = options;

  const base = getBaseUrl(baseUrl);
  const url = `${base}${API_PREFIX}/mcp/${encodeURIComponent(mcpId)}/proxy/list-tools`;

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
