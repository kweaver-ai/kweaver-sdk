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
    // If DataView already exists (403 with "Existed" error code), delete and recreate
    if (response.status === 403) {
      try {
        const errBody = JSON.parse(responseBody) as { error_code?: string };
        if (errBody.error_code?.includes("Existed")) {
          const actualId = await findDataViewByName({ baseUrl, accessToken, name, groupId: datasourceId, businessDomain });
          if (actualId && fields.length > 0) {
            // Delete the bare DataView (created by scanMetadata) and recreate with fields
            await deleteDataView({ baseUrl, accessToken, id: actualId, businessDomain });
            const retryResponse = await fetch(url, {
              method: "POST",
              headers: { ...buildHeaders(accessToken, businessDomain), "content-type": "application/json" },
              body,
            });
            if (retryResponse.ok) {
              const retryBody = await retryResponse.text();
              const retryId = extractViewId(JSON.parse(retryBody));
              return retryId ?? viewId;
            }
          }
          if (actualId) return actualId;
          return viewId;
        }
      } catch { /* fall through to throw */ }
    }
    throw new HttpError(response.status, response.statusText, responseBody);
  }

  const createdId = extractViewId(JSON.parse(responseBody));
  return createdId ?? viewId;
}

async function findDataViewByName(options: {
  baseUrl: string;
  accessToken: string;
  name: string;
  groupId: string;
  businessDomain: string;
}): Promise<string | null> {
  const base = options.baseUrl.replace(/\/+$/, "");
  const url = new URL(`${base}/api/mdl-data-model/v1/data-views`);
  url.searchParams.set("keyword", options.name);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: buildHeaders(options.accessToken, options.businessDomain),
  });
  if (!response.ok) return null;

  const body = JSON.parse(await response.text()) as {
    entries?: Array<{ id?: string; name?: string; group_id?: string }>;
  };
  const match = body.entries?.find(
    (e) => e.name === options.name && e.group_id === options.groupId,
  );
  return match?.id ?? null;
}

async function deleteDataView(options: {
  baseUrl: string;
  accessToken: string;
  id: string;
  businessDomain: string;
}): Promise<void> {
  const base = options.baseUrl.replace(/\/+$/, "");
  const url = `${base}/api/mdl-data-model/v1/data-views/${encodeURIComponent(options.id)}`;
  await fetch(url, {
    method: "DELETE",
    headers: buildHeaders(options.accessToken, options.businessDomain),
  });
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
