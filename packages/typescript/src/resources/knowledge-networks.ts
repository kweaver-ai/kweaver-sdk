import { buildHeaders } from "../api/headers.js";
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
import { fetchTextOrThrow } from "../utils/http.js";
import type { ClientContext } from "../client.js";

export interface BuildStatus {
  state: "running" | "completed" | "failed" | string;
  state_detail?: string;
}

export class KnowledgeNetworksResource {
  constructor(private readonly ctx: ClientContext) {}

  async list(opts: { offset?: number; limit?: number; name_pattern?: string; tag?: string } = {}): Promise<unknown[]> {
    const raw = await listKnowledgeNetworks({ ...this.ctx.base(), ...opts });
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    // API returns { entries: [...] }
    const data = parsed?.entries ?? parsed?.data ?? parsed;
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

  /**
   * Trigger a full build (index rebuild) of a BKN.
   * Call this after adding datasources or modifying object/relation types.
   *
   * @param bknId   BKN ID to build.
   * @returns A promise that resolves immediately after the build is triggered.
   *          Use `buildAndWait` to block until completion.
   */
  async build(bknId: string): Promise<void> {
    const { baseUrl, accessToken, businessDomain } = this.ctx.base();
    const headers = {
      "content-type": "application/json",
      ...buildHeaders(accessToken, businessDomain),
    };
    await fetchTextOrThrow(
      `${baseUrl}/api/ontology-manager/v1/knowledge-networks/${encodeURIComponent(bknId)}/jobs`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ name: `sdk_build_${bknId.slice(0, 8)}`, job_type: "full" }),
      }
    );
  }

  /** Poll build status for a BKN. */
  async buildStatus(bknId: string): Promise<BuildStatus> {
    const { baseUrl, accessToken, businessDomain } = this.ctx.base();
    const headers = buildHeaders(accessToken, businessDomain);
    const { body } = await fetchTextOrThrow(
      `${baseUrl}/api/ontology-manager/v1/knowledge-networks/${encodeURIComponent(bknId)}/jobs?limit=1&direction=desc`,
      { headers }
    );
    const data = JSON.parse(body) as unknown;
    const jobs: Array<Record<string, unknown>> = Array.isArray(data)
      ? (data as Array<Record<string, unknown>>)
      : data && typeof data === "object" && "entries" in data
        ? ((data as { entries: Array<Record<string, unknown>> }).entries ?? [])
        : data && typeof data === "object" && "data" in data
          ? ((data as { data: Array<Record<string, unknown>> }).data ?? [])
          : [];
    if (jobs.length > 0) {
      return { state: (jobs[0].state as string) ?? "running", state_detail: jobs[0].state_detail as string | undefined };
    }
    return { state: "completed" };
  }

  /**
   * Trigger a full BKN build and wait for it to complete.
   *
   * @param bknId     BKN ID to build.
   * @param timeout   Max wait time in milliseconds (default 300_000 = 5 min).
   * @param interval  Poll interval in milliseconds (default 2_000).
   * @throws Error if the build fails or times out.
   */
  async buildAndWait(
    bknId: string,
    { timeout = 300_000, interval = 2_000 }: { timeout?: number; interval?: number } = {}
  ): Promise<BuildStatus> {
    await this.build(bknId);
    const deadline = Date.now() + timeout;
    while (true) {
      await new Promise((r) => setTimeout(r, interval));
      const status = await this.buildStatus(bknId);
      if (status.state === "completed") return status;
      if (status.state === "failed") {
        throw new Error(`BKN build failed for ${bknId}: ${status.state_detail ?? "no detail"}`);
      }
      if (Date.now() > deadline) {
        throw new Error(`BKN build timed out after ${timeout}ms for ${bknId}`);
      }
    }
  }
}
