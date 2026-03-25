import {
  type ClientConfig,
  type TokenConfig,
  getCurrentPlatform,
  loadClientConfig,
  loadTokenConfig,
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
  let client = loadClientConfig(base);
  if (options?.clientId) {
    // Use the platform's existing client (e.g. the web app client).
    // Persist it so future logins reuse it without re-registering.
    client = {
      baseUrl: base,
      clientId: options.clientId,
      clientSecret: options.clientSecret ?? "",
      redirectUri,
      logoutRedirectUri: redirectUri.replace("/callback", "/successful-logout"),
      scope,
      lang: "zh-cn",
      product: "adp",
      xForwardedPrefix: "",
    };
    saveClientConfig(base, client);
  } else if (!client?.clientId) {
    client = await registerOAuth2Client(base, redirectUri, scope);
    saveClientConfig(base, client);
  }

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

  // Step 4: Start local callback server, wait for code
  const code = await new Promise<string>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      server.close();
      reject(new Error("OAuth2 login timed out (120s). No authorization code received."));
    }, 120_000);

    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
      if (url.pathname === "/callback") {
        const receivedState = url.searchParams.get("state");
        const receivedCode = url.searchParams.get("code");

        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<html><body><h2>Login successful. You can close this tab.</h2></body></html>");

        clearTimeout(timeoutId);
        server.close();

        if (receivedState !== state) {
          reject(new Error("OAuth2 state mismatch — possible CSRF attack."));
        } else if (!receivedCode) {
          reject(new Error("No authorization code received in callback."));
        } else {
          resolve(receivedCode);
        }
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    server.listen(port, "127.0.0.1", () => {
      // Step 5: Open browser (uses spawn with proper Windows quoting)
      import("../utils/browser.js").then(({ openBrowser }) => {
        openBrowser(authUrl);
      });
      process.stderr.write(`If the wrong browser opens, copy this URL to your correct browser:\n  ${authUrl}\n`);
    });
  });

  // Step 6: Exchange code for tokens
  const token = await exchangeCodeForToken(
    base,
    code,
    client.clientId,
    client.clientSecret,
    redirectUri,
    pkce?.verifier,
    options?.tlsInsecure,
  );

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

  // Step 1: Ensure registered OAuth2 client
  let client = loadClientConfig(base);
  if (!client?.clientId) {
    client = await registerOAuth2Client(base, redirectUri, scope);
    saveClientConfig(base, client);
  }

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

  // Step 4: Start local callback server to capture the authorization code
  const code = await new Promise<string>((resolve, reject) => {
    const TIMEOUT_MS = hasCredentials ? 30_000 : 120_000;
    const timeoutId = setTimeout(() => {
      server.close();
      browser?.close();
      reject(new Error(`OAuth2 login timed out (${TIMEOUT_MS / 1000}s). No authorization code received.`));
    }, TIMEOUT_MS);

    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
      if (url.pathname === "/callback") {
        const receivedState = url.searchParams.get("state");
        const receivedCode = url.searchParams.get("code");

        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<html><body><h2>Login successful. You can close this tab.</h2></body></html>");

        clearTimeout(timeoutId);
        server.close();
        browser?.close();

        if (receivedState !== state) {
          reject(new Error("OAuth2 state mismatch — possible CSRF attack."));
        } else if (!receivedCode) {
          reject(new Error("No authorization code received in callback."));
        } else {
          resolve(receivedCode);
        }
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    let browser: any;

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

  // Step 5: Exchange authorization code for tokens (includes refresh_token)
  const token = await exchangeCodeForToken(
    base,
    code,
    client.clientId,
    client.clientSecret,
    redirectUri,
    undefined,
    options?.tlsInsecure,
  );

  setCurrentPlatform(base);
  return token;
  });
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
  };
  saveTokenConfig(newToken);
  return newToken;
}

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

  let token = loadTokenConfig(currentPlatform);
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
      const latest = loadTokenConfig(platformUrl);
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
      const latest = loadTokenConfig(platformUrl) ?? token;
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
