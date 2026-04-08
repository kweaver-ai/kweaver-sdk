import type { Server } from "node:http";
import {
  type ClientConfig,
  type TokenConfig,
  deleteClientConfig,
  getCurrentPlatform,
  loadClientConfig,
  loadTokenConfig,
  loadUserTokenConfig,
  resolveUserId,
  saveClientConfig,
  saveTokenConfig,
  setCurrentPlatform,
} from "../config/store.js";
import { HttpError, NetworkRequestError } from "../utils/http.js";

const TOKEN_TTL_SECONDS = 3600;

/** Seconds before access token expiry to trigger refresh (matches Python ConfigAuth). */
const REFRESH_THRESHOLD_SEC = 60;

const DEFAULT_REDIRECT_PORT = 9010;
const DEFAULT_SCOPE = "openid offline all";

/** Best-effort fetch of display name via EACP userinfo (ShareServer). */
async function fetchDisplayName(
  baseUrl: string,
  accessToken: string,
  tlsInsecure?: boolean,
): Promise<string | null> {
  try {
    const res = await runWithTlsInsecure(tlsInsecure, () =>
      fetch(`${baseUrl}/api/eacp/v1/user/get`, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      }),
    );
    if (!res.ok) return null;
    const info = (await res.json()) as Record<string, unknown>;
    if (typeof info.account === "string") return info.account;
    if (typeof info.name === "string") return info.name;
    if (typeof info.mail === "string") return info.mail;
  } catch {
    /* Non-critical — displayName will be absent. */
  }
  return null;
}

/** POSIX shell single-quote escaping for copy-paste commands. */
export function shellQuoteForShell(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Build a one-line `kweaver auth login ...` command for headless / other machines.
 * Omits `--client-secret` when empty (PKCE-only client); headless refresh may still require a confidential client.
 */
export function buildCopyCommand(
  baseUrl: string,
  clientId: string,
  clientSecret: string,
  refreshToken: string | undefined,
  tlsInsecure?: boolean,
): string {
  const parts = ["kweaver", "auth", "login", shellQuoteForShell(normalizeBaseUrl(baseUrl)), "--client-id", shellQuoteForShell(clientId)];
  if (clientSecret) {
    parts.push("--client-secret", shellQuoteForShell(clientSecret));
  }
  if (refreshToken) {
    parts.push("--refresh-token", shellQuoteForShell(refreshToken));
  }
  if (tlsInsecure) {
    parts.push("--insecure");
  }
  return parts.join(" ");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * HTML shown after successful OAuth callback with a copyable headless login command.
 */
export function buildCallbackHtml(copyCommand: string): string {
  const safeCmd = escapeHtml(copyCommand);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Login successful</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 52rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; }
    pre { background: #f4f4f5; padding: 1rem; border-radius: 6px; overflow-x: auto; white-space: pre-wrap; word-break: break-all; }
    button { margin-top: 0.75rem; padding: 0.5rem 1rem; cursor: pointer; }
    .warn { color: #b45309; margin-top: 1.5rem; font-size: 0.9rem; }
  </style>
</head>
<body>
  <h2>Login successful</h2>
  <p>You can close this tab.</p>
  <h3>Headless machine</h3>
  <p>On the computer that has no browser (SSH server, CI runner, container), run:</p>
  <pre id="kw-cmd">${safeCmd}</pre>
  <button type="button" id="kw-copy">Copy command</button>
  <p class="warn">Keep these credentials secure. Anyone with the refresh token and client secret can obtain new access tokens.</p>
  <script>
    (function () {
      var btn = document.getElementById("kw-copy");
      var pre = document.getElementById("kw-cmd");
      if (btn && pre) {
        btn.addEventListener("click", function () {
          var text = pre.textContent || "";
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text.trim()).then(function () {
              btn.textContent = "Copied";
              setTimeout(function () { btn.textContent = "Copy command"; }, 2000);
            });
          } else {
            window.prompt("Copy this command:", text.trim());
          }
        });
      }
    })();
  </script>
</body>
</html>`;
}

function buildCallbackExchangeErrorHtml(message: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><title>Login error</title></head>
<body><h2>Login error</h2><pre>${escapeHtml(message)}</pre></body></html>`;
}

export function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

/**
 * Temporarily disable TLS certificate verification for Node `fetch` (sets
 * NODE_TLS_REJECT_UNAUTHORIZED). Used for `--insecure` login and token refresh.
 */
async function runWithTlsInsecure<T>(tlsInsecure: boolean | undefined, fn: () => Promise<T>): Promise<T> {
  if (!tlsInsecure) {
    return fn();
  }
  const prev = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  try {
    return await fn();
  } finally {
    if (prev === undefined) {
      delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    } else {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = prev;
    }
  }
}

/** Generate a PKCE code_verifier and code_challenge (S256). */
async function generatePkce(): Promise<{ verifier: string; challenge: string }> {
  const { randomBytes, createHash } = await import("node:crypto");
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

/**
 * Pre-flight check: verify that a cached OAuth2 client is still recognised
 * by the server. Fetches the authorization endpoint with `redirect: "manual"`
 * and inspects the Location header. Returns false when Hydra redirects to an
 * error page containing `invalid_client` or similar indicators.
 */
async function isClientStillValid(
  baseUrl: string,
  clientId: string,
  redirectUri: string,
): Promise<boolean> {
  try {
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      scope: "openid",
      redirect_uri: redirectUri,
      state: "preflight",
    });
    const resp = await fetch(`${baseUrl}/oauth2/auth?${params}`, {
      redirect: "manual",
    });
    if (resp.status === 302) {
      const location = resp.headers.get("location") ?? "";
      if (
        location.includes("error=invalid_client") ||
        location.includes("error=error")
      ) {
        return false;
      }
      return true;
    }
    // Non-redirect — Hydra might serve an error page directly
    if (resp.status >= 400) return false;
    return true;
  } catch {
    // Network error — cannot pre-validate; let the real flow proceed
    return true;
  }
}

