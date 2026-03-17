/**
 * Module-level simple API — cognee-style usage without instantiating KWeaverClient.
 *
 * @example Read-only (search + chat, no weaver needed)
 * ```typescript
 * import kweaver from "kweaver-sdk/kweaver";
 *
 * kweaver.configure({ config: true, bknId: "your-bkn-id", agentId: "your-agent-id" });
 *
 * const results = await kweaver.search("供应链有哪些风险？");
 * const reply   = await kweaver.chat("总结前三大风险");
 * console.log(reply.text);
 * ```
 *
 * @example Write then build
 * ```typescript
 * kweaver.configure({ baseUrl: "https://...", accessToken: "token", bknId: "abc" });
 * // ... add datasource, object types via kweaver.client ...
 * await kweaver.weaver({ wait: true });
 * const results = await kweaver.search("新接入的数据");
 * ```
 */

import { KWeaverClient } from "./client.js";
import type { ChatResult } from "./api/agent-chat.js";
import type { SemanticSearchResult } from "./resources/bkn.js";
import type { BuildStatus } from "./resources/knowledge-networks.js";
import {
  getCurrentPlatform,
  loadTokenConfig,
} from "./config/store.js";

// ── Global state ──────────────────────────────────────────────────────────────

let _client: KWeaverClient | null = null;
let _defaultBknId: string | null = null;
let _defaultAgentId: string | null = null;

// ── configure() ───────────────────────────────────────────────────────────────

export interface ConfigureOptions {
  /**
   * KWeaver base URL. Required unless config=true or KWEAVER_BASE_URL is set.
   */
  baseUrl?: string;
  /** Bearer access token. Required unless config=true or KWEAVER_TOKEN is set. */
  accessToken?: string;
  /**
   * If true, read credentials from ~/.kweaver/ (saved by `kweaver auth login`).
   * When config=true, baseUrl is ignored — the URL comes from the saved platform
   * config, preventing accidental cross-environment credential leaks.
   */
  config?: boolean;
  /** Default BKN ID used by search() and weaver(). */
  bknId?: string;
  /** Default agent ID used by chat(). */
  agentId?: string;
  /** x-business-domain header. Defaults to "bd_public". */
  businessDomain?: string;
}

/**
 * Initialize the default KWeaver client.
 * Must be called before any other kweaver.* function.
 *
 * @example
 * ```typescript
 * kweaver.configure({ config: true, bknId: "abc", agentId: "ag1" });
 * kweaver.configure({ baseUrl: "https://...", accessToken: "token", bknId: "abc" });
 * ```
 */
export function configure(opts: ConfigureOptions): void {
  // Reset all state first so a failed re-configure never leaves a stale client.
  _client = null;
  _defaultBknId = null;
  _defaultAgentId = null;

  const { bknId, agentId, businessDomain, config, baseUrl, accessToken } = opts;

  if (config) {
    // Use saved credentials — do NOT pass baseUrl to avoid cross-env leaks
    const platform = getCurrentPlatform();
    if (!platform) {
      throw new Error("No active platform. Run `kweaver auth login` first.");
    }
    const stored = loadTokenConfig(platform);
    if (!stored?.accessToken) {
      throw new Error(`No token for ${platform}. Run \`kweaver auth login\` first.`);
    }
    _client = new KWeaverClient({
      baseUrl: platform,
      accessToken: stored.accessToken,
      businessDomain,
    });
  } else {
    if (!baseUrl && !process.env.KWEAVER_BASE_URL) {
      throw new Error("Provide baseUrl=, config=true, or set KWEAVER_BASE_URL.");
    }
    if (!accessToken && !process.env.KWEAVER_TOKEN) {
      throw new Error("Provide accessToken=, config=true, or set KWEAVER_TOKEN.");
    }
    _client = new KWeaverClient({ baseUrl, accessToken, businessDomain });
  }

  _defaultBknId = bknId ?? null;
  _defaultAgentId = agentId ?? null;
}

