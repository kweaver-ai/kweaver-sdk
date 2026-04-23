# Auth Login Playwright Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `kweaver auth login` OAuth2 code flow with Playwright headless browser login so tokens work with BKN/DS APIs.

**Architecture:** Playwright navigates to dip-hub login page, fills credentials, extracts `dip.oauth2_token` cookie, stores as `token.json`. All OAuth2 client registration, callback server, and refresh logic is removed. Token valid for 1 hour, no auto-refresh.

**Tech Stack:** TypeScript, Playwright (peerDependency), Node.js readline

**Spec:** `docs/superpowers/specs/2026-03-21-auth-login-playwright-design.md`

---

### Task 1: Update `store.ts` — remove `ClientConfig` dependency from `hasPlatform` and `listPlatforms`

**Files:**
- Modify: `packages/typescript/src/config/store.ts:456-525`
- Modify: `packages/typescript/src/config/store.ts:387-405` (`getCurrentContextLoaderKn`)
- Modify: `packages/typescript/test/store.test.ts`

- [ ] **Step 1: Update `hasPlatform()` to check `token.json` instead of `client.json`**

```typescript
// store.ts:456-459
export function hasPlatform(baseUrl: string): boolean {
  ensureStoreReady();
  return existsSync(getPlatformFile(baseUrl, "token.json"));
}
```

- [ ] **Step 2: Update `listPlatforms()` to read `baseUrl` from `token.json` instead of `client.json`**

```typescript
// store.ts:499-525
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
```

- [ ] **Step 3: Update `getCurrentContextLoaderKn()` to use `loadTokenConfig` instead of `loadClientConfig`**

```typescript
// store.ts:387-405
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
```

- [ ] **Step 4: Update `clearPlatformSession()` to only remove `token.json` (no more `callback.json`)**

```typescript
// store.ts:465-475
export function clearPlatformSession(baseUrl: string): void {
  ensureStoreReady();
  const tokenFile = getPlatformFile(baseUrl, "token.json");
  if (existsSync(tokenFile)) {
    rmSync(tokenFile, { force: true });
  }
}
```

- [ ] **Step 5: Update tests in `store.test.ts`**

Every test that creates a platform must call `saveTokenConfig` (not just `saveClientConfig`) because `hasPlatform()`, `listPlatforms()`, and `getCurrentContextLoaderKn()` now read `token.json`. For each test:

- **"store saves multiple platforms" (line 18)**: Add `saveTokenConfig` for `adp.aishu.cn` (it already has one for `dip.aishu.cn`). Update `listPlatforms` assertion: both platforms now have `hasToken: true`.
- **"store supports aliases" (line 72)**: Add `saveTokenConfig` for `dip.aishu.cn` so `hasPlatform` returns true.
- **"store deletes platform" (line 105)**: Add `saveTokenConfig` for `adp.aishu.cn` so `deletePlatform` can find the next current platform.
- **"store context-loader" tests (lines 200-310)**: In every test that calls `saveClientConfig` + `getCurrentContextLoaderKn`, add a matching `saveTokenConfig` call with the same `baseUrl`. The `getCurrentContextLoaderKn` function now reads `loadTokenConfig` instead of `loadClientConfig`, so without `token.json` it returns `null`.
- **"store migrates legacy" (line 144)**: Replace `loadClientConfig`/`loadCallbackSession` assertions — handled in Task 4 Step 5.

- [ ] **Step 6: Run tests**