/**
 * Resolve a cached client or register a new one. When a cached client fails
 * pre-flight validation (stale registration after server reset), the local
 * client.json is deleted and a fresh registration is performed.
 */
async function resolveOrRegisterClient(
  baseUrl: string,
  redirectUri: string,
  scope: string,
  options?: { clientId?: string; clientSecret?: string },
): Promise<ClientConfig> {
  if (options?.clientId) {
    const client: ClientConfig = {
      baseUrl,
      clientId: options.clientId,
      clientSecret: options.clientSecret ?? "",
      redirectUri,
      logoutRedirectUri: redirectUri.replace("/callback", "/successful-logout"),
      scope,
      lang: "zh-cn",
      product: "adp",
      xForwardedPrefix: "",
    };
    saveClientConfig(baseUrl, client);
    return client;
  }

  let client = loadClientConfig(baseUrl);
  if (client?.clientId) {
    const valid = await isClientStillValid(baseUrl, client.clientId, redirectUri);
    if (valid) return client;

    process.stderr.write(
      "Cached OAuth2 client is no longer valid on the server. Re-registering…\n",
    );
    deleteClientConfig(baseUrl);
    client = null;
  }

  const registered = await registerOAuth2Client(baseUrl, redirectUri, scope);
  saveClientConfig(baseUrl, registered);
  return registered;
}

/**
 * OAuth2 Authorization Code login flow.
 * 1. Register client (if not already registered), OR use a provided client ID
 * 2. Open browser to /oauth2/auth
 * 3. Receive authorization code via local HTTP callback
 * 4. Exchange code for access_token + refresh_token
 * 5. Save token.json + client.json to ~/.kweaver/
 */
