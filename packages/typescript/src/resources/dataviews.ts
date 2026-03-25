import {
  createDataView,
  deleteDataView,
  findDataView,
  getDataView,
  listDataViews,
} from "../api/dataviews.js";
import type { DataView } from "../api/dataviews.js";
import type { ClientContext } from "../client.js";

export class DataViewsResource {
  constructor(private readonly ctx: ClientContext) {}

  async create(opts: {
    name: string;
    datasourceId: string;
    table: string;
    fields?: Array<{ name: string; type: string }>;
  }): Promise<string> {
    return createDataView({ ...this.ctx.base(), ...opts });
  }

  async get(id: string): Promise<DataView> {
    return getDataView({ ...this.ctx.base(), id });
  }

  async list(opts: { datasourceId?: string; type?: string; limit?: number } = {}): Promise<DataView[]> {
    return listDataViews({
      ...this.ctx.base(),
      datasourceId: opts.datasourceId,
      type: opts.type,
      limit: opts.limit,
    });
  }

  async find(
    name: string,
    opts?: { datasourceId?: string; exact?: boolean; wait?: boolean; timeoutMs?: number },
  ): Promise<DataView[]> {
    return findDataView({
      ...this.ctx.base(),
      name,
      datasourceId: opts?.datasourceId,
      exact: opts?.exact,
      wait: opts?.wait,
      timeoutMs: opts?.timeoutMs,
    });
  }

  async delete(id: string): Promise<void> {
    await deleteDataView({ ...this.ctx.base(), id });
  }
}
