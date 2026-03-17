import {
  objectTypeQuery,
  objectTypeProperties,
  subgraph,
  actionTypeQuery,
  actionTypeExecute,
  actionExecutionGet,
  actionLogsList,
  actionLogGet,
  actionLogCancel,
} from "../api/ontology-query.js";
import type { ClientContext } from "../client.js";

/** BKN engine resource — instance queries, subgraph, action execution and logs. */
export class BknResource {
  constructor(private readonly ctx: ClientContext) {}

  async queryInstances(knId: string, otId: string, body: Record<string, unknown>): Promise<unknown> {
    const raw = await objectTypeQuery({ ...this.ctx.base(), knId, otId, body: JSON.stringify(body) });
    return JSON.parse(raw) as unknown;
  }

  async queryProperties(knId: string, otId: string, body: Record<string, unknown>): Promise<unknown> {
    const raw = await objectTypeProperties({ ...this.ctx.base(), knId, otId, body: JSON.stringify(body) });
    return JSON.parse(raw) as unknown;
  }

  async querySubgraph(knId: string, body: Record<string, unknown>): Promise<unknown> {
    const raw = await subgraph({ ...this.ctx.base(), knId, body: JSON.stringify(body) });
    return JSON.parse(raw) as unknown;
  }

  async queryAction(knId: string, atId: string, body: Record<string, unknown>): Promise<unknown> {
    const raw = await actionTypeQuery({ ...this.ctx.base(), knId, atId, body: JSON.stringify(body) });
    return JSON.parse(raw) as unknown;
  }

  async executeAction(knId: string, atId: string, body: Record<string, unknown>): Promise<unknown> {
    const raw = await actionTypeExecute({ ...this.ctx.base(), knId, atId, body: JSON.stringify(body) });
    return JSON.parse(raw) as unknown;
  }

  async getExecution(knId: string, executionId: string): Promise<unknown> {
    const raw = await actionExecutionGet({ ...this.ctx.base(), knId, executionId });
    return JSON.parse(raw) as unknown;
  }

  async listActionLogs(
    knId: string,
    opts: { offset?: number; limit?: number; atId?: string; status?: string } = {}
  ): Promise<unknown[]> {
    const raw = await actionLogsList({ ...this.ctx.base(), knId, ...opts });
    const parsed = JSON.parse(raw) as unknown;
    const items =
      parsed && typeof parsed === "object" && "data" in parsed
        ? ((parsed as { data: { records?: unknown[] } }).data?.records ?? [])
        : Array.isArray(parsed)
          ? parsed
          : [];
    return items;
  }

  async getActionLog(knId: string, logId: string): Promise<unknown> {
    const raw = await actionLogGet({ ...this.ctx.base(), knId, logId });
    return JSON.parse(raw) as unknown;
  }

  async cancelActionLog(knId: string, logId: string): Promise<unknown> {
    const raw = await actionLogCancel({ ...this.ctx.base(), knId, logId });
    return JSON.parse(raw) as unknown;
  }
}
