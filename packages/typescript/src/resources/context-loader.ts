import {
  callTool,
  searchSchema,
  queryObjectInstance,
  queryInstanceSubgraph,
  getLogicPropertiesValues,
  getActionInfo,
} from "../api/context-loader.js";
import type {
  SearchSchemaArgs,
  QueryObjectInstanceArgs,
  QueryInstanceSubgraphArgs,
  GetLogicPropertiesValuesArgs,
  GetActionInfoArgs,
} from "../api/context-loader.js";
import type { ClientContext } from "../client.js";

export class ContextLoaderResource {
  private readonly mcpUrl: string;
  private readonly knId: string;

  constructor(
    private readonly ctx: ClientContext,
    mcpUrl: string,
    knId: string
  ) {
    this.mcpUrl = mcpUrl;
    this.knId = knId;
  }

  private opts() {
    return { mcpUrl: this.mcpUrl, knId: this.knId, accessToken: this.ctx.base().accessToken };
  }

  async callTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    return callTool(this.opts(), toolName, args);
  }

  async searchSchema(args: SearchSchemaArgs): Promise<unknown> {
    return searchSchema(this.opts(), args);
  }

  async queryInstances(args: QueryObjectInstanceArgs): Promise<unknown> {
    return queryObjectInstance(this.opts(), args);
  }

  async querySubgraph(args: QueryInstanceSubgraphArgs): Promise<unknown> {
    return queryInstanceSubgraph(this.opts(), args);
  }

  async getLogicProperties(args: GetLogicPropertiesValuesArgs): Promise<unknown> {
    return getLogicPropertiesValues(this.opts(), args);
  }

  async getActionInfo(args: GetActionInfoArgs): Promise<unknown> {
    return getActionInfo(this.opts(), args);
  }
}
