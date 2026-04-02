import { HttpError } from "../utils/http.js";
import { buildHeaders } from "./headers.js";

export interface OntologyQueryBaseOptions {
  baseUrl: string;
  accessToken: string;
  knId: string;
  businessDomain?: string;
}

/** Object-type query: POST with X-HTTP-Method-Override: GET */
export interface ObjectTypeQueryOptions extends OntologyQueryBaseOptions {
  otId: string;
  body: string;
  includeTypeInfo?: boolean;
  includeLogicParams?: boolean;
  excludeSystemProperties?: string[];
}

export async function objectTypeQuery(options: ObjectTypeQueryOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    knId,
    otId,
    body,
    businessDomain = "bd_public",
    includeTypeInfo,
    includeLogicParams,
    excludeSystemProperties,
  } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const url = new URL(
    `${base}/api/ontology-query/v1/knowledge-networks/${encodeURIComponent(knId)}/object-types/${encodeURIComponent(otId)}`
  );
  if (includeTypeInfo !== undefined) {
    url.searchParams.set("include_type_info", String(includeTypeInfo));
  }
  if (includeLogicParams !== undefined) {
    url.searchParams.set("include_logic_params", String(includeLogicParams));
  }
  if (excludeSystemProperties?.length) {
    for (const p of excludeSystemProperties) {
      url.searchParams.append("exclude_system_properties", p);
    }
  }

  const headers: Record<string, string> = {
    ...buildHeaders(accessToken, businessDomain),
    "content-type": "application/json",
    "X-HTTP-Method-Override": "GET",
  };

  const response = await fetch(url.toString(), {
    method: "POST",
    headers,
    body,
  });

  const responseBody = await response.text();
  if (!response.ok) {
    throw new HttpError(response.status, response.statusText, responseBody);
  }
  return responseBody;
}

/** Object-type properties: POST with X-HTTP-Method-Override: GET */
export interface ObjectTypePropertiesOptions extends OntologyQueryBaseOptions {
  otId: string;
  body: string;
  excludeSystemProperties?: string[];
}

export async function objectTypeProperties(options: ObjectTypePropertiesOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    knId,
    otId,
    body,
    businessDomain = "bd_public",
    excludeSystemProperties,
  } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const url = new URL(
    `${base}/api/ontology-query/v1/knowledge-networks/${encodeURIComponent(knId)}/object-types/${encodeURIComponent(otId)}/properties`
  );
  if (excludeSystemProperties?.length) {
    for (const p of excludeSystemProperties) {
      url.searchParams.append("exclude_system_properties", p);
    }
  }

  const headers: Record<string, string> = {
    ...buildHeaders(accessToken, businessDomain),
    "content-type": "application/json",
    "X-HTTP-Method-Override": "GET",
  };

  const response = await fetch(url.toString(), {
    method: "POST",
    headers,
    body,
  });

  const responseBody = await response.text();
  if (!response.ok) {
    throw new HttpError(response.status, response.statusText, responseBody);
  }
  return responseBody;
}

/** Subgraph: POST with X-HTTP-Method-Override: GET */
export interface SubgraphOptions extends OntologyQueryBaseOptions {
  body: string;
  includeLogicParams?: boolean;
  excludeSystemProperties?: string[];
  queryType?: "" | "relation_path";
}

export async function subgraph(options: SubgraphOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    knId,
    body,
    businessDomain = "bd_public",
    includeLogicParams,
    excludeSystemProperties,
    queryType,
  } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const url = new URL(
    `${base}/api/ontology-query/v1/knowledge-networks/${encodeURIComponent(knId)}/subgraph`
  );
  if (includeLogicParams !== undefined) {
    url.searchParams.set("include_logic_params", String(includeLogicParams));
  }
  if (excludeSystemProperties?.length) {
    for (const p of excludeSystemProperties) {
      url.searchParams.append("exclude_system_properties", p);
    }
  }
  if (queryType !== undefined && queryType !== "") {
    url.searchParams.set("query_type", queryType);
  }

  const headers: Record<string, string> = {
    ...buildHeaders(accessToken, businessDomain),
    "content-type": "application/json",
    "X-HTTP-Method-Override": "GET",
  };

  const response = await fetch(url.toString(), {
    method: "POST",
    headers,
    body,
  });

  const responseBody = await response.text();
  if (!response.ok) {
    throw new HttpError(response.status, response.statusText, responseBody);
  }
  return responseBody;
}

/** Action-type query: POST with X-HTTP-Method-Override: GET */
export interface ActionTypeQueryOptions extends OntologyQueryBaseOptions {
  atId: string;
  body: string;
  includeTypeInfo?: boolean;
  excludeSystemProperties?: string[];
}

export async function actionTypeQuery(options: ActionTypeQueryOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    knId,
    atId,
    body,
    businessDomain = "bd_public",
    includeTypeInfo,
    excludeSystemProperties,
  } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const url = new URL(
    `${base}/api/ontology-query/v1/knowledge-networks/${encodeURIComponent(knId)}/action-types/${encodeURIComponent(atId)}/`
  );
  if (includeTypeInfo !== undefined) {
    url.searchParams.set("include_type_info", String(includeTypeInfo));
  }
  if (excludeSystemProperties?.length) {
    for (const p of excludeSystemProperties) {
      url.searchParams.append("exclude_system_properties", p);
    }
  }

  const headers: Record<string, string> = {
    ...buildHeaders(accessToken, businessDomain),
    "content-type": "application/json",
    "X-HTTP-Method-Override": "GET",
  };

  const response = await fetch(url.toString(), {
    method: "POST",
    headers,
    body,
  });

  const responseBody = await response.text();
  if (!response.ok) {
    throw new HttpError(response.status, response.statusText, responseBody);
  }
  return responseBody;
}

