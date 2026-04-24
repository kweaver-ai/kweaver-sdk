import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { listBusinessDomains } from "../api/business-domains.js";
import { NO_AUTH_TOKEN } from "./no-auth.js";
import { decodeJwtPayload, extractUserIdFromJwt } from "./jwt.js";

export { NO_AUTH_TOKEN, isNoAuth } from "./no-auth.js";

/**
 * Persist a no-auth session for a platform (users/default/token.json) and set it as current.
 * Used by `kweaver auth <url> --no-auth` and when OAuth registration returns 404.
 */
export function saveNoAuthPlatform(baseUrl: string, opts?: { tlsInsecure?: boolean }): TokenConfig {
  const base = baseUrl.replace(/\/+$/, "");
  const token: TokenConfig = {
    baseUrl: base,
    accessToken: NO_AUTH_TOKEN,
    tokenType: "none",
    scope: "",
    obtainedAt: new Date().toISOString(),
  };
  if (opts?.tlsInsecure) {
    token.tlsInsecure = true;
  }
  saveTokenConfig(token);
  setCurrentPlatform(base);
  return token;
}

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
  /** When true, skip TLS certificate verification for this platform (saved by `kweaver auth --insecure`). */
  tlsInsecure?: boolean;
  /** Human-readable display name fetched from userinfo at login time. */
  displayName?: string;
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
  /** Maps baseUrl → active userId for multi-account support. */
  activeUsers?: Record<string, string>;
}

export interface PlatformSummary {
  baseUrl: string;
  hasToken: boolean;
  isCurrent: boolean;
  alias?: string;
  /** Active user ID for this platform (from id_token sub claim). */
  userId?: string;
  /** Human-readable name persisted from /oauth2/userinfo at login time. */
  displayName?: string;
}

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
  const dir = join(filePath, "..");
  ensureDir(dir);
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

// ---------------------------------------------------------------------------
// User-scoped file routing
// ---------------------------------------------------------------------------

/** Files that live under users/<userId>/ instead of at platform root. */
const USER_SCOPED_FILES = new Set(["token.json", "config.json", "context-loader.json"]);

function getUserDir(baseUrl: string, userId: string): string {
  return join(getPlatformDir(baseUrl), "users", userId);
}

function getUsersDirPath(baseUrl: string): string {
  return join(getPlatformDir(baseUrl), "users");
}

/**
 * Resolve a per-platform file path, routing user-scoped files through the
 * active user's subdirectory with auto-migration fallback.
 */
function resolveFile(baseUrl: string, filename: string): string {
  if (!USER_SCOPED_FILES.has(filename)) {
    return getPlatformFile(baseUrl, filename);
  }

  const userId = getActiveUserRaw(baseUrl);
  if (userId) {
    const userPath = join(getUserDir(baseUrl, userId), filename);
    if (existsSync(userPath)) return userPath;
  }

  // Fallback: check platform root for legacy / partially-migrated files
  const legacyPath = getPlatformFile(baseUrl, filename);
  if (existsSync(legacyPath)) {
    // If legacy token.json exists, trigger full on-demand migration
    const legacyToken = getPlatformFile(baseUrl, "token.json");
    if (existsSync(legacyToken)) {
      migratePlatformToUserScoped(baseUrl);
      const migratedUser = getActiveUserRaw(baseUrl);
      if (migratedUser) {
        const migratedPath = join(getUserDir(baseUrl, migratedUser), filename);
        if (existsSync(migratedPath)) return migratedPath;
      }
    }
    // File exists at legacy root but no migration possible (e.g. token already migrated).
    // Return legacy path so the caller can still read it.
    return legacyPath;
  }

  if (userId) return join(getUserDir(baseUrl, userId), filename);
  return legacyPath;
}

// ---------------------------------------------------------------------------
// State helpers
// ---------------------------------------------------------------------------

function readState(): StoreState {
  return readJsonFile<StoreState>(getStateFilePath()) ?? {};
}

function writeState(state: StoreState): void {
  writeJsonFile(getStateFilePath(), state);
}

function normalizeAlias(value: string): string {
  return value.trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Migration: legacy flat files → platforms/<encoded>/
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Migration: flat platform dir → users/<userId>/ scoped layout
// ---------------------------------------------------------------------------

/** Extract userId from a TokenConfig (try idToken, then accessToken, fallback "default"). */
export function extractUserId(token: TokenConfig): string {
  if (token.idToken) {
    const sub = extractUserIdFromJwt(token.idToken);
    if (sub) return sub;
  }
  if (token.accessToken) {
    const sub = extractUserIdFromJwt(token.accessToken);
    if (sub) return sub;
  }
  return "default";
}

function migratePlatformToUserScoped(baseUrl: string): void {
  const platformDir = getPlatformDir(baseUrl);
  const usersDir = getUsersDirPath(baseUrl);
  const rootTokenFile = join(platformDir, "token.json");

  if (!existsSync(rootTokenFile) || existsSync(usersDir)) {
    return;
  }

  const token = readJsonFile<TokenConfig>(rootTokenFile);
  if (!token) return;

  const userId = extractUserId(token);
  const userDir = getUserDir(baseUrl, userId);
  ensureDir(userDir);

  renameSync(rootTokenFile, join(userDir, "token.json"));

  const rootConfigFile = join(platformDir, "config.json");
  if (existsSync(rootConfigFile)) {
    renameSync(rootConfigFile, join(userDir, "config.json"));
  }

  const rootContextLoaderFile = join(platformDir, "context-loader.json");
  if (existsSync(rootContextLoaderFile)) {
    renameSync(rootContextLoaderFile, join(userDir, "context-loader.json"));
  }

  const resolvedUrl = token.baseUrl || baseUrl;
  const state = readState();
  const activeUsers = { ...(state.activeUsers ?? {}) };
  activeUsers[resolvedUrl] = userId;
  writeState({ ...state, activeUsers });
}

function migrateAllPlatformsToUserScoped(): void {
  const platformsDir = getPlatformsDirPath();
  if (!existsSync(platformsDir)) return;

  for (const entry of readdirSync(platformsDir)) {
    const dirPath = join(platformsDir, entry);
    if (!statSync(dirPath).isDirectory()) continue;

    const rootToken = join(dirPath, "token.json");
    const usersDir = join(dirPath, "users");
    if (!existsSync(rootToken) || existsSync(usersDir)) continue;

    const token = readJsonFile<TokenConfig>(rootToken);
    if (!token?.baseUrl) continue;

    migratePlatformToUserScoped(token.baseUrl);
  }
}

// ---------------------------------------------------------------------------
// Store initialization
// ---------------------------------------------------------------------------

function ensureStoreReady(): void {
  ensureConfigDir();
  migrateLegacyFilesIfNeeded();
  migrateAllPlatformsToUserScoped();
}

// ---------------------------------------------------------------------------
// Active user management
// ---------------------------------------------------------------------------

/** Read active user from state without triggering ensureStoreReady (avoids recursion). */
function getActiveUserRaw(baseUrl: string): string | null {
  const state = readJsonFile<StoreState>(getStateFilePath()) ?? {};
  const userId = state.activeUsers?.[baseUrl];
  if (userId) return userId;

  // Fallback: scan users/ dir and pick the first one
  const usersDir = getUsersDirPath(baseUrl);
  if (!existsSync(usersDir)) return null;
  for (const entry of readdirSync(usersDir)) {
    const entryPath = join(usersDir, entry);
    if (statSync(entryPath).isDirectory() && existsSync(join(entryPath, "token.json"))) {
      return entry;
    }
  }
  return null;
}

/** Get the active userId for a platform. */
export function getActiveUser(baseUrl: string): string | null {
  ensureStoreReady();
  return getActiveUserRaw(baseUrl);
}

/** Set the active userId for a platform. */
export function setActiveUser(baseUrl: string, userId: string): void {
  ensureStoreReady();
  const state = readState();
  const activeUsers = { ...(state.activeUsers ?? {}) };
  activeUsers[baseUrl] = userId;
  writeState({ ...state, activeUsers });
}

/** List all user IDs stored under a platform. */
export function listUsers(baseUrl: string): string[] {
  ensureStoreReady();
  const usersDir = getUsersDirPath(baseUrl);
  if (!existsSync(usersDir)) return [];

  const users: string[] = [];
  for (const entry of readdirSync(usersDir)) {
    const entryPath = join(usersDir, entry);
    if (statSync(entryPath).isDirectory()) {
      users.push(entry);
    }
  }
  return users.sort();
}

/** Load a specific user's token (not necessarily the active user). */
export function loadUserTokenConfig(baseUrl: string, userId: string): TokenConfig | null {
  ensureStoreReady();
  return readJsonFile<TokenConfig>(join(getUserDir(baseUrl, userId), "token.json"));
}

export interface UserProfile {
  userId: string;
  username?: string;
  email?: string;
}

/**
 * List all user profiles for a platform, enriched with display names.
 *
 * Resolution order for username:
 *   1. ``displayName`` field persisted in token.json (set at login via /oauth2/userinfo)
 *   2. ``preferred_username`` or ``name`` decoded from id_token JWT
 */
export function listUserProfiles(baseUrl: string): UserProfile[] {
  const userIds = listUsers(baseUrl);
  return userIds.map((userId) => {
    const token = loadUserTokenConfig(baseUrl, userId);
    let username: string | undefined;
    let email: string | undefined;

    if (token?.displayName) {
      username = token.displayName;
    }

    if (token?.idToken) {
      const payload = decodeJwtPayload(token.idToken);
      if (payload) {
        if (!username) {
          if (typeof payload.preferred_username === "string") username = payload.preferred_username;
          else if (typeof payload.name === "string") username = payload.name;
        }
        if (typeof payload.email === "string") email = payload.email;
      }
    }
    return { userId, username, email };
  });
}

/** Resolve a user identifier (userId, username, or email) to a userId for the given platform.
 *  userId and username are matched case-sensitively; email is case-insensitive. */
export function resolveUserId(baseUrl: string, identifier: string): string | null {
  const users = listUsers(baseUrl);
  if (users.includes(identifier)) return identifier;

  const profiles = listUserProfiles(baseUrl);

  // Exact match on username (case-sensitive)
  const exact = profiles.find((p) => p.username === identifier);
  if (exact) return exact.userId;

  // Email match (case-insensitive per RFC 5321)
  const lower = identifier.toLowerCase();
  const byEmail = profiles.find((p) => p.email?.toLowerCase() === lower);
  return byEmail?.userId ?? null;
}

// ---------------------------------------------------------------------------
// Public API — platform & alias management
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Token config (user-scoped)
// ---------------------------------------------------------------------------

export function loadTokenConfig(baseUrl?: string): TokenConfig | null {
  ensureStoreReady();
  const targetBaseUrl = baseUrl ?? getCurrentPlatform();
  if (!targetBaseUrl) {
    return null;
  }
  return readJsonFile<TokenConfig>(resolveFile(targetBaseUrl, "token.json"));
}

export function saveTokenConfig(config: TokenConfig, userId?: string): void {
  ensureStoreReady();
  const resolvedUser = userId ?? extractUserId(config);
  const dir = getUserDir(config.baseUrl, resolvedUser);
  ensureDir(dir);
  writeJsonFile(join(dir, "token.json"), config);
  // When KWEAVER_USER is set the caller is doing a one-off operation;
  // don't change the persisted active user.
  if (!process.env.KWEAVER_USER) {
    setActiveUser(config.baseUrl, resolvedUser);
  }
}

// ---------------------------------------------------------------------------
// Client config (platform-level — shared across users)
// ---------------------------------------------------------------------------

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

export function deleteClientConfig(baseUrl: string): void {
  const filePath = getPlatformFile(baseUrl, "client.json");
  if (existsSync(filePath)) rmSync(filePath, { force: true });
}

// ---------------------------------------------------------------------------
// Context-loader config (user-scoped)
// ---------------------------------------------------------------------------

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
  const raw = readJsonFile<unknown>(resolveFile(targetBaseUrl, "context-loader.json"));
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
  const userId = getActiveUser(baseUrl);
  if (userId) {
    const dir = getUserDir(baseUrl, userId);
    ensureDir(dir);
    writeJsonFile(join(dir, "context-loader.json"), config);
  } else {
    ensurePlatformDir(baseUrl);
    writeJsonFile(getPlatformFile(baseUrl, "context-loader.json"), config);
  }
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
    const file = resolveFile(baseUrl, "context-loader.json");
    if (existsSync(file)) rmSync(file, { force: true });
    return;
  }

  let newCurrent = config.current;
  if (config.current === name) {
    newCurrent = newConfigs[0].name;
  }
  saveContextLoaderConfig(baseUrl, { configs: newConfigs, current: newCurrent });
}

// ---------------------------------------------------------------------------
// Platform existence / session management
// ---------------------------------------------------------------------------

export function hasPlatform(baseUrl: string): boolean {
  ensureStoreReady();
  const file = resolveFile(baseUrl, "token.json");
  if (existsSync(file)) return true;
  return listUsers(baseUrl).length > 0;
}

export function clearPlatformSession(baseUrl: string, userId?: string): void {
  ensureStoreReady();
  const target = userId ?? getActiveUser(baseUrl);
  if (target) {
    const tokenFile = join(getUserDir(baseUrl, target), "token.json");
    if (existsSync(tokenFile)) rmSync(tokenFile, { force: true });
    return;
  }
  // Fallback: legacy flat layout
  const legacyToken = getPlatformFile(baseUrl, "token.json");
  if (existsSync(legacyToken)) rmSync(legacyToken, { force: true });
}

/** Delete a single user's profile directory under a platform. */
export function deleteUser(baseUrl: string, userId: string): void {
  ensureStoreReady();
  const dir = getUserDir(baseUrl, userId);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });

  const state = readState();
  if (state.activeUsers?.[baseUrl] === userId) {
    const remaining = listUsers(baseUrl);
    const au = { ...(state.activeUsers ?? {}) };
    if (remaining.length > 0) {
      au[baseUrl] = remaining[0];
    } else {
      delete au[baseUrl];
    }
    writeState({ ...state, activeUsers: Object.keys(au).length > 0 ? au : undefined });
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
  const au = { ...(state.activeUsers ?? {}) };
  delete au[baseUrl];

  if (state.currentPlatform !== baseUrl) {
    writeState({ ...state, activeUsers: Object.keys(au).length > 0 ? au : undefined });
    return;
  }

  const remainingPlatforms = listPlatforms();
  writeState({
    ...readState(),
    currentPlatform: remainingPlatforms[0]?.baseUrl,
    activeUsers: Object.keys(au).length > 0 ? au : undefined,
  });
}

