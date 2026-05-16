import type { VegaCatalogEntry } from "../schemas.js";

export interface VegaCatalogClient {
  listDataviews(filter?: { knId?: string }): Promise<VegaCatalogEntry[]>;
}

// Stub: replace body with real Vega API calls when endpoint is confirmed
export class KweaverVegaCatalogClient implements VegaCatalogClient {
  constructor(private baseUrl: string, private token: string) {}

  async listDataviews(_filter?: { knId?: string }): Promise<VegaCatalogEntry[]> {
    // TODO: GET {baseUrl}/api/vega/v1/dataviews?kn_id={filter.knId}
    // Response shape: [{ id, name, columns: [{ name, type }] }]
    throw new Error("KweaverVegaCatalogClient.listDataviews not yet implemented — use mock in tests");
  }
}
