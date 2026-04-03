export interface ListConversationsOptions {
  baseUrl: string;
  accessToken: string;
  agentId: string;
  businessDomain?: string;
  limit?: number;
}

export interface ListMessagesOptions {
  baseUrl: string;
  accessToken: string;
  agentId: string;
  conversationId: string;
  businessDomain?: string;
  limit?: number;
}

export interface GetTracesOptions {
  baseUrl: string;
  accessToken: string;
  agentId: string;
  conversationId: string;
  businessDomain?: string;
}

function buildConversationsUrl(baseUrl: string, agentId: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return `${base}/api/agent-factory/v1/app/${agentId}/conversation`;
}

function buildConversationDetailUrl(baseUrl: string, agentId: string, conversationId: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return `${base}/api/agent-factory/v1/app/${agentId}/conversation/${conversationId}`;
}

/**
 * List conversations for an agent.
 * Returns empty array on 404 (endpoint may not be available in all deployments).
 */
export async function listConversations(opts: ListConversationsOptions): Promise<string> {
  const { baseUrl, accessToken, agentId, businessDomain = "bd_public", limit } = opts;
  const url = new URL(buildConversationsUrl(baseUrl, agentId));
  if (limit !== undefined) {
    url.searchParams.set("limit", String(limit));
  }

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
  const { baseUrl, accessToken, agentId, conversationId, businessDomain = "bd_public" } = opts;
  const url = buildConversationDetailUrl(baseUrl, agentId, conversationId);

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