Run: `cd packages/typescript && node --import tsx --test test/store.test.ts`
Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/typescript/src/config/store.ts packages/typescript/test/store.test.ts
git commit -m "refactor(store): use token.json instead of client.json for platform detection"
```

---

### Task 2: Rewrite `oauth.ts` — replace OAuth2 flow with Playwright login

**Files:**
- Modify: `packages/typescript/src/auth/oauth.ts`

- [ ] **Step 1: Remove all OAuth2-specific functions and types**

Delete the following functions and interfaces (keeping `normalizeBaseUrl`, `formatHttpError`, `formatOAuthErrorBody`):

- `RegisterClientOptions` interface
- `TokenResponse` interface
- `EnsureClientOptions` interface
- `EnsuredClientConfig` interface
- `AuthRedirectConfig` interface
- `AuthLoginOptions` interface
- `randomValue()`
- `getAuthorizationSuccessMessage()`
- `toBasicAuth()`
- `buildTokenConfig()`
- `registerClient()`
- `toSuccessfulLogoutPath()`
- `normalizeListenHost()`
- `buildAuthRedirectConfig()`
- `ensureClientConfig()`
- `buildAuthorizationUrl()`
- `waitForAuthorizationCode()`
- `exchangeAuthorizationCode()`
- `callLogoutEndpoint()`
- `refreshAccessToken()`
- `getStoredAuthSummary()`
- `login()`

Remove imports that are no longer needed: `createServer`, `randomBytes`, `URL`, `openBrowser`, and all `ClientConfig`/`CallbackSession` related imports from store.

- [ ] **Step 2: Write `playwrightLogin()` function**

```typescript
import {
  type TokenConfig,
  getCurrentPlatform,
  loadTokenConfig,
  saveTokenConfig,
  setCurrentPlatform,
} from "../config/store.js";
import { HttpError, NetworkRequestError } from "../utils/http.js";

const TOKEN_TTL_SECONDS = 3600;

export function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