export async function oauth2Login(
  baseUrl: string,
  options?: {
    port?: number;
    scope?: string;
    clientId?: string;
    clientSecret?: string;
    /** Skip TLS certificate verification (self-signed / dev servers only). */
    tlsInsecure?: boolean;
  },
): Promise<TokenConfig> {
  return runWithTlsInsecure(options?.tlsInsecure, async () => {
  const { createServer } = await import("node:http");
  const { randomBytes } = await import("node:crypto");

  const base = normalizeBaseUrl(baseUrl);
  const port = options?.port ?? DEFAULT_REDIRECT_PORT;
  const scope = options?.scope ?? DEFAULT_SCOPE;
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  // Step 1: Determine client — use provided client ID or fall back to dynamic registration
  let client = await resolveOrRegisterClient(base, redirectUri, scope, options);

  // Use PKCE when no client secret is available (public client / platform client).
  const usePkce = !client.clientSecret;
  const pkce = usePkce ? await generatePkce() : null;

  // Step 2: Generate CSRF state
  const state = randomBytes(12).toString("hex");

  // Step 3: Build authorization URL
  const authParams = new URLSearchParams({
    redirect_uri: redirectUri,
    "x-forwarded-prefix": "",
    client_id: client.clientId,
    scope,
    response_type: "code",
    state,
    lang: "zh-cn",
    product: "adp",
  });
  if (pkce) {
    authParams.set("code_challenge", pkce.challenge);
    authParams.set("code_challenge_method", "S256");
  }
  const authUrl = `${base}/oauth2/auth?${authParams.toString()}`;

  // Step 4: Start local callback server; exchange code inside handler, then show credentials HTML
  const token = await new Promise<TokenConfig>((resolve, reject) => {
    let server: Server;
    const timeoutId = setTimeout(() => {
      server?.close();
      reject(new Error("OAuth2 login timed out (120s). No authorization code received."));
    }, 120_000);

    server = createServer((req, res) => {
      void (async () => {
        try {
          const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
          if (url.pathname !== "/callback") {
            res.writeHead(404);
            res.end();
            return;
          }

          const receivedState = url.searchParams.get("state");
          const receivedCode = url.searchParams.get("code");
          const callbackError = url.searchParams.get("error");
          const callbackErrorDesc = url.searchParams.get("error_description");

          if (receivedState !== state) {
            res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
            res.end(buildCallbackExchangeErrorHtml("OAuth2 state mismatch — possible CSRF attack."));
            clearTimeout(timeoutId);
            server.close();
            reject(new Error("OAuth2 state mismatch — possible CSRF attack."));
            return;
          }
          if (callbackError) {
            const msg = callbackErrorDesc
              ? `Authorization failed: ${callbackError} — ${callbackErrorDesc}`
              : `Authorization failed: ${callbackError}`;
            res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
            res.end(buildCallbackExchangeErrorHtml(msg));
            clearTimeout(timeoutId);
            server.close();
            reject(new Error(msg));
            return;
          }
          if (!receivedCode) {
            res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
            res.end(buildCallbackExchangeErrorHtml("No authorization code received in callback."));
            clearTimeout(timeoutId);
            server.close();
            reject(new Error("No authorization code received in callback."));
            return;
          }

          const exchanged = await exchangeCodeForToken(
            base,
            receivedCode,
            client.clientId,
            client.clientSecret,
            redirectUri,
            pkce?.verifier,
            options?.tlsInsecure,
          );

          const copyCommand = buildCopyCommand(
            base,
            client.clientId,
            client.clientSecret,
            exchanged.refreshToken,
            options?.tlsInsecure,
          );

          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(buildCallbackHtml(copyCommand));

          clearTimeout(timeoutId);
          server.close();
          resolve(exchanged);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          try {
            res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
            res.end(buildCallbackExchangeErrorHtml(message));
          } catch {
            /* response may already be sent */
          }
          clearTimeout(timeoutId);
          server.close();
          reject(err instanceof Error ? err : new Error(message));
        }
      })();
    });

    server.listen(port, "127.0.0.1", () => {
      // Step 5: Open browser (uses spawn with proper Windows quoting)
      import("../utils/browser.js").then(({ openBrowser }) => {
        openBrowser(authUrl);
      });
      process.stderr.write(`If the wrong browser opens, copy this URL to your correct browser:\n  ${authUrl}\n`);
    });
  });

  setCurrentPlatform(base);
  return token;
  });
}

