import {
  type TokenConfig,
  getCurrentPlatform,
  loadClientConfig,
  loadTokenConfig,
  saveTokenConfig,
  setCurrentPlatform,
} from "../config/store.js";
import { HttpError, NetworkRequestError } from "../utils/http.js";

const TOKEN_TTL_SECONDS = 3600;

/** Seconds before access token expiry to trigger refresh (matches Python ConfigAuth). */
const REFRESH_THRESHOLD_SEC = 60;

export function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

export async function playwrightLogin(
  baseUrl: string,
  options?: { username?: string; password?: string },
): Promise<TokenConfig> {
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

  const hasCredentials = options?.username && options?.password;
  const browser = await chromium.launch({ headless: hasCredentials ? true : false });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(`${baseUrl}/api/dip-hub/v1/login`, {
      waitUntil: "networkidle",
      timeout: 30_000,
    });

    if (hasCredentials) {
      // Headless mode: auto-fill credentials
      await page.waitForSelector('input[name="account"]', { timeout: 10_000 });
      await page.fill('input[name="account"]', options.username!);
      await page.fill('input[name="password"]', options.password!);
      await page.click("button.ant-btn-primary");
    }
    // else: headed mode — user logs in manually in the browser window

    const TIMEOUT_SECONDS = hasCredentials ? 30 : 120;
    let accessToken: string | null = null;
    for (let i = 0; i < TIMEOUT_SECONDS; i++) {
      await new Promise((r) => setTimeout(r, 1000));

      // Check cookies (works even after navigation)
      for (const cookie of await context.cookies()) {
        if (cookie.name === "dip.oauth2_token") {
          accessToken = decodeURIComponent(cookie.value);
          break;
        }
      }
      if (accessToken) break;

      // In headless mode, check for login error messages
      if (hasCredentials) {
        try {
          const errorEl = await page.$(".ant-message-error, .ant-alert-error");
          if (errorEl) {
            const errorText = await errorEl.textContent();
            throw new Error(`Login failed: ${errorText?.trim() || "unknown error"}`);
          }
        } catch (e) {
          if (e instanceof Error && e.message.startsWith("Login failed:")) throw e;
        }
      }
    }

    if (!accessToken) {
      throw new Error(
        `Login timed out: dip.oauth2_token cookie not received within ${TIMEOUT_SECONDS} seconds.`
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
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: body.toString(),
    });
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
    return error.message;
  }

  return String(error);
}
