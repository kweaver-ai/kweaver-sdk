# Auth Login: 从 OAuth2 Code Flow 切换到 Playwright 登录

## 问题

CLI 的 `kweaver auth login` 通过标准 OAuth2 Authorization Code Flow 拿到的 `access_token`（`ory_at_...`），调用 BKN/DS API 时返回 401：

```
{"error_code":"Public.Unauthorized","description":"认证失败","error_details":"oauth info is not active"}
```

而通过浏览器登录（dip-hub `/api/dip-hub/v1/login`）获取的 `dip.oauth2_token` cookie 调用同一 API 正常。两个 token 都由同一个 Ory Hydra 实例签发，前缀相同（`ory_at_...`），但 BKN/DS 的 API 网关只认浏览器登录路径产生的 token。

详细分析见 `docs/issues/kweaver-backend-api-issues.md` 第 5 项。

## 验证结果

通过 `scripts/verify-diphub-auth.ts` 在 `dip-poc.aishu.cn` 环境验证：

| 测试 | 结果 |
|------|------|
| Playwright 登录提取 `dip.oauth2_token` | ✅ 成功 |
| 用该 token 调 BKN API (`ontology-manager`) | ✅ 成功 (200) |
| 用 CLI 的 OAuth2 client refresh dip-hub 的 refresh_token | ❌ 失败 ("issued to another client") |
| 不带 client 直接 refresh | ❌ 失败 |

结论：Playwright 登录路径可行，但 refresh token 不能跨 client 使用。

## 方案

完全替换 `auth login` 的内部实现：从 OAuth2 code flow 改为 Playwright headless 浏览器登录。命令接口不变。

## 登录流程

```
kweaver auth login <url>
  → readline 提示输入账号密码（密码隐藏）
  → Playwright headless Chromium
  → 访问 {url}/api/dip-hub/v1/login (waitUntil: networkidle, timeout: 30s)
  → 填入 input[name="account"] + input[name="password"]
  → 点击 button.ant-btn-primary
  → 轮询 cookies（最多 30 次，每次 1s）
  → 提取 dip.oauth2_token（URL decode）
  → 存到 ~/.kweaver/platforms/{encoded-url}/token.json
  → 打印 "Login successful."
```

参照实现：Python SDK `PasswordAuth`（`packages/python/src/kweaver/_auth.py:31-103`）。

## 设计决策

### 密码不持久化

交互式 readline 提示输入，用完即丢。不存文件、不存环境变量。

### Token 过期处理

- Token 有效期 1 小时（dip-hub `cookie_timeout=3600`）
- 不支持自动刷新（refresh token 绑定 dip-hub 的 client，CLI 无法使用）
- 过期后 `ensureValidToken()` 报错：`"Access token expired (1-hour TTL). Run 'kweaver auth login <url>' again."`
- 对 OpenClaw 场景足够（单次任务通常几分钟到十几分钟）

### Playwright 依赖

- `playwright` 作为 `peerDependencies`
- lazy import：`await import("playwright")`
- 未安装时报明确错误：`"Playwright is not installed. Run: npm install playwright && npx playwright install chromium"`
- 不 fallback 到 OAuth2 flow（避免用户困惑：登录成功但 API 报 401）

## 改动范围

### `src/auth/oauth.ts`

- **新增** `playwrightLogin(baseUrl: string, username: string, password: string): Promise<TokenConfig>` 函数
  - Playwright headless 登录
  - `page.waitForSelector('input[name="account"]', { timeout: 10000 })` 确认页面加载
  - 提取 `dip.oauth2_token` cookie，URL decode
  - 构造 TokenConfig：`accessToken`, `tokenType: "bearer"`, `scope: ""`, `expiresAt = now + 3600s`, `obtainedAt`（不含 `refreshToken`、`idToken`）
  - 保存 token.json
  - 登录失败检测：点击登录后检查页面是否出现 `.ant-message-error` 或 `.ant-alert-error`，有则提取错误文本报给用户（如"账号或密码错误"）；30 秒内无 cookie 且无明确错误则报超时
- **删除** `registerClient()`、`ensureClientConfig()`、`buildAuthorizationUrl()`、`waitForAuthorizationCode()`、`exchangeAuthorizationCode()`、`refreshAccessToken()`、`callLogoutEndpoint()`、`buildTokenConfig()`
- **简化** `ensureValidToken()`：
  - 去掉 `loadClientConfig()` 依赖，只读 token.json
  - 检查 expiresAt → 未过期返回 → 过期报错（含平台 URL）：`"Access token expired. Run 'kweaver auth login <baseUrl>' again."`
  - `forceRefresh` 参数保留但行为改为直接报错（不再尝试 refresh）
- **简化** `withTokenRetry()`：401 时不再尝试 refresh，直接抛出带平台 URL 的过期提示
- **简化** `login()`：提示输入账号密码 → 调 `playwrightLogin()`
- `kweaver auth <url>` 简写形式保留，走同一个 Playwright 路径

### `src/commands/auth.ts`

- `login` 分支改为调新的 `login()` 函数
- 去掉 `--port`、`--host`、`--redirect-uri`、`--force-register`、`--no-open` 等 OAuth2 相关 flags
- 保留 `--alias`
- **`auth status`**：去掉 ClientConfig 相关字段显示（clientId、redirectUri），只显示 token 状态（平台 URL、过期时间、是否有效）
- **`auth logout`**：去掉 `callLogoutEndpoint()`（服务端 OAuth2 signout 不适用），只清理本地文件（token.json）
- **`auth list`**：改为扫描 `platforms/*/token.json` 而非 `client.json`

### `src/config/store.ts`

- token.json 结构不变（`accessToken`, `expiresAt`, `obtainedAt` 等），`tokenType` 固定 `"bearer"`，`scope` 为空
- 不再写入 `refreshToken`、`idToken`
- **删除** `saveClientConfig()`、`loadClientConfig()`、`saveCallbackSession()`、`loadCallbackSession()`
- **修改** `hasPlatform()`：从检查 `client.json` 改为检查 `token.json`
- **修改** `listPlatforms()`：从读 `client.json` 的 `baseUrl` 改为读 `token.json` 的 `baseUrl`
- 保留旧 `client.json` 文件不删除（忽略即可），无迁移逻辑

### `package.json`

- 加 `playwright` 为 `peerDependencies`

### 不变的部分

- `auth use`、`auth delete` 逻辑不变
- `token` 命令不变
- 所有 API 调用层不变（仍用 `Authorization: Bearer ${token}` + `token: ${token}` 双 header）
- `KWEAVER_TOKEN` + `KWEAVER_BASE_URL` 环境变量路径不变
- context-loader 配置读取不变（它只依赖 `token.json` 中的 `baseUrl`，不依赖 `client.json`）

## Skill 文档更新

### `skills/kweaver/references/auth.md`

- 更新 `login` 命令说明：从"浏览器 OAuth2 登录"改为"输入账号密码登录"
- 去掉 `--port` 等不再支持的参数
- 加安装前提：`npm install playwright && npx playwright install chromium`

### `skills/kweaver/SKILL.md`

- 注意事项加一条：token 过期后提示用户手动 `kweaver auth login`，禁止 agent 自动重试登录