export async function playwrightLogin(
  baseUrl: string,
  username: string,
  password: string,
): Promise<TokenConfig> {
  let chromium: typeof import("playwright").chromium;
  try {
    const pw = await import("playwright");
    chromium = pw.chromium;
  } catch {
    throw new Error(
      "Playwright is not installed. Run:\n  npm install playwright && npx playwright install chromium"
    );
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(`${baseUrl}/api/dip-hub/v1/login`, {
      waitUntil: "networkidle",
      timeout: 30_000,
    });

    await page.waitForSelector('input[name="account"]', { timeout: 10_000 });
    await page.fill('input[name="account"]', username);
    await page.fill('input[name="password"]', password);
    await page.click("button.ant-btn-primary");

    let accessToken: string | null = null;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000));

      // Check for login error messages
      const errorEl = await page.$(".ant-message-error, .ant-alert-error");
      if (errorEl) {
        const errorText = await errorEl.textContent();
        throw new Error(`Login failed: ${errorText?.trim() || "unknown error"}`);
      }

      for (const cookie of await context.cookies()) {
        if (cookie.name === "dip.oauth2_token") {
          accessToken = decodeURIComponent(cookie.value);
          break;
        }
      }
      if (accessToken) break;
    }

    if (!accessToken) {
      throw new Error(
        "Login timed out: dip.oauth2_token cookie not received within 30 seconds. " +
        "Check username/password."
      );
    }

    const now = new Date();
    const tokenConfig: TokenConfig = {
      baseUrl,
      accessToken,
      tokenType: "bearer",
      scope: "",
      expiresIn: TOKEN_TTL_SECONDS,
      expiresAt: new Date(now.getTime() + TOKEN_TTL_SECONDS * 1000).toISOString(),
      obtainedAt: now.toISOString(),
    };

    saveTokenConfig(tokenConfig);
    setCurrentPlatform(baseUrl);
    return tokenConfig;
  } finally {
    await browser.close();
  }
}
```

- [ ] **Step 3: Rewrite `ensureValidToken()`**

When `forceRefresh` is true, always throw — there is no refresh mechanism anymore.

```typescript
export async function ensureValidToken(opts?: { forceRefresh?: boolean }): Promise<TokenConfig> {
  const envToken = process.env.KWEAVER_TOKEN;
  const envBaseUrl = process.env.KWEAVER_BASE_URL;
  if (!opts?.forceRefresh && envToken && envBaseUrl) {
    const rawToken = envToken.replace(/^Bearer\s+/i, "");
    return {
      baseUrl: normalizeBaseUrl(envBaseUrl),
      accessToken: rawToken,
      tokenType: "bearer",
      scope: "",
      obtainedAt: new Date().toISOString(),
    };
  }

  const currentPlatform = getCurrentPlatform();
  if (!currentPlatform) {
    throw new Error("No active platform selected. Run `kweaver auth login <platform-url>` first.");
  }

  if (opts?.forceRefresh) {
    throw new Error(
      `Token refresh is not supported. Run \`kweaver auth login ${currentPlatform}\` again.`
    );
  }

  const token = loadTokenConfig(currentPlatform);
  if (!token) {
    throw new Error(
      `No saved token for ${currentPlatform}. Run \`kweaver auth login ${currentPlatform}\` first.`
    );
  }

  if (token.expiresAt) {
    const expiresAtMs = Date.parse(token.expiresAt);
    if (!Number.isNaN(expiresAtMs) && expiresAtMs - 60_000 <= Date.now()) {
      throw new Error(
        `Access token expired. Run \`kweaver auth login ${currentPlatform}\` again.`
      );
    }
  }

  return token;
}
```

- [ ] **Step 4: Simplify `withTokenRetry()`**

```typescript
export async function withTokenRetry<T>(
  fn: (token: TokenConfig) => Promise<T>,
): Promise<T> {
  const token = await ensureValidToken();
  try {
    return await fn(token);
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) {
      const platform = token.baseUrl;
      throw new Error(
        `Authentication failed (401). Token may be expired or revoked.\n` +
        `Run \`kweaver auth login ${platform}\` again.`
      );
    }
    throw error;
  }
}
```

- [ ] **Step 5: Keep `formatHttpError()` and `formatOAuthErrorBody()` unchanged**

These are still used for error formatting. No changes needed.

- [ ] **Step 6: Run build to check for compile errors**

Run: `cd packages/typescript && npx tsc --noEmit`
Expected: No errors (some may occur from auth.ts — fixed in Task 3).

- [ ] **Step 7: Commit**

```bash
git add packages/typescript/src/auth/oauth.ts
git commit -m "feat(auth): replace OAuth2 code flow with Playwright browser login"
```

---

### Task 3: Update `auth.ts` command — simplify login and status flows

**Files:**
- Modify: `packages/typescript/src/commands/auth.ts`

- [ ] **Step 1: Replace imports and rewrite login flow**

```typescript
import {
  clearPlatformSession,
  deletePlatform,
  getConfigDir,
  getCurrentPlatform,
  getPlatformAlias,
  hasPlatform,
  listPlatforms,
  loadTokenConfig,
  resolvePlatformIdentifier,
  setCurrentPlatform,
  setPlatformAlias,
} from "../config/store.js";
import type { TokenConfig } from "../config/store.js";
import {
  ensureValidToken,
  formatHttpError,
  normalizeBaseUrl,
  playwrightLogin,
} from "../auth/oauth.js";
import { createInterface } from "node:readline";

function promptInput(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function promptPassword(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    // Mute output for password
    const origWrite = process.stdout.write.bind(process.stdout);
    let prompted = false;
    process.stdout.write = ((chunk: any, ...args: any[]) => {
      if (!prompted && typeof chunk === "string" && chunk.includes(question)) {
        prompted = true;
        return origWrite(chunk, ...args);
      }
      if (prompted) return true as any;
      return origWrite(chunk, ...args);
    }) as typeof process.stdout.write;
    rl.question(question, (answer) => {
      process.stdout.write = origWrite;
      console.log(); // newline
      rl.close();
      resolve(answer);
    });
  });
}
```

- [ ] **Step 2: Rewrite the login branch (URL-as-target)**

Replace the block at lines 97-148 (the `target && target !== "status" && ...` branch):

```typescript
  if (target && target !== "status" && target !== "list" && target !== "use" && target !== "delete" && target !== "logout") {
    try {
      const normalizedTarget = normalizeBaseUrl(target);
      const alias = readOption(args, "--alias");

      const username = await promptInput("Username: ");
      const password = await promptPassword("Password: ");

      if (!username || !password) {
        console.error("Username and password are required.");
        return 1;
      }

      console.log("Logging in...");
      const token = await playwrightLogin(normalizedTarget, username, password);

      if (alias) {
        setPlatformAlias(normalizedTarget, alias);
      }

      console.log(`Config directory: ${getConfigDir()}`);
      if (alias) {
        console.log(`Alias: ${alias.toLowerCase()}`);
      } else {
        const savedAlias = getPlatformAlias(normalizedTarget);
        if (savedAlias) {
          console.log(`Alias: ${savedAlias}`);
        }
      }
      console.log(`Current platform: ${normalizedTarget}`);
      console.log(`Access token saved: yes`);
      if (token.expiresAt) {
        console.log(`Token expires at: ${token.expiresAt}`);
      }
      return 0;
    } catch (error) {
      console.error(formatHttpError(error));
      return 1;
    }
  }
