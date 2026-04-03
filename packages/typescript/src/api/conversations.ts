export interface ListConversationsOptions {
  baseUrl: string;
  accessToken: string;
  agentKey: string;
  businessDomain?: string;
  page?: number;
  size?: number;
}

export interface ListMessagesOptions {
  baseUrl: string;
  accessToken: string;
  agentKey: string;
  conversationId: string;
  businessDomain?: string;
}

export interface GetTracesOptions {
  baseUrl: string;
  accessToken: string;
  agentId: string;
  conversationId: string;
  businessDomain?: string;
}

function buildConversationsUrl(baseUrl: string, agentKey: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return `${base}/api/agent-factory/v1/app/${agentKey}/conversation`;
}

function buildMessagesUrl(baseUrl: string, agentKey: string, conversationId: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return `${base}/api/agent-factory/v1/app/${agentKey}/conversation/${conversationId}`;
}

/**
 * List conversations for an agent.
 * Returns empty array on 404 (endpoint may not be available in all deployments).
 */
export async function listConversations(opts: ListConversationsOptions): Promise<string> {
  const { baseUrl, accessToken, agentKey, businessDomain = "bd_public", page = 1, size = 10 } = opts;
  const url = new URL(buildConversationsUrl(baseUrl, agentKey));
  url.searchParams.set("page", String(page));
  url.searchParams.set("size", String(size));

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${accessToken}`,
      token: accessToken,
      "x-business-domain": businessDomain,
    },
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`listConversations failed: HTTP ${response.status} ${response.statusText} — ${body.slice(0, 200)}`);
  }

  return body || "[]";
}

function buildTracesUrl(baseUrl: string, agentId: string, conversationId: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return `${base}/api/agent-factory/v1/observability/agent/${agentId}/conversation/${conversationId}/session`;
}

export async function getTracesByConversation(opts: GetTracesOptions): Promise<string> {
  const { baseUrl, accessToken, agentId, conversationId, businessDomain = "bd_public" } = opts;
  const url = buildTracesUrl(baseUrl, agentId, conversationId);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      accept: "application/json",
      authorization: `Bearer ${accessToken}`,
      token: accessToken,
      "x-business-domain": businessDomain,
    },
    body: JSON.stringify({
      agent_id: agentId,
      start_time: 1,
      end_time: Date.now() + 86400000,
      page: 1,
      size: 50,
    }),
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`getTracesByConversation failed: HTTP ${response.status} ${response.statusText} — ${body.slice(0, 200)}`);
  }

  return body || "{}";
}

/**
 * List messages for a conversation.
 * Returns empty array on 404 (endpoint may not be available in all deployments).
 */
export async function listMessages(opts: ListMessagesOptions): Promise<string> {
  const { baseUrl, accessToken, agentKey, conversationId, businessDomain = "bd_public" } = opts;
  const url = buildMessagesUrl(baseUrl, agentKey, conversationId);

  const response = await fetch(url, {
    method: "GET",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${accessToken}`,
      token: accessToken,
      "x-business-domain": businessDomain,
    },
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`listMessages failed: HTTP ${response.status} ${response.statusText} — ${body.slice(0, 200)}`);
  }

  return body || "{}";
}
