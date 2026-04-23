import type { ClientContext } from "../client.js";
import {
  debugTool,
  executeTool,
  listTools,
  listToolboxes,
  setToolStatuses,
  uploadTool,
} from "../api/toolboxes.js";

export interface InvokeToolArgs {
  /** Optional headers to forward to the downstream tool. Authorization is
   *  auto-injected from the client's access token when omitted; pass `{}` to
   *  send no headers. */
  header?: Record<string, unknown>;
  query?: Record<string, unknown>;
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
