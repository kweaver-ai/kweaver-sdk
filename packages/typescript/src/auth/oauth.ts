import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { URL } from "node:url";

import { openBrowser } from "../utils/browser.js";
import { fetchTextOrThrow, HttpError, NetworkRequestError } from "../utils/http.js";
import {
  type CallbackSession,
  type ClientConfig,
  type TokenConfig,
  getCurrentPlatform,
  loadCallbackSession,
  loadClientConfig,
  loadTokenConfig,
  saveCallbackSession,
  saveClientConfig,
  saveTokenConfig,
  setCurrentPlatform,
} from "../config/store.js";

interface RegisterClientOptions {
  baseUrl: string;
  clientName: string;
  redirectUri: string;
  logoutRedirectUri: string;
  lang?: string;
  product?: string;
  xForwardedPrefix?: string;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
  expires_in?: number;
  refresh_token?: string;
  id_token?: string;
}

export function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function randomValue(size = 24): string {
  return randomBytes(size).toString("hex");
}

export function getAuthorizationSuccessMessage(): string {
  return "Authorization succeeded. You can close this page and return to the terminal.";
}

function toBasicAuth(clientId: string, clientSecret: string): string {
  const user = encodeURIComponent(clientId);
  const password = encodeURIComponent(clientSecret);
  return `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
}

function buildTokenConfig(baseUrl: string, token: TokenResponse): TokenConfig {
  const obtainedAt = new Date().toISOString();
  const expiresAt =
    token.expires_in === undefined
      ? undefined
      : new Date(Date.now() + token.expires_in * 1000).toISOString();

  return {
    baseUrl,
    accessToken: token.access_token,
    tokenType: token.token_type,
    scope: token.scope,
    expiresIn: token.expires_in,
    expiresAt,
    refreshToken: token.refresh_token,
    idToken: token.id_token,
    obtainedAt,
  };
}

export async function registerClient(options: RegisterClientOptions): Promise<ClientConfig> {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const payload = {
    client_name: options.clientName,
    grant_types: ["authorization_code", "implicit", "refresh_token"],
    response_types: ["token id_token", "code", "token"],
    scope: "openid offline all",
    redirect_uris: [options.redirectUri],
    post_logout_redirect_uris: [options.logoutRedirectUri],
    metadata: {
      device: {
        name: options.clientName,
        client_type: "web",
        description: "kweaver CLI",
      },
    },
  };

  const { body } = await fetchTextOrThrow(`${baseUrl}/oauth2/clients`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = JSON.parse(body) as { client_id: string; client_secret: string };
  const clientConfig: ClientConfig = {
    baseUrl,
    clientId: data.client_id,
    clientSecret: data.client_secret,
    redirectUri: options.redirectUri,
    logoutRedirectUri: options.logoutRedirectUri,
    scope: payload.scope,
    lang: options.lang,
    product: options.product,
    xForwardedPrefix: options.xForwardedPrefix,
  };

  saveClientConfig(clientConfig);
  return clientConfig;
}

export interface EnsureClientOptions {
  baseUrl: string;
  port: number;
  clientName: string;
  forceRegister: boolean;
  host?: string;
  redirectUriOverride?: string;
  lang?: string;
  product?: string;
  xForwardedPrefix?: string;
}

export interface EnsuredClientConfig {
  client: ClientConfig;
  created: boolean;
}

export interface AuthRedirectConfig {
  redirectUri: string;
  logoutRedirectUri: string;
  listenHost: string;
  listenPort: number;
  callbackPath: string;
}

function toSuccessfulLogoutPath(pathname: string): string {
  if (pathname.endsWith("/callback")) {
    return `${pathname.slice(0, -"/callback".length)}/successful-logout`;
  }

  return `${pathname.replace(/\/$/, "")}/successful-logout`;
}

function normalizeListenHost(host?: string): string {
  return host?.trim() || "127.0.0.1";
}

export function buildAuthRedirectConfig(options: {
  port: number;
  host?: string;
  redirectUriOverride?: string;
}): AuthRedirectConfig {
  const listenHost = normalizeListenHost(options.host);
  const listenPort = options.port;

  if (options.redirectUriOverride) {
    const redirect = new URL(options.redirectUriOverride);
    const logout = new URL(options.redirectUriOverride);
    logout.pathname = toSuccessfulLogoutPath(redirect.pathname);
    logout.search = "";
    logout.hash = "";

    return {
      redirectUri: redirect.toString(),
      logoutRedirectUri: logout.toString(),
      listenHost,
      listenPort,
      callbackPath: redirect.pathname,
    };
  }

  return {
    redirectUri: `http://${listenHost}:${listenPort}/callback`,
    logoutRedirectUri: `http://${listenHost}:${listenPort}/successful-logout`,
    listenHost,
    listenPort,
    callbackPath: "/callback",
  };
}

