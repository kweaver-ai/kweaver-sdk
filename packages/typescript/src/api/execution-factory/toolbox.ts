import { HttpError } from "../../utils/http.js";
import { buildHeaders } from "../headers.js";
import type {
  CreateToolBoxRequest,
  CreateToolBoxResult,
  UpdateToolBoxRequest,
  UpdateToolBoxResult,
  DeleteToolBoxResult,
  UpdateToolBoxStatusReq,
  UpdateToolBoxStatusResp,
  CreateToolReq,
  CreateToolResp,
  UpdateToolReq,
  UpdateToolResp,
  UpdateToolStatusReq,
  UpdateToolStatusResp,
  BatchDeleteToolReq,
  BatchDeleteToolResp,
  ConvertToolReq,
  ConvertToolResp,
  BoxToolList,
  ToolBoxInfoList,
  GetToolBoxMarketInfoResult,
  CreateInternalToolBoxReq,
  CreateInternalToolBoxResp,
  APIProxyRequest,
  APIProxyResponse,
  FunctionExecuteReq,
  FunctionExecuteResp,
  FunctionAIGenerateReq,
  FunctionAIGenerateResp,
  PromptTemplate,
  DependenciesInfo,
  DependencyVersion,
} from "./types.js";

const API_PREFIX = "/api/agent-operator-integration/v1";

function getBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

export interface ListToolBoxesOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
  page?: number;
  page_size?: number;
  box_id?: string;
  box_name?: string;
  status?: string;
  category_type?: string;
  source?: string;
  create_user?: string;
}

export async function listToolBoxes(options: ListToolBoxesOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    businessDomain = "bd_public",
    page = 1,
    page_size = 30,
    box_id,
    box_name,
    status = "published",
    category_type,
    source,
    create_user,
  } = options;

  const base = getBaseUrl(baseUrl);
  const params = new URLSearchParams();
  params.append("page", String(page));
  params.append("page_size", String(page_size));
  if (box_id) params.append("box_id", box_id);
  if (box_name) params.append("box_name", box_name);
  if (status) params.append("status", status);
  if (category_type) params.append("category_type", category_type);
  if (source) params.append("source", source);
  if (create_user) params.append("create_user", create_user);

  const url = `${base}${API_PREFIX}/tool-box/list?${params.toString()}`;

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

export interface GetToolBoxOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
  boxId: string;
}

export async function getToolBox(options: GetToolBoxOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    businessDomain = "bd_public",
    boxId,
  } = options;

  const base = getBaseUrl(baseUrl);
  const url = `${base}${API_PREFIX}/tool-box/${encodeURIComponent(boxId)}`;

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

export interface CreateToolBoxOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
  body: CreateToolBoxRequest;
}

export async function createToolBox(options: CreateToolBoxOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    businessDomain = "bd_public",
    body,
  } = options;

  const base = getBaseUrl(baseUrl);
  const url = `${base}${API_PREFIX}/tool-box`;

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

export interface UpdateToolBoxOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
  boxId: string;
  body: UpdateToolBoxRequest;
}

export async function updateToolBox(options: UpdateToolBoxOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    businessDomain = "bd_public",
    boxId,
    body,
  } = options;

  const base = getBaseUrl(baseUrl);
  const url = `${base}${API_PREFIX}/tool-box/${encodeURIComponent(boxId)}`;

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

export interface DeleteToolBoxOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
  boxId: string;
}

export async function deleteToolBox(options: DeleteToolBoxOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    businessDomain = "bd_public",
    boxId,
  } = options;

  const base = getBaseUrl(baseUrl);
  const url = `${base}${API_PREFIX}/tool-box/${encodeURIComponent(boxId)}`;

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

export interface UpdateToolBoxStatusOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
  boxId: string;
  body: UpdateToolBoxStatusReq;
}

export async function updateToolBoxStatus(options: UpdateToolBoxStatusOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    businessDomain = "bd_public",
    boxId,
    body,
  } = options;

  const base = getBaseUrl(baseUrl);
  const url = `${base}${API_PREFIX}/tool-box/${encodeURIComponent(boxId)}/status`;

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