/**
 * Action-type execute: POST (has side effects).
 *
 * The request body must include `_instance_identities` — an array of objects
 * identifying which instances the action operates on:
 * ```json
 * {"_instance_identities": [{"<primary_key>": "<value>"}], ...otherParams}
 * ```
 */
export interface ActionTypeExecuteOptions extends OntologyQueryBaseOptions {
  atId: string;
  body: string;
}

export async function actionTypeExecute(options: ActionTypeExecuteOptions): Promise<string> {
  const { baseUrl, accessToken, knId, atId, body, businessDomain = "bd_public" } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}/api/ontology-query/v1/knowledge-networks/${encodeURIComponent(knId)}/action-types/${encodeURIComponent(atId)}/execute`;

  const headers: Record<string, string> = {
    ...buildHeaders(accessToken, businessDomain),
    "content-type": "application/json",
  };

  const response = await fetch(url, {
    method: "POST",
    headers,
    body,
  });

  const responseBody = await response.text();
  if (!response.ok) {
    throw new HttpError(response.status, response.statusText, responseBody);
  }
  return responseBody;
}

/** Action-execution get: GET */
export interface ActionExecutionGetOptions extends OntologyQueryBaseOptions {
  executionId: string;
}

export async function actionExecutionGet(options: ActionExecutionGetOptions): Promise<string> {
  const { baseUrl, accessToken, knId, executionId, businessDomain = "bd_public" } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}/api/ontology-query/v1/knowledge-networks/${encodeURIComponent(knId)}/action-executions/${encodeURIComponent(executionId)}`;

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

/** Action-logs list: GET */
export interface ActionLogsListOptions extends OntologyQueryBaseOptions {
  actionTypeId?: string;
  status?: string;
  triggerType?: string;
  startTimeFrom?: number;
  startTimeTo?: number;
  limit?: number;
  needTotal?: boolean;
  searchAfter?: string;
}

export async function actionLogsList(options: ActionLogsListOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    knId,
    businessDomain = "bd_public",
    actionTypeId,
    status,
    triggerType,
    startTimeFrom,
    startTimeTo,
    limit,
    needTotal,
    searchAfter,
  } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const url = new URL(
    `${base}/api/ontology-query/v1/knowledge-networks/${encodeURIComponent(knId)}/action-logs`
  );
  if (actionTypeId !== undefined && actionTypeId !== "") {
    url.searchParams.set("action_type_id", actionTypeId);
  }
  if (status !== undefined && status !== "") {
    url.searchParams.set("status", status);
  }
  if (triggerType !== undefined && triggerType !== "") {
    url.searchParams.set("trigger_type", triggerType);
  }
  if (startTimeFrom !== undefined) {
    url.searchParams.set("start_time_from", String(startTimeFrom));
  }
  if (startTimeTo !== undefined) {
    url.searchParams.set("start_time_to", String(startTimeTo));
  }
  if (limit !== undefined) {
    url.searchParams.set("limit", String(limit));
  }
  if (needTotal !== undefined) {
    url.searchParams.set("need_total", String(needTotal));
  }
  if (searchAfter !== undefined && searchAfter !== "") {
    url.searchParams.set("search_after", searchAfter);
  }

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: buildHeaders(accessToken, businessDomain),
  });

  const body = await response.text();
  if (!response.ok) {
    throw new HttpError(response.status, response.statusText, body);
  }
  return body;
}

/** Action-log get: GET */
export interface ActionLogGetOptions extends OntologyQueryBaseOptions {
  logId: string;
  resultsLimit?: number;
  resultsOffset?: number;
  resultsStatus?: "success" | "failed";
}

export async function actionLogGet(options: ActionLogGetOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    knId,
    logId,
    businessDomain = "bd_public",
    resultsLimit,
    resultsOffset,
    resultsStatus,
  } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const url = new URL(
    `${base}/api/ontology-query/v1/knowledge-networks/${encodeURIComponent(knId)}/action-logs/${encodeURIComponent(logId)}`
  );
  if (resultsLimit !== undefined) {
    url.searchParams.set("results_limit", String(resultsLimit));
  }
  if (resultsOffset !== undefined) {
    url.searchParams.set("results_offset", String(resultsOffset));
  }
  if (resultsStatus !== undefined) {
    url.searchParams.set("results_status", resultsStatus);
  }

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: buildHeaders(accessToken, businessDomain),
  });

  const body = await response.text();
  if (!response.ok) {
    throw new HttpError(response.status, response.statusText, body);
  }
  return body;
}

/** Action-log cancel: POST (has side effects) */
export interface ActionLogCancelOptions extends OntologyQueryBaseOptions {
  logId: string;
  body?: string;
}

export async function actionLogCancel(options: ActionLogCancelOptions): Promise<string> {
  const { baseUrl, accessToken, knId, logId, body = "{}", businessDomain = "bd_public" } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}/api/ontology-query/v1/knowledge-networks/${encodeURIComponent(knId)}/action-logs/${encodeURIComponent(logId)}/cancel`;

  const headers: Record<string, string> = {
    ...buildHeaders(accessToken, businessDomain),
    "content-type": "application/json",
  };

  const response = await fetch(url, {
    method: "POST",
    headers,
    body,
  });

  const responseBody = await response.text();
  if (!response.ok) {
    throw new HttpError(response.status, response.statusText, responseBody);
  }
  return responseBody;
}
