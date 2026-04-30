import { applyTlsEnvFromSavedTokens } from "./config/tls-env.js";
import { NO_AUTH_TOKEN, isNoAuth } from "./config/no-auth.js";
import {
  getCurrentPlatform,
  loadTokenConfig,
} from "./config/store.js";
import { buildHeaders } from "./api/headers.js";
import { ensureValidToken } from "./auth/oauth.js";
import { AgentsResource } from "./resources/agents.js";
import { AgentTemplatesResource } from "./resources/agent-templates.js";
import { ConversationsResource } from "./resources/conversations.js";
import { ContextLoaderResource } from "./resources/context-loader.js";
import { DataflowsResource } from "./resources/dataflows.js";
import { DataSourcesResource } from "./resources/datasources.js";
import { DataViewsResource } from "./resources/dataviews.js";
import { KnowledgeNetworksResource } from "./resources/knowledge-networks.js";
import { BknResource } from "./resources/bkn.js";
import { SkillsResource } from "./resources/skills.js";
import { ToolboxesResource } from "./resources/toolboxes.js";
import { VegaResource } from "./resources/vega.js";

// ── ClientContext ─────────────────────────────────────────────────────────────

/**
 * Shared credentials passed to every resource method.
 * Internal — use KWeaverClient.
 */
export interface ClientContext {
  /** Returns the base options that every API function requires. */
  base(): { baseUrl: string; accessToken: string; businessDomain: string };
}

// ── KWeaverClientOptions ──────────────────────────────────────────────────────

export interface KWeaverClientOptions {
  /**
   * KWeaver platform base URL (e.g. "https://your-kweaver.com").
   * When omitted, reads the active platform saved by `kweaver auth login`.
   */
  baseUrl?: string;

  /**
   * Bearer access token.
   * When omitted, reads the token saved for the active platform.
   */
  accessToken?: string;

  /**
   * x-business-domain header value.  Defaults to "bd_public".
   * Override with KWEAVER_BUSINESS_DOMAIN env var or pass explicitly.
   */
  businessDomain?: string;

  /**
   * When true, read credentials exclusively from ~/.kweaver/ (saved by
   * `kweaver auth login`), ignoring KWEAVER_BASE_URL / KWEAVER_TOKEN env vars.
   * Useful when env vars hold stale tokens or are intended for other tooling.
   * Incompatible with `auth: false` — the constructor throws if both are set.
   */
  config?: boolean;

  /**
   * When false, use no-auth mode: API requests omit Authorization / token headers.
   * Requires a resolvable base URL: `baseUrl`, `KWEAVER_BASE_URL`, or the active
   * platform from `kweaver auth login`. Incompatible with `config: true` — use
   * saved `~/.kweaver/` credentials (including `__NO_AUTH__`) via `config: true`
   * alone instead of passing `auth: false`.
   */
  auth?: boolean;
}

// ── KWeaverClient ─────────────────────────────────────────────────────────────

/**
 * Main entry point for the KWeaver TypeScript SDK.
 *
 * @example Using explicit credentials:
 * ```typescript
 * import { KWeaverClient } from "kweaver-sdk";
 *
 * const client = new KWeaverClient({
 *   baseUrl: "https://your-kweaver.com",
 *   accessToken: "your-token",
 * });
 *
 * const kns = await client.knowledgeNetworks.list();
 * const reply = await client.agents.chat("agent-id", "你好");
 * console.log(reply.text);
 * ```
 *
 * @example Using credentials saved by `kweaver auth login` (zero config):
 * ```typescript
 * const client = new KWeaverClient();   // reads ~/.kweaver/
 * ```
 *
 * @example Using environment variables:
 * ```typescript
 * // Set KWEAVER_BASE_URL and KWEAVER_TOKEN
 * const client = new KWeaverClient();
 * ```
 */