async function registerOAuth2Client(baseUrl: string, redirectUri: string, scope: string): Promise<ClientConfig> {
  const logoutUri = redirectUri.replace("/callback", "/successful-logout");

  const response = await fetch(`${baseUrl}/oauth2/clients`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_name: "kweaver-sdk",
      grant_types: ["authorization_code", "implicit", "refresh_token"],
      response_types: ["token id_token", "code", "token"],
      scope: "openid offline all",
      redirect_uris: [redirectUri],
      post_logout_redirect_uris: [logoutUri],
      metadata: {
        device: {
          name: "kweaver-sdk",
          client_type: "web",
          description: "KWeaver TypeScript SDK",
        },
      },
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new HttpError(response.status, response.statusText, text);
  }

  const data = JSON.parse(text) as { client_id: string; client_secret: string };
  return {
    baseUrl,
    clientId: data.client_id,
    clientSecret: data.client_secret,
    redirectUri,
    logoutRedirectUri: logoutUri,
    scope,
    lang: "zh-cn",
    product: "adp",
    xForwardedPrefix: "",
  };
}

async function exchangeCodeForToken(
  baseUrl: string,
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
  codeVerifier: string | undefined,
  tlsInsecure?: boolean,
): Promise<TokenConfig> {
  const params: Record<string, string> = {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  };
  if (codeVerifier) {
    params.code_verifier = codeVerifier;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };

  if (clientSecret) {
    // Confidential client: use HTTP Basic auth
    headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
  } else {
    // Public client (PKCE): send client_id in body
    params.client_id = clientId;
  }

  const response = await fetch(`${baseUrl}/oauth2/token`, {
    method: "POST",
    headers,
    body: new URLSearchParams(params).toString(),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new HttpError(response.status, response.statusText, text);
  }

  const data = JSON.parse(text) as {
    access_token: string;
    token_type?: string;
    scope?: string;
    expires_in?: number;
    refresh_token?: string;
    id_token?: string;
  };

  const now = new Date();
  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 3600;
  const token: TokenConfig = {
    baseUrl,
    accessToken: data.access_token,
    tokenType: data.token_type ?? "Bearer",
    scope: data.scope ?? "",
    expiresIn,
    expiresAt: new Date(now.getTime() + expiresIn * 1000).toISOString(),
    refreshToken: data.refresh_token ?? "",
    idToken: data.id_token ?? "",
    obtainedAt: now.toISOString(),
    ...(tlsInsecure ? { tlsInsecure: true } : {}),
  };

  const displayName = await fetchDisplayName(baseUrl, data.access_token, tlsInsecure);
  if (displayName) token.displayName = displayName;

  saveTokenConfig(token);
  return token;
}

/**
 * Playwright-automated OAuth2 login.
 *
 * Uses the full OAuth2 authorization code flow (same as `oauth2Login`) but
 * automates the browser interaction with Playwright.  This produces a
 * refresh_token so the CLI can auto-refresh without re-login.
 *
 * When `username` and `password` are provided the browser runs headless and
 * fills the login form automatically.  Otherwise it opens a visible browser
 * window for manual login (same UX as the old cookie-based flow).
 */
export async function playwrightLogin(
  baseUrl: string,
  options?: {
    username?: string;
    password?: string;
    port?: number;
    scope?: string;
    tlsInsecure?: boolean;
  },
): Promise<TokenConfig> {
  return runWithTlsInsecure(options?.tlsInsecure, async () => {
  const { createServer } = await import("node:http");
  const { randomBytes } = await import("node:crypto");

  let chromium: any;
  try {
    const modName = "playwright";
    const pw = await import(/* webpackIgnore: true */ modName);
    chromium = pw.chromium;
  } catch {
    throw new Error(
      "Playwright is not installed. Run:\n  npm install playwright && npx playwright install chromium"
    );
  }

  const base = normalizeBaseUrl(baseUrl);
  const port = options?.port ?? DEFAULT_REDIRECT_PORT;
  const scope = options?.scope ?? DEFAULT_SCOPE;
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  const hasCredentials = !!(options?.username && options?.password);

  // Step 1: Ensure registered OAuth2 client (with stale-client auto-recovery)
  let client = await resolveOrRegisterClient(base, redirectUri, scope);

  // Step 2: Generate CSRF state
  const state = randomBytes(12).toString("hex");

  // Step 3: Build authorization URL
  const authParams = new URLSearchParams({
    redirect_uri: redirectUri,
    "x-forwarded-prefix": "",
    client_id: client.clientId,
    scope,
    response_type: "code",
    state,
    lang: "zh-cn",
    product: "adp",
  });
  const authUrl = `${base}/oauth2/auth?${authParams.toString()}`;

  // Step 4: Start local callback server; exchange code inside handler, then show credentials HTML
  let browser: any;
  const token = await new Promise<TokenConfig>((resolve, reject) => {
    const TIMEOUT_MS = hasCredentials ? 30_000 : 120_000;
    let server: Server;
    const timeoutId = setTimeout(() => {
      server?.close();
      browser?.close();
      reject(new Error(`OAuth2 login timed out (${TIMEOUT_MS / 1000}s). No authorization code received.`));
    }, TIMEOUT_MS);

    server = createServer((req, res) => {
      void (async () => {
        try {
          const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
          if (url.pathname !== "/callback") {
            res.writeHead(404);
            res.end();
            return;
          }

          const receivedState = url.searchParams.get("state");
          const receivedCode = url.searchParams.get("code");
          const callbackError = url.searchParams.get("error");
          const callbackErrorDesc = url.searchParams.get("error_description");

          if (receivedState !== state) {
            res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
            res.end(buildCallbackExchangeErrorHtml("OAuth2 state mismatch — possible CSRF attack."));
            clearTimeout(timeoutId);
            server.close();
            browser?.close();
            reject(new Error("OAuth2 state mismatch — possible CSRF attack."));
            return;
          }
          if (callbackError) {
            const msg = callbackErrorDesc
              ? `Authorization failed: ${callbackError} — ${callbackErrorDesc}`
              : `Authorization failed: ${callbackError}`;
            res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
            res.end(buildCallbackExchangeErrorHtml(msg));
            clearTimeout(timeoutId);
            server.close();
            browser?.close();
            reject(new Error(msg));
            return;
          }
          if (!receivedCode) {
            res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
            res.end(buildCallbackExchangeErrorHtml("No authorization code received in callback."));
            clearTimeout(timeoutId);
            server.close();
            browser?.close();
            reject(new Error("No authorization code received in callback."));
            return;
          }

          const exchanged = await exchangeCodeForToken(
            base,
            receivedCode,
            client.clientId,
            client.clientSecret,
            redirectUri,
            undefined,
            options?.tlsInsecure,
          );

          const copyCommand = buildCopyCommand(
            base,
            client.clientId,
            client.clientSecret,
            exchanged.refreshToken,
            options?.tlsInsecure,
          );

          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(buildCallbackHtml(copyCommand));

          clearTimeout(timeoutId);
          server.close();
          browser?.close();
          resolve(exchanged);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          try {
            res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
            res.end(buildCallbackExchangeErrorHtml(message));
          } catch {
            /* response may already be sent */
          }
          clearTimeout(timeoutId);
          server.close();
          browser?.close();
          reject(err instanceof Error ? err : new Error(message));
        }
      })();
    });

    server.listen(port, "127.0.0.1", async () => {
      try {
        browser = await chromium.launch({ headless: hasCredentials });
        const context = await browser.newContext({ ignoreHTTPSErrors: !!options?.tlsInsecure });
        const page = await context.newPage();

        // Navigate to OAuth2 auth URL — redirects to signin page
        await page.goto(authUrl, { waitUntil: "networkidle", timeout: 30_000 });

        if (hasCredentials) {
          // Auto-fill credentials
          await page.waitForSelector('input[name="account"]', { timeout: 10_000 });
          await page.fill('input[name="account"]', options!.username!);
          await page.fill('input[name="password"]', options!.password!);
          await page.click("button.ant-btn-primary");
        }
        // else: visible browser — user logs in manually
        // The OAuth2 callback will fire when login completes, resolving the promise above
      } catch (err) {
        clearTimeout(timeoutId);
        server.close();
        browser?.close();
        reject(err);
      }
    });
  });

  if (hasCredentials) {
    const copyCommand = buildCopyCommand(
      base,
      client.clientId,
      client.clientSecret,
      token.refreshToken,
      options?.tlsInsecure,
    );
    process.stderr.write(
      "\nHeadless login: copy this command and run it on a machine without a browser, or use `kweaver auth export`:\n\n" +
        copyCommand +
        "\n\n",
    );
  }

  setCurrentPlatform(base);
  return token;
  });
}

/**
 * Log in on a headless machine using OAuth2 client credentials and a refresh token (no browser).
 * Exchanges the refresh token for a new access token and persists ~/.kweaver/ state.
 */
export async function refreshTokenLogin(
  baseUrl: string,
  options: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
    tlsInsecure?: boolean;
  },
): Promise<TokenConfig> {
  const base = normalizeBaseUrl(baseUrl);
  const redirectUri = `http://127.0.0.1:${DEFAULT_REDIRECT_PORT}/callback`;
  const client: ClientConfig = {
    baseUrl: base,
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    redirectUri,
    logoutRedirectUri: redirectUri.replace("/callback", "/successful-logout"),
    scope: DEFAULT_SCOPE,
    lang: "zh-cn",
    product: "adp",
    xForwardedPrefix: "",
  };
  saveClientConfig(base, client);
  const synthetic: TokenConfig = {
    baseUrl: base,
    accessToken: "",
    tokenType: "Bearer",
    scope: "",
    refreshToken: options.refreshToken,
    obtainedAt: new Date().toISOString(),
    ...(options.tlsInsecure ? { tlsInsecure: true } : {}),
  };
  const token = await runWithTlsInsecure(options.tlsInsecure, () => refreshAccessToken(synthetic));
  setCurrentPlatform(base);
  return token;
}

