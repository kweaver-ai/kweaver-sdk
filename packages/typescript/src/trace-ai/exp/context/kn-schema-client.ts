import type { KnSchemaSnapshot } from "../schemas.js";
import { searchSchema } from "../../../api/context-loader.js";
import type { ContextLoaderCallOptions, SearchSchemaArgs, SearchSchemaResult } from "../../../api/context-loader.js";

export interface KnSchemaClient {
  getSchema(knId: string): Promise<KnSchemaSnapshot>;
}

type SearchSchemaFn = (opts: ContextLoaderCallOptions, args: SearchSchemaArgs) => Promise<SearchSchemaResult>;

export class KweaverKnSchemaClient implements KnSchemaClient {
  constructor(
    private mcpUrl: string,
    private token: string,
    private searchSchemaFn: SearchSchemaFn = searchSchema,
  ) {}

  async getSchema(knId: string): Promise<KnSchemaSnapshot> {
    const opts: ContextLoaderCallOptions = {
      mcpUrl: this.mcpUrl,
      accessToken: this.token,
      knId,
    };
    const result = await this.searchSchemaFn(opts, {
      query: "*",
      response_format: "json",
      schema_brief: true,
    });

    const rawObjectTypes = (result.object_types ?? []) as Array<Record<string, unknown>>;
    const object_types = rawObjectTypes.map(ot => {
      const ds = ot["data_source"] as Record<string, unknown> | undefined;
      const props = (ot["properties"] as Array<Record<string, unknown>> | undefined) ?? [];
      return {
        concept_name: String(ot["concept_name"] ?? ""),
        data_view_id: typeof ds?.["id"] === "string" ? ds["id"] : undefined,
        fields: props.map(p => ({ name: String(p["name"] ?? ""), type: String(p["type"] ?? "string") })),
      };
    });

    const rawRelTypes = (result.relation_types ?? []) as Array<Record<string, unknown>>;
    const relation_types = rawRelTypes.map(rt => ({
      concept_name: String(rt["concept_name"] ?? rt["name"] ?? ""),
      source: String(rt["source"] ?? ""),
      target: String(rt["target"] ?? ""),
      join_key: String(rt["join_key"] ?? ""),
    }));

    return { object_types, relation_types };
  }
}
