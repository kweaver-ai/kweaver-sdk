import { HttpError } from "../../utils/http.js";
import { buildHeaders } from "../headers.js";
import type {
  OperatorDataInfo,
  OperatorRegisterReq,
  OperatorRegisterResp,
  OperatorEditReq,
  OperatorDeleteReq,
  OperatorStatusUpdateReq,
  OperatorDebugReq,
  OperatorDebugResp,
  OperatorIntCompReq,
  OperatorIntCompResp,
  PaginatedResponse,
} from "./types.js";

const API_PREFIX = "/api/agent-operator-integration/v1";

function getBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

export interface ListOperatorsOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
  page?: number;
  page_size?: number;
  operator_id?: string;
  name?: string;
  status?: string;
  metadata_type?: string;
  category?: string;
  source?: string;
  create_user?: string;
}

export async function listOperators(options: ListOperatorsOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    businessDomain = "bd_public",
    page = 1,
    page_size = 30,
    operator_id,
    name,
    status = "published",
    metadata_type,
    category,
    source,
    create_user,
  } = options;

  const base = getBaseUrl(baseUrl);
  const params = new URLSearchParams();
  params.append("page", String(page));
  params.append("page_size", String(page_size));
  if (operator_id) params.append("operator_id", operator_id);
  if (name) params.append("name", name);
  if (status) params.append("status", status);
  if (metadata_type) params.append("metadata_type", metadata_type);
  if (category) params.append("category", category);
  if (source) params.append("source", source);
  if (create_user) params.append("create_user", create_user);

  const url = `${base}${API_PREFIX}/operator/info/list?${params.toString()}`;

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

export interface GetOperatorOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
  operatorId: string;
  version?: string;
}

export async function getOperator(options: GetOperatorOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    businessDomain = "bd_public",
    operatorId,
    version,
  } = options;

  const base = getBaseUrl(baseUrl);
  let url = `${base}${API_PREFIX}/operator/${encodeURIComponent(operatorId)}`;
  if (version) {
    url += `?version=${encodeURIComponent(version)}`;
  }

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

export interface RegisterOperatorOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
  body: OperatorRegisterReq;
}

export async function registerOperator(options: RegisterOperatorOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    businessDomain = "bd_public",
    body,
  } = options;

  const base = getBaseUrl(baseUrl);
  const url = `${base}${API_PREFIX}/operator/register`;

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

export interface EditOperatorOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
  operatorId: string;
  version: string;
  body: OperatorEditReq;
}

export async function editOperator(options: EditOperatorOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    businessDomain = "bd_public",
    operatorId,
    version,
    body,
  } = options;

  const base = getBaseUrl(baseUrl);
  const url = `${base}${API_PREFIX}/operator/${encodeURIComponent(operatorId)}/versions/${encodeURIComponent(version)}`;

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

export interface DeleteOperatorOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
  body: OperatorDeleteReq;
}

export async function deleteOperator(options: DeleteOperatorOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    businessDomain = "bd_public",
    body,
  } = options;

  const base = getBaseUrl(baseUrl);
  const url = `${base}${API_PREFIX}/operator/delete`;

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

export interface UpdateOperatorStatusOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
  body: OperatorStatusUpdateReq;
}

export async function updateOperatorStatus(options: UpdateOperatorStatusOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    businessDomain = "bd_public",
    body,
  } = options;

  const base = getBaseUrl(baseUrl);
  const url = `${base}${API_PREFIX}/operator/status`;

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

export interface DebugOperatorOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
  body: OperatorDebugReq;
}

export async function debugOperator(options: DebugOperatorOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    businessDomain = "bd_public",
    body,
  } = options;

  const base = getBaseUrl(baseUrl);
  const url = `${base}${API_PREFIX}/operator/debug`;

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

export interface ListOperatorHistoryOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
  operatorId: string;
  page?: number;
  page_size?: number;
}

export async function listOperatorHistory(options: ListOperatorHistoryOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    businessDomain = "bd_public",
    operatorId,
    page = 1,
    page_size = 30,
  } = options;

  const base = getBaseUrl(baseUrl);
  const params = new URLSearchParams();
  params.append("page", String(page));
  params.append("page_size", String(page_size));

  const url = `${base}${API_PREFIX}/operator/${encodeURIComponent(operatorId)}/history?${params.toString()}`;

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

export interface ListOperatorMarketOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
  page?: number;
  page_size?: number;
  operator_id?: string;
  name?: string;
  category?: string;
  source?: string;
}

export async function listOperatorMarket(options: ListOperatorMarketOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    businessDomain = "bd_public",
    page = 1,
    page_size = 30,
    operator_id,
    name,
    category,
    source,
  } = options;

  const base = getBaseUrl(baseUrl);
  const params = new URLSearchParams();
  params.append("page", String(page));
  params.append("page_size", String(page_size));
  if (operator_id) params.append("operator_id", operator_id);
  if (name) params.append("name", name);
  if (category) params.append("category", category);
  if (source) params.append("source", source);

  const url = `${base}${API_PREFIX}/operator/market?${params.toString()}`;

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

export interface GetOperatorMarketOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
  operatorId: string;
}

export async function getOperatorMarket(options: GetOperatorMarketOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    businessDomain = "bd_public",
    operatorId,
  } = options;

  const base = getBaseUrl(baseUrl);
  const url = `${base}${API_PREFIX}/operator/market/${encodeURIComponent(operatorId)}`;

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

export interface ListOperatorCategoriesOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
}

export async function listOperatorCategories(options: ListOperatorCategoriesOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    businessDomain = "bd_public",
  } = options;

  const base = getBaseUrl(baseUrl);
  const url = `${base}${API_PREFIX}/operator/categories`;

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

export interface RegisterInternalOperatorOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
  body: OperatorIntCompReq;
}

export async function registerInternalOperator(options: RegisterInternalOperatorOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    businessDomain = "bd_public",
    body,
  } = options;

  const base = getBaseUrl(baseUrl);
  const url = `${base}${API_PREFIX}/operator/internal/register`;

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