function tokenNeedsRefresh(token: TokenConfig): boolean {
  if (!token.expiresAt) {
    return false;
  }
  const expiresAtMs = Date.parse(token.expiresAt);
  if (Number.isNaN(expiresAtMs)) {
    return false;
  }
  const thresholdMs = REFRESH_THRESHOLD_SEC * 1000;
  return expiresAtMs - thresholdMs <= Date.now();
}

/**
 * Exchange refresh_token for a new access token (OAuth2 password grant style, same as Python ConfigAuth).
 * Persists the new token to ~/.kweaver/ and returns it.
 */
export async function refreshAccessToken(token: TokenConfig): Promise<TokenConfig> {
  const baseUrl = normalizeBaseUrl(token.baseUrl);
  const refreshToken = token.refreshToken?.trim();
  if (!refreshToken) {
    throw new Error(
      `Token expired and no refresh_token available for ${baseUrl}. Run \`kweaver auth login ${baseUrl}\` again.`,
    );
  }

  const client = loadClientConfig(baseUrl);
  const clientId = client?.clientId?.trim() ?? "";
  const clientSecret = client?.clientSecret?.trim() ?? "";
  if (!clientId || !clientSecret) {
    throw new Error(
      `Token refresh requires OAuth client credentials (client.json). Run \`kweaver auth login ${baseUrl}\` again.`,
    );
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const url = `${baseUrl}/oauth2/token`;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  let response: Response;
  try {
    response = await runWithTlsInsecure(token.tlsInsecure, () =>
      fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: body.toString(),
      }),
    );
  } catch (cause) {
    const hint =
      cause instanceof Error ? cause.message : String(cause);
    throw new NetworkRequestError(
      "POST",
      url,
      hint,
      "Check network connectivity and that the platform exposes /oauth2/token.",
    );
  }

  const text = await response.text();
  if (!response.ok) {
    throw new HttpError(response.status, response.statusText, text);
  }

  let data: {
    access_token: string;
    token_type?: string;
    expires_in?: number;
    scope?: string;
    refresh_token?: string;
    id_token?: string;
  };
  try {
    data = JSON.parse(text) as typeof data;
  } catch {
    throw new Error(`Invalid JSON from ${url} during token refresh.`);
  }

  if (typeof data.access_token !== "string") {
    throw new Error(`Token refresh response missing access_token from ${url}.`);
  }

  const now = new Date();
  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 3600;
  let displayName = token.displayName;
  if (!displayName) {
    displayName = (await fetchDisplayName(baseUrl, data.access_token, token.tlsInsecure)) ?? undefined;
  }

  const newToken: TokenConfig = {
    baseUrl,
    accessToken: data.access_token,
    tokenType: data.token_type ?? "Bearer",
    scope: data.scope ?? token.scope ?? "",
    expiresIn,
    expiresAt: new Date(now.getTime() + expiresIn * 1000).toISOString(),
    refreshToken: data.refresh_token ?? refreshToken,
    idToken: data.id_token ?? token.idToken ?? "",
    obtainedAt: now.toISOString(),
    ...(token.tlsInsecure ? { tlsInsecure: true } : {}),
    ...(displayName ? { displayName } : {}),
  };
  saveTokenConfig(newToken);
  return newToken;
}

