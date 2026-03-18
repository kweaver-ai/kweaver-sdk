import { createHash } from "node:crypto";
import { HttpError } from "../utils/http.js";

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

function extractViewId(data: unknown): string | null {
  if (Array.isArray(data) && data.length > 0) {
    const item = data[0];
    if (typeof item === "string") return item;
    if (item && typeof item === "object" && "id" in item) {
      return String((item as Record<string, unknown>).id ?? "");
    }
  }
  if (data && typeof data === "object" && "id" in data) {
    return String((data as Record<string, unknown>).id ?? "");
  }
  return null;
}

export interface CreateDataViewOptions {
  baseUrl: string;
  accessToken: string;
  name: string;
  datasourceId: string;
  table: string;
  fields?: Array<{ name: string; type: string }>;
  businessDomain?: string;
}

export async function createDataView(options: CreateDataViewOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    name,
    datasourceId,
    table,
    fields = [],
    businessDomain = "bd_public",
  } = options;

  const viewId = createHash("md5").update(`${datasourceId}:${table}`).digest("hex").slice(0, 35);

  const body = JSON.stringify([
    {
      id: viewId,
      name,
      technical_name: table,
      type: "atomic",
      query_type: "SQL",
      data_source_id: datasourceId,
      group_id: datasourceId,
      fields,
    },
  ]);

  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}/api/mdl-data-model/v1/data-views`;

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

  const createdId = extractViewId(JSON.parse(responseBody));
  return createdId ?? viewId;
}

export interface GetDataViewOptions {
  baseUrl: string;
  accessToken: string;
  id: string;
  businessDomain?: string;
}

export async function getDataView(options: GetDataViewOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    id,
    businessDomain = "bd_public",
  } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}/api/mdl-data-model/v1/data-views/${encodeURIComponent(id)}`;

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
