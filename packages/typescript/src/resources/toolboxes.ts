import type { ClientContext } from "../client.js";
import {
  debugTool,
  executeTool,
  exportConfig,
  importConfig,
  listTools,
  listToolboxes,
  setToolStatuses,
  uploadTool,
  type ImpexType,
} from "../api/toolboxes.js";

export interface InvokeToolArgs {
  /** Optional headers to forward to the downstream tool. Authorization is
   *  auto-injected from the client's access token when omitted; pass `{}` to
   *  send no headers. */
  header?: Record<string, unknown>;
  query?: Record<string, unknown>;
  /** Path parameters for OpenAPI `{name}` placeholders (e.g. `{ id: "<uuid>" }`). */
  path?: Record<string, unknown>;
  body?: unknown;
  /** Per-call timeout in seconds (backend default applies when omitted). */
  timeout?: number;
}

/** Toolbox / tool management on the agent-operator-integration service. */
export class ToolboxesResource {
  constructor(private readonly ctx: ClientContext) {}

  async list(opts: { keyword?: string; limit?: number; offset?: number } = {}): Promise<string> {
    return listToolboxes({ ...this.ctx.base(), ...opts });
  }

  async listToolsIn(boxId: string): Promise<string> {
    return listTools({ ...this.ctx.base(), boxId });
  }

  async uploadTool(opts: {
    boxId: string;
    filePath: string;
    metadataType?: "openapi";
  }): Promise<string> {
    return uploadTool({
      ...this.ctx.base(),
      boxId: opts.boxId,
      filePath: opts.filePath,
      metadataType: opts.metadataType,
    });
  }

  async setToolStatuses(opts: {
    boxId: string;
    updates: Array<{ toolId: string; status: "enabled" | "disabled" }>;
  }): Promise<void> {
    await setToolStatuses({ ...this.ctx.base(), ...opts });
  }

  /** Execute a published+enabled tool through the toolbox proxy. */
  async execute(boxId: string, toolId: string, args: InvokeToolArgs = {}): Promise<string> {
    return executeTool({
      ...this.ctx.base(),
      boxId,
      toolId,
      ...this.injectAuth(args),
    });
  }

  /** Debug a tool through the toolbox proxy (works on draft/disabled tools too). */
  async debug(boxId: string, toolId: string, args: InvokeToolArgs = {}): Promise<string> {
    return debugTool({
      ...this.ctx.base(),
      boxId,
      toolId,
      ...this.injectAuth(args),
    });
  }

  /**
   * Export a toolbox/mcp/operator config (.adp JSON) as raw bytes.
   *
   * Returned bytes are usually UTF-8 JSON; mirrors the Python SDK's
   * `export_config -> bytes`. Use `new TextDecoder().decode(buf)` if you
   * need a string.
   */
  async exportConfig(id: string, opts: { type?: ImpexType } = {}): Promise<Uint8Array> {
    return exportConfig({ ...this.ctx.base(), id, type: opts.type });
  }

  /** Import a previously exported config from disk. */
  async importConfig(filePath: string, opts: { type?: ImpexType } = {}): Promise<string> {
    return importConfig({ ...this.ctx.base(), filePath, type: opts.type });
  }

  // The forwarder requires every header the downstream tool expects to be set
  // explicitly under `header`; most published tools declare an Authorization
  // parameter and would otherwise see no token. Auto-inject the active
  // session token unless the caller already provided one.
  private injectAuth(args: InvokeToolArgs): InvokeToolArgs {
    const header = { ...(args.header ?? {}) };
    const hasAuth = Object.keys(header).some((k) => k.toLowerCase() === "authorization");
    if (!hasAuth) header.Authorization = `Bearer ${this.ctx.base().accessToken}`;
    return { ...args, header };
  }
}