export function listPlatforms(): PlatformSummary[] {
  ensureStoreReady();
  const currentPlatform = getCurrentPlatform();
  const items: PlatformSummary[] = [];

  const platformsDir = getPlatformsDirPath();
  if (!existsSync(platformsDir)) return items;

  for (const entry of readdirSync(platformsDir)) {
    const dirPath = join(platformsDir, entry);
    if (!statSync(dirPath).isDirectory()) {
      continue;
    }

    // Try to find the baseUrl from any available token
    let baseUrl: string | null = null;

    // Check users/ subdirectory first (new layout)
    const usersDir = join(dirPath, "users");
    if (existsSync(usersDir)) {
      for (const userEntry of readdirSync(usersDir)) {
        const userTokenPath = join(usersDir, userEntry, "token.json");
        const userToken = readJsonFile<TokenConfig>(userTokenPath);
        if (userToken?.baseUrl) {
          baseUrl = userToken.baseUrl;
          break;
        }
      }
    }

    // Fallback: legacy flat layout
    if (!baseUrl) {
      const token = readJsonFile<TokenConfig>(join(dirPath, "token.json"));
      if (token?.baseUrl) {
        baseUrl = token.baseUrl;
      }
    }

    // Fallback: client.json
    if (!baseUrl) {
      const client = readJsonFile<ClientConfig>(join(dirPath, "client.json"));
      if (client?.baseUrl) {
        baseUrl = client.baseUrl;
      }
    }

    if (!baseUrl) continue;

    const hasToken = existsSync(resolveFile(baseUrl, "token.json"));
    const activeUser = getActiveUserRaw(baseUrl);
    let displayName: string | undefined;
    if (activeUser) {
      const tok = loadUserTokenConfig(baseUrl, activeUser);
      if (tok?.displayName) displayName = tok.displayName;
    }

    items.push({
      baseUrl,
      hasToken,
      isCurrent: baseUrl === currentPlatform,
      alias: getPlatformAlias(baseUrl) ?? undefined,
      userId: activeUser ?? undefined,
      displayName,
    });
  }

  items.sort((a, b) => a.baseUrl.localeCompare(b.baseUrl));
  return items;
}