function requireClient(): KWeaverClient {
  if (!_client) {
    throw new Error("No KWeaver client configured. Call kweaver.configure() first.");
  }
  return _client;
}

function requireBknId(bknId?: string): string {
  const id = bknId ?? _defaultBknId;
  if (!id) {
    throw new Error("No bknId provided. Pass bknId or set it in kweaver.configure().");
  }
  return id;
}

function requireAgentId(agentId?: string): string {
  const id = agentId ?? _defaultAgentId;
  if (!id) {
    throw new Error("No agentId provided. Pass agentId or set it in kweaver.configure().");
  }
  return id;
}

// ── Top-level API ─────────────────────────────────────────────────────────────

/**
 * Semantic search over a BKN.
 *
 * @example
 * ```typescript
 * const results = await kweaver.search("供应链风险");
 * for (const c of results.concepts) console.log(c.concept_name);
 * ```
 */
export async function search(
  query: string,
  opts: { bknId?: string; mode?: string; maxConcepts?: number } = {}
): Promise<SemanticSearchResult> {
  const client = requireClient();
  const bknId = requireBknId(opts.bknId);
  return client.bkn.semanticSearch(bknId, query, opts);
}

/**
 * List published agents.
 *
 * @example
 * ```typescript
 * const list = await kweaver.agents({ keyword: "supply" });
 * list.forEach(a => console.log(a));
 * ```
 */
export async function agents(
  opts: { keyword?: string; limit?: number } = {}
): Promise<unknown[]> {
  return requireClient().agents.list(opts);
}

/**
 * Send a message to an agent.
 *
 * @example
 * ```typescript
 * const reply = await kweaver.chat("分析供应链风险");
 * console.log(reply.text);
 * ```
 */
export async function chat(
  message: string,
  opts: { agentId?: string; conversationId?: string } = {}
): Promise<ChatResult> {
  const client = requireClient();
  const agentId = requireAgentId(opts.agentId);
  return client.agents.chat(agentId, message, {
    conversationId: opts.conversationId,
    stream: false,
  });
}

/**
 * List BKNs (Business Knowledge Networks).
 *
 * @example
 * ```typescript
 * const list = await kweaver.bkns();
 * list.forEach(b => console.log(b));
 * ```
 */
export async function bkns(
  opts: { limit?: number; name_pattern?: string } = {}
): Promise<unknown[]> {
  return requireClient().knowledgeNetworks.list(opts);
}

/**
 * Trigger a full build (index rebuild) of a BKN.
 *
 * Only needed after write-side changes (added datasource, modified object/relation
 * types). Pure read-only usage (search, chat) does not require weaver().
 *
 * @param opts.wait     If true, poll until completed and return the final BuildStatus.
 * @param opts.timeout  Max wait time in **milliseconds** (default 300_000 = 5 min).
 *                      Note: Python SDK uses seconds; multiply by 1000 when porting.
 * @param opts.interval Poll interval in **milliseconds** (default 2_000).
 *
 * @example
 * ```typescript
 * await kweaver.weaver({ wait: true });              // block until done
 * await kweaver.weaver({ wait: true, timeout: 60_000 }); // 60-second timeout
 * await kweaver.weaver();                            // fire-and-forget (returns void)
 * ```
 */
export async function weaver(
  opts: { bknId?: string; wait?: boolean; timeout?: number; interval?: number } = {}
): Promise<BuildStatus | void> {
  const client = requireClient();
  const bknId = requireBknId(opts.bknId);
  if (opts.wait) {
    return client.knowledgeNetworks.buildAndWait(bknId, {
      timeout: opts.timeout,
      interval: opts.interval,
    });
  }
  await client.knowledgeNetworks.build(bknId);
}

// ── Expose underlying client ──────────────────────────────────────────────────

/** Access the underlying KWeaverClient for advanced operations. */
export function getClient(): KWeaverClient {
  return requireClient();
}

// ── Default export ────────────────────────────────────────────────────────────

export default { configure, search, agents, chat, bkns, weaver, getClient };
