import { HttpError } from "../../utils/http.js";
import { buildHeaders } from "../headers.js";
import type {
  ExportResp,
  ImportResp,
} from "./types.js";

const API_PREFIX = "/api/agent-operator-integration/v1";

function getBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

export interface ExportOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
  type: "operator" | "toolbox" | "mcp";
  id: string;
}

export async function exportData(options: ExportOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    businessDomain = "bd_public",
    type,
    id,
  } = options;

  const base = getBaseUrl(baseUrl);
  const url = `${base}${API_PREFIX}/impex/export/${type}/${encodeURIComponent(id)}`;

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

export interface ImportOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
  type: "operator" | "toolbox" | "mcp";
  body?: Record<string, unknown>;
  filePath?: string;
}

export async function importData(options: ImportOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    businessDomain = "bd_public",
    type,
    body,
    filePath,
  } = options;

  const base = getBaseUrl(baseUrl);
  const url = `${base}${API_PREFIX}/impex/import/${type}`;

  if (filePath) {
    const fileContent = await import("fs").then((fs) => fs.promises.readFile(filePath));
    const formData = new FormData();
    const blob = new Blob([fileContent], { type: "application/msaccess" });
    formData.append("data", blob, filePath.split("/").pop() || "upload.adp");
    formData.append("mode", "upsert");

    const response = await fetch(url, {
      method: "POST",
      headers: {
        ...buildHeaders(accessToken, businessDomain),
      },
      body: formData,
    });

    const responseBody = await response.text();
    if (!response.ok) {
      throw new HttpError(response.status, response.statusText, responseBody);
    }
    return responseBody;
  }

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