import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

function createStoreDir(): string {
  return mkdtempSync(join(tmpdir(), "kweaver-store-"));
}

async function importStoreModule(configDir: string) {
  process.env.KWEAVERC_CONFIG_DIR = configDir;
  const moduleUrl = pathToFileURL(join(process.cwd(), "src/config/store.ts")).href;
  return import(`${moduleUrl}?t=${Date.now()}-${Math.random()}`);
}

test("store saves multiple platforms and switches current platform", async () => {
  const configDir = createStoreDir();
  const store = await importStoreModule(configDir);

  store.saveTokenConfig({
    baseUrl: "https://dip.aishu.cn",
    accessToken: "token-a",
    tokenType: "bearer",
    scope: "openid offline all",
    obtainedAt: "2026-03-11T00:00:00.000Z",
  });
  store.setCurrentPlatform("https://dip.aishu.cn");

  store.saveTokenConfig({
    baseUrl: "https://adp.aishu.cn",
    accessToken: "token-b",
    tokenType: "bearer",
    scope: "openid offline all",
    obtainedAt: "2026-03-11T00:00:00.000Z",
  });

  assert.equal(store.getCurrentPlatform(), "https://dip.aishu.cn");
  assert.equal(store.loadTokenConfig("https://dip.aishu.cn")?.accessToken, "token-a");
  assert.equal(store.loadTokenConfig("https://adp.aishu.cn")?.accessToken, "token-b");

  store.setCurrentPlatform("https://adp.aishu.cn");

  assert.equal(store.getCurrentPlatform(), "https://adp.aishu.cn");
  assert.equal(store.loadTokenConfig()?.baseUrl, "https://adp.aishu.cn");

  const platforms = store.listPlatforms();
  assert.equal(platforms.length, 2);
  assert.deepEqual(
    platforms.map((item: { baseUrl: string; hasToken: boolean; isCurrent: boolean }) => ({
      baseUrl: item.baseUrl,
      hasToken: item.hasToken,
      isCurrent: item.isCurrent,
    })),
    [
      { baseUrl: "https://adp.aishu.cn", hasToken: true, isCurrent: true },
      { baseUrl: "https://dip.aishu.cn", hasToken: true, isCurrent: false },
    ]
  );
});

test("store supports aliases and resolves them to platform urls", async () => {
  const configDir = createStoreDir();
  const store = await importStoreModule(configDir);

  store.saveTokenConfig({
    baseUrl: "https://dip.aishu.cn",
    accessToken: "token-a",
    tokenType: "bearer",
    scope: "openid offline all",
    obtainedAt: "2026-03-11T00:00:00.000Z",
  });
  store.setPlatformAlias("https://dip.aishu.cn", "dip");

  assert.equal(store.getPlatformAlias("https://dip.aishu.cn"), "dip");
  assert.equal(store.resolvePlatformIdentifier("dip"), "https://dip.aishu.cn");
  assert.equal(store.resolvePlatformIdentifier("https://dip.aishu.cn"), "https://dip.aishu.cn");

  assert.throws(
    () => store.setPlatformAlias("https://adp.aishu.cn", "dip"),
    /already assigned/
  );
});

test("store deletes platform data aliases and resets current platform", async () => {
  const configDir = createStoreDir();
  const store = await importStoreModule(configDir);

  store.saveTokenConfig({
    baseUrl: "https://dip.aishu.cn",
    accessToken: "token-a",
    tokenType: "bearer",
    scope: "openid offline all",
    obtainedAt: "2026-03-11T00:00:00.000Z",
  });
  store.setPlatformAlias("https://dip.aishu.cn", "dip");
  store.setCurrentPlatform("https://dip.aishu.cn");

  store.saveTokenConfig({
    baseUrl: "https://adp.aishu.cn",
    accessToken: "token-b",
    tokenType: "bearer",
    scope: "openid offline all",
    obtainedAt: "2026-03-11T00:00:00.000Z",
  });

  store.deletePlatform("https://dip.aishu.cn");

  assert.equal(store.hasPlatform("https://dip.aishu.cn"), false);
  assert.equal(store.getPlatformAlias("https://dip.aishu.cn"), null);
  assert.equal(store.resolvePlatformIdentifier("dip"), "dip");
  assert.equal(store.getCurrentPlatform(), "https://adp.aishu.cn");
});

test("store migrates legacy single-platform files automatically", async () => {
  const configDir = createStoreDir();
  mkdirSync(configDir, { recursive: true });

  writeFileSync(
    join(configDir, "client.json"),
    JSON.stringify({
      baseUrl: "https://dip.aishu.cn",
      clientId: "legacy-client",
      clientSecret: "legacy-secret",
      redirectUri: "http://127.0.0.1:9010/callback",
      logoutRedirectUri: "http://127.0.0.1:9010/successful-logout",
      scope: "openid offline all",
    })
  );
  writeFileSync(
    join(configDir, "token.json"),
    JSON.stringify({
      baseUrl: "https://dip.aishu.cn",
      accessToken: "legacy-token",
      tokenType: "bearer",
      scope: "openid offline all",
      refreshToken: "legacy-refresh",
      obtainedAt: "2026-03-11T00:00:00.000Z",
    })
  );
  writeFileSync(
    join(configDir, "callback.json"),
    JSON.stringify({
      baseUrl: "https://dip.aishu.cn",
      redirectUri: "http://127.0.0.1:9010/callback",
      code: "legacy-code",
      state: "legacy-state",
      receivedAt: "2026-03-11T00:00:00.000Z",
    })
  );

  const store = await importStoreModule(configDir);

  assert.equal(store.getCurrentPlatform(), "https://dip.aishu.cn");
  assert.equal(store.loadTokenConfig()?.accessToken, "legacy-token");
  assert.deepEqual(
    store.listPlatforms().map(
      (item: { baseUrl: string; hasToken: boolean; isCurrent: boolean; alias?: string }) => ({
        baseUrl: item.baseUrl,
        hasToken: item.hasToken,
        isCurrent: item.isCurrent,
        alias: item.alias,
      })
    ),
    [{ baseUrl: "https://dip.aishu.cn", hasToken: true, isCurrent: true, alias: undefined }]
  );
});

test("store saves and loads context-loader config per platform", async () => {
  const configDir = createStoreDir();
  const store = await importStoreModule(configDir);

  store.saveTokenConfig({
    baseUrl: "https://dip.aishu.cn",
    accessToken: "token-x",
    tokenType: "bearer",
    scope: "",
    obtainedAt: "2026-03-11T00:00:00.000Z",
  });
  store.setCurrentPlatform("https://dip.aishu.cn");

  assert.equal(store.loadContextLoaderConfig(), null);

  store.addContextLoaderEntry("https://dip.aishu.cn", "default", "kn-123");

  const loaded = store.loadContextLoaderConfig();
  assert.ok(loaded);
  assert.equal(loaded.configs.length, 1);
  assert.equal(loaded.configs[0].name, "default");
  assert.equal(loaded.configs[0].knId, "kn-123");
  assert.equal(loaded.current, "default");

  const kn = store.getCurrentContextLoaderKn();
  assert.ok(kn);
  assert.equal(kn.mcpUrl, "https://dip.aishu.cn/api/agent-retrieval/v1/mcp");
  assert.equal(kn.knId, "kn-123");

  store.saveTokenConfig({
    baseUrl: "https://adp.aishu.cn",
    accessToken: "token-y",
    tokenType: "bearer",
    scope: "",
    obtainedAt: "2026-03-11T00:00:00.000Z",
  });
  store.setCurrentPlatform("https://adp.aishu.cn");

  assert.equal(store.loadContextLoaderConfig(), null);
  assert.equal(store.getCurrentContextLoaderKn(), null);

  const dipConfig = store.loadContextLoaderConfig("https://dip.aishu.cn");
  assert.ok(dipConfig);
  assert.equal(dipConfig.configs[0].knId, "kn-123");

  const dipKn = store.getCurrentContextLoaderKn("https://dip.aishu.cn");
  assert.ok(dipKn);
  assert.equal(dipKn.mcpUrl, "https://dip.aishu.cn/api/agent-retrieval/v1/mcp");
});

test("store context-loader supports multiple configs and switch", async () => {
  const configDir = createStoreDir();
  const store = await importStoreModule(configDir);

  store.saveTokenConfig({
    baseUrl: "https://dip.aishu.cn",
    accessToken: "token-x",
    tokenType: "bearer",
    scope: "",
    obtainedAt: "2026-03-11T00:00:00.000Z",
  });
  store.setCurrentPlatform("https://dip.aishu.cn");

  store.addContextLoaderEntry("https://dip.aishu.cn", "default", "kn-1");
  store.addContextLoaderEntry("https://dip.aishu.cn", "project-a", "kn-2");

  let kn = store.getCurrentContextLoaderKn();
  assert.equal(kn?.knId, "kn-1");

  store.setCurrentContextLoader("https://dip.aishu.cn", "project-a");
  kn = store.getCurrentContextLoaderKn();
  assert.equal(kn?.knId, "kn-2");

  store.removeContextLoaderEntry("https://dip.aishu.cn", "project-a");
  kn = store.getCurrentContextLoaderKn();
  assert.equal(kn?.knId, "kn-1");
});

