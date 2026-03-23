import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface TokenConfig {
  baseUrl: string;
  accessToken: string;
  tokenType: string;
  scope: string;
  expiresIn?: number;
  expiresAt?: string;
  refreshToken?: string;
  idToken?: string;
  obtainedAt: string;
}

/** OAuth2 client registration (per platform), used for refresh_token grant. */
export interface ClientConfig {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri?: string;
  logoutRedirectUri?: string;
  scope?: string;
  lang?: string;
  product?: string;
  xForwardedPrefix?: string;
}

/** Single context-loader entry (named kn_id). */
export interface ContextLoaderEntry {
  name: string;
  knId: string;
}

/** Per-platform context-loader config: multiple kn entries, one current. */
export interface ContextLoaderConfig {
  configs: ContextLoaderEntry[];
  current: string;
}

const MCP_PATH = "/api/agent-retrieval/v1/mcp";

function buildMcpUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "") + MCP_PATH;
}

interface StoreState {
  currentPlatform?: string;
  aliases?: Record<string, string>;
}

export interface PlatformSummary {
  baseUrl: string;
  hasToken: boolean;
  isCurrent: boolean;
  alias?: string;
}

const CONFIG_DIR = process.env.KWEAVERC_CONFIG_DIR || join(homedir(), ".kweaver");
function getConfigDirPath(): string {
  return process.env.KWEAVERC_CONFIG_DIR || join(homedir(), ".kweaver");
}

function getPlatformsDirPath(): string {
  return join(getConfigDirPath(), "platforms");
}

function getStateFilePath(): string {
  return join(getConfigDirPath(), "state.json");
}

function getLegacyClientFilePath(): string {
  return join(getConfigDirPath(), "client.json");
}

function getLegacyTokenFilePath(): string {
  return join(getConfigDirPath(), "token.json");
}

function getLegacyCallbackFilePath(): string {
  return join(getConfigDirPath(), "callback.json");
}

const IS_WIN32 = process.platform === "win32";

function ensureDir(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true, ...(IS_WIN32 ? {} : { mode: 0o700 }) });
  }
}

function ensureConfigDir(): void {
  ensureDir(getConfigDirPath());
  ensureDir(getPlatformsDirPath());
}

function readJsonFile<T>(filePath: string): T | null {
  if (!existsSync(filePath)) {
    return null;
  }

  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function writeJsonFile(filePath: string, value: unknown): void {
  ensureConfigDir();
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, IS_WIN32 ? {} : { mode: 0o600 });
  if (!IS_WIN32) chmodSync(filePath, 0o600);
}

function encodePlatformKey(baseUrl: string): string {
  return Buffer.from(baseUrl, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function getPlatformDir(baseUrl: string): string {
  return join(getPlatformsDirPath(), encodePlatformKey(baseUrl));
}

function getPlatformFile(baseUrl: string, filename: string): string {
  return join(getPlatformDir(baseUrl), filename);
}

function ensurePlatformDir(baseUrl: string): void {
  ensureDir(getPlatformDir(baseUrl));
}

function readState(): StoreState {
  return readJsonFile<StoreState>(getStateFilePath()) ?? {};
}

function writeState(state: StoreState): void {
  writeJsonFile(getStateFilePath(), state);
}

function normalizeAlias(value: string): string {
  return value.trim().toLowerCase();
}

function migrateLegacyFilesIfNeeded(): void {
  const legacyClientFile = getLegacyClientFilePath();
  const legacyTokenFile = getLegacyTokenFilePath();
  const legacyCallbackFile = getLegacyCallbackFilePath();
  const hasLegacy =
    existsSync(legacyClientFile) || existsSync(legacyTokenFile) || existsSync(legacyCallbackFile);
  if (!hasLegacy) {
    return;
  }

  const legacyClient = readJsonFile<{ baseUrl?: string }>(legacyClientFile);
  const legacyToken = readJsonFile<TokenConfig>(legacyTokenFile);
  const legacyCallback = readJsonFile<{ baseUrl?: string }>(legacyCallbackFile);
  const baseUrl = legacyClient?.baseUrl ?? legacyToken?.baseUrl ?? legacyCallback?.baseUrl;

  if (!baseUrl) {
    return;
  }

  const platformClientFile = getPlatformFile(baseUrl, "client.json");
  const platformTokenFile = getPlatformFile(baseUrl, "token.json");
  const platformCallbackFile = getPlatformFile(baseUrl, "callback.json");
  ensurePlatformDir(baseUrl);

  if (legacyClient && !existsSync(platformClientFile)) {
    writeJsonFile(platformClientFile, legacyClient);
  }
  if (legacyToken && !existsSync(platformTokenFile)) {
    writeJsonFile(platformTokenFile, legacyToken);
  }
  if (legacyCallback && !existsSync(platformCallbackFile)) {
    writeJsonFile(platformCallbackFile, legacyCallback);
  }

  const state = readState();
  if (!state.currentPlatform) {
    writeState({ ...state, currentPlatform: baseUrl });
  }
}

function ensureStoreReady(): void {
  ensureConfigDir();
  migrateLegacyFilesIfNeeded();
}

export function getConfigDir(): string {
  return getConfigDirPath();
}

export function getCurrentPlatform(): string | null {
  ensureStoreReady();
  return readState().currentPlatform ?? null;
}

export function setCurrentPlatform(baseUrl: string): void {
  ensureStoreReady();
  const state = readState();
  writeState({ ...state, currentPlatform: baseUrl });
}

export function setPlatformAlias(baseUrl: string, alias: string): void {
  ensureStoreReady();
  const normalizedAlias = normalizeAlias(alias);
  if (!normalizedAlias) {
    throw new Error("Alias cannot be empty.");
  }

  const state = readState();
  const aliases = { ...(state.aliases ?? {}) };
  const existing = aliases[normalizedAlias];
  if (existing && existing !== baseUrl) {
    throw new Error(`Alias '${normalizedAlias}' is already assigned to ${existing}.`);
  }

  aliases[normalizedAlias] = baseUrl;
  writeState({ ...state, aliases });
}

export function deletePlatformAlias(baseUrl: string): void {
  ensureStoreReady();
  const state = readState();
  const aliases = { ...(state.aliases ?? {}) };
  let changed = false;

  for (const [alias, targetBaseUrl] of Object.entries(aliases)) {
    if (targetBaseUrl === baseUrl) {
      delete aliases[alias];
      changed = true;
    }
  }

  if (!changed) {
    return;
  }

  writeState({
    ...state,
    aliases: Object.keys(aliases).length > 0 ? aliases : undefined,
  });
}

export function getPlatformAlias(baseUrl: string): string | null {
  ensureStoreReady();
  const aliases = readState().aliases ?? {};
  for (const [alias, targetBaseUrl] of Object.entries(aliases)) {
    if (targetBaseUrl === baseUrl) {
      return alias;
    }
  }
  return null;
}

export function resolvePlatformIdentifier(value: string): string | null {
  ensureStoreReady();
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  const aliases = readState().aliases ?? {};
  const aliasTarget = aliases[normalizeAlias(normalized)];
  if (aliasTarget) {
    return aliasTarget;
  }

  return normalized;
}

export function loadTokenConfig(baseUrl?: string): TokenConfig | null {
  ensureStoreReady();
  const targetBaseUrl = baseUrl ?? getCurrentPlatform();
  if (!targetBaseUrl) {
    return null;
  }
  return readJsonFile<TokenConfig>(getPlatformFile(targetBaseUrl, "token.json"));
}

export function saveTokenConfig(config: TokenConfig): void {
  ensureStoreReady();
  ensurePlatformDir(config.baseUrl);
  writeJsonFile(getPlatformFile(config.baseUrl, "token.json"), config);
}

export function loadClientConfig(baseUrl?: string): ClientConfig | null {
  ensureStoreReady();
  const targetBaseUrl = baseUrl ?? getCurrentPlatform();
  if (!targetBaseUrl) {
    return null;
  }
  return readJsonFile<ClientConfig>(getPlatformFile(targetBaseUrl, "client.json"));
}

export function saveClientConfig(baseUrl: string, config: ClientConfig): void {
  ensureStoreReady();
  ensurePlatformDir(baseUrl);
  writeJsonFile(getPlatformFile(baseUrl, "client.json"), { ...config, baseUrl });
}

/** Legacy format (pre-refactor). */
interface LegacyContextLoaderConfig {
  mcpUrl?: string;
  knId?: string;
}

function migrateLegacyContextLoader(raw: unknown): ContextLoaderConfig {
  const leg = raw as LegacyContextLoaderConfig;
  if (leg?.knId && !Array.isArray((raw as ContextLoaderConfig).configs)) {
    return {
      configs: [{ name: "default", knId: leg.knId }],
      current: "default",
    };
  }
  return raw as ContextLoaderConfig;
}

export function loadContextLoaderConfig(baseUrl?: string): ContextLoaderConfig | null {
  ensureStoreReady();
  const targetBaseUrl = baseUrl ?? getCurrentPlatform();
  if (!targetBaseUrl) {
    return null;
  }
  const raw = readJsonFile<unknown>(getPlatformFile(targetBaseUrl, "context-loader.json"));
  if (!raw) return null;

  const migrated = migrateLegacyContextLoader(raw);
  if (
    !Array.isArray(migrated.configs) ||
    migrated.configs.length === 0 ||
    !migrated.current
  ) {
    return null;
  }
  const hasCurrent = migrated.configs.some((c) => c.name === migrated.current);
  if (!hasCurrent) return null;

  const isLegacy = (raw as LegacyContextLoaderConfig)?.knId && !(raw as ContextLoaderConfig).configs;
  if (isLegacy) {
    saveContextLoaderConfig(targetBaseUrl, migrated);
  }
  return migrated;
}

export function saveContextLoaderConfig(baseUrl: string, config: ContextLoaderConfig): void {
  ensureStoreReady();
  ensurePlatformDir(baseUrl);
  writeJsonFile(getPlatformFile(baseUrl, "context-loader.json"), config);
}

export interface CurrentContextLoaderKn {
  mcpUrl: string;
  knId: string;
}

export function getCurrentContextLoaderKn(baseUrl?: string): CurrentContextLoaderKn | null {
  ensureStoreReady();
  const targetBaseUrl = baseUrl ?? getCurrentPlatform();
  if (!targetBaseUrl) return null;

  const token = loadTokenConfig(targetBaseUrl);
  if (!token?.baseUrl) return null;

  const config = loadContextLoaderConfig(targetBaseUrl);
  if (!config) return null;

  const entry = config.configs.find((c) => c.name === config.current);
  if (!entry) return null;

  return {
    mcpUrl: buildMcpUrl(token.baseUrl),
    knId: entry.knId,
  };
}

export function addContextLoaderEntry(baseUrl: string, name: string, knId: string): void {
  ensureStoreReady();
  const existing = loadContextLoaderConfig(baseUrl);
  const configs = existing?.configs ?? [];
  const idx = configs.findIndex((c) => c.name === name);
  const entry: ContextLoaderEntry = { name, knId };
  const newConfigs = idx >= 0
    ? configs.map((c, i) => (i === idx ? entry : c))
    : [...configs, entry];
  const current = existing?.current ?? name;
  const hasCurrent = newConfigs.some((c) => c.name === current);
  saveContextLoaderConfig(baseUrl, {
    configs: newConfigs,
    current: hasCurrent ? current : name,
  });
}

export function setCurrentContextLoader(baseUrl: string, name: string): void {
  ensureStoreReady();
  const config = loadContextLoaderConfig(baseUrl);
  if (!config) {
    throw new Error("Context-loader is not configured. Run: kweaver context-loader config set --kn-id <id>");
  }
  const hasName = config.configs.some((c) => c.name === name);
  if (!hasName) {
    throw new Error(`No context-loader config named '${name}'. Use config list to see available configs.`);
  }
  saveContextLoaderConfig(baseUrl, { ...config, current: name });
}

export function removeContextLoaderEntry(baseUrl: string, name: string): void {
  ensureStoreReady();
  const config = loadContextLoaderConfig(baseUrl);
  if (!config) return;

  const newConfigs = config.configs.filter((c) => c.name !== name);
  if (newConfigs.length === 0) {
    const file = getPlatformFile(baseUrl, "context-loader.json");
    if (existsSync(file)) rmSync(file, { force: true });
    return;
  }

  let newCurrent = config.current;
  if (config.current === name) {
    newCurrent = newConfigs[0].name;
  }
  saveContextLoaderConfig(baseUrl, { configs: newConfigs, current: newCurrent });
}

export function hasPlatform(baseUrl: string): boolean {
  ensureStoreReady();
  return existsSync(getPlatformFile(baseUrl, "token.json"));
}

/**
 * Remove token for a platform so the next auth will do a full login.
 */
export function clearPlatformSession(baseUrl: string): void {
  ensureStoreReady();
  const tokenFile = getPlatformFile(baseUrl, "token.json");
  if (existsSync(tokenFile)) {
    rmSync(tokenFile, { force: true });
  }
}

export function deletePlatform(baseUrl: string): void {
  ensureStoreReady();
  const platformDir = getPlatformDir(baseUrl);
  if (!existsSync(platformDir)) {
    return;
  }

  deletePlatformAlias(baseUrl);
  rmSync(platformDir, { recursive: true, force: true });

  const state = readState();
  if (state.currentPlatform !== baseUrl) {
    return;
  }

  const remainingPlatforms = listPlatforms();
  writeState({
    ...readState(),
    currentPlatform: remainingPlatforms[0]?.baseUrl,
  });
}

export function listPlatforms(): PlatformSummary[] {
  ensureStoreReady();
  const currentPlatform = getCurrentPlatform();
  const items: PlatformSummary[] = [];

  for (const entry of readdirSync(getPlatformsDirPath())) {
    const dirPath = join(getPlatformsDirPath(), entry);
    if (!statSync(dirPath).isDirectory()) {
      continue;
    }

    const token = readJsonFile<TokenConfig>(join(dirPath, "token.json"));
    if (!token?.baseUrl) {
      continue;
    }

    items.push({
      baseUrl: token.baseUrl,
      hasToken: true,
      isCurrent: token.baseUrl === currentPlatform,
      alias: getPlatformAlias(token.baseUrl) ?? undefined,
    });
  }

  items.sort((a, b) => a.baseUrl.localeCompare(b.baseUrl));
  return items;
}

/** Per-platform config (not auth — general settings). */
export interface PlatformConfig {
  businessDomain?: string;
}

function loadPlatformConfig(baseUrl: string): PlatformConfig | null {
  ensureStoreReady();
  return readJsonFile<PlatformConfig>(getPlatformFile(baseUrl, "config.json"));
}

function savePlatformConfig(baseUrl: string, config: PlatformConfig): void {
  ensureStoreReady();
  ensurePlatformDir(baseUrl);
  writeJsonFile(getPlatformFile(baseUrl, "config.json"), config);
}

export function loadPlatformBusinessDomain(baseUrl: string): string | null {
  return loadPlatformConfig(baseUrl)?.businessDomain ?? null;
}

export function savePlatformBusinessDomain(baseUrl: string, businessDomain: string): void {
  const existing = loadPlatformConfig(baseUrl) ?? {};
  savePlatformConfig(baseUrl, { ...existing, businessDomain });
}

/**
 * Resolve businessDomain: env var > per-platform config > "bd_public".
 * If baseUrl is omitted, uses the current platform.
 */
export function resolveBusinessDomain(baseUrl?: string): string {
  const fromEnv = process.env.KWEAVER_BUSINESS_DOMAIN;
  if (fromEnv) return fromEnv;

  const targetUrl = baseUrl ?? getCurrentPlatform();
  if (targetUrl) {
    const fromConfig = loadPlatformBusinessDomain(targetUrl);
    if (fromConfig) return fromConfig;
  }
  return "bd_public";
}