```

- [ ] **Step 3: Rewrite `auth status` to use token-only data**

Replace the status block (lines 150-181):

```typescript
  if (target === "status") {
    const resolvedTarget = args[1] ? resolvePlatformIdentifier(args[1]) : undefined;
    const statusTarget =
      resolvedTarget && /^https?:\/\//.test(resolvedTarget) ? normalizeBaseUrl(resolvedTarget) : resolvedTarget ?? undefined;

    const platform = statusTarget ?? getCurrentPlatform();
    if (!platform) {
      console.error("No active platform. Run `kweaver auth login <platform-url>` first.");
      return 1;
    }

    const token = loadTokenConfig(platform);
    if (!token) {
      console.error(
        statusTarget ? `No saved token for ${statusTarget}.` : "No saved token found."
      );
      return 1;
    }

    const currentPlatform = getCurrentPlatform();
    const lines = [
      `Config directory: ${getConfigDir()}`,
      `Platform: ${token.baseUrl}`,
      `Current platform: ${token.baseUrl === currentPlatform ? "yes" : "no"}`,
      `Token present: yes`,
    ];

    if (token.expiresAt) {
      const expiry = new Date(token.expiresAt);
      const remainingMs = expiry.getTime() - Date.now();
      if (remainingMs > 0) {
        const remainingMin = Math.ceil(remainingMs / 60_000);
        lines.push(`Token status: active (expires in ${remainingMin} min)`);
      } else {
        lines.push(`Token status: expired (run \`kweaver auth login ${token.baseUrl}\` again)`);
      }
    }

    for (const line of lines) {
      console.log(line);
    }
    return 0;
  }
```

- [ ] **Step 4: Simplify `auth logout` — remove server-side signout**

Replace the logout block (lines 240-261):

```typescript
  if (target === "logout") {
    const resolvedTarget = args[1] ? resolvePlatformIdentifier(args[1]) : getCurrentPlatform();
    const logoutTarget =
      resolvedTarget && /^https?:\/\//.test(resolvedTarget) ? normalizeBaseUrl(resolvedTarget) : resolvedTarget;
    if (!logoutTarget) {
      console.error("Usage: kweaver auth logout [platform-url|alias]");
      console.error("No current platform. Specify a platform to logout.");
      return 1;
    }
    if (!hasPlatform(logoutTarget)) {
      console.error(`No saved token for ${logoutTarget}.`);
      return 1;
    }
    clearPlatformSession(logoutTarget);
    console.log(`Logged out: ${logoutTarget}`);
    console.log(`Run \`kweaver auth login ${logoutTarget}\` to sign in again.`);
    return 0;
  }
```

- [ ] **Step 5: Remove unused imports and functions**

Remove:
- `getClientProvisioningMessage()`
- `formatAuthStatusSummary()`
- Import of `callLogoutEndpoint`, `getStoredAuthSummary`, `login` from oauth
- Import of `CallbackSession`, `ClientConfig` from store

- [ ] **Step 6: Update help text**

```typescript
  if (!target || target === "--help" || target === "-h") {
    console.log(`kweaver auth login <url>     Login to a platform (browser login)
kweaver auth <url>           Login (shorthand)
kweaver auth status [url]    Show current auth status
kweaver auth list            List saved platforms
kweaver auth use <url>       Switch active platform
kweaver auth logout [url]    Logout (clear local token)
kweaver auth delete <url>    Delete saved credentials`);
    return 0;
  }
