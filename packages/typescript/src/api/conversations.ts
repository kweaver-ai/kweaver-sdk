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
  conversationId: string;
  businessDomain?: string;
  limit?: number;
}

export interface GetTracesOptions {
  baseUrl: string;
  accessToken: string;
  conversationId: string;
}

function buildConversationsUrl(baseUrl: string, agentId: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return `${base}/api/agent-app/v1/app/${agentId}/conversations`;
}

function buildMessagesUrl(baseUrl: string, conversationId: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return `${base}/api/agent-app/v1/conversations/${conversationId}/messages`;
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

  if (response.status === 404) {
    return "[]";
  }

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`listConversations failed: HTTP ${response.status} ${response.statusText} — ${body.slice(0, 200)}`);
  }

  return body || "[]";
}

function buildTracesUrl(baseUrl: string, conversationId: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return `${base}/api/v1/traces/by-conversation?conversation_id=${conversationId}`;
}

export async function getTracesByConversation(opts: GetTracesOptions): Promise<string> {
  const { baseUrl, accessToken, conversationId } = opts;
  const url = buildTracesUrl(baseUrl, conversationId);

  const response = await fetch(url, {
    method: "GET",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${accessToken}`,
      token: accessToken,
    },
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
  const { baseUrl, accessToken, conversationId, businessDomain = "bd_public", limit } = opts;
  const url = new URL(buildMessagesUrl(baseUrl, conversationId));
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

  if (response.status === 404) {
    return "[]";
  }

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`listMessages failed: HTTP ${response.status} ${response.statusText} — ${body.slice(0, 200)}`);
  }

  return body || "[]";
}
