import { HttpError } from "../utils/http.js";

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
    headers: {
      accept: "application/json, text/plain, */*",
      "accept-language": "zh-CN",
      authorization: `Bearer ${accessToken}`,
      token: accessToken,
      "x-business-domain": businessDomain,
      "x-language": "zh-CN",
    },
    body,
  });

  const responseBody = await response.text();
  if (!response.ok) {
    throw new HttpError(response.status, response.statusText, responseBody);
  }
  return responseBody;
}

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
    headers: {
      accept: "application/json, text/plain, */*",
      "accept-language": "zh-CN",
      authorization: `Bearer ${accessToken}`,
      token: accessToken,
      "x-business-domain": businessDomain,
      "x-language": "zh-CN",
    },
  });

  const responseBody = await response.text();
  if (!response.ok) {
    throw new HttpError(response.status, response.statusText, responseBody);
  }
  return responseBody;
}
