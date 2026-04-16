import {
  testDatasource,
  createDatasource,
  listDatasources,
  getDatasource,
  deleteDatasource,
  listTables,
  listTablesWithColumns,
  scanMetadata,
} from "../api/datasources.js";
import type { ClientContext } from "../client.js";

export class DataSourcesResource {
  constructor(private readonly ctx: ClientContext) {}

  async test(id: string): Promise<void> {
    await testDatasource({ ...this.ctx.base(), id });
  }

  async create(opts: {
    name: string;
    type: string;
    host: string;
    port: number;
    database: string;
    account: string;
    password: string;
    schema?: string;
    comment?: string;
  }): Promise<unknown> {
    const raw = await createDatasource({ ...this.ctx.base(), ...opts });
    return JSON.parse(raw);
  }

  async list(opts: { keyword?: string; type?: string } = {}): Promise<unknown[]> {
    const raw = await listDatasources({ ...this.ctx.base(), ...opts });
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      const items = obj.entries ?? obj.data ?? obj.records;
      if (Array.isArray(items)) return items;
    }
    return [];
  }

  async get(id: string): Promise<unknown> {
    const raw = await getDatasource({ ...this.ctx.base(), id });
    return JSON.parse(raw);
  }

  async delete(id: string): Promise<void> {
    await deleteDatasource({ ...this.ctx.base(), id });
  }

  async listTables(
    id: string,
    opts: { keyword?: string; limit?: number; offset?: number } = {},
  ): Promise<unknown[]> {
    const raw = await listTables({ ...this.ctx.base(), id, ...opts });
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      const items = obj.entries ?? obj.data;
      if (Array.isArray(items)) return items;
    }
    return [];
  }

  async listTablesWithColumns(
    id: string,
    opts: { keyword?: string; limit?: number; offset?: number; autoScan?: boolean } = {},
  ): Promise<Array<{ name: string; columns: Array<{ name: string; type: string; comment?: string }> }>> {
    const raw = await listTablesWithColumns({ ...this.ctx.base(), id, ...opts });
    return JSON.parse(raw) as Array<{ name: string; columns: Array<{ name: string; type: string; comment?: string }> }>;
  }

  async scanMetadata(id: string, opts: { dsType?: string } = {}): Promise<string> {
    return scanMetadata({ ...this.ctx.base(), id, ...opts });
  }
}
