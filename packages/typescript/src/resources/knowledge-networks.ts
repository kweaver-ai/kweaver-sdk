import {
  listKnowledgeNetworks,
  getKnowledgeNetwork,
  createKnowledgeNetwork,
  updateKnowledgeNetwork,
  deleteKnowledgeNetwork,
  listObjectTypes,
  listRelationTypes,
  listActionTypes,
} from "../api/knowledge-networks.js";
import type { ClientContext } from "../client.js";

export class KnowledgeNetworksResource {
  constructor(private readonly ctx: ClientContext) {}

  async list(opts: { offset?: number; limit?: number; name_pattern?: string; tag?: string } = {}): Promise<unknown[]> {
    const raw = await listKnowledgeNetworks({ ...this.ctx.base(), ...opts });
    const parsed = JSON.parse(raw) as unknown;
    const data = parsed && typeof parsed === "object" && "data" in parsed
      ? (parsed as { data: unknown }).data
      : parsed;
    return Array.isArray(data) ? data : [];
  }

  async get(knId: string, opts: { mode?: "export" | ""; include_statistics?: boolean } = {}): Promise<unknown> {
    const raw = await getKnowledgeNetwork({ ...this.ctx.base(), knId, ...opts });
    return JSON.parse(raw) as unknown;
  }

  async create(opts: { name: string; description?: string; tags?: string[] }): Promise<unknown> {
    const raw = await createKnowledgeNetwork({ ...this.ctx.base(), body: JSON.stringify(opts) });
    return JSON.parse(raw) as unknown;
  }

  async update(knId: string, opts: { name: string; description?: string; tags?: string[] }): Promise<unknown> {
    const raw = await updateKnowledgeNetwork({ ...this.ctx.base(), knId, body: JSON.stringify(opts) });
    return JSON.parse(raw) as unknown;
  }

  async delete(knId: string): Promise<void> {
    await deleteKnowledgeNetwork({ ...this.ctx.base(), knId });
  }

  async listObjectTypes(knId: string, opts: { branch?: string; limit?: number } = {}): Promise<unknown[]> {
    const raw = await listObjectTypes({ ...this.ctx.base(), knId, ...opts });
    const parsed = JSON.parse(raw) as unknown;
    const items = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && "entries" in parsed
        ? (parsed as { entries: unknown[] }).entries
        : [];
    return items;
  }

  async listRelationTypes(knId: string, opts: { branch?: string; limit?: number } = {}): Promise<unknown[]> {
    const raw = await listRelationTypes({ ...this.ctx.base(), knId, ...opts });
    const parsed = JSON.parse(raw) as unknown;
    const items = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && "entries" in parsed
        ? (parsed as { entries: unknown[] }).entries
        : [];
    return items;
  }

  async listActionTypes(knId: string, opts: { branch?: string; limit?: number } = {}): Promise<unknown[]> {
    const raw = await listActionTypes({ ...this.ctx.base(), knId, ...opts });
    const parsed = JSON.parse(raw) as unknown;
    const items = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && "entries" in parsed
        ? (parsed as { entries: unknown[] }).entries
        : [];
    return items;
  }
}