// ---------------------------------------------------------------------------
// Per-user platform config (businessDomain, etc.)
// ---------------------------------------------------------------------------

/** Per-platform config (not auth — general settings). */
export interface PlatformConfig {
  businessDomain?: string;
}

function loadPlatformConfig(baseUrl: string): PlatformConfig | null {
  ensureStoreReady();
  return readJsonFile<PlatformConfig>(resolveFile(baseUrl, "config.json"));
}

function savePlatformConfig(baseUrl: string, config: PlatformConfig): void {
  ensureStoreReady();
  const userId = getActiveUser(baseUrl);
  if (userId) {
    const dir = getUserDir(baseUrl, userId);
    ensureDir(dir);
    writeJsonFile(join(dir, "config.json"), config);
  } else {
    ensurePlatformDir(baseUrl);
    writeJsonFile(getPlatformFile(baseUrl, "config.json"), config);
  }
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

/**
 * Pick and persist a default business domain after login when none is configured.
 * Skips API calls when KWEAVER_BUSINESS_DOMAIN is set or config already has businessDomain.
 * Preference: bd_public if present in the list, else first item; empty list or failure → bd_public (not saved).
 */
export async function autoSelectBusinessDomain(
  baseUrl: string,
  accessToken: string,
  options?: { tlsInsecure?: boolean }
): Promise<string> {
  if (process.env.KWEAVER_BUSINESS_DOMAIN) {
    return process.env.KWEAVER_BUSINESS_DOMAIN;
  }
  const configured = loadPlatformBusinessDomain(baseUrl);
  if (configured) {
    return configured;
  }
  try {
    const list = await listBusinessDomains({
      baseUrl,
      accessToken,
      tlsInsecure: options?.tlsInsecure,
    });
    let selected: string;
    if (list.some((d) => d.id === "bd_public")) {
      selected = "bd_public";
    } else if (list.length > 0 && list[0].id) {
      selected = list[0].id;
    } else {
      return "bd_public";
    }
    savePlatformBusinessDomain(baseUrl, selected);
    return selected;
  } catch (error) {
    // Endpoint may be unavailable on this deployment or for this account
    // type — fall back silently. Set KWEAVER_DEBUG=1 to surface the
    // underlying error during diagnostics.
    if (process.env.KWEAVER_DEBUG) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Business domain list unavailable (${message}); defaulting to bd_public.`);
    }
    return "bd_public";
  }
}