/**
 * Resolve a usable access token for the current platform.
 *
 * **Default behavior** (saved `~/.kweaver/` session from OAuth2 code login): when the access
 * token is expired or near expiry, automatically exchanges the saved **refresh_token** for a new
 * access token (OAuth2 `refresh_token` grant) and persists it. No extra flags are required.
 *
 * Static env `KWEAVER_TOKEN` bypasses refresh (see implementation).
 */
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

  // KWEAVER_USER: load a specific user's token without switching active user
  const envUser = process.env.KWEAVER_USER;
  let token: TokenConfig | null;
  if (envUser) {
    const userId = resolveUserId(currentPlatform, envUser);
    if (!userId) {
      throw new Error(
        `User '${envUser}' not found for ${currentPlatform}. ` +
          "Run `kweaver auth users` to see available users.",
      );
    }
    token = loadUserTokenConfig(currentPlatform, userId);
  } else {
    token = loadTokenConfig(currentPlatform);
  }

  if (!token) {
    throw new Error(
      `No saved token for ${currentPlatform}. Run \`kweaver auth login ${currentPlatform}\` first.`,
    );
  }

  if (opts?.forceRefresh) {
    return refreshAccessToken(token);
  }

  if (tokenNeedsRefresh(token)) {
    try {
      return await refreshAccessToken(token);
    } catch (err) {
      throw new Error(
        `Access token expired or near expiry and refresh failed for ${currentPlatform}.\n` +
          (err instanceof Error ? `${err.message}\n` : "") +
          `Run \`kweaver auth login ${currentPlatform}\` again.`,
        { cause: err },
      );
    }
  }

  return token;
}

