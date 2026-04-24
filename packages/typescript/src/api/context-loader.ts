import { isNoAuth } from "../config/no-auth.js";
import { fetchTextOrThrow } from "../utils/http.js";

/** Per-call options for context-loader MCP. */
export interface ContextLoaderCallOptions {
  mcpUrl: string;
  knId: string;
  accessToken: string;
}

const MCP_PROTOCOL_VERSION = "2024-11-05";

const SESSION_TTL_MS = 300_000; // 5 minutes
const sessionCache = new Map<string, { id: string; createdAt: number }>();

function sessionKey(options: ContextLoaderCallOptions): string {
  return `${options.mcpUrl}:${options.knId}`;
}

function buildHeaders(options: ContextLoaderCallOptions, sessionId?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "X-Kn-ID": options.knId,
    "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
  };
  if (!isNoAuth(options.accessToken)) {
    headers.Authorization = `Bearer ${options.accessToken}`;
  }
  if (sessionId) {
    headers["MCP-Session-Id"] = sessionId;
  }
  return headers;
}

async function ensureSession(options: ContextLoaderCallOptions): Promise<string> {
  const key = sessionKey(options);
  const cached = sessionCache.get(key);
  if (cached && Date.now() - cached.createdAt < SESSION_TTL_MS) return cached.id;
  // Remove stale entry if expired
  if (cached) sessionCache.delete(key);

  const initBody = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "kweaver-caller", version: "0.1.0" },
    },
  });

  const { response, body } = await fetchTextOrThrow(options.mcpUrl, {
    method: "POST",
    headers: buildHeaders(options),
    body: initBody,
  });

  const sessionId = response.headers.get("MCP-Session-Id") ?? response.headers.get("mcp-session-id");
  if (!sessionId) {
    throw new Error(
      "MCP server did not return MCP-Session-Id. The server may require session initialization."
    );
  }

  const initNotifBody = JSON.stringify({
    jsonrpc: "2.0",
    method: "notifications/initialized",
  });

  await fetchTextOrThrow(options.mcpUrl, {
    method: "POST",
    headers: buildHeaders(options, sessionId),
    body: initNotifBody,
  });

  sessionCache.set(key, { id: sessionId, createdAt: Date.now() });
  return sessionId;
}

/** Layer 1: kn_search arguments. */
export interface KnSearchArgs {
  query: string;
  only_schema?: boolean;
}

/** Layer 1: kn_schema_search arguments. */
export interface KnSchemaSearchArgs {
  query: string;
  max_concepts?: number;
}

export interface SearchSchemaScope {
  include_object_types?: boolean;
  include_relation_types?: boolean;
  include_action_types?: boolean;
  include_metric_types?: boolean;
}

/** Layer 1: search_schema arguments. */
export interface SearchSchemaArgs {
  query: string;
  response_format?: "json" | "toon";
  search_scope?: SearchSchemaScope;
  max_concepts?: number;
  schema_brief?: boolean;
  enable_rerank?: boolean;
}

/** Layer 1: search_schema result. */
export interface SearchSchemaResult {
  object_types?: unknown[];
  relation_types?: unknown[];
  action_types?: unknown[];
  metric_types?: unknown[];
  raw?: string;
}

/** Condition for query_object_instance and query_instance_subgraph. */
export interface ConditionSpec {
  operation: "and" | "or";
  sub_conditions: Array<{
    field?: string;
    operation?: string;
    value_from?: "const";
    value?: unknown;
  }>;
}

/** Layer 2: query_object_instance arguments. */
export interface QueryObjectInstanceArgs {
  ot_id: string;
  limit?: number;
  condition: ConditionSpec;
}

/** Layer 2: query_instance_subgraph relation type path. */
export interface RelationTypePath {
  object_types: Array<{
    id: string;
    condition: ConditionSpec;
    limit?: number;
  }>;
  relation_types: Array<{
    relation_type_id: string;
    source_object_type_id: string;
    target_object_type_id: string;
  }>;
}

/** Layer 2: query_instance_subgraph arguments. */
export interface QueryInstanceSubgraphArgs {
  relation_type_paths: RelationTypePath[];
}

/** Layer 3: get_logic_properties_values arguments. */
export interface GetLogicPropertiesValuesArgs {
  ot_id: string;
  query: string;
  _instance_identities: Record<string, string>[];
  properties: string[];
  additional_context?: string;
}

/** Layer 3: get_action_info arguments. */
export interface GetActionInfoArgs {
  at_id: string;
  _instance_identity: Record<string, string>;
}

/** Error when get_logic_properties_values returns MISSING_INPUT_PARAMS. */
export interface MissingInputParamsError {
  error_code: "MISSING_INPUT_PARAMS";
  message: string;
  missing: Array<{
    property: string;
    params: Array<{ name: string; type: string; hint: string }>;
  }>;
}

