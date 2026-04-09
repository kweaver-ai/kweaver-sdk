import {
  vegaHealth,
  listVegaCatalogs,
  getVegaCatalog,
  createVegaCatalog,
  updateVegaCatalog,
  deleteVegaCatalogs,
  vegaCatalogHealthStatus,
  testVegaCatalogConnection,
  discoverVegaCatalog,
  listVegaCatalogResources,
  listVegaResources,
  getVegaResource,
  queryVegaResourceData,
  createVegaResource,
  updateVegaResource,
  deleteVegaResources,
  createVegaDatasetDocs,
  updateVegaDatasetDocs,
  deleteVegaDatasetDocs,
  deleteVegaDatasetDocsQuery,
  buildVegaDataset,
  getVegaDatasetBuildStatus,
  executeVegaQuery,
  listAllVegaResources,
  listVegaConnectorTypes,
  getVegaConnectorType,
  registerVegaConnectorType,
  updateVegaConnectorType,
  deleteVegaConnectorType,
  setVegaConnectorTypeEnabled,
} from "../api/vega.js";
import type { ClientContext } from "../client.js";

function unwrapArray(raw: string): unknown[] {
  const parsed = JSON.parse(raw) as unknown;
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    const items = obj.entries ?? obj.data ?? obj.records;
    if (Array.isArray(items)) return items;
  }
  return [];
}

export class VegaResource {
  constructor(private readonly ctx: ClientContext) {}

  // ── Health ──────────────────────────────────────────────────────────────────

  async health(): Promise<unknown> {
    const raw = await vegaHealth(this.ctx.base());
    return JSON.parse(raw);
  }

  // ── Catalogs ────────────────────────────────────────────────────────────────

  async listCatalogs(opts: { status?: string; limit?: number; offset?: number } = {}): Promise<unknown[]> {
    const raw = await listVegaCatalogs({ ...this.ctx.base(), ...opts });
    return unwrapArray(raw);
  }

  async getCatalog(id: string): Promise<unknown> {
    const raw = await getVegaCatalog({ ...this.ctx.base(), id });
    return JSON.parse(raw);
  }

  async createCatalog(data: {
    name: string;
    connector_type: string;
    connector_config: Record<string, unknown>;
    tags?: string[];
    description?: string;
  }): Promise<unknown> {
    const raw = await createVegaCatalog({ ...this.ctx.base(), body: JSON.stringify(data) });
    return raw ? JSON.parse(raw) : {};
  }

  async updateCatalog(id: string, body: string): Promise<unknown> {
    const raw = await updateVegaCatalog({ ...this.ctx.base(), id, body });
    return raw ? JSON.parse(raw) : {};
  }

  async deleteCatalogs(ids: string): Promise<unknown> {
    const raw = await deleteVegaCatalogs({ ...this.ctx.base(), ids });
    return raw ? JSON.parse(raw) : {};
  }

  async catalogHealthStatus(ids: string): Promise<unknown> {
    const raw = await vegaCatalogHealthStatus({ ...this.ctx.base(), ids });
    return JSON.parse(raw);
  }

  async testCatalogConnection(id: string): Promise<unknown> {
    const raw = await testVegaCatalogConnection({ ...this.ctx.base(), id });
    return JSON.parse(raw);
  }

  async discoverCatalog(id: string, opts: { wait?: boolean } = {}): Promise<unknown> {
    const raw = await discoverVegaCatalog({ ...this.ctx.base(), id, ...opts });
    return JSON.parse(raw);
  }

  async listCatalogResources(
    id: string,
    opts: { category?: string; limit?: number; offset?: number } = {},
  ): Promise<unknown[]> {
    const raw = await listVegaCatalogResources({ ...this.ctx.base(), id, ...opts });
    return unwrapArray(raw);
  }

  // ── Resources ───────────────────────────────────────────────────────────────

