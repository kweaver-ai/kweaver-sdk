import { listConversations, listMessages } from "../api/conversations.js";
import type { ClientContext } from "../client.js";

export class ConversationsResource {
  constructor(private readonly ctx: ClientContext) {}

  async list(agentId: string, opts: { limit?: number } = {}): Promise<unknown[]> {
    const raw = await listConversations({ ...this.ctx.base(), agentId, ...opts });
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  }

  async listMessages(agentId: string, conversationId: string, opts: { limit?: number } = {}): Promise<unknown[]> {
    const raw = await listMessages({ ...this.ctx.base(), agentId, conversationId, ...opts });
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  }
}
