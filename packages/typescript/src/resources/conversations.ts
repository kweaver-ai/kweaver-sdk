import { listConversations, listMessages } from "../api/conversations.js";
import { fetchAgentInfo } from "../api/agent-chat.js";
import type { ClientContext } from "../client.js";

export class ConversationsResource {
  constructor(private readonly ctx: ClientContext) {}

  async list(agentId: string, opts: { limit?: number; page?: number; size?: number; version?: string } = {}): Promise<unknown[]> {
    const { version = "v0", limit, page, size } = opts;
    const info = await fetchAgentInfo({ ...this.ctx.base(), agentId, version });
    const raw = await listConversations({
      ...this.ctx.base(),
      agentKey: info.key,
      page: page ?? 1,
      size: size ?? (limit ?? 10),
    });
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  }

  async listMessages(agentId: string, conversationId: string, opts: { version?: string } = {}): Promise<unknown[]> {
    const { version = "v0" } = opts;
    const info = await fetchAgentInfo({ ...this.ctx.base(), agentId, version });
    const raw = await listMessages({
      ...this.ctx.base(),
      agentKey: info.key,
      conversationId,
    });
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  }
}