  async listResources(opts: {
    catalogId?: string;
    category?: string;
    status?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<unknown[]> {
    const raw = await listVegaResources({ ...this.ctx.base(), ...opts });
    return unwrapArray(raw);
  }

  async getResource(id: string): Promise<unknown> {
    const raw = await getVegaResource({ ...this.ctx.base(), id });
    return JSON.parse(raw);
  }

  async queryResourceData(id: string, body: string): Promise<unknown> {
    const raw = await queryVegaResourceData({ ...this.ctx.base(), id, body });
    return JSON.parse(raw);
  }

  async createResource(body: string): Promise<unknown> {
    const raw = await createVegaResource({ ...this.ctx.base(), body });
    return raw ? JSON.parse(raw) : {};
  }

  async updateResource(id: string, body: string): Promise<unknown> {
    const raw = await updateVegaResource({ ...this.ctx.base(), id, body });
    return raw ? JSON.parse(raw) : {};
  }

  async deleteResources(ids: string): Promise<unknown> {
    const raw = await deleteVegaResources({ ...this.ctx.base(), ids });
    return raw ? JSON.parse(raw) : {};
  }

  // ── Dataset Docs ────────────────────────────────────────────────────────────

  async createDatasetDocs(id: string, body: string): Promise<unknown> {
    const raw = await createVegaDatasetDocs({ ...this.ctx.base(), id, body });
    return JSON.parse(raw);
  }

  async updateDatasetDocs(id: string, body: string): Promise<unknown> {
    const raw = await updateVegaDatasetDocs({ ...this.ctx.base(), id, body });
    return raw ? JSON.parse(raw) : {};
  }

  async deleteDatasetDocs(id: string, docIds: string): Promise<unknown> {
    const raw = await deleteVegaDatasetDocs({ ...this.ctx.base(), id, docIds });
    return raw ? JSON.parse(raw) : {};
  }

  async deleteDatasetDocsQuery(id: string, body: string): Promise<unknown> {
    const raw = await deleteVegaDatasetDocsQuery({ ...this.ctx.base(), id, body });
    return raw ? JSON.parse(raw) : {};
  }

  // ── Dataset Build ──────────────────────────────────────────────────────────

  async buildDataset(id: string, mode?: string): Promise<unknown> {
    const raw = await buildVegaDataset({ ...this.ctx.base(), id, mode });
    return JSON.parse(raw);
  }

  async getDatasetBuildStatus(id: string, taskId: string): Promise<unknown> {
    const raw = await getVegaDatasetBuildStatus({ ...this.ctx.base(), id, taskId });
    return JSON.parse(raw);
  }

  // ── Query ──────────────────────────────────────────────────────────────────

  async executeQuery(body: string): Promise<unknown> {
    const raw = await executeVegaQuery({ ...this.ctx.base(), body });
    return JSON.parse(raw);
  }

  // ── Resource List All ──────────────────────────────────────────────────────

  async listAllResources(opts: { limit?: number; offset?: number } = {}): Promise<unknown[]> {
    const raw = await listAllVegaResources({ ...this.ctx.base(), ...opts });
    return unwrapArray(raw);
  }

  // ── Connector Types ─────────────────────────────────────────────────────────

  async listConnectorTypes(): Promise<unknown[]> {
    const raw = await listVegaConnectorTypes(this.ctx.base());
    return unwrapArray(raw);
  }

  async getConnectorType(type: string): Promise<unknown> {
    const raw = await getVegaConnectorType({ ...this.ctx.base(), type });
    return JSON.parse(raw);
  }

  async registerConnectorType(body: string): Promise<unknown> {
    const raw = await registerVegaConnectorType({ ...this.ctx.base(), body });
    return JSON.parse(raw);
  }

  async updateConnectorType(type: string, body: string): Promise<unknown> {
    const raw = await updateVegaConnectorType({ ...this.ctx.base(), type, body });
    return raw ? JSON.parse(raw) : {};
  }

  async deleteConnectorType(type: string): Promise<unknown> {
    const raw = await deleteVegaConnectorType({ ...this.ctx.base(), type });
    return raw ? JSON.parse(raw) : {};
  }

  async setConnectorTypeEnabled(type: string, enabled: boolean): Promise<unknown> {
    const raw = await setVegaConnectorTypeEnabled({ ...this.ctx.base(), type, enabled });
    return raw ? JSON.parse(raw) : {};
  }

}
