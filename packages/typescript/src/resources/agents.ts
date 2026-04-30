import {
  listAgents,
  getAgent,
  getAgentByKey,
  createAgent,
  updateAgent,
  deleteAgent,
  publishAgent,
  unpublishAgent,
} from "../api/agent-list.js";
import {
  copyAgent,
  copyAgentToTemplate,
  exportAgents as exportAgentsHttp,
  importAgents as importAgentsHttp,
  type AgentImportMode,
} from "../api/agents-inout.js";
import {
  fetchAgentInfo,
  sendChatRequest,
  sendChatRequestStream,
} from "../api/agent-chat.js";
import type { ChatResult, SendChatRequestStreamCallbacks } from "../api/agent-chat.js";
import type { ClientContext } from "../client.js";

// ── Agent config types (mixed: core fields typed, rest open) ─────────────────

export interface AgentLlmConfig {
  id?: string;
  name: string;
  model_type?: string;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  max_tokens: number;
}

export interface AgentLlmItem {
  is_default: boolean;
  llm_config: AgentLlmConfig;
}

export interface AgentInputField {
  name: string;
  type?: string;
  desc?: string;
}

export interface AgentInput {
  fields: AgentInputField[];
  rewrite?: Record<string, unknown>;
  augment?: Record<string, unknown>;
}

export interface AgentOutput {
  variables?: Record<string, unknown>;
  default_format?: string;
}

export interface AgentConfig {
  input: AgentInput;
  output: AgentOutput;
  system_prompt?: string;
  dolphin?: string;
  is_dolphin_mode?: number;
  data_source?: Record<string, unknown>;
  skills?: Record<string, unknown>;
  llms?: AgentLlmItem[];
  opening_remark_config?: Record<string, unknown>;
  preset_questions?: Array<{ question: string }>;
  memory?: { is_enabled: boolean };
  related_question?: { is_enabled: boolean };
  plan_mode?: { is_enabled: boolean };
  conversation_history_config?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface CreateAgentBody {
  name: string;
  profile: string;
  avatar_type?: number;
  avatar?: string;
  product_key?: string;
  key?: string;
  config: AgentConfig;
}

export interface UpdateAgentBody {
  name: string;
  profile: string;
  avatar_type: number;
  avatar: string;
  product_key: string;
  config: AgentConfig;
}

// ── AgentsResource ───────────────────────────────────────────────────────────

export class AgentsResource {
  constructor(private readonly ctx: ClientContext) {}

  // ── List (published agents) ──────────────────────────────────────────────

  async list(opts: { name?: string; keyword?: string; offset?: number; limit?: number } = {}): Promise<unknown[]> {
    const { keyword, ...rest } = opts;
    const raw = await listAgents({ ...this.ctx.base(), name: keyword, ...rest });
    const parsed = JSON.parse(raw) as unknown;
    const items = (() => {
      if (Array.isArray(parsed)) return parsed;
      if (!parsed || typeof parsed !== "object") return [];
      const obj = parsed as { data?: unknown; entries?: unknown[] };
      if (Array.isArray(obj.entries)) return obj.entries;
      if (Array.isArray(obj.data)) return obj.data;
      if (obj.data && typeof obj.data === "object") {
        const dataObj = obj.data as { records?: unknown[]; entries?: unknown[] };
        if (Array.isArray(dataObj.records)) return dataObj.records;
        if (Array.isArray(dataObj.entries)) return dataObj.entries;
      }
      return [];
    })();
    return items;
  }

  // ── Get by ID ────────────────────────────────────────────────────────────

  async get(agentId: string): Promise<unknown> {
    const raw = await getAgent({ ...this.ctx.base(), agentId });
    return JSON.parse(raw) as unknown;
  }

  // ── Get by key ───────────────────────────────────────────────────────────

  async getByKey(key: string): Promise<unknown> {
    const raw = await getAgentByKey({ ...this.ctx.base(), key });
    return JSON.parse(raw) as unknown;
  }

  // ── Create ───────────────────────────────────────────────────────────────

  async create(body: CreateAgentBody): Promise<{ id: string; version: string }> {
    // Apply defaults for required fields the user may omit
    const payload = {
      avatar_type: body.avatar_type ?? 1,
      avatar: body.avatar ?? "icon-dip-agent-default",
      product_key: body.product_key ?? "DIP",
      ...body,
    };
    const raw = await createAgent({ ...this.ctx.base(), body: JSON.stringify(payload) });
    return JSON.parse(raw) as { id: string; version: string };
  }