/**
 * Run an operation; on HTTP 401, refresh the access token once and retry.
 * Does not call `ensureValidToken` first — use for CLI routers so `--help` works without login.
 */
export async function with401RefreshRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) {
      const currentPlatform = getCurrentPlatform();
      if (!currentPlatform) {
        throw error;
      }
      const platformUrl = normalizeBaseUrl(currentPlatform);
      const envUser = process.env.KWEAVER_USER;
      let latest: TokenConfig | null;
      if (envUser) {
        const userId = resolveUserId(platformUrl, envUser);
        latest = userId ? loadUserTokenConfig(platformUrl, userId) : null;
      } else {
        latest = loadTokenConfig(platformUrl);
      }
      if (!latest) {
        throw error;
      }
      try {
        await refreshAccessToken(latest);
      } catch (retryErr) {
        const oauthHint = formatOAuthErrorBody(retryErr instanceof HttpError ? retryErr.body : "");
        const extra = oauthHint ? `\n\n${oauthHint}` : "";
        throw new Error(
          `Authentication failed (401). Token refresh did not succeed for ${platformUrl}.${extra}\n` +
            `Run \`kweaver auth login ${platformUrl}\` again.`,
          { cause: retryErr },
        );
      }
      return await fn();
    }
    throw error;
  }
}

