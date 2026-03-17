/**
 * KWeaver TypeScript SDK — public API entry point.
 *
 * ## Recommended: KWeaverClient (high-level)
 *
 * ```typescript
 * import { KWeaverClient } from "kweaver-sdk";
 *
 * const client = new KWeaverClient({ baseUrl, accessToken });
 * const kns  = await client.knowledgeNetworks.list();
 * const reply = await client.agents.chat("agent-id", "你好");
 * ```
 *
 * ## Advanced: raw API functions (low-level)
 *
 * All API functions take explicit `baseUrl` and `accessToken` parameters.
 * Use `getCurrentPlatform` / `getConfigDir` to read credentials saved by the CLI.
 *
 * @example
 * ```typescript
 * import { listKnowledgeNetworks, sendChatRequest } from "kweaver-sdk";
 *
 * const kns = await listKnowledgeNetworks({ baseUrl, accessToken });
 * const reply = await sendChatRequest({ baseUrl, accessToken, agentId, agentKey, agentVersion, query, stream: false });
 * console.log(reply.text);
 * ```
 */

// ── Knowledge networks ────────────────────────────────────────────────────────
export type {
  ListKnowledgeNetworksOptions,
  GetKnowledgeNetworkOptions,
  CreateKnowledgeNetworkOptions,
  UpdateKnowledgeNetworkOptions,
  DeleteKnowledgeNetworkOptions,
  ListSchemaTypesOptions,
} from "./api/knowledge-networks.js";
export {
  listKnowledgeNetworks,
  getKnowledgeNetwork,
  createKnowledgeNetwork,
  updateKnowledgeNetwork,
  deleteKnowledgeNetwork,
  listObjectTypes,
  listRelationTypes,
  listActionTypes,
} from "./api/knowledge-networks.js";

// ── Ontology query (instances, subgraph, actions) ─────────────────────────────
export type {
  OntologyQueryBaseOptions,
  ObjectTypeQueryOptions,
  ObjectTypePropertiesOptions,
  SubgraphOptions,
  ActionTypeQueryOptions,
  ActionTypeExecuteOptions,
  ActionExecutionGetOptions,
  ActionLogsListOptions,
  ActionLogGetOptions,
  ActionLogCancelOptions,
} from "./api/ontology-query.js";
export {
  objectTypeQuery,
  objectTypeProperties,
  subgraph,
  actionTypeQuery,
  actionTypeExecute,
  actionExecutionGet,
  actionLogsList,
  actionLogGet,
  actionLogCancel,
} from "./api/ontology-query.js";

// ── Agent chat ────────────────────────────────────────────────────────────────
export type {
  SendChatRequestOptions,
  SendChatRequestStreamCallbacks,
  ChatResult,
  ProgressItem,
  AgentInfo,
} from "./api/agent-chat.js";
export {
  sendChatRequest,
  sendChatRequestStream,
  fetchAgentInfo,
  buildChatUrl,
  buildAgentInfoUrl,
  extractText,
} from "./api/agent-chat.js";

// ── Agent list ────────────────────────────────────────────────────────────────
export type { ListAgentsOptions } from "./api/agent-list.js";
export { listAgents } from "./api/agent-list.js";

// ── Conversations ─────────────────────────────────────────────────────────────
export type { ListConversationsOptions, ListMessagesOptions } from "./api/conversations.js";
export { listConversations, listMessages } from "./api/conversations.js";

// ── Context loader ────────────────────────────────────────────────────────────
export type {
  ContextLoaderCallOptions,
  KnSearchArgs,
  KnSchemaSearchArgs,
  ConditionSpec,
  QueryObjectInstanceArgs,
  RelationTypePath,
  QueryInstanceSubgraphArgs,
  GetLogicPropertiesValuesArgs,
  GetActionInfoArgs,
  MissingInputParamsError,
} from "./api/context-loader.js";
export {
  knSearch,
  knSchemaSearch,
  queryObjectInstance,
  queryInstanceSubgraph,
  getLogicPropertiesValues,
  getActionInfo,
  formatMissingInputParamsHint,
  validateCondition,
  validateInstanceIdentity,
  validateInstanceIdentities,
} from "./api/context-loader.js";

// ── Module-level simple API (cognee-style) ────────────────────────────────────
export type { ConfigureOptions } from "./kweaver.js";
export { configure, search, agents, chat, bkns, weaver, getClient } from "./kweaver.js";

// ── High-level client ─────────────────────────────────────────────────────────
export type { KWeaverClientOptions, ClientContext } from "./client.js";
export { KWeaverClient } from "./client.js";
export { KnowledgeNetworksResource } from "./resources/knowledge-networks.js";
export { AgentsResource } from "./resources/agents.js";
export { BknResource } from "./resources/bkn.js";
export { ConversationsResource } from "./resources/conversations.js";
export { ContextLoaderResource } from "./resources/context-loader.js";

// ── HTTP utilities ────────────────────────────────────────────────────────────
export { HttpError, NetworkRequestError, fetchTextOrThrow } from "./utils/http.js";

// ── Config / credential store (read-only helpers) ─────────────────────────────
export type {
  ClientConfig,
  TokenConfig,
  ContextLoaderEntry,
  ContextLoaderConfig,
  PlatformSummary,
} from "./config/store.js";
export { getConfigDir, getCurrentPlatform } from "./config/store.js";