export async function ensureClientConfig(options: EnsureClientOptions): Promise<EnsuredClientConfig> {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const redirect = buildAuthRedirectConfig({
    port: options.port,
    host: options.host,
    redirectUriOverride: options.redirectUriOverride,
  });
  const { redirectUri, logoutRedirectUri } = redirect;

  const client = loadClientConfig(baseUrl);
  if (
    client &&
    !options.forceRegister &&
    client.baseUrl === baseUrl &&
    client.redirectUri === redirectUri &&
    client.clientId &&
    client.clientSecret
  ) {
    return { client, created: false };
  }

  const createdClient = await registerClient({
    baseUrl,
    clientName: options.clientName,
    redirectUri,
    logoutRedirectUri,
    lang: options.lang,
    product: options.product,
    xForwardedPrefix: options.xForwardedPrefix,
  });

  return {
    client: createdClient,
    created: true,
  };
}

export function buildAuthorizationUrl(client: ClientConfig, state = randomValue(12)): string {
  const authorizationUrl = new URL(`${client.baseUrl}/oauth2/auth`);
  authorizationUrl.searchParams.set("redirect_uri", client.redirectUri);
  authorizationUrl.searchParams.set("x-forwarded-prefix", client.xForwardedPrefix ?? "");
  authorizationUrl.searchParams.set("client_id", client.clientId);
  authorizationUrl.searchParams.set("scope", client.scope);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("lang", client.lang ?? "zh-cn");
  if (client.product) {
    authorizationUrl.searchParams.set("product", client.product);
  }

  return authorizationUrl.toString();
}

function waitForAuthorizationCode(
  options: { listenHost: string; listenPort: number; callbackPath: string },
  expectedState: string
): Promise<{ code: string; state: string; scope?: string }> {
  const { listenHost, listenPort, callbackPath } = options;

  return new Promise((resolve, reject) => {
    const server = createServer((request, response) => {
      if (!request.url) {
        response.statusCode = 400;
        response.end("Missing request URL");
        return;
      }

      const callbackUrl = new URL(request.url, `http://${request.headers.host ?? `${listenHost}:${listenPort}`}`);
      if (callbackUrl.pathname !== callbackPath) {
        response.statusCode = 404;
        response.end("Not Found");
        return;
      }

      const error = callbackUrl.searchParams.get("error");
      if (error) {
        response.statusCode = 400;
        response.end(`Authorization failed: ${error}`);
        server.close();
        reject(new Error(`Authorization failed: ${error}`));
        return;
      }

      const state = callbackUrl.searchParams.get("state");
      if (state !== expectedState) {
        response.statusCode = 400;
        response.end("State mismatch — waiting for correct callback, please use the new authorization URL");
        return;
      }

      const code = callbackUrl.searchParams.get("code");
      if (!code) {
        response.statusCode = 400;
        response.end("Missing authorization code");
        server.close();
        reject(new Error("Missing authorization code"));
        return;
      }

      response.statusCode = 200;
      response.setHeader("content-type", "text/plain; charset=utf-8");
      response.end(getAuthorizationSuccessMessage());
      server.close();
      resolve({
        code,
        state,
        scope: callbackUrl.searchParams.get("scope") ?? undefined,
      });
    });

    server.on("error", (error) => reject(error));
    server.listen(listenPort, listenHost);
  });
}