/**
 * Load a valid token, run `fn(token)`, and on 401 refresh once and retry with the new token.
 */
export async function withTokenRetry<T>(
  fn: (token: TokenConfig) => Promise<T>,
): Promise<T> {
  const token = await ensureValidToken();
  try {
    return await fn(token);
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) {
      const platformUrl = normalizeBaseUrl(token.baseUrl);
      const envUser = process.env.KWEAVER_USER;
      let latest: TokenConfig | null;
      if (envUser) {
        const userId = resolveUserId(platformUrl, envUser);
        latest = userId ? loadUserTokenConfig(platformUrl, userId) : null;
      } else {
        latest = loadTokenConfig(platformUrl);
      }
      if (!latest) latest = token;
      try {
        const refreshed = await refreshAccessToken(latest);
        return await fn(refreshed);
      } catch (retryErr) {
        const oauthHint = formatOAuthErrorBody(retryErr instanceof HttpError ? retryErr.body : "");
        const extra = oauthHint ? `\n\n${oauthHint}` : "";
        throw new Error(
          `Authentication failed (401). Token refresh did not succeed for ${platformUrl}.${extra}\n` +
            `Run \`kweaver auth login ${platformUrl}\` again.`,
          { cause: retryErr },
        );
      }
    }
    throw error;
  }
}

function formatOAuthErrorBody(body: string): string | null {
  let data: { error?: string; error_description?: string };
  try {
    data = JSON.parse(body) as { error?: string; error_description?: string };
  } catch {
    return null;
  }
  if (!data || typeof data.error !== "string") {
    return null;
  }
  const code = data.error;
  const description = typeof data.error_description === "string" ? data.error_description : "";
  const lines: string[] = [`OAuth error: ${code}`];
  if (description) {
    lines.push(description);
  }
  if (code === "invalid_grant") {
    lines.push("");
    lines.push("The refresh token or authorization code is invalid or expired. Run `kweaver auth <platform-url>` again to log in.");
  }
  return lines.join("\n");
}

export function formatHttpError(error: unknown): string {
  if (error instanceof HttpError) {
    const oauthMessage = formatOAuthErrorBody(error.body);
    if (oauthMessage) {
      return `HTTP ${error.status} ${error.statusText}\n\n${oauthMessage}`;
    }
    return `${error.message}\n${error.body}`.trim();
  }

  if (error instanceof NetworkRequestError) {
    return [
      error.message,
      `Method: ${error.method}`,
      `URL: ${error.url}`,
      `Cause: ${error.causeMessage}`,
      `Hint: ${error.hint}`,
    ].join("\n").trim();
  }

  if (error instanceof Error) {
    const cause =
      "cause" in error && error.cause instanceof Error ? error.cause.message : "";
    if (cause && error.message === "fetch failed") {
      return `${error.message}: ${cause}\nHint: use --insecure (-k) to skip TLS verification for self-signed certificates.`;
    }
    return error.message;
  }

  return String(error);
}