export interface ListToolsOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
  boxId: string;
  page?: number;
  page_size?: number;
  tool_id?: string;
  name?: string;
  status?: string;
  metadata_type?: string;
}

export async function listTools(options: ListToolsOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    businessDomain = "bd_public",
    boxId,
    page = 1,
    page_size = 30,
    tool_id,
    name,
    status,
    metadata_type,
  } = options;

  const base = getBaseUrl(baseUrl);
  const params = new URLSearchParams();
  params.append("page", String(page));
  params.append("page_size", String(page_size));
  if (tool_id) params.append("tool_id", tool_id);
  if (name) params.append("name", name);
  if (status) params.append("status", status);
  if (metadata_type) params.append("metadata_type", metadata_type);

  const url = `${base}${API_PREFIX}/tool-box/${encodeURIComponent(boxId)}/tools?${params.toString()}`;

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

export interface GetToolOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
  boxId: string;
  toolId: string;
}

export async function getTool(options: GetToolOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    businessDomain = "bd_public",
    boxId,
    toolId,
  } = options;

  const base = getBaseUrl(baseUrl);
  const url = `${base}${API_PREFIX}/tool-box/${encodeURIComponent(boxId)}/tools/${encodeURIComponent(toolId)}`;

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

export interface CreateToolOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
  boxId: string;
  body: CreateToolReq;
}

export async function createTool(options: CreateToolOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    businessDomain = "bd_public",
    boxId,
    body,
  } = options;

  const base = getBaseUrl(baseUrl);
  const url = `${base}${API_PREFIX}/tool-box/${encodeURIComponent(boxId)}/tools`;

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

export interface UpdateToolOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
  boxId: string;
  toolId: string;
  body: UpdateToolReq;
}

export async function updateTool(options: UpdateToolOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    businessDomain = "bd_public",
    boxId,
    toolId,
    body,
  } = options;

  const base = getBaseUrl(baseUrl);
  const url = `${base}${API_PREFIX}/tool-box/${encodeURIComponent(boxId)}/tools/${encodeURIComponent(toolId)}`;

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

export interface UpdateToolStatusOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
  boxId: string;
  body: UpdateToolStatusReq;
}

export async function updateToolStatus(options: UpdateToolStatusOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    businessDomain = "bd_public",
    boxId,
    body,
  } = options;

  const base = getBaseUrl(baseUrl);
  const url = `${base}${API_PREFIX}/tool-box/${encodeURIComponent(boxId)}/tools/status`;

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

export interface DeleteToolOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
  boxId: string;
  toolId: string;
}

export async function deleteTool(options: DeleteToolOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    businessDomain = "bd_public",
    boxId,
    toolId,
  } = options;

  const base = getBaseUrl(baseUrl);
  const url = `${base}${API_PREFIX}/tool-box/${encodeURIComponent(boxId)}/tools/${encodeURIComponent(toolId)}`;

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

export interface BatchDeleteToolsOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
  boxId: string;
  body: BatchDeleteToolReq;
}

export async function batchDeleteTools(options: BatchDeleteToolsOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    businessDomain = "bd_public",
    boxId,
    body,
  } = options;

  const base = getBaseUrl(baseUrl);
  const url = `${base}${API_PREFIX}/tool-box/${encodeURIComponent(boxId)}/tools/batch-delete`;

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

export interface ConvertOperatorToToolOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
  body: ConvertToolReq;
}

export async function convertOperatorToTool(options: ConvertOperatorToToolOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    businessDomain = "bd_public",
    body,
  } = options;

  const base = getBaseUrl(baseUrl);
  const url = `${base}${API_PREFIX}/tool-box/tools/convert`;

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

export interface ListToolBoxMarketOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
  page?: number;
  page_size?: number;
  box_id?: string;
  box_name?: string;
  category_type?: string;
  source?: string;
}

