/**
 * Agent template (agent-tpl) CRUD under agent-factory v3.
 */

import { HttpError, fetchWithRetry, rethrowIfEndpointUnavailable } from "../utils/http.js";
import { buildHeaders } from "./headers.js";

const FACTORY_V3 = "/api/agent-factory/v3";

interface BaseOpts {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
}

function factoryUrl(baseUrl: string, suffix: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${FACTORY_V3}${suffix}`;
}

export interface GetAgentTemplateOptions extends BaseOpts {
  templateId: string;
}

export async function getAgentTemplate(opts: GetAgentTemplateOptions): Promise<string> {
  const pathSeg = `/agent-tpl/${encodeURIComponent(opts.templateId)}`;
  const url = factoryUrl(opts.baseUrl, pathSeg);
  const response = await fetchWithRetry(url, {
    method: "GET",
    headers: buildHeaders(opts.accessToken, opts.businessDomain ?? "bd_public"),
  });
  const body = await response.text();
  if (!response.ok) {
    rethrowIfEndpointUnavailable(`${FACTORY_V3}${pathSeg}`, new HttpError(response.status, response.statusText, body));
  }
  return body;
}

export interface GetAgentTemplateByKeyOptions extends BaseOpts {
  key: string;
}

export async function getAgentTemplateByKey(opts: GetAgentTemplateByKeyOptions): Promise<string> {
  const pathSeg = `/agent-tpl/by-key/${encodeURIComponent(opts.key)}`;
  const url = factoryUrl(opts.baseUrl, pathSeg);
  const response = await fetchWithRetry(url, {
    method: "GET",
    headers: buildHeaders(opts.accessToken, opts.businessDomain ?? "bd_public"),
  });
  const body = await response.text();
  if (!response.ok) {
    rethrowIfEndpointUnavailable(`${FACTORY_V3}${pathSeg}`, new HttpError(response.status, response.statusText, body));
  }
  return body;
}

export interface UpdateAgentTemplateOptions extends BaseOpts {
  templateId: string;
  body: string;
}

export async function updateAgentTemplate(opts: UpdateAgentTemplateOptions): Promise<void> {
  const pathSeg = `/agent-tpl/${encodeURIComponent(opts.templateId)}`;
  const url = factoryUrl(opts.baseUrl, pathSeg);
  const response = await fetchWithRetry(url, {
    method: "PUT",
    headers: {
      ...buildHeaders(opts.accessToken, opts.businessDomain ?? "bd_public"),
      "content-type": "application/json",
    },
    body: opts.body,
  });
  const body = await response.text();
  if (!response.ok) {
    rethrowIfEndpointUnavailable(`${FACTORY_V3}${pathSeg}`, new HttpError(response.status, response.statusText, body));
  }
}

export interface DeleteAgentTemplateOptions extends BaseOpts {
  templateId: string;
}

export async function deleteAgentTemplate(opts: DeleteAgentTemplateOptions): Promise<void> {
  const pathSeg = `/agent-tpl/${encodeURIComponent(opts.templateId)}`;
  const url = factoryUrl(opts.baseUrl, pathSeg);
  const response = await fetchWithRetry(url, {
    method: "DELETE",
    headers: buildHeaders(opts.accessToken, opts.businessDomain ?? "bd_public"),
  });
  const body = await response.text();
  if (!response.ok) {
    rethrowIfEndpointUnavailable(`${FACTORY_V3}${pathSeg}`, new HttpError(response.status, response.statusText, body));
  }
}

export interface CopyAgentTemplateOptions extends BaseOpts {
  templateId: string;
}

/** POST — duplicate template (HTTP 201 body per backend). */
export async function copyAgentTemplate(opts: CopyAgentTemplateOptions): Promise<string> {
  const pathSeg = `/agent-tpl/${encodeURIComponent(opts.templateId)}/copy`;
  const url = factoryUrl(opts.baseUrl, pathSeg);
  const response = await fetchWithRetry(url, {
    method: "POST",
    headers: {
      ...buildHeaders(opts.accessToken, opts.businessDomain ?? "bd_public"),
      "content-type": "application/json",
    },
    body: "{}",
  });
  const body = await response.text();
  if (!response.ok) {
    rethrowIfEndpointUnavailable(`${FACTORY_V3}${pathSeg}`, new HttpError(response.status, response.statusText, body));
  }
  return body;
}

export interface PublishAgentTemplateOptions extends BaseOpts {
  templateId: string;
  /** JSON body; default matches backend PublishReq embed (category_ids optional). */
  body?: string;
}

export async function publishAgentTemplate(opts: PublishAgentTemplateOptions): Promise<string> {
  const pathSeg = `/agent-tpl/${encodeURIComponent(opts.templateId)}/publish`;
  const url = factoryUrl(opts.baseUrl, pathSeg);
  const payload =
    opts.body ??
    JSON.stringify({
      business_domain_id: "bd_public",
      category_ids: [],
    });
  const response = await fetchWithRetry(url, {
    method: "POST",
    headers: {
      ...buildHeaders(opts.accessToken, opts.businessDomain ?? "bd_public"),
      "content-type": "application/json",
    },
    body: payload,
  });
  const body = await response.text();
  if (!response.ok) {
    rethrowIfEndpointUnavailable(`${FACTORY_V3}${pathSeg}`, new HttpError(response.status, response.statusText, body));
  }
  return body;
}

export interface UnpublishAgentTemplateOptions extends BaseOpts {
  templateId: string;
}

export async function unpublishAgentTemplate(opts: UnpublishAgentTemplateOptions): Promise<void> {
  const pathSeg = `/agent-tpl/${encodeURIComponent(opts.templateId)}/unpublish`;
  const url = factoryUrl(opts.baseUrl, pathSeg);
  const response = await fetchWithRetry(url, {
    method: "PUT",
    headers: buildHeaders(opts.accessToken, opts.businessDomain ?? "bd_public"),
  });
  const body = await response.text();
  if (!response.ok) {
    rethrowIfEndpointUnavailable(`${FACTORY_V3}${pathSeg}`, new HttpError(response.status, response.statusText, body));
  }
}

export async function getAgentTemplatePublishInfo(opts: GetAgentTemplateOptions): Promise<string> {
  const pathSeg = `/agent-tpl/${encodeURIComponent(opts.templateId)}/publish-info`;
  const url = factoryUrl(opts.baseUrl, pathSeg);
  const response = await fetchWithRetry(url, {
    method: "GET",
    headers: buildHeaders(opts.accessToken, opts.businessDomain ?? "bd_public"),
  });
  const body = await response.text();
  if (!response.ok) {
    rethrowIfEndpointUnavailable(`${FACTORY_V3}${pathSeg}`, new HttpError(response.status, response.statusText, body));
  }
  return body;
}

export interface UpdateAgentTemplatePublishInfoOptions extends BaseOpts {
  templateId: string;
  body: string;
}

export async function updateAgentTemplatePublishInfo(opts: UpdateAgentTemplatePublishInfoOptions): Promise<string> {
  const pathSeg = `/agent-tpl/${encodeURIComponent(opts.templateId)}/publish-info`;
  const url = factoryUrl(opts.baseUrl, pathSeg);
  const response = await fetchWithRetry(url, {
    method: "PUT",
    headers: {
      ...buildHeaders(opts.accessToken, opts.businessDomain ?? "bd_public"),
      "content-type": "application/json",
    },
    body: opts.body,
  });
  const body = await response.text();
  if (!response.ok) {
    rethrowIfEndpointUnavailable(`${FACTORY_V3}${pathSeg}`, new HttpError(response.status, response.statusText, body));
  }
  return body;
}
