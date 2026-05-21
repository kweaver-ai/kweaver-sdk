import {
  RESOURCE_LIST_DEFAULT_LIMIT,
  createResource,
  deleteResource,
  findResource,
  getResource,
  listResources,
  queryResource,
} from "../api/resources.js";
import type { Resource, ResourceQueryResult } from "../api/resources.js";
import type { ClientContext } from "../client.js";

export class ResourcesResource {
  constructor(private readonly ctx: ClientContext) {}

  async create(opts: {
    name: string;
    datasourceId: string;
    table: string;
    fields?: Array<{ name: string; type: string }>;
  }): Promise<string> {
    return createResource({ ...this.ctx.base(), ...opts });
  }

  async get(id: string): Promise<Resource> {
    return getResource({ ...this.ctx.base(), id });
  }

  async list(opts: { datasourceId?: string; category?: string; limit?: number } = {}): Promise<Resource[]> {
    return listResources({
      ...this.ctx.base(),
      datasourceId: opts.datasourceId,
      category: opts.category,
      limit: opts.limit ?? RESOURCE_LIST_DEFAULT_LIMIT,
    });
  }

  async find(
    name: string,
    opts?: { datasourceId?: string; exact?: boolean; wait?: boolean; timeoutMs?: number },
  ): Promise<Resource[]> {
    return findResource({
      ...this.ctx.base(),
      name,
      datasourceId: opts?.datasourceId,
      exact: opts?.exact,
      wait: opts?.wait,
      timeoutMs: opts?.timeoutMs,
    });
  }

  async delete(id: string): Promise<void> {
    await deleteResource({ ...this.ctx.base(), id });
  }

  async query(
    id: string,
    opts?: {
      offset?: number;
      limit?: number;
      needTotal?: boolean;
      filterCondition?: unknown;
      sort?: string;
      direction?: "asc" | "desc";
    },
  ): Promise<ResourceQueryResult> {
    return queryResource({
      ...this.ctx.base(),
      id,
      offset: opts?.offset,
      limit: opts?.limit,
      needTotal: opts?.needTotal,
      filterCondition: opts?.filterCondition,
      sort: opts?.sort,
      direction: opts?.direction,
    });
  }
}
