import { fetchWithRetry } from "./ontology-query.js";
import { buildHeaders } from "./headers.js";
import type { OntologyQueryBaseOptions } from "./ontology-query.js";

export interface MetricQueryDataOptions extends OntologyQueryBaseOptions {
  metricId: string;
  body: string;
  branch?: string;
  fillNull?: boolean;
}

export interface MetricDryRunOptions extends OntologyQueryBaseOptions {
  body: string;
  branch?: string;
  fillNull?: boolean;
}

function appendMetricQueryParams(url: URL, branch: string | undefined, fillNull: boolean | undefined): void {
  if (branch !== undefined) url.searchParams.set("branch", branch);
  if (fillNull !== undefined) url.searchParams.set("fill_null", String(fillNull));
}

export async function metricQueryData(options: MetricQueryDataOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    knId,
    metricId,
    body,
    businessDomain = "bd_public",
    branch,
    fillNull,
  } = options;
  const base = baseUrl.replace(/\/+$/, "");
  const url = new URL(
    `${base}/api/ontology-query/v1/knowledge-networks/${encodeURIComponent(knId)}/metrics/${encodeURIComponent(metricId)}/data`
  );
  appendMetricQueryParams(url, branch, fillNull);
  const headers: Record<string, string> = {
    ...buildHeaders(accessToken, businessDomain),
    "content-type": "application/json",
  };
  return fetchWithRetry(url.toString(), { method: "POST", headers, body });
}

export async function metricDryRun(options: MetricDryRunOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    knId,
    body,
    businessDomain = "bd_public",
    branch,
    fillNull,
  } = options;
  const base = baseUrl.replace(/\/+$/, "");
  const url = new URL(
    `${base}/api/ontology-query/v1/knowledge-networks/${encodeURIComponent(knId)}/metrics/dry-run`
  );
  appendMetricQueryParams(url, branch, fillNull);
  const headers: Record<string, string> = {
    ...buildHeaders(accessToken, businessDomain),
    "content-type": "application/json",
  };
  return fetchWithRetry(url.toString(), { method: "POST", headers, body });
}
