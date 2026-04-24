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

// ── Agent list / CRUD ────────────────────────────────────────────────────────
export type {
  ListAgentsOptions,
  GetAgentOptions,
  GetAgentByKeyOptions,
  CreateAgentOptions,
  UpdateAgentOptions,
  DeleteAgentOptions,
  PublishAgentOptions,
  UnpublishAgentOptions,
} from "./api/agent-list.js";
export {
  listAgents,
  getAgent,
  getAgentByKey,
  createAgent,
  updateAgent,
  deleteAgent,
  publishAgent,
  unpublishAgent,
} from "./api/agent-list.js";

// ── Conversations ─────────────────────────────────────────────────────────────
export type { ListConversationsOptions, ListMessagesOptions } from "./api/conversations.js";
export { listConversations, listMessages } from "./api/conversations.js";

// ── Semantic search ───────────────────────────────────────────────────────────
export type { SemanticSearchOptions, KnSearchHttpOptions } from "./api/semantic-search.js";
export { semanticSearch, knSearchHttp } from "./api/semantic-search.js";

// ── Context loader ────────────────────────────────────────────────────────────
export type {
  ContextLoaderCallOptions,
  SearchSchemaArgs,
  SearchSchemaScope,
  SearchSchemaResult,
  ConditionSpec,
  QueryObjectInstanceArgs,
  RelationTypePath,
  QueryInstanceSubgraphArgs,
  GetLogicPropertiesValuesArgs,
  GetActionInfoArgs,
  FindSkillsArgs,
  FindSkillsResult,
  MissingInputParamsError,
} from "./api/context-loader.js";
export {
  callTool,
  searchSchema,
  queryObjectInstance,
  queryInstanceSubgraph,
  getLogicPropertiesValues,
  getActionInfo,
  findSkills,
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
export type {
  AgentConfig,
  AgentInput,
  AgentInputField,
  AgentOutput,
  AgentLlmConfig,
  AgentLlmItem,
  CreateAgentBody,
  UpdateAgentBody,
} from "./resources/agents.js";
export { BknResource } from "./resources/bkn.js";
export { ConversationsResource } from "./resources/conversations.js";
export { ContextLoaderResource } from "./resources/context-loader.js";
export { SkillsResource } from "./resources/skills.js";
export { ToolboxesResource } from "./resources/toolboxes.js";
export type { InvokeToolArgs } from "./resources/toolboxes.js";

// ── Skills (agent-operator-integration) ──────────────────────────────────────
export type {
  SkillStatus,
  SkillSummary,
  SkillInfo,
  SkillFileSummary,
  SkillContentIndex,
  SkillFileReadResult,
  RegisterSkillResult,
  DeleteSkillResult,
  UpdateSkillStatusResult,
  SkillListResult,
  ListSkillsOptions,
  ListSkillMarketOptions,
  GetSkillOptions,
  RegisterSkillContentOptions,
  RegisterSkillZipOptions,
  UpdateSkillStatusOptions,
  ReadSkillFileOptions,
  DownloadSkillOptions,
  DownloadedSkillArchive,
} from "./api/skills.js";
export {
  listSkills,
  listSkillMarket,
  getSkill,
  deleteSkill,
  updateSkillStatus,
  registerSkillContent,
  registerSkillZip,
  getSkillContentIndex,
  fetchSkillContent,
  readSkillFile,
  fetchSkillFile,
  downloadSkill,
  installSkillArchive,
} from "./api/skills.js";

// ── Data views (mdl-data-model) ────────────────────────────────────────────────
export type {
  ViewField,
  DataView,
  CreateDataViewOptions,
  GetDataViewOptions,
  ListDataViewsOptions,
  DeleteDataViewOptions,
  FindDataViewOptions,
  QueryDataViewOptions,
  DataViewQueryResult,
} from "./api/dataviews.js";
export {
  parseDataView,
  createDataView,
  getDataView,
  listDataViews,
  deleteDataView,
  findDataView,
  queryDataView,
} from "./api/dataviews.js";
export { DataViewsResource } from "./resources/dataviews.js";

// ── Business domains (platform API) ───────────────────────────────────────────
export type { BusinessDomain, ListBusinessDomainsOptions } from "./api/business-domains.js";
export { listBusinessDomains } from "./api/business-domains.js";

// ── Toolboxes / tools (agent-operator-integration) ────────────────────────────
export type {
  CreateToolboxOptions,
  DeleteToolboxOptions,
  SetToolboxStatusOptions,
  UploadToolOptions,
  SetToolStatusesOptions,
  ListToolboxesOptions,
  ListToolsOptions,
  InvokeToolOptions,
} from "./api/toolboxes.js";
export {
  createToolbox,
  deleteToolbox,
  setToolboxStatus,
  uploadTool,
  setToolStatuses,
  listToolboxes,
  listTools,
  executeTool,
  debugTool,
} from "./api/toolboxes.js";

// ── HTTP utilities ────────────────────────────────────────────────────────────
export { HttpError, NetworkRequestError, fetchTextOrThrow } from "./utils/http.js";

// ── Config / credential store (read-only helpers) ─────────────────────────────
export type {
  TokenConfig,
  ContextLoaderEntry,
  ContextLoaderConfig,
} from "./config/store.js";
export type { UserProfile } from "./config/store.js";
export {
  NO_AUTH_TOKEN,
  isNoAuth,
  saveNoAuthPlatform,
  autoSelectBusinessDomain,
  getConfigDir,
  getCurrentPlatform,
  getActiveUser,
  setActiveUser,
  listUsers,
  listUserProfiles,
  resolveUserId,
  extractUserId,
} from "./config/store.js";

// ── JWT utilities ─────────────────────────────────────────────────────────────
export { decodeJwtPayload, extractUserIdFromJwt } from "./config/jwt.js";

// ── OAuth (advanced — CLI uses these internally; optional for custom login tools) ─
export {
  DEFAULT_SIGNIN_RSA_MODULUS_HEX,
  InitialPasswordChangeRequiredError,
  oauth2PasswordSigninLogin,
  parseSigninPageHtmlProps,
  rsaModulusHexToSpkiPem,
  STUDIOWEB_LOGIN_PUBLIC_KEY_PEM,
} from "./auth/oauth.js";

export { eacpModifyPassword, encryptModifyPwd } from "./auth/eacp-modify-password.js";