```

- [ ] **Step 7: Update usage error messages at the bottom**

```typescript
  console.error("Usage: kweaver auth login <platform-url>");
  console.error("       kweaver auth <platform-url> [--alias <name>]");
  console.error("       kweaver auth status [platform-url|alias]");
  console.error("       kweaver auth list");
  console.error("       kweaver auth use <platform-url|alias>");
  console.error("       kweaver auth logout [platform-url|alias]");
  console.error("       kweaver auth delete <platform-url|alias>");
  return 1;
```

- [ ] **Step 8: Run build**

Run: `cd packages/typescript && npx tsc --noEmit`
Expected: No compile errors.

- [ ] **Step 9: Commit**

```bash
git add packages/typescript/src/commands/auth.ts
git commit -m "refactor(auth): simplify auth commands for Playwright login"
```

---

### Task 4: Remove unused exports from `store.ts` and fix downstream references

**Files:**
- Modify: `packages/typescript/src/config/store.ts`
- Modify: `packages/typescript/src/client.ts`
- Modify: `packages/typescript/src/index.ts`
- Modify: `packages/typescript/test/store.test.ts`

- [ ] **Step 1: Remove `ClientConfig` interface, `CallbackSession` interface, and related functions from `store.ts`**

Remove:
- `ClientConfig` interface (lines 14-24)
- `CallbackSession` interface (lines 38-45)
- `loadClientConfig()` function (lines 287-294)
- `saveClientConfig()` function (lines 296-300)
- `loadCallbackSession()` function (lines 317-324)
- `saveCallbackSession()` function (lines 326-330)

Keep the legacy migration function `migrateLegacyFilesIfNeeded()` as-is — it uses local type casts internally and doesn't export `ClientConfig`.

- [ ] **Step 2: Remove `loadClientConfig` import from `src/client.ts`**

```typescript
// client.ts:1-5 — change to:
import {
  getCurrentPlatform,
  loadTokenConfig,
} from "./config/store.js";
```

- [ ] **Step 3: Remove `ClientConfig` re-export from `src/index.ts`**

In `src/index.ts` line 175, remove `ClientConfig` from the re-export block. The remaining exports (`TokenConfig`, `ContextLoaderEntry`, `ContextLoaderConfig`) stay.

- [ ] **Step 4: Update `KWeaverClient.connect()` in `src/client.ts`**

The force-refresh retry path (lines 187-195) is now broken since `ensureValidToken({ forceRefresh: true })` always throws. Simplify the 401 probe handling to throw directly:

```typescript
    if (probe.status === 401) {
      throw new Error(
        `Access token revoked. Run \`kweaver auth login\` to re-authenticate.`
      );
    }
```

- [ ] **Step 5: Update legacy migration test in `store.test.ts`**

The test "store migrates legacy single-platform files automatically" (line 144) asserts on `loadClientConfig` and `loadCallbackSession`. Replace these assertions with `loadTokenConfig`-based checks:

```typescript
// Replace:
assert.equal(store.loadClientConfig()?.clientId, "legacy-client");
assert.equal(store.loadCallbackSession()?.code, "legacy-code");
// With:
assert.equal(store.loadTokenConfig()?.accessToken, "legacy-token");
```

Also remove `loadCallbackSession` from `listPlatforms` assertion since platforms now require `token.json`.

- [ ] **Step 6: Check for remaining references**

Run: `cd packages/typescript && grep -rn "ClientConfig\|CallbackSession\|saveClientConfig\|loadClientConfig\|loadCallbackSession\|saveCallbackSession" src/ test/`

Fix any remaining references found.

- [ ] **Step 7: Run all tests**

Run: `cd packages/typescript && node --import tsx --test test/store.test.ts test/config-store.test.ts`
Expected: All pass.

- [ ] **Step 8: Run full build**

Run: `cd packages/typescript && npx tsc --noEmit`
Expected: No compile errors.

- [ ] **Step 9: Commit**

```bash
git add packages/typescript/src/config/store.ts packages/typescript/src/client.ts packages/typescript/src/index.ts packages/typescript/test/store.test.ts
git commit -m "refactor(store): remove ClientConfig and CallbackSession types, fix downstream refs"
```

---

### Task 5: Add `playwright` as peerDependency

**Files:**
- Modify: `packages/typescript/package.json`

- [ ] **Step 1: Add peerDependency**

Add to `peerDependencies` section (create if absent):

```json
"peerDependencies": {
  "playwright": ">=1.40.0"
},
"peerDependenciesMeta": {
  "playwright": {
    "optional": true
  }
}
```

- [ ] **Step 2: Run build to verify nothing breaks**

Run: `cd packages/typescript && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add packages/typescript/package.json
git commit -m "chore: add playwright as optional peerDependency"
```

---

### Task 6: Update skill documentation

**Files:**
- Modify: `skills/kweaver/references/auth.md`
- Modify: `skills/kweaver/SKILL.md`

- [ ] **Step 1: Rewrite `skills/kweaver/references/auth.md`**

```markdown
# 认证命令参考