export class KWeaverClient implements ClientContext {
  private readonly _baseUrl: string;
  private readonly _accessToken: string;
  private readonly _businessDomain: string;

  /** Knowledge network CRUD and schema (object/relation/action types). */
  readonly knowledgeNetworks: KnowledgeNetworksResource;

  /** Agent listing and chat (single-shot and streaming). */
  readonly agents: AgentsResource;

  /** Personal-space agent templates (agent-tpl CRUD + publish). */
  readonly agentTemplates: AgentTemplatesResource;

  /** BKN engine: instance queries, subgraph, action execute/poll, action logs. */
  readonly bkn: BknResource;

  /** Conversation and message history. */
  readonly conversations: ConversationsResource;

  /** Dataflow DAG automation (create/run/poll/delete). */
  readonly dataflows: DataflowsResource;

  /** Data source management (connect, test, list tables). */
  readonly datasources: DataSourcesResource;

  /** Data view creation and retrieval. */
  readonly dataviews: DataViewsResource;

  /** Vega observability platform (catalogs, resources, connector types). */
  readonly vega: VegaResource;

  /** ADP/KWeaver skill registry, market, progressive read, and install helpers. */
  readonly skills: SkillsResource;

  /** Toolbox / tool management plus execute & debug invocation. */
  readonly toolboxes: ToolboxesResource;

  constructor(opts: KWeaverClientOptions = {}) {
    const envDomain = process.env.KWEAVER_BUSINESS_DOMAIN;

    if (opts.auth === false && opts.config) {
      throw new Error(
        "KWeaverClient: auth: false is incompatible with config: true.",
      );
    }

    let baseUrl: string | undefined;
    let accessToken: string | undefined;

    if (opts.auth === false) {
      {
        const envUrl = process.env.KWEAVER_BASE_URL;
        baseUrl = opts.baseUrl ?? envUrl;
        if (!baseUrl) {
          const platform = getCurrentPlatform();
          if (platform) baseUrl = platform;
        }
      }
      if (!baseUrl) {
        throw new Error(
          "KWeaverClient: baseUrl is required when auth is false. " +
            "Pass it explicitly, set KWEAVER_BASE_URL, or run `kweaver auth login`.",
        );
      }
      this._baseUrl = baseUrl.replace(/\/+$/, "");
      this._accessToken = NO_AUTH_TOKEN;
      this._businessDomain = opts.businessDomain ?? envDomain ?? "bd_public";
      this.knowledgeNetworks = new KnowledgeNetworksResource(this);
      this.agents = new AgentsResource(this);
      this.agentTemplates = new AgentTemplatesResource(this);
      this.bkn = new BknResource(this);
      this.conversations = new ConversationsResource(this);
      this.dataflows = new DataflowsResource(this);
      this.datasources = new DataSourcesResource(this);
      this.dataviews = new DataViewsResource(this);
      this.vega = new VegaResource(this);
      this.skills = new SkillsResource(this);
      this.toolboxes = new ToolboxesResource(this);
      return;
    }

    if (opts.config) {
      // config: true — read exclusively from ~/.kweaver/, ignore env vars
      const platform = getCurrentPlatform();
      if (!platform) {
        throw new Error("No active platform. Run `kweaver auth login` first.");
      }
      const stored = loadTokenConfig(platform);
      if (!stored?.accessToken) {
        throw new Error(`No token for ${platform}. Run \`kweaver auth login\` first.`);
      }
      baseUrl = opts.baseUrl ?? platform;
      accessToken = opts.accessToken ?? stored.accessToken;
    } else {
      // Default: explicit > env > saved config
      const envUrl = process.env.KWEAVER_BASE_URL;
      const envToken = process.env.KWEAVER_TOKEN;
      baseUrl = opts.baseUrl ?? envUrl;
      accessToken = opts.accessToken ?? envToken;

      if (!baseUrl || !accessToken) {
        const platform = getCurrentPlatform();
        if (platform) {
          const stored = loadTokenConfig(platform);
          if (!baseUrl) baseUrl = platform;
          if (!accessToken && stored) accessToken = stored.accessToken;
        }
      }
    }

    if (!baseUrl) {
      throw new Error(
        "KWeaverClient: baseUrl is required. " +
        "Pass it explicitly, set KWEAVER_BASE_URL, or run `kweaver auth login`."
      );
    }
    if (!accessToken) {
      throw new Error(
        "KWeaverClient: accessToken is required. " +
        "Pass it explicitly, set KWEAVER_TOKEN, or run `kweaver auth login`."
      );
    }

    this._baseUrl = baseUrl.replace(/\/+$/, "");
    // Strip "Bearer " prefix if present — callers (env vars, config files) may
    // include it, but API helpers always add their own "Bearer " prefix.
    this._accessToken = accessToken.replace(/^Bearer\s+/i, "");
    this._businessDomain = opts.businessDomain ?? envDomain ?? "bd_public";

    this.knowledgeNetworks = new KnowledgeNetworksResource(this);
    this.agents = new AgentsResource(this);
    this.agentTemplates = new AgentTemplatesResource(this);
    this.bkn = new BknResource(this);
    this.conversations = new ConversationsResource(this);
    this.dataflows = new DataflowsResource(this);
    this.datasources = new DataSourcesResource(this);
    this.dataviews = new DataViewsResource(this);
    this.vega = new VegaResource(this);
    this.skills = new SkillsResource(this);
    this.toolboxes = new ToolboxesResource(this);
  }