async function exchangeAuthorizationCode(client: ClientConfig, code: string): Promise<TokenConfig> {
  const payload = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: client.redirectUri,
  });

  const { body } = await fetchTextOrThrow(`${client.baseUrl}/oauth2/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
      authorization: toBasicAuth(client.clientId, client.clientSecret),
    },
    body: payload.toString(),
  });

  const tokenConfig = buildTokenConfig(client.baseUrl, JSON.parse(body) as TokenResponse);
  saveTokenConfig(tokenConfig);
  return tokenConfig;
}

/**
 * Call the platform's end-session endpoint so the server invalidates the session.
 * Best-effort: failures are ignored so local logout still proceeds.
 */
export async function callLogoutEndpoint(client: ClientConfig, token: TokenConfig | null): Promise<void> {
  const url = new URL(`${client.baseUrl}/oauth2/signout`);
  if (token?.idToken) {
    url.searchParams.set("id_token_hint", token.idToken);
  }
  url.searchParams.set("post_logout_redirect_uri", client.logoutRedirectUri);
  url.searchParams.set("client_id", client.clientId);

  try {
    const response = await fetch(url.toString(), { method: "GET", redirect: "manual" });
    if (!response.ok && response.status !== 302) {
      const body = await response.text();
      console.error(`Logout endpoint returned ${response.status}: ${body.slice(0, 200)}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Logout endpoint request failed: ${msg}`);
  }
}

export async function refreshAccessToken(client: ClientConfig, refreshToken: string): Promise<TokenConfig> {
  const payload = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const { body } = await fetchTextOrThrow(`${client.baseUrl}/oauth2/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
      authorization: toBasicAuth(client.clientId, client.clientSecret),
    },
    body: payload.toString(),
  });

  const parsed = JSON.parse(body) as TokenResponse;
  const tokenConfig = buildTokenConfig(client.baseUrl, {
    ...parsed,
    refresh_token: parsed.refresh_token ?? refreshToken,
  });
  saveTokenConfig(tokenConfig);
  return tokenConfig;
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
      scope: "openid",
      obtainedAt: new Date().toISOString(),
    };
  }

  const currentPlatform = getCurrentPlatform();
  if (!currentPlatform) {
    throw new Error("No active platform selected. Run `kweaver auth <platform-url>` first.");
  }

  const client = loadClientConfig(currentPlatform);
  const token = loadTokenConfig(currentPlatform);

  if (!client || !token) {
    throw new Error(
      `Missing saved credentials for ${currentPlatform}. Run \`kweaver auth ${currentPlatform}\` first.`
    );
  }

  if (!opts?.forceRefresh) {
    if (!token.expiresAt) {
      return token;
    }
    const expiresAtMs = Date.parse(token.expiresAt);
    if (Number.isNaN(expiresAtMs) || expiresAtMs - 60_000 > Date.now()) {
      return token;
    }
  }

  if (!token.refreshToken) {
    throw new Error("Access token expired and no refresh token is available. Run auth login again.");
  }

  return refreshAccessToken(client, token.refreshToken);
}

export interface AuthLoginOptions {
  baseUrl: string;
  port: number;
  clientName: string;
  open: boolean;
  forceRegister: boolean;
  host?: string;
  redirectUriOverride?: string;
  lang?: string;
  product?: string;
  xForwardedPrefix?: string;
}

export async function login(options: AuthLoginOptions): Promise<{
  client: ClientConfig;
  token: TokenConfig;
  authorizationUrl: string;
  callback: CallbackSession;
  created: boolean;
}> {
  const redirect = buildAuthRedirectConfig({
    port: options.port,
    host: options.host,
    redirectUriOverride: options.redirectUriOverride,
  });
  const { client, created } = await ensureClientConfig({
    baseUrl: options.baseUrl,
    port: options.port,
    clientName: options.clientName,
    forceRegister: options.forceRegister,
    host: options.host,
    redirectUriOverride: options.redirectUriOverride,
    lang: options.lang,
    product: options.product,
    xForwardedPrefix: options.xForwardedPrefix,
  });
  const state = randomValue(12);
  const authorizationUrl = buildAuthorizationUrl(client, state);

  const waitForCode = waitForAuthorizationCode(
    {
      listenHost: redirect.listenHost,
      listenPort: redirect.listenPort,
      callbackPath: redirect.callbackPath,
    },
    state
  );

  if (options.open) {
    console.log(`Opening browser for authorization: ${authorizationUrl}`);
    const opened = await openBrowser(authorizationUrl);
    if (!opened) {
      console.error("Failed to open a browser automatically. Open this URL manually:");
      console.error(authorizationUrl);
    }
  } else {
    console.log("Authorization URL:");
    console.log(authorizationUrl);
    console.log("");
    console.log(`Redirect URI: ${client.redirectUri}`);
    console.log(`Waiting for OAuth callback on http://${redirect.listenHost}:${redirect.listenPort}${redirect.callbackPath}`);
    if (redirect.listenHost === "127.0.0.1" || redirect.listenHost === "localhost") {
      console.log("");
      console.log("If your browser is on another machine, use SSH port forwarding first:");
      console.log(`ssh -L ${redirect.listenPort}:127.0.0.1:${redirect.listenPort} user@server`);
    }
  }

  const callbackResult = await waitForCode;
  const callback: CallbackSession = {
    baseUrl: client.baseUrl,
    redirectUri: client.redirectUri,
    code: callbackResult.code,
    state: callbackResult.state,
    scope: callbackResult.scope,
    receivedAt: new Date().toISOString(),
  };
  saveCallbackSession(callback);

  const token = await exchangeAuthorizationCode(client, callbackResult.code);
  setCurrentPlatform(client.baseUrl);

  return { client, token, authorizationUrl, callback, created };
}

export function getStoredAuthSummary(baseUrl?: string): {
  client: ClientConfig | null;
  token: TokenConfig | null;
  callback: CallbackSession | null;
} {
  const targetBaseUrl = baseUrl ?? getCurrentPlatform() ?? undefined;
  return {
    client: loadClientConfig(targetBaseUrl),
    token: loadTokenConfig(targetBaseUrl),
    callback: loadCallbackSession(targetBaseUrl),
  };
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
