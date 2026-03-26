import { HttpError } from "../utils/http.js";

/** One business domain entry from GET /api/business-system/v1/business-domain */
export interface BusinessDomain {
  id: string;
  name?: string;
  description?: string;
  creator?: string;
  products?: string[];
  create_time?: string;
}

export interface ListBusinessDomainsOptions {
  baseUrl: string;
  accessToken: string;
  /** When true, skip TLS verification (matches `--insecure` login). */
  tlsInsecure?: boolean;
}

async function withTlsInsecure<T>(tlsInsecure: boolean | undefined, fn: () => Promise<T>): Promise<T> {
  if (!tlsInsecure) {
    return fn();
  }
  const prev = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  try {
    return await fn();
  } finally {
    if (prev === undefined) {
      delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    } else {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = prev;
    }
  }
}

/**
 * List business domains for the authenticated user. Does not send x-business-domain
 * (the endpoint returns all domains the user can access).
 */
export async function listBusinessDomains(
  options: ListBusinessDomainsOptions
): Promise<BusinessDomain[]> {
  const { baseUrl, accessToken, tlsInsecure } = options;
  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}/api/business-system/v1/business-domain`;

  return withTlsInsecure(tlsInsecure, async () => {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        accept: "application/json, text/plain, */*",
        authorization: `Bearer ${accessToken}`,
        token: accessToken,
      },
    });
    const body = await response.text();
    if (!response.ok) {
      throw new HttpError(response.status, response.statusText, body);
    }
    const data = JSON.parse(body) as unknown;
    if (!Array.isArray(data)) {
      throw new Error("Business domain list response was not a JSON array.");
    }
    return data.map((item) => {
      const row = item as Record<string, unknown>;
      const id = row.id;
      if (typeof id !== "string" || id.length === 0) {
        throw new Error("Business domain entry missing string id.");
      }
      return item as BusinessDomain;
    });
  });
}