export async function listToolBoxMarket(options: ListToolBoxMarketOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    businessDomain = "bd_public",
    page = 1,
    page_size = 30,
    box_id,
    box_name,
    category_type,
    source,
  } = options;

  const base = getBaseUrl(baseUrl);
  const params = new URLSearchParams();
  params.append("page", String(page));
  params.append("page_size", String(page_size));
  if (box_id) params.append("box_id", box_id);
  if (box_name) params.append("box_name", box_name);
  if (category_type) params.append("category_type", category_type);
  if (source) params.append("source", source);

  const url = `${base}${API_PREFIX}/tool-box/market?${params.toString()}`;

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

export interface GetToolBoxMarketOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
  boxId: string;
}

export async function getToolBoxMarket(options: GetToolBoxMarketOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    businessDomain = "bd_public",
    boxId,
  } = options;

  const base = getBaseUrl(baseUrl);
  const url = `${base}${API_PREFIX}/tool-box/market/${encodeURIComponent(boxId)}`;

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

export interface ListToolBoxCategoriesOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
}

export async function listToolBoxCategories(options: ListToolBoxCategoriesOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    businessDomain = "bd_public",
  } = options;

  const base = getBaseUrl(baseUrl);
  const url = `${base}${API_PREFIX}/tool-box/categories`;

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

export interface CreateInternalToolBoxOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
  body: CreateInternalToolBoxReq;
}

export async function createInternalToolBox(options: CreateInternalToolBoxOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    businessDomain = "bd_public",
    body,
  } = options;

  const base = getBaseUrl(baseUrl);
  const url = `${base}${API_PREFIX}/tool-box/internal`;

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

export interface ToolProxyOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
  boxId: string;
  toolId: string;
  body: APIProxyRequest;
}

export async function toolProxy(options: ToolProxyOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    businessDomain = "bd_public",
    boxId,
    toolId,
    body,
  } = options;

  const base = getBaseUrl(baseUrl);
  const url = `${base}${API_PREFIX}/tool-box/${encodeURIComponent(boxId)}/tools/${encodeURIComponent(toolId)}/proxy`;

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

export interface DebugToolOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
  boxId: string;
  toolId: string;
  body: APIProxyRequest;
}

export async function debugTool(options: DebugToolOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    businessDomain = "bd_public",
    boxId,
    toolId,
    body,
  } = options;

  const base = getBaseUrl(baseUrl);
  const url = `${base}${API_PREFIX}/tool-box/${encodeURIComponent(boxId)}/tools/${encodeURIComponent(toolId)}/debug`;

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

export interface ExecuteFunctionOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
  body: FunctionExecuteReq;
}

export async function executeFunction(options: ExecuteFunctionOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    businessDomain = "bd_public",
    body,
  } = options;

  const base = getBaseUrl(baseUrl);
  const url = `${base}${API_PREFIX}/function/execute`;

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

export interface AIGenerateFunctionOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
  body: FunctionAIGenerateReq;
}

export async function aiGenerateFunction(options: AIGenerateFunctionOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    businessDomain = "bd_public",
    body,
  } = options;

  const base = getBaseUrl(baseUrl);
  const url = `${base}${API_PREFIX}/function/ai-generate`;

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

export interface ListPromptTemplatesOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
}

export async function listPromptTemplates(options: ListPromptTemplatesOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    businessDomain = "bd_public",
  } = options;

  const base = getBaseUrl(baseUrl);
  const url = `${base}${API_PREFIX}/function/prompt-templates`;

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

export interface InstallDependenciesOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
  body: DependenciesInfo;
}

export async function installDependencies(options: InstallDependenciesOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    businessDomain = "bd_public",
    body,
  } = options;

  const base = getBaseUrl(baseUrl);
  const url = `${base}${API_PREFIX}/function/dependencies/install`;

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

export interface GetDependencyVersionsOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
  packageName: string;
}

export async function getDependencyVersions(options: GetDependencyVersionsOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    businessDomain = "bd_public",
    packageName,
  } = options;

  const base = getBaseUrl(baseUrl);
  const url = `${base}${API_PREFIX}/function/dependencies/${encodeURIComponent(packageName)}/versions`;

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