function isMissingInputParams(obj: unknown): obj is MissingInputParamsError {
  return (
    typeof obj === "object" &&
    obj !== null &&
    (obj as Record<string, unknown>).error_code === "MISSING_INPUT_PARAMS"
  );
}

/** Build retry hint from MISSING_INPUT_PARAMS response. */
export function formatMissingInputParamsHint(err: MissingInputParamsError): string {
  const lines: string[] = [
    "MISSING_INPUT_PARAMS: " + err.message,
    "Add the following to additional_context and retry:",
  ];
  for (const m of err.missing ?? []) {
    for (const p of m.params ?? []) {
      if (p.hint) lines.push(`  - ${p.name}: ${p.hint}`);
    }
  }
  return lines.join("\n");
}

/** Guardrail: value_from only supports "const"; must appear with value. */
export function validateCondition(condition: unknown): void {
  if (!condition || typeof condition !== "object") return;
  const c = condition as Record<string, unknown>;
  const sub = c.sub_conditions;
  if (Array.isArray(sub)) {
    for (const s of sub) {
      if (s && typeof s === "object") {
        const sc = s as Record<string, unknown>;
        if (sc.value_from !== undefined && sc.value_from !== "const") {
          throw new Error(
            'Condition value_from only supports "const". Must use value_from: "const" with value.'
          );
        }
        if (sc.value_from === "const" && sc.value === undefined) {
          throw new Error('When value_from is "const", value must be provided.');
        }
      }
    }
  }
  if (c.value_from !== undefined && c.value_from !== "const") {
    throw new Error('Condition value_from only supports "const".');
  }
}

/** Guardrail: _instance_identity must be a plain object (from Layer 2 output, not fabricated). */
export function validateInstanceIdentity(v: unknown, label: string): void {
  if (v === null || typeof v !== "object" || Array.isArray(v)) {
    throw new Error(
      `${label} must be a plain object from Layer 2 query result (_instance_identity). Do not fabricate.`
    );
  }
}

/** Guardrail: _instance_identities must be array of plain objects from Layer 2. */
export function validateInstanceIdentities(v: unknown): void {
  if (!Array.isArray(v)) {
    throw new Error("_instance_identities must be an array from Layer 2 query result.");
  }
  for (let i = 0; i < v.length; i += 1) {
    validateInstanceIdentity(v[i], `_instance_identities[${i}]`);
  }
}

let requestId = 0;