  // ── Update ───────────────────────────────────────────────────────────────

  async update(agentId: string, body: UpdateAgentBody): Promise<void> {
    await updateAgent({ ...this.ctx.base(), agentId, body: JSON.stringify(body) });
  }

  // ── Delete ───────────────────────────────────────────────────────────────

  async delete(agentId: string): Promise<void> {
    await deleteAgent({ ...this.ctx.base(), agentId });
  }

  // ── Publish ──────────────────────────────────────────────────────────────

  async publish(agentId: string, opts: { business_domain_id?: string } = {}): Promise<unknown> {
    const body = JSON.stringify({ agent_id: agentId, ...opts });
    const raw = await publishAgent({ ...this.ctx.base(), agentId, body });
    return JSON.parse(raw) as unknown;
  }

  // ── Unpublish ────────────────────────────────────────────────────────────

  async unpublish(agentId: string): Promise<void> {
    await unpublishAgent({ ...this.ctx.base(), agentId });
  }

  // ── Copy / bulk export-import (agent-factory v3, not operator impex) ─────

  /** Duplicate agent in personal space (POST …/agent/{id}/copy). */
  async copy(agentId: string): Promise<unknown> {
    const raw = await copyAgent({ ...this.ctx.base(), agentId });
    return JSON.parse(raw) as unknown;
  }

  /** Copy agent as a draft template (POST …/copy2tpl). */
  async copyToTemplate(agentId: string): Promise<unknown> {
    const raw = await copyAgentToTemplate({ ...this.ctx.base(), agentId });
    return JSON.parse(raw) as unknown;
  }

  /** Batch-export agents from personal space (POST …/agent-inout/export). */
  async exportAgents(agentIds: string[]): Promise<{ filename: string; bytes: Uint8Array }> {
    return exportAgentsHttp({ ...this.ctx.base(), agentIds });
  }

  /** Same as {@link AgentsResource.exportAgents} — bulk export JSON (plan/SDK alias). */
  async exportConfig(agentIds: string[]): Promise<{ filename: string; bytes: Uint8Array }> {
    return this.exportAgents(agentIds);
  }

  /** Import agents from an export JSON file (multipart …/agent-inout/import). */
  async importAgents(filePath: string, opts: { importType?: AgentImportMode } = {}): Promise<unknown> {
    const raw = await importAgentsHttp({ ...this.ctx.base(), filePath, importType: opts.importType });
    return JSON.parse(raw) as unknown;
  }

  /** Same as {@link AgentsResource.importAgents} — multipart import (plan/SDK alias). */
  async importConfig(filePath: string, opts: { importType?: AgentImportMode } = {}): Promise<unknown> {
    return this.importAgents(filePath, opts);
  }

  // ── Agent info (resolve key/version) ─────────────────────────────────────

  async info(agentId: string, version = "v0"): Promise<{ id: string; key: string; version: string }> {
    const info = await fetchAgentInfo({ ...this.ctx.base(), agentId, version });
    return info;
  }

  // ── Chat (single-shot) ──────────────────────────────────────────────────

  async chat(
    agentId: string,
    message: string,
    opts: {
      conversationId?: string;
      version?: string;
      stream?: boolean;
      verbose?: boolean;
    } = {}
  ): Promise<ChatResult> {
    const { version = "v0", stream = false, conversationId, verbose } = opts;
    const info = await fetchAgentInfo({ ...this.ctx.base(), agentId, version });
    return sendChatRequest({
      ...this.ctx.base(),
      agentId: info.id,
      agentKey: info.key,
      agentVersion: info.version,
      query: message,
      conversationId,
      stream,
      verbose,
    });
  }

  // ── Stream ──────────────────────────────────────────────────────────────

  async stream(
    agentId: string,
    message: string,
    callbacks: SendChatRequestStreamCallbacks,
    opts: {
      conversationId?: string;
      version?: string;
      verbose?: boolean;
    } = {}
  ): Promise<ChatResult> {
    const { version = "v0", conversationId, verbose } = opts;
    const info = await fetchAgentInfo({ ...this.ctx.base(), agentId, version });
    return sendChatRequestStream(
      {
        ...this.ctx.base(),
        agentId: info.id,
        agentKey: info.key,
        agentVersion: info.version,
        query: message,
        conversationId,
        stream: true,
        verbose,
      },
      callbacks
    );
  }
}
