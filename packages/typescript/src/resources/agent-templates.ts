import type { ClientContext } from "../client.js";
import {
  copyAgentTemplate,
  deleteAgentTemplate,
  getAgentTemplate,
  getAgentTemplateByKey,
  getAgentTemplatePublishInfo,
  publishAgentTemplate,
  unpublishAgentTemplate,
  updateAgentTemplate,
  updateAgentTemplatePublishInfo,
} from "../api/agent-tpl.js";

/** Agent template (personal-space `agent-tpl`) CRUD + publish — agent-factory v3. */
export class AgentTemplatesResource {
  constructor(private readonly ctx: ClientContext) {}

  async get(templateId: string): Promise<unknown> {
    const raw = await getAgentTemplate({ ...this.ctx.base(), templateId });
    return JSON.parse(raw) as unknown;
  }

  async getByKey(key: string): Promise<unknown> {
    const raw = await getAgentTemplateByKey({ ...this.ctx.base(), key });
    return JSON.parse(raw) as unknown;
  }

  async update(templateId: string, body: Record<string, unknown>): Promise<void> {
    await updateAgentTemplate({
      ...this.ctx.base(),
      templateId,
      body: JSON.stringify(body),
    });
  }

  async delete(templateId: string): Promise<void> {
    await deleteAgentTemplate({ ...this.ctx.base(), templateId });
  }

  async copy(templateId: string): Promise<unknown> {
    const raw = await copyAgentTemplate({ ...this.ctx.base(), templateId });
    return JSON.parse(raw) as unknown;
  }

  async publish(templateId: string, body?: Record<string, unknown>): Promise<unknown> {
    const raw = await publishAgentTemplate({
      ...this.ctx.base(),
      templateId,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return JSON.parse(raw) as unknown;
  }

  async unpublish(templateId: string): Promise<void> {
    await unpublishAgentTemplate({ ...this.ctx.base(), templateId });
  }

  async getPublishInfo(templateId: string): Promise<unknown> {
    const raw = await getAgentTemplatePublishInfo({ ...this.ctx.base(), templateId });
    return JSON.parse(raw) as unknown;
  }

  async updatePublishInfo(templateId: string, body: Record<string, unknown>): Promise<unknown> {
    const raw = await updateAgentTemplatePublishInfo({
      ...this.ctx.base(),
      templateId,
      body: JSON.stringify(body),
    });
    return JSON.parse(raw) as unknown;
  }
}