/** Call a generic MCP JSON-RPC method (e.g. tools/list, resources/list). Returns result as-is. */
async function callMcpMethod(
  options: ContextLoaderCallOptions,
  method: string,
  params: Record<string, unknown> = {}
): Promise<unknown> {
  const sessionId = await ensureSession(options);
  const id = (requestId += 1);

  const body = JSON.stringify({
    jsonrpc: "2.0",
    method,
    params: Object.keys(params).length > 0 ? params : undefined,
    id,
  });

  const { body: responseBody } = await fetchTextOrThrow(options.mcpUrl, {
    method: "POST",
    headers: buildHeaders(options, sessionId),
    body,
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(responseBody);
  } catch {
    throw new Error(`Context-loader returned invalid JSON: ${responseBody.slice(0, 200)}`);
  }

  const rpc = parsed as { result?: unknown; error?: { code: number; message: string } };
  if (rpc.error) {
    throw new Error(`Context-loader error: ${rpc.error.message}`);
  }

  if (rpc.result !== undefined) {
    return rpc.result;
  }

  throw new Error("Context-loader returned no result");
}

export async function callTool(
  options: ContextLoaderCallOptions,
  toolName: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const sessionId = await ensureSession(options);
  const id = (requestId += 1);

  const body = JSON.stringify({
    jsonrpc: "2.0",
    method: "tools/call",
    params: { name: toolName, arguments: args as Record<string, unknown> },
    id,
  });

  const { body: responseBody } = await fetchTextOrThrow(options.mcpUrl, {
    method: "POST",
    headers: buildHeaders(options, sessionId),
    body,
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(responseBody);
  } catch {
    throw new Error(`Context-loader returned invalid JSON: ${responseBody.slice(0, 200)}`);
  }

  if (isMissingInputParams(parsed)) {
    throw new Error(formatMissingInputParamsHint(parsed));
  }

  const rpc = parsed as { result?: unknown; error?: { code: number; message: string; data?: unknown } };
  if (rpc.error) {
    const data = rpc.error.data;
    if (isMissingInputParams(data)) {
      throw new Error(formatMissingInputParamsHint(data));
    }
    throw new Error(`Context-loader error: ${rpc.error.message}`);
  }

  const result = rpc.result;
  if (result !== undefined) {
    const content = (result as Record<string, unknown>).content;
    if (Array.isArray(content) && content.length > 0) {
      const first = content[0] as Record<string, unknown>;
      const text = first?.text;
      if (typeof text === "string") {
        try {
          return JSON.parse(text) as unknown;
        } catch {
          return { raw: text };
        }
      }
    }
    return result;
  }

  const direct = parsed as Record<string, unknown>;
  if (
    "object_types" in direct ||
    "concepts" in direct ||
    "datas" in direct ||
    "entries" in direct ||
    "_dynamic_tools" in direct
  ) {
    return parsed;
  }

  throw new Error("Context-loader returned no result");
}

/** Layer 1: search_schema. Returns object_types, relation_types, action_types, metric_types. */
export async function searchSchema(
  options: ContextLoaderCallOptions,
  args: SearchSchemaArgs
): Promise<unknown> {
  const toolArgs: Record<string, unknown> = {
    query: args.query,
    response_format: args.response_format ?? "json",
  };
  if (args.search_scope !== undefined) toolArgs.search_scope = args.search_scope;
  if (args.max_concepts !== undefined) toolArgs.max_concepts = args.max_concepts;
  if (args.schema_brief !== undefined) toolArgs.schema_brief = args.schema_brief;
  if (args.enable_rerank !== undefined) toolArgs.enable_rerank = args.enable_rerank;
  return callTool(options, "search_schema", toolArgs);
}

/** Layer 1: kn_search. Returns object_types, relation_types, action_types. */
export async function knSearch(
  options: ContextLoaderCallOptions,
  args: KnSearchArgs
): Promise<unknown> {
  return searchSchema(options, { query: args.query });
}

/** Layer 1: kn_schema_search. Returns concepts (candidate discovery only). */
export async function knSchemaSearch(
  options: ContextLoaderCallOptions,
  args: KnSchemaSearchArgs
): Promise<unknown> {
  return searchSchema(options, {
    query: args.query,
    max_concepts: args.max_concepts,
    schema_brief: true,
  });
}

/** Layer 2: query_object_instance. Returns datas with _instance_identity. */
export async function queryObjectInstance(
  options: ContextLoaderCallOptions,
  args: QueryObjectInstanceArgs
): Promise<unknown> {
  validateCondition(args.condition);
  return callTool(options, "query_object_instance", { ...args });
}

/** Layer 2: query_instance_subgraph. Returns entries with nested _instance_identity. */
export async function queryInstanceSubgraph(
  options: ContextLoaderCallOptions,
  args: QueryInstanceSubgraphArgs
): Promise<unknown> {
  for (const path of args.relation_type_paths) {
    for (const ot of path.object_types) {
      validateCondition(ot.condition);
    }
  }
  return callTool(options, "query_instance_subgraph", { ...args });
}

/** Layer 3: get_logic_properties_values. Throws with retry hint on MISSING_INPUT_PARAMS. */
export async function getLogicPropertiesValues(
  options: ContextLoaderCallOptions,
  args: GetLogicPropertiesValuesArgs
): Promise<unknown> {
  validateInstanceIdentities(args._instance_identities);
  return callTool(options, "get_logic_properties_values", { ...args });
}

/** Layer 3: get_action_info. Returns _dynamic_tools. */
export async function getActionInfo(
  options: ContextLoaderCallOptions,
  args: GetActionInfoArgs
): Promise<unknown> {
  validateInstanceIdentity(args._instance_identity, "_instance_identity");
  return callTool(options, "get_action_info", { ...args });
}

/** MCP tools/list. Returns list of available tools. */
export async function listTools(
  options: ContextLoaderCallOptions,
  params?: { cursor?: string }
): Promise<unknown> {
  return callMcpMethod(options, "tools/list", params ? { cursor: params.cursor } : {});
}

/** MCP resources/list. Returns list of available resources. */
export async function listResources(
  options: ContextLoaderCallOptions,
  params?: { cursor?: string }
): Promise<unknown> {
  return callMcpMethod(options, "resources/list", params ? { cursor: params.cursor } : {});
}

/** MCP resources/read. Returns resource content by URI. */
export async function readResource(
  options: ContextLoaderCallOptions,
  uri: string
): Promise<unknown> {
  return callMcpMethod(options, "resources/read", { uri });
}

/** MCP resources/templates/list. Returns list of resource templates. */
export async function listResourceTemplates(
  options: ContextLoaderCallOptions,
  params?: { cursor?: string }
): Promise<unknown> {
  return callMcpMethod(options, "resources/templates/list", params ? { cursor: params.cursor } : {});
}

/** MCP prompts/list. Returns list of available prompts. */
export async function listPrompts(
  options: ContextLoaderCallOptions,
  params?: { cursor?: string }
): Promise<unknown> {
  return callMcpMethod(options, "prompts/list", params ? { cursor: params.cursor } : {});
}

/** MCP prompts/get. Returns prompt by name with optional arguments. */
export async function getPrompt(
  options: ContextLoaderCallOptions,
  name: string,
  args?: Record<string, unknown>
): Promise<unknown> {
  return callMcpMethod(options, "prompts/get", args ? { name, arguments: args } : { name });
}
