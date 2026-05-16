import type { KnSchemaSnapshot } from "../schemas.js";

export interface KnSchemaClient {
  getSchema(knId: string): Promise<KnSchemaSnapshot>;
}

// Stub: replace body with real BKN API calls when endpoint is confirmed
export class KweaverKnSchemaClient implements KnSchemaClient {
  constructor(private baseUrl: string, private token: string) {}

  async getSchema(_knId: string): Promise<KnSchemaSnapshot> {
    // TODO: GET {baseUrl}/api/bkn/v1/knowledge-networks/{knId}/schema
    // Response shape: { object_types: [{ concept_name, fields: [{ name, type }] }], relation_types: [...] }
    throw new Error("KweaverKnSchemaClient.getSchema not yet implemented — use mock in tests");
  }
}