平台认证管理。凭据存储在 `~/.kweaver/`。

## 前提

```bash
npm install playwright && npx playwright install chromium
```

## 命令

```bash
kweaver auth login <url> [--alias <name>]      # 输入账号密码登录
kweaver auth <url> [--alias <name>]             # 同上（简写）
kweaver auth logout [<platform>]                 # 登出（清除本地 token）
kweaver auth status                              # 查看 token 状态
kweaver auth list                                # 列出已保存的平台
kweaver auth use <platform>                      # 切换平台（URL 或 alias）
kweaver auth delete <platform> [-y]              # 删除平台凭证
```

## 说明

- `login` 通过 Playwright headless 浏览器完成登录，提取平台 token
- Token 有效期 1 小时，过期后需重新 `auth login`
- 不支持自动刷新
- 支持多平台，用 `--alias` 设置短名称方便切换

## 示例

```bash
kweaver auth login https://kweaver.example.com --alias prod
kweaver auth login https://kweaver-dev.example.com --alias dev
kweaver auth list
kweaver auth use prod
kweaver auth status
```
```

- [ ] **Step 2: Update `skills/kweaver/SKILL.md` 注意事项**

Add to the 注意事项 section:

```markdown
- Token 1 小时过期，**不支持自动刷新**。过期后需要用户重新运行 `kweaver auth login <url>`。遇到 401 错误时提示用户重新登录，**禁止自动重试 `auth login`**
```

Replace the existing token-related bullet:
```
- Token 1 小时过期，CLI 自动刷新；遇到 401 会自动重试一次，无需手动干预
- 仅当 refresh token 也失效（自动重试仍报 401）时，才提示用户 `kweaver auth login`
```

- [ ] **Step 3: Commit**

```bash
git add skills/kweaver/references/auth.md skills/kweaver/SKILL.md
git commit -m "docs(skill): update auth docs for Playwright login"
```

---

### Task 7: Manual verification on live platform

**Files:** None (manual testing)

- [ ] **Step 1: Login**

Run: `kweaver auth login https://dip-poc.aishu.cn`
Enter: `kweaver` / `111111`
Expected: "Access token saved: yes"

- [ ] **Step 2: Verify BKN API works**

Run: `kweaver bkn list`
Expected: 200 response (not 401 "oauth info is not active")

- [ ] **Step 3: Check auth status**

Run: `kweaver auth status`
Expected: Shows platform URL, token status active with remaining minutes

- [ ] **Step 4: Test logout and re-login**

Run: `kweaver auth logout`
Run: `kweaver bkn list`
Expected: Error "No saved token"

Run: `kweaver auth login https://dip-poc.aishu.cn`
Expected: Login succeeds again

- [ ] **Step 5: Commit verification script cleanup**

```bash
git rm scripts/verify-diphub-auth.ts
git commit -m "chore: remove auth verification script"
```