test("store context-loader migrates legacy format", async () => {
  const configDir = createStoreDir();
  const store = await importStoreModule(configDir);

  store.saveTokenConfig({
    baseUrl: "https://dip.aishu.cn",
    accessToken: "token-x",
    tokenType: "bearer",
    scope: "",
    obtainedAt: "2026-03-11T00:00:00.000Z",
  });
  store.setCurrentPlatform("https://dip.aishu.cn");

  const enc = (s: string) =>
    Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  const rawPath = join(store.getConfigDir(), "platforms", enc("https://dip.aishu.cn"), "context-loader.json");
  writeFileSync(rawPath, JSON.stringify({ mcpUrl: "https://old.example.com/mcp", knId: "legacy-kn" }));

  const kn = store.getCurrentContextLoaderKn();
  assert.ok(kn);
  assert.equal(kn.knId, "legacy-kn");
  assert.equal(kn.mcpUrl, "https://dip.aishu.cn/api/agent-retrieval/v1/mcp");

  const config = store.loadContextLoaderConfig();
  assert.ok(config);
  assert.equal(config.configs.length, 1);
  assert.equal(config.configs[0].name, "default");
  assert.equal(config.configs[0].knId, "legacy-kn");
});

// ---------------------------------------------------------------------------
// Multi-account support tests
// ---------------------------------------------------------------------------

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.fake-signature`;
}

test("saveTokenConfig extracts userId from idToken and routes to user dir", async () => {
  const configDir = createStoreDir();
  const store = await importStoreModule(configDir);

  const idToken = makeJwt({ sub: "user-abc", iss: "https://auth.example.com" });
  store.saveTokenConfig({
    baseUrl: "https://platform.example.com",
    accessToken: "at-1",
    tokenType: "bearer",
    scope: "openid",
    idToken,
    obtainedAt: new Date().toISOString(),
  });

  assert.equal(store.getActiveUser("https://platform.example.com"), "user-abc");

  const loaded = store.loadTokenConfig("https://platform.example.com");
  assert.ok(loaded);
  assert.equal(loaded.accessToken, "at-1");
  assert.equal(loaded.idToken, idToken);
});

test("saveTokenConfig falls back to accessToken sub when no idToken", async () => {
  const configDir = createStoreDir();
  const store = await importStoreModule(configDir);

  const accessToken = makeJwt({ sub: "user-xyz" });
  store.saveTokenConfig({
    baseUrl: "https://platform.example.com",
    accessToken,
    tokenType: "bearer",
    scope: "",
    obtainedAt: new Date().toISOString(),
  });

  assert.equal(store.getActiveUser("https://platform.example.com"), "user-xyz");
});

test("saveTokenConfig uses 'default' when no JWT sub available", async () => {
  const configDir = createStoreDir();
  const store = await importStoreModule(configDir);

  store.saveTokenConfig({
    baseUrl: "https://platform.example.com",
    accessToken: "opaque-token",
    tokenType: "bearer",
    scope: "",
    obtainedAt: new Date().toISOString(),
  });

  assert.equal(store.getActiveUser("https://platform.example.com"), "default");
});

test("multiple users on same platform — listUsers, setActiveUser, switch", async () => {
  const configDir = createStoreDir();
  const store = await importStoreModule(configDir);
  const url = "https://multi.example.com";

  store.saveTokenConfig({
    baseUrl: url,
    accessToken: "at-alice",
    tokenType: "bearer",
    scope: "",
    idToken: makeJwt({ sub: "alice" }),
    obtainedAt: new Date().toISOString(),
  });

  store.saveTokenConfig({
    baseUrl: url,
    accessToken: "at-bob",
    tokenType: "bearer",
    scope: "",
    idToken: makeJwt({ sub: "bob" }),
    obtainedAt: new Date().toISOString(),
  });

  const users = store.listUsers(url);
  assert.deepEqual(users, ["alice", "bob"]);

  assert.equal(store.getActiveUser(url), "bob");
  assert.equal(store.loadTokenConfig(url)?.accessToken, "at-bob");

  store.setActiveUser(url, "alice");
  assert.equal(store.getActiveUser(url), "alice");
  assert.equal(store.loadTokenConfig(url)?.accessToken, "at-alice");
});

test("deleteUser removes user profile and switches active user", async () => {
  const configDir = createStoreDir();
  const store = await importStoreModule(configDir);
  const url = "https://del.example.com";

  store.saveTokenConfig({
    baseUrl: url,
    accessToken: "at-1",
    tokenType: "bearer",
    scope: "",
    idToken: makeJwt({ sub: "user-1" }),
    obtainedAt: new Date().toISOString(),
  });

  store.saveTokenConfig({
    baseUrl: url,
    accessToken: "at-2",
    tokenType: "bearer",
    scope: "",
    idToken: makeJwt({ sub: "user-2" }),
    obtainedAt: new Date().toISOString(),
  });

  assert.equal(store.getActiveUser(url), "user-2");
  store.deleteUser(url, "user-2");
  assert.deepEqual(store.listUsers(url), ["user-1"]);
  assert.equal(store.getActiveUser(url), "user-1");
});

test("migration from flat layout to user-scoped", async () => {
  const configDir = createStoreDir();
  mkdirSync(configDir, { recursive: true });

  const enc = (s: string) =>
    Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

  const url = "https://migrate.example.com";
  const platDir = join(configDir, "platforms", enc(url));
  mkdirSync(platDir, { recursive: true });

  const idToken = makeJwt({ sub: "migrated-user" });
  writeFileSync(join(platDir, "token.json"), JSON.stringify({
    baseUrl: url,
    accessToken: "at-migrate",
    tokenType: "bearer",
    scope: "",
    idToken,
    obtainedAt: new Date().toISOString(),
  }));
  writeFileSync(join(platDir, "config.json"), JSON.stringify({ businessDomain: "bd_test" }));
  writeFileSync(join(platDir, "client.json"), JSON.stringify({
    baseUrl: url,
    clientId: "cid",
    clientSecret: "csec",
  }));

  const store = await importStoreModule(configDir);

  // Flat layout should have been migrated
  assert.equal(store.getActiveUser(url), "migrated-user");
  assert.equal(store.loadTokenConfig(url)?.accessToken, "at-migrate");

  // client.json stays at platform root
  assert.ok(existsSync(join(platDir, "client.json")));
  // token.json should have moved to users/migrated-user/
  assert.ok(!existsSync(join(platDir, "token.json")));
  assert.ok(existsSync(join(platDir, "users", "migrated-user", "token.json")));
  assert.ok(existsSync(join(platDir, "users", "migrated-user", "config.json")));
});

test("listPlatforms includes userId", async () => {
  const configDir = createStoreDir();
  const store = await importStoreModule(configDir);

  store.saveTokenConfig({
    baseUrl: "https://platform.example.com",
    accessToken: "at-1",
    tokenType: "bearer",
    scope: "",
    idToken: makeJwt({ sub: "the-user" }),
    obtainedAt: new Date().toISOString(),
  });

  const platforms = store.listPlatforms();
  assert.equal(platforms.length, 1);
  assert.equal(platforms[0].userId, "the-user");
});

test("displayName is persisted and surfaced in listPlatforms and listUserProfiles", async () => {
  const configDir = createStoreDir();
  const store = await importStoreModule(configDir);

  store.saveTokenConfig({
    baseUrl: "https://display.example.com",
    accessToken: "at-display",
    tokenType: "bearer",
    scope: "",
    idToken: makeJwt({ sub: "uid-42" }),
    displayName: "alice",
    obtainedAt: new Date().toISOString(),
  });

  // listPlatforms should surface displayName
  const platforms = store.listPlatforms();
  assert.equal(platforms.length, 1);
  assert.equal(platforms[0].userId, "uid-42");
  assert.equal(platforms[0].displayName, "alice");

  // listUserProfiles should prefer displayName over id_token claims
  const profiles = store.listUserProfiles("https://display.example.com");
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].userId, "uid-42");
  assert.equal(profiles[0].username, "alice");

  // loadUserTokenConfig should contain displayName
  const token = store.loadUserTokenConfig("https://display.example.com", "uid-42");
  assert.equal(token.displayName, "alice");
});

test("deleteClientConfig removes cached client.json", async () => {
  const configDir = createStoreDir();
  const store = await importStoreModule(configDir);

  const baseUrl = "https://del-client.example.com";
  store.saveClientConfig(baseUrl, {
    baseUrl,
    clientId: "stale-cid",
    clientSecret: "stale-secret",
  });
  assert.ok(store.loadClientConfig(baseUrl));
  assert.equal(store.loadClientConfig(baseUrl)!.clientId, "stale-cid");

  store.deleteClientConfig(baseUrl);
  assert.equal(store.loadClientConfig(baseUrl), null);

  // Idempotent — calling again on missing file does not throw
  store.deleteClientConfig(baseUrl);
});

test("listUserProfiles falls back to id_token claims when no displayName", async () => {
  const configDir = createStoreDir();
  const store = await importStoreModule(configDir);

  store.saveTokenConfig({
    baseUrl: "https://fallback.example.com",
    accessToken: "at-fb",
    tokenType: "bearer",
    scope: "",
    idToken: makeJwt({ sub: "uid-99", preferred_username: "bob", email: "bob@example.com" }),
    obtainedAt: new Date().toISOString(),
  });

  const profiles = store.listUserProfiles("https://fallback.example.com");
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].username, "bob");
  assert.equal(profiles[0].email, "bob@example.com");
});