  /**
   * Async factory that auto-refreshes expired or revoked tokens.
   *
   * Reads credentials from `~/.kweaver/` and refreshes the access token
   * if it has expired or been revoked (using the saved refresh token).
   * If the initial token fails with 401, forces a refresh and retries.
   *
   * @example
   * ```typescript
   * const client = await KWeaverClient.connect();
   * ```
   */
  static async connect(opts: KWeaverClientOptions = {}): Promise<KWeaverClient> {
    applyTlsEnvFromSavedTokens();

    // Try with current token first
    let token = await ensureValidToken();
    const client = new KWeaverClient({
      baseUrl: token.baseUrl,
      accessToken: token.accessToken,
      ...opts,
    });

    if (!isNoAuth(token.accessToken)) {
      // Quick probe — if the token was revoked server-side, force refresh
      try {
        const bd = client.base().businessDomain;
        const probe = await fetch(
          `${token.baseUrl.replace(/\/+$/, "")}/api/ontology-manager/v1/knowledge-networks?limit=1`,
          { headers: buildHeaders(token.accessToken, bd) },
        );
        if (probe.status === 401) {
          throw new Error(
            "Access token revoked. Run `kweaver auth login` to re-authenticate."
          );
        }
      } catch (e) {
        if (
          e instanceof Error &&
          e.message.startsWith("Access token revoked")
        ) {
          throw e;
        }
        // Network error — return client as-is, let the caller deal with it
      }
    }
    return client;
  }

  /** @internal — used by resource classes to build API call options. */
  base(): { baseUrl: string; accessToken: string; businessDomain: string } {
    return {
      baseUrl: this._baseUrl,
      accessToken: this._accessToken,
      businessDomain: this._businessDomain,
    };
  }

  /**
   * Create a ContextLoaderResource bound to a specific knowledge network.
   *
   * @param mcpUrl  Full MCP endpoint URL (e.g. from `kweaver context-loader config show`).
   * @param knId    Knowledge network ID to search against.
   *
   * @example
   * ```typescript
   * const cl = client.contextLoader(mcpUrl, "d5iv6c9818p72mpje8pg");
   * const results = await cl.search({ query: "高血压 治疗" });
   * ```
   */
  contextLoader(mcpUrl: string, knId: string): ContextLoaderResource {
    return new ContextLoaderResource(this, mcpUrl, knId);
  }
}
