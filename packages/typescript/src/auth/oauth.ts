import type { Server } from "node:http";
import { readFile } from "node:fs/promises";
import { createPublicKey, constants as cryptoConstants, publicEncrypt, randomBytes } from "node:crypto";
import { isNoAuth } from "../config/no-auth.js";
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
  saveNoAuthPlatform,
  saveTokenConfig,
  setCurrentPlatform,
} from "../config/store.js";
import { HttpError, NetworkRequestError, fetchWithRetry } from "../utils/http.js";

/** Thrown when `POST /oauth2/signin` returns HTTP 401 with EACP code `401001017` (initial password must be changed). */
export class InitialPasswordChangeRequiredError extends Error {
  readonly code = 401001017;
  readonly account: string;
  readonly baseUrl: string;
  readonly httpStatus = 401;
  readonly serverMessage: string;

  constructor(opts: { account: string; baseUrl: string; serverMessage: string }) {
    super(opts.serverMessage);
    this.name = "InitialPasswordChangeRequiredError";
    this.account = opts.account;
    this.baseUrl = opts.baseUrl;
    this.serverMessage = opts.serverMessage;
  }
}

const TOKEN_TTL_SECONDS = 3600;

/** Seconds before access token expiry to trigger refresh (matches Python ConfigAuth). */
const REFRESH_THRESHOLD_SEC = 60;

const DEFAULT_REDIRECT_PORT = 9010;
const DEFAULT_SCOPE = "openid offline all";

/**
 * Studioweb hardcoded LOGIN public key (PEM) — the single key used for HTTP `/oauth2/signin`.
 * Source: kweaver-ai/kweaver `deploy/auto_cofig/auto_config.sh` `LOGIN_PUBLIC_KEY`.
 */
export const STUDIOWEB_LOGIN_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAsyOstgbYuubBi2PUqeVj
GKlkwVUY6w1Y8d4k116dI2SkZI8fxcjHALv77kItO4jYLVplk9gO4HAtsisnNE2o
wlYIqdmyEPMwupaeFFFcg751oiTXJiYbtX7ABzU5KQYPjRSEjMq6i5qu/mL67XTk
hvKwrC83zme66qaKApmKupDODPb0RRkutK/zHfd1zL7sciBQ6psnNadh8pE24w8O
2XVy1v2bgSNkGHABgncR7seyIg81JQ3c/Axxd6GsTztjLnlvGAlmT1TphE84mi99
fUaGD2A1u1qdIuNc+XuisFeNcUW6fct0+x97eS2eEGRr/7qxWmO/P20sFVzXc2bF
1QIDAQAB
-----END PUBLIC KEY-----`;

/**
 * Default RSA modulus (hex) for `/oauth2/signin` when `__NEXT_DATA__` has no `publicKey` / `modulus`.
 * DIP / EACP / AnyShare-style deployments use the ISFWeb `core/auth` PUBLIC_KEY (1024-bit, exp 65537).
 * Prefer key material from the sign-in page when present.
 */
export const DEFAULT_SIGNIN_RSA_MODULUS_HEX =
  "C1D9F84B95AF6B331FBA2D64D76A39CAD7529DA79DB4B3543E4DF3DF21723FEC6F7E2F6602E11037339AE0462DF6B39F94150FC256A505A8CA95BB3699E25C3FB84764D6A1DC3F483A2C1DC4F70925D85725151D0CFBF1EB5A6C4FA0E37ED32FED150C717CD82C528745CDB761D17635AC855421B3CBBEE7D405B2CA5C70CFA7";

/**
 * Default PEM for HTTP `/oauth2/signin`: **the fixed `STUDIOWEB_LOGIN_PUBLIC_KEY_PEM`** (matches
 * `kweaver-ai/kweaver/deploy/auto_cofig/auto_config.sh` `LOGIN_PUBLIC_KEY`). KWeaver platforms have
 * standardized on this single key — no fallback list, no probing of `__NEXT_DATA__` page key, no
 * `trying next candidate…` noise. Override with `--signin-public-key-file` /
 * `KWEAVER_SIGNIN_RSA_PUBLIC_KEY` if a deployment ever ships a different public key.
 */
function buildHttpSigninPemCandidates(_parsedMaterial: string | undefined): string[] {
  return [STUDIOWEB_LOGIN_PUBLIC_KEY_PEM];
}

/**
 * Build an SPKI PEM from an RSA modulus (hex) and public exponent (default 65537 / 0x10001).
 */
export function rsaModulusHexToSpkiPem(modulusHex: string, exponent: number = 65537): string {
  const hex = modulusHex.replace(/\s+/g, "");
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) {
    throw new Error("RSA modulus must be an even-length hex string.");
  }
  const nBuf = Buffer.from(hex, "hex");
  const eBytes: number[] = [];
  let exp = exponent;
  while (exp > 0) {
    eBytes.unshift(exp & 0xff);
    exp >>= 8;
  }
  const eBuf = Buffer.from(eBytes);
  const key = createPublicKey({
    key: {
      kty: "RSA",
      n: nBuf.toString("base64url"),
      e: eBuf.toString("base64url"),
    },
    format: "jwk",
  });
  return key.export({ type: "spki", format: "pem" }) as string;
}

/**
 * Import SPKI DER from Base64 (no PEM headers) — same shape as af-agent `RSA.importKey(base64.b64decode(...))`.
 */
function tryDerSpkiBase64ToPem(material: string): string | null {
  const trimmed = material.replace(/\s+/g, "");
  if (trimmed.length < 80 || !/^[A-Za-z0-9+/]+=*$/.test(trimmed)) {
    return null;
  }
  try {
    const buf = Buffer.from(trimmed, "base64");
    const key = createPublicKey({ key: buf, format: "der", type: "spki" });
    return key.export({ type: "spki", format: "pem" }) as string;
  } catch {
    return null;
  }
}

function isLikelyRsaHexModulusString(s: string): boolean {
  const h = s.replace(/\s+/g, "");
  return h.length >= 128 && h.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(h);
}

function isLikelySpkiBase64String(s: string): boolean {
  const t = s.replace(/\s+/g, "");
  if (t.length < 200 || !/^[A-Za-z0-9+/]+=*$/.test(t)) {
    return false;
  }
  return tryDerSpkiBase64ToPem(t) !== null;
}

/**
 * PEM from page (`BEGIN PUBLIC KEY` / `BEGIN RSA PUBLIC KEY`), hex modulus, or Base64 SPKI DER.
 * When `material` is missing, uses the built-in modulus (`DEFAULT_SIGNIN_RSA_MODULUS_HEX`) so
 * `--http-signin` does not require extra CLI flags. Opt out with `KWEAVER_SIGNIN_DISALLOW_BUILTIN_MODULUS=1`.
 */
function resolveSigninPublicKeyPem(
  material: string | undefined,
  opts?: { allowBuiltinModulus?: boolean },
): string {
  const disallowBuiltin =
    opts?.allowBuiltinModulus === false || process.env.KWEAVER_SIGNIN_DISALLOW_BUILTIN_MODULUS === "1";
  if (material?.trim()) {
    const m = material.trim();
    if (m.includes("BEGIN PUBLIC KEY") || m.includes("BEGIN RSA PUBLIC KEY")) {
      return m;
    }
    const hex = m.replace(/\s+/g, "");
    if (/^[0-9a-fA-F]+$/.test(hex) && hex.length % 2 === 0) {
      return rsaModulusHexToSpkiPem(hex);
    }
    const fromDer = tryDerSpkiBase64ToPem(m);
    if (fromDer) {
      return fromDer;
    }
    throw new Error(
      "RSA public key material is present but could not be parsed (expected PEM, hex modulus, or Base64 SPKI).",
    );
  }
  if (disallowBuiltin) {
    throw new Error(
      "No RSA public key in sign-in HTML and built-in modulus disabled (KWEAVER_SIGNIN_DISALLOW_BUILTIN_MODULUS=1). " +
        "Use --signin-public-key-file or KWEAVER_SIGNIN_RSA_PUBLIC_KEY.",
    );
  }
  return rsaModulusHexToSpkiPem(DEFAULT_SIGNIN_RSA_MODULUS_HEX.replace(/\s+/g, ""));
}

/**
 * Recursively find a string that looks like PEM, hex modulus, or Base64 SPKI in `pageProps` (nested configs).
 */
function deepFindSigninRsaMaterial(obj: unknown, depth: number, seen: Set<unknown>): string | undefined {
  if (depth < 0 || obj === null || obj === undefined) {
    return undefined;
  }
  if (typeof obj === "string") {
    const t = obj.trim();
    if (!t) {
      return undefined;
    }
    if (t.includes("BEGIN PUBLIC KEY") || t.includes("BEGIN RSA PUBLIC KEY")) {
      return t;
    }
    if (isLikelyRsaHexModulusString(t)) {
      return t.replace(/\s+/g, "");
    }
    if (isLikelySpkiBase64String(t)) {
      return t.replace(/\s+/g, "");
    }
    return undefined;
  }
  if (typeof obj !== "object") {
    return undefined;
  }
  if (seen.has(obj)) {
    return undefined;
  }
  seen.add(obj);
  if (Array.isArray(obj)) {
    for (const el of obj) {
      const r = deepFindSigninRsaMaterial(el, depth - 1, seen);
      if (r) {
        return r;
      }
    }
    return undefined;
  }
  const rec = obj as Record<string, unknown>;
  for (const k of Object.keys(rec)) {
    const r = deepFindSigninRsaMaterial(rec[k], depth - 1, seen);
    if (r) {
      return r;
    }
  }
  return undefined;
}

/**
 * Regex fallback when JSON path differs (escaped quotes, minified bundles, inline scripts).
 * Some deployments put the SPKI Base64 as a raw substring (no JSON key).
 */
function extractSigninRsaMaterialFromHtml(html: string): string | undefined {
  const pemPub = html.match(/-----BEGIN PUBLIC KEY-----[\s\S]*?-----END PUBLIC KEY-----/);
  if (pemPub) {
    return pemPub[0].trim();
  }
  const pemRsa = html.match(/-----BEGIN RSA PUBLIC KEY-----[\s\S]*?-----END RSA PUBLIC KEY-----/);
  if (pemRsa) {
    return pemRsa[0].trim();
  }

  const jsonPatterns: RegExp[] = [
    /"modulus"\s*:\s*"([0-9a-fA-F]{128,})"/,
    /'modulus'\s*:\s*'([0-9a-fA-F]{128,})'/,
    /"(?:publicKey|rsaPublicKey|public_key|encryptPublicKey|rsaModulus|passwordPublicKey|loginPublicKey|pwdPublicKey|encryptKey)"\s*:\s*"([A-Za-z0-9+/=\s]{200,})"/,
    /'(?:publicKey|rsaPublicKey|public_key)'\s*:\s*'([A-Za-z0-9+/=]{200,})'/,
  ];
  for (const re of jsonPatterns) {
    const m = html.match(re);
    if (m?.[1]) {
      return m[1].replace(/\s+/g, "");
    }
  }

  // Raw SPKI Base64 blocks (2048-bit RSA SPKI often starts with MIIBIjAN…)
  const rawSpki = html.match(
    /(MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA[A-Za-z0-9+/=]{80,800})/,
  );
  if (rawSpki) {
    return rawSpki[1].replace(/\s+/g, "");
  }
  const rawSpki1024 = html.match(
    /(MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQ[A-Za-z0-9+/=\s]{80,500})/,
  );
  if (rawSpki1024) {
    return rawSpki1024[1].replace(/\s+/g, "");
  }
  return undefined;
}

/** Match `rsa.min` / Studio `rsaEncrypt`: base64 with newline every 64 chars (EACP may validate format). */
function formatPasswordBase64LikeRsaMin(b64: string): string {
  return b64.replace(/(.{64})/g, "$1\n");
}

function extractRsaPublicKeyMaterialFromPageProps(pageProps: Record<string, unknown>): string | undefined {
  const keys = [
    "publicKey",
    "rsaPublicKey",
    "public_key",
    "modulus",
    "encryptPublicKey",
    "pubKey",
    "rsaModulus",
    "passwordPublicKey",
    "loginPublicKey",
    "encryptKey",
    "pwdPublicKey",
    "modulusHex",
    "rsaPublicKeyHex",
  ];
  for (const k of keys) {
    const v = pageProps[k];
    if (typeof v === "string" && v.trim()) {
      return v.trim();
    }
  }
  return deepFindSigninRsaMaterial(pageProps, 5, new Set());
}

/** Identity resolved from EACP `/api/eacp/v1/user/get` for the bound access token. */
export interface EacpUserInfo {
  /** "user" — interactive end-user; "app" — service / application identity. */
  type: "user" | "app";
  /** EACP id (`userid` for users, `id` for apps). */
  id: string;
  /** Login name (e.g. "alice@example.com"). User tokens only. */
  account?: string;
  /** Display name — `visionName` for users, app name for apps. */
  name?: string;
}

/**
 * Probe EACP for the bound identity. Returns `null` on any failure (network,
 * non-2xx, malformed JSON, unknown `type`). Callers must treat absence as a
 * soft signal — this never throws and never blocks the user's actual command.
 *
 * The shape differs per token type, mirroring the EACP backend:
 *   - `type: "user"` → `{ userid, account, name, ... }`
 *   - `type: "app"`  → `{ id, name }`
 */
export async function fetchEacpUserInfo(
  baseUrl: string,
  accessToken: string,
  tlsInsecure?: boolean,
): Promise<EacpUserInfo | null> {
  try {
    const res = await runWithTlsInsecure(tlsInsecure, () =>
      fetch(`${baseUrl}/api/eacp/v1/user/get`, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      }),
    );
    if (!res.ok) return null;
    const raw = (await res.json()) as Record<string, unknown>;
    const type = raw.type;
    if (type !== "user" && type !== "app") return null;
    const idCandidate = type === "user" ? raw.userid : raw.id;
    const id = typeof idCandidate === "string" ? idCandidate : "";
    if (!id) return null;
    return {
      type,
      id,
      account: typeof raw.account === "string" ? raw.account : undefined,
      name: typeof raw.name === "string" ? raw.name : undefined,
    };
  } catch {
    return null;
  }
}

/** Best-effort fetch of display name via EACP userinfo (ShareServer). */
async function fetchDisplayName(
  baseUrl: string,
  accessToken: string,
  tlsInsecure?: boolean,
): Promise<string | null> {
  const info = await fetchEacpUserInfo(baseUrl, accessToken, tlsInsecure);
  return info?.account ?? info?.name ?? null;
}

/**
 * Characters that bash/zsh/sh AND cmd.exe/PowerShell all leave untouched when
 * a value is written without surrounding quotes. Real-world OAuth values
 * (URLs, UUID-like client IDs, base64url refresh tokens) live in this set, so
 * we can emit them bare and the resulting command is portable across macOS,
 * Linux, Windows cmd, and PowerShell — including the copy-mac-paste-to-windows
 * (and the reverse) workflow.
 */
const SHELL_SAFE_VALUE = /^[A-Za-z0-9._:/+=@-]+$/;

/**
 * Quote a value for safe copy-paste into a shell command.
 *
 * Strategy:
 * - If the value only contains "shell-safe" characters, return it bare. This
 *   keeps the printed command portable across shells (issue #74: POSIX single
 *   quotes are literal in cmd.exe, so any quoting locks the line to one OS).
 * - Otherwise the value contains characters the shell would interpret
 *   (space, `&`, `|`, `$`, `*`, ...), so we must quote per host shell:
 *     - win32 (cmd.exe / PowerShell): wrap in `"..."`; embedded `"` -> `""`
 *     - POSIX (bash/zsh/sh): wrap in `'...'`; embedded `'` -> `'\''`
 *
 * `platform` defaults to `process.platform`; passable for tests and for
 * generating commands targeted at a specific shell.
 */
export function shellQuoteForShell(
  value: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (value !== "" && SHELL_SAFE_VALUE.test(value)) {
    return value;
  }
  if (platform === "win32") {
    return `"${value.replace(/"/g, `""`)}"`;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Build a one-line `kweaver auth login ...` command for headless / other machines.
 * Omits `--client-secret` when empty (PKCE-only client); headless refresh may still require a confidential client.
 *
 * `platform` defaults to `process.platform`; pass explicitly in tests or when
 * generating a command meant for a different OS.
 */
export function buildCopyCommand(
  baseUrl: string,
  clientId: string,
  clientSecret: string,
  refreshToken: string | undefined,
  tlsInsecure?: boolean,
  platform: NodeJS.Platform = process.platform,
): string {
  const q = (v: string) => shellQuoteForShell(v, platform);
  const parts = ["kweaver", "auth", "login", q(normalizeBaseUrl(baseUrl)), "--client-id", q(clientId)];
  if (clientSecret) {
    parts.push("--client-secret", q(clientSecret));
  }
  if (refreshToken) {
    parts.push("--refresh-token", q(refreshToken));
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
/** @internal Exported for CLI env-only identity resolution (`env-snapshot.ts`). */
export async function runWithTlsInsecure<T>(tlsInsecure: boolean | undefined, fn: () => Promise<T>): Promise<T> {
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
      if (location.includes("error=")) {
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
    const storedUri = client.redirectUri ?? redirectUri;
    const valid = await isClientStillValid(baseUrl, client.clientId, storedUri);
    if (valid) {
      if (storedUri !== redirectUri) {
        process.stderr.write(
          "Redirect URI changed. Re-registering OAuth2 client…\n",
        );
        deleteClientConfig(baseUrl);
        client = null;
      } else {
        return client;
      }
    } else {
      process.stderr.write(
        "Cached OAuth2 client is no longer valid on the server. Re-registering…\n",
      );
      deleteClientConfig(baseUrl);
      client = null;
    }
  }

  const registered = await registerOAuth2Client(baseUrl, redirectUri, scope);
  saveClientConfig(baseUrl, registered);
  return registered;
}

/**
 * Emphasize text on stderr (bold + bright yellow) when stderr is a TTY and `NO_COLOR` is unset.
 * See https://no-color.org/
 */
function stderrEmphasis(text: string): string {
  const noColor = process.env.NO_COLOR;
  if (noColor != null && noColor !== "") {
    return text;
  }
  if (!process.stderr.isTTY) {
    return text;
  }
  return `\x1b[1;33m${text}\x1b[0m`;
}

/**
 * Headless login: read authorization code from stdin (full callback URL or raw code).
 * Used with `--no-browser` or when automatic browser launch fails.
 *
 * `io` is injectable for tests; defaults to `process.stdin` / `process.stderr`.
 */
export async function promptForCode(
  authUrl: string,
  state: string,
  port: number,
  pasteMode: "explicit" | "fallback" = "explicit",
  io?: { input?: NodeJS.ReadableStream; output?: NodeJS.WritableStream },
): Promise<string> {
  const { createInterface } = await import("node:readline");
  const stdin = io?.input ?? process.stdin;
  const stderr = io?.output ?? process.stderr;
  const intro =
    pasteMode === "explicit"
      ? "Open this URL on any device (use a private/incognito window if you need the full sign-in form):\n\n"
      : "Could not open a browser automatically. Open this URL on any device:\n\n";
  const pasteInstructions =
    "After login, the browser may show an error page (this is expected if nothing listens on localhost).\n" +
    "Copy the FULL URL from the address bar and paste it here, or paste only the authorization code.\n" +
    `The URL looks like: http://127.0.0.1:${port}/callback?code=THIS_PART&state=...\n\n`;
  stderr.write(
    "\n" +
      intro +
      `  ${authUrl}\n\n` +
      stderrEmphasis(pasteInstructions),
  );
  const rl = createInterface({ input: stdin, output: stderr });
  // The `close` listener exists to surface Ctrl-D / EOF before the user answers.
  // It MUST be a no-op once the question callback has fired, because `rl.close()`
  // emits `close` synchronously and would otherwise reject the promise before
  // `resolve(answer)` runs (race condition that turns valid input into "Login cancelled.").
  const input = await new Promise<string>((resolve, reject) => {
    let answered = false;
    rl.on("close", () => {
      if (!answered) reject(new Error("Login cancelled."));
    });
    rl.question("Paste URL or code> ", (answer) => {
      answered = true;
      rl.close();
      resolve(answer.trim());
    });
  });
  if (input.includes("code=")) {
    let url: URL;
    try {
      url = new URL(input.startsWith("http") ? input : `http://x/?${input}`);
    } catch {
      throw new Error("Could not parse the pasted URL. Paste the full callback URL or the code value.");
    }
    const receivedState = url.searchParams.get("state");
    if (receivedState && receivedState !== state) {
      throw new Error("OAuth2 state mismatch — possible CSRF attack.");
    }
    const err = url.searchParams.get("error");
    if (err) {
      const desc = url.searchParams.get("error_description") ?? "";
      throw new Error(
        desc ? `Authorization failed: ${err} — ${desc}` : `Authorization failed: ${err}`,
      );
    }
    const code = url.searchParams.get("code");
    if (!code) {
      throw new Error("No authorization code found in the pasted URL.");
    }
    return code;
  }
  if (!input) {
    throw new Error("No authorization code entered.");
  }
  return input;
}

/**
 * Prompt the user for a username on stderr (input echoed).
 *
 * `io` is injectable for tests; defaults to `process.stdin` / `process.stderr`.
 */
export async function promptForUsername(
  promptLabel = "Username",
  io?: { input?: NodeJS.ReadableStream; output?: NodeJS.WritableStream },
): Promise<string> {
  const { createInterface } = await import("node:readline");
  const stdin = io?.input ?? process.stdin;
  const stderr = io?.output ?? process.stderr;
  const rl = createInterface({ input: stdin, output: stderr });
  const value = await new Promise<string>((resolve, reject) => {
    let answered = false;
    rl.on("close", () => {
      if (!answered) reject(new Error("Login cancelled."));
    });
    rl.question(`${promptLabel}: `, (answer) => {
      answered = true;
      rl.close();
      resolve(answer.trim());
    });
  });
  if (!value) {
    throw new Error(`${promptLabel} is required.`);
  }
  return value;
}

/**
 * Prompt the user for a password on stderr without echoing keystrokes (TTY only).
 *
 * Falls back to a regular readline prompt when stdin is not a TTY (e.g. piped input
 * during scripted use); callers needing strict no-echo should detect this case themselves.
 *
 * `io` is injectable for tests.
 */
export async function promptForPassword(
  promptLabel = "Password",
  io?: { input?: NodeJS.ReadableStream & { isTTY?: boolean; setRawMode?: (mode: boolean) => unknown }; output?: NodeJS.WritableStream },
): Promise<string> {
  const stdin = io?.input ?? (process.stdin as NodeJS.ReadableStream & { isTTY?: boolean; setRawMode?: (mode: boolean) => unknown });
  const stderr = io?.output ?? process.stderr;

  // Non-TTY (piped, redirected, tests): use regular readline — no masking is possible
  // without raw mode, so we accept echoed input rather than block forever.
  if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
    const { createInterface } = await import("node:readline");
    const rl = createInterface({ input: stdin, output: stderr });
    const value = await new Promise<string>((resolve, reject) => {
      let answered = false;
      rl.on("close", () => {
        if (!answered) reject(new Error("Login cancelled."));
      });
      rl.question(`${promptLabel}: `, (answer) => {
        answered = true;
        rl.close();
        resolve(answer);
      });
    });
    if (!value) throw new Error(`${promptLabel} is required.`);
    return value;
  }

  // TTY: read byte-by-byte in raw mode so keystrokes are not echoed.
  return new Promise<string>((resolve, reject) => {
    stderr.write(`${promptLabel}: `);
    let buf = "";
    const onData = (chunk: Buffer) => {
      const s = chunk.toString("utf8");
      for (const ch of s) {
        const code = ch.charCodeAt(0);
        if (ch === "\n" || ch === "\r") {
          cleanup();
          stderr.write("\n");
          if (!buf) {
            reject(new Error(`${promptLabel} is required.`));
          } else {
            resolve(buf);
          }
          return;
        }
        if (code === 3) {
          // Ctrl-C
          cleanup();
          stderr.write("\n");
          reject(new Error("Login cancelled."));
          return;
        }
        if (code === 4 && buf.length === 0) {
          // Ctrl-D on empty buffer -> cancel
          cleanup();
          stderr.write("\n");
          reject(new Error("Login cancelled."));
          return;
        }
        if (code === 8 || code === 127) {
          // Backspace / DEL
          buf = buf.slice(0, -1);
          continue;
        }
        if (code < 32) continue; // ignore other control chars
        buf += ch;
      }
    };
    const cleanup = () => {
      try { stdin.setRawMode!(false); } catch { /* noop */ }
      stdin.removeListener("data", onData);
      if (typeof (stdin as { pause?: () => void }).pause === "function") {
        (stdin as { pause: () => void }).pause();
      }
    };
    try { stdin.setRawMode!(true); } catch { /* noop */ }
    if (typeof (stdin as { resume?: () => void }).resume === "function") {
      (stdin as { resume: () => void }).resume();
    }
    stdin.on("data", onData);
  });
}

/**
 * OAuth2 Authorization Code login flow.
 * 1. Register client (if not already registered), OR use a provided client ID
 * 2. Open browser to /oauth2/auth (unless `noBrowser` or browser launch fails)
 * 3. Receive authorization code via local HTTP callback, or stdin paste (`noBrowser` / fallback)
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
    /**
     * Do not open a browser; print the auth URL and prompt for the callback URL or code (stdin).
     * For headless servers or when automatic browser launch is unavailable.
     */
    noBrowser?: boolean;
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
  let client: ClientConfig;
  try {
    client = await resolveOrRegisterClient(base, redirectUri, scope, options);
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) {
      process.stderr.write(
        "OAuth2 endpoint not found (404). Saving platform in no-auth mode.\n",
      );
      return saveNoAuthPlatform(base, { tlsInsecure: options?.tlsInsecure });
    }
    throw e;
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

  const runPasteCodeFlow = async (pasteMode: "explicit" | "fallback"): Promise<TokenConfig> => {
    const code = await promptForCode(authUrl, state, port, pasteMode);
    const exchanged = await exchangeCodeForToken(
      base, code, client.clientId, client.clientSecret,
      redirectUri, pkce?.verifier, options?.tlsInsecure,
    );
    const copyCommand = buildCopyCommand(
      base, client.clientId, client.clientSecret,
      exchanged.refreshToken, options?.tlsInsecure,
    );
    process.stderr.write(
      "\nOn a machine without a browser, run:\n\n  " + copyCommand + "\n\n",
    );
    return exchanged;
  };

  let token: TokenConfig;

  if (options?.noBrowser) {
    token = await runPasteCodeFlow("explicit");
  } else {
    // Step 4: Local HTTP callback, or paste-code if browser cannot be opened
    token = await new Promise<TokenConfig>((resolve, reject) => {
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
            const code = url.searchParams.get("code");
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
            if (!code) {
              res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
              res.end(buildCallbackExchangeErrorHtml("No authorization code received in callback."));
              clearTimeout(timeoutId);
              server.close();
              reject(new Error("No authorization code received in callback."));
              return;
            }

            const exchanged = await exchangeCodeForToken(
              base, code, client.clientId, client.clientSecret,
              redirectUri, pkce?.verifier, options?.tlsInsecure,
            );
            const copyCommand = buildCopyCommand(
              base, client.clientId, client.clientSecret,
              exchanged.refreshToken, options?.tlsInsecure,
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
        void (async () => {
          const { openBrowser } = await import("../utils/browser.js");
          const opened = await openBrowser(authUrl);
          process.stderr.write(
            `If the wrong browser opens, copy this URL to your correct browser:\n  ${authUrl}\n`,
          );
          if (!opened) {
            clearTimeout(timeoutId);
            server.close();
            try {
              resolve(await runPasteCodeFlow("fallback"));
            } catch (err) {
              reject(err instanceof Error ? err : new Error(String(err)));
            }
          }
        })();
      });
    });
  }

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

function mergeCookieJarForSignin(existing: string, response: Response): string {
  const setCookies =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : (() => {
          const raw = response.headers.get("set-cookie");
          return raw ? [raw] : [];
        })();
  const map = new Map<string, string>();
  for (const part of existing
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)) {
    const eq = part.indexOf("=");
    if (eq > 0) map.set(part.slice(0, eq), part.slice(eq + 1));
  }
  for (const sc of setCookies) {
    const first = sc.split(";")[0]?.trim() ?? "";
    const eq = first.indexOf("=");
    if (eq > 0) map.set(first.slice(0, eq), first.slice(eq + 1));
  }
  return [...map.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

/**
 * Parse query parameters from a `Location` header value (absolute or relative URL).
 */
function parseQueryFromLocationHeader(location: string): Record<string, string> {
  const q = location.includes("?") ? location.slice(location.indexOf("?")) : "";
  const params = new URLSearchParams(q.startsWith("?") ? q.slice(1) : q);
  const out: Record<string, string> = {};
  params.forEach((v, k) => {
    out[k] = v;
  });
  return out;
}

/**
 * Parse Next.js `__NEXT_DATA__` from the OAuth2 sign-in HTML shell (CSRF + optional challenge/remember for POST /oauth2/signin).
 * Hydra `login_challenge` may appear only in the sign-in URL; use that when `pageProps.challenge` is absent.
 */
export function parseSigninPageHtmlProps(html: string): {
  challenge?: string;
  csrftoken: string;
  remember?: boolean;
  /** Hex modulus, PEM, or Base64 SPKI from page (nested search + HTML regex fallback). */
  rsaPublicKeyMaterial?: string;
} {
  const m = html.match(/<script[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!m) {
    throw new Error("Could not find __NEXT_DATA__ on the sign-in page.");
  }
  const data = JSON.parse(m[1]) as Record<string, unknown>;
  const pageProps = (data.props as Record<string, unknown> | undefined)?.pageProps as
    | Record<string, unknown>
    | undefined;
  if (!pageProps) {
    throw new Error("Invalid __NEXT_DATA__: missing pageProps.");
  }
  const challenge = pageProps.challenge;
  const csrftoken = pageProps.csrftoken ?? pageProps._csrf;
  if (typeof csrftoken !== "string") {
    throw new Error(
      "Sign-in page did not expose csrftoken (expected in __NEXT_DATA__.props.pageProps).",
    );
  }
  const challengeStr = typeof challenge === "string" ? challenge : undefined;
  const rememberRaw = pageProps.remember;
  const remember =
    typeof rememberRaw === "boolean"
      ? rememberRaw
      : typeof rememberRaw === "string"
        ? rememberRaw === "true"
        : undefined;
  let rsaPublicKeyMaterial = extractRsaPublicKeyMaterialFromPageProps(pageProps);
  if (!rsaPublicKeyMaterial) {
    rsaPublicKeyMaterial = deepFindSigninRsaMaterial(data, 10, new Set());
  }
  if (!rsaPublicKeyMaterial) {
    rsaPublicKeyMaterial = extractSigninRsaMaterialFromHtml(html);
  }
  return { challenge: challengeStr, csrftoken, remember, rsaPublicKeyMaterial };
}

async function followSigninRedirectsUntilCallback(
  startUrl: string,
  initialJar: string,
  state: string,
  redirectUri: string,
  base: string,
  scope: string,
): Promise<{ code: string; jar: string }> {
  let url = startUrl;
  let jar = initialJar;
  const callbackHost = new URL(redirectUri).origin;
  const callbackPath = new URL(redirectUri).pathname;

  for (let hop = 0; hop < 40; hop++) {
    const resp = await fetch(url, {
      method: "GET",
      headers: {
        Cookie: jar,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "manual",
    });
    jar = mergeCookieJarForSignin(jar, resp);

    if (resp.status === 302 || resp.status === 303 || resp.status === 307 || resp.status === 308) {
      const loc = resp.headers.get("location");
      if (!loc) {
        throw new HttpError(resp.status, "Missing Location", "");
      }
      const next = new URL(loc, url);
      if (next.origin === callbackHost && next.pathname === callbackPath) {
        const code = next.searchParams.get("code");
        const st = next.searchParams.get("state");
        if (st !== state) {
          throw new Error("OAuth2 state mismatch — possible CSRF attack.");
        }
        const err = next.searchParams.get("error");
        if (err) {
          const desc = next.searchParams.get("error_description") ?? "";
          throw new Error(desc ? `Authorization failed: ${err} — ${desc}` : `Authorization failed: ${err}`);
        }
        if (!code) {
          throw new Error("Callback URL missing authorization code.");
        }
        return { code, jar };
      }
      url = next.href;
      continue;
    }

    if (resp.status === 200) {
      const html = await resp.text();
      const consentResult = await tryAcceptConsentAfterSignin(
        base,
        url,
        html,
        jar,
        scope,
        state,
        redirectUri,
      );
      if (consentResult) {
        return consentResult;
      }
      throw new Error(
        `Unexpected OAuth page (HTTP 200) at ${url.slice(0, 120)}… ` +
          `If this is a consent or MFA screen, use browser login (kweaver auth login <url>).`,
      );
    }

    const text = await resp.text().catch(() => "");
    throw new HttpError(resp.status, resp.statusText, text);
  }
  throw new Error("Too many OAuth redirects.");
}

async function tryAcceptConsentAfterSignin(
  base: string,
  pageUrl: string,
  html: string,
  jar: string,
  scope: string,
  state: string,
  redirectUri: string,
): Promise<{ code: string; jar: string } | null> {
  let data: Record<string, unknown>;
  try {
    const m = html.match(/<script[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
    if (!m) {
      return null;
    }
    data = JSON.parse(m[1]) as Record<string, unknown>;
  } catch {
    return null;
  }
  const pageProps = (data.props as Record<string, unknown> | undefined)?.pageProps as
    | Record<string, unknown>
    | undefined;
  if (!pageProps) {
    return null;
  }
  const consentChallenge = pageProps.consent_challenge;
  if (typeof consentChallenge !== "string") {
    return null;
  }

  const scopes = scope.split(/\s+/).filter(Boolean);
  const body = new URLSearchParams();
  body.set("consent_challenge", consentChallenge);
  for (const s of scopes) {
    body.append("grant_scope", s);
  }
  const resp = await fetch(`${base}/oauth2/consent`, {
    method: "POST",
    headers: {
      Cookie: jar,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
    },
    body: body.toString(),
    redirect: "manual",
  });
  const newJar = mergeCookieJarForSignin(jar, resp);
  if (resp.status === 302 || resp.status === 303 || resp.status === 307) {
    const loc = resp.headers.get("location");
    if (!loc) {
      throw new HttpError(resp.status, "Missing Location after consent", "");
    }
    return followSigninRedirectsUntilCallback(
      new URL(loc, pageUrl).href,
      newJar,
      state,
      redirectUri,
      base,
      scope,
    );
  }
  return null;
}

/**
 * Build the JSON body for `POST /oauth2/signin` (matches the browser `oauth2-ui` form).
 *
 * `device.client_type` MUST be a value present in the EACP whitelist defined by
 * `kweaver/deploy/auto_cofig/auto_config.sh`. `console_web` is the canonical CLI value
 * (also used by `kweaver-admin`); other values such as `unknown` are rejected by strict
 * deployments with `管理员已禁止此类客户端登录` — surfaced upstream as a `request_forbidden`
 * `No CSRF value available in the session cookie` error after Hydra discards the rejected
 * login challenge.
 *
 * `vcode` and `dualfactorauthinfo` must be present even when empty; otherwise eachttpserver
 * returns HTTP 400 (invalid parameter).
 */
export function buildOauth2SigninPostBody(opts: {
  csrftoken: string;
  challenge: string;
  account: string;
  passwordCipher: string;
  remember: boolean;
}): Record<string, unknown> {
  return {
    _csrf: opts.csrftoken,
    challenge: opts.challenge,
    account: opts.account,
    password: opts.passwordCipher,
    vcode: { id: "", content: "" },
    dualfactorauthinfo: {
      validcode: { vcode: "" },
      OTP: { OTP: "" },
    },
    remember: opts.remember,
    device: {
      name: "",
      description: "",
      client_type: "console_web",
      udids: [],
    },
  };
}

/**
 * OAuth2 Authorization Code login using HTTP **only**: `GET /oauth2/signin` (Next.js shell) and
 * `POST /oauth2/signin` with an RSA PKCS#1 v1.5–encrypted password (same as the browser `rsa.min` / Studio
 * `core/mediator/auth` path).
 *
 * `/oauth2/auth` uses `product` `adp` by default (KWeaver Studio shell); set `oauthProduct` or `KWEAVER_OAUTH_PRODUCT` for DIP (`dip`).
 * Password ciphertext defaults to **single-line base64** (PyCrypto-style); set `KWEAVER_SIGNIN_PASSWORD_B64_RSA_MIN=1` for rsa.min-style wrapped lines.
 */
export async function oauth2PasswordSigninLogin(
  baseUrl: string,
  options: {
    username: string;
    password: string;
    port?: number;
    scope?: string;
    clientId?: string;
    clientSecret?: string;
    tlsInsecure?: boolean;
    /**
     * `product` query for `/oauth2/auth` (must match deployment). Default `adp`; DIP deployments often use `dip`.
     * @default KWEAVER_OAUTH_PRODUCT env or `adp`
     */
    oauthProduct?: string;
    /**
     * Password ciphertext: `rsa.min` uses newline every 64 chars; PyCrypto / some gateways expect a single base64 line.
     * @default false (single-line base64, matches kweaver-core EACP-style encryption)
     */
    signinPasswordBase64Plain?: boolean;
    /**
     * PEM / hex / Base64-SPKI file path — overrides key from the sign-in HTML.
     * Env: `KWEAVER_SIGNIN_RSA_PUBLIC_KEY` (same path semantics as CLI `--signin-public-key-file`).
     */
    signinPublicKeyPemPath?: string;
  },
): Promise<TokenConfig> {
  return runWithTlsInsecure(options.tlsInsecure, async () => {
    const { publicEncrypt, constants: cryptoConstants } = await import("node:crypto");
    const { randomBytes } = await import("node:crypto");

    const base = normalizeBaseUrl(baseUrl);
    const port = options.port ?? DEFAULT_REDIRECT_PORT;
    const scope = options.scope ?? DEFAULT_SCOPE;
    const redirectUri = `http://127.0.0.1:${port}/callback`;

    const state = randomBytes(12).toString("hex");
    const oauthProduct =
      options.oauthProduct?.trim() ||
      (typeof process.env.KWEAVER_OAUTH_PRODUCT === "string" && process.env.KWEAVER_OAUTH_PRODUCT.trim()
        ? process.env.KWEAVER_OAUTH_PRODUCT.trim()
        : "adp");

    // Note: previously we pre-flighted `/interface/studioweb/login` to detect deployments
    // missing the Studio web shell. The probe added an extra round-trip and was unreliable
    // (see kweaver-admin which works fine without it). HTTP sign-in only needs `/oauth2/auth`
    // and `/oauth2/signin`; if either is missing the request below will surface a precise error.
    let client: ClientConfig;
    try {
      client = await resolveOrRegisterClient(base, redirectUri, scope, {
        clientId: options.clientId,
        clientSecret: options.clientSecret,
      });
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) {
        process.stderr.write(
          "OAuth2 endpoint not found (404). Saving platform in no-auth mode.\n",
        );
        return saveNoAuthPlatform(base, { tlsInsecure: options.tlsInsecure });
      }
      throw e;
    }

    const usePkce = !client.clientSecret;
    const pkce = usePkce ? await generatePkce() : null;

    const authParams = new URLSearchParams({
      redirect_uri: redirectUri,
      "x-forwarded-prefix": "",
      client_id: client.clientId,
      scope,
      response_type: "code",
      state,
      lang: "zh-cn",
      product: oauthProduct,
    });
    if (pkce) {
      authParams.set("code_challenge", pkce.challenge);
      authParams.set("code_challenge_method", "S256");
    }
    const authUrl = `${base}/oauth2/auth?${authParams.toString()}`;

    let jar = "";
    const authResp = await fetch(authUrl, { method: "GET", redirect: "manual" });
    jar = mergeCookieJarForSignin(jar, authResp);
    if (authResp.status !== 302 && authResp.status !== 303 && authResp.status !== 307) {
      const t = await authResp.text();
      throw new HttpError(authResp.status, authResp.statusText, t);
    }
    const authLoc = authResp.headers.get("location");
    if (!authLoc) {
      throw new HttpError(authResp.status, "Missing Location after /oauth2/auth", "");
    }
    const signinUrl = new URL(authLoc, base);
    if (!signinUrl.pathname.includes("signin")) {
      throw new Error(`Expected redirect to a sign-in page, got: ${authLoc}`);
    }

    const signinPageResp = await fetch(signinUrl.href, {
      method: "GET",
      headers: {
        Cookie: jar,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "manual",
    });
    jar = mergeCookieJarForSignin(jar, signinPageResp);
    if (signinPageResp.status !== 200) {
      const t = await signinPageResp.text();
      throw new HttpError(signinPageResp.status, signinPageResp.statusText, t);
    }
    const html = await signinPageResp.text();
    const parsed = parseSigninPageHtmlProps(html);
    const loginChallenge =
      signinUrl.searchParams.get("login_challenge")?.trim() || parsed.challenge?.trim();
    if (!loginChallenge) {
      throw new Error(
        "Could not resolve login challenge: missing login_challenge in sign-in URL and __NEXT_DATA__.props.pageProps.challenge.",
      );
    }
    const csrftoken = parsed.csrftoken;
    const remember = parsed.remember ?? false;

    const keyPath =
      options.signinPublicKeyPemPath?.trim() ||
      (typeof process.env.KWEAVER_SIGNIN_RSA_PUBLIC_KEY === "string"
        ? process.env.KWEAVER_SIGNIN_RSA_PUBLIC_KEY.trim()
        : "");
    const pems: string[] = keyPath
      ? [
          resolveSigninPublicKeyPem((await readFile(keyPath, "utf8")).trim(), {
            allowBuiltinModulus: false,
          }),
        ]
      : buildHttpSigninPemCandidates(parsed.rsaPublicKeyMaterial);

    const usePlainB64 =
      options.signinPasswordBase64Plain === true
        ? true
        : options.signinPasswordBase64Plain === false
          ? false
          : process.env.KWEAVER_SIGNIN_PASSWORD_B64_RSA_MIN !== "1";

    const postBody = buildOauth2SigninPostBody({
      csrftoken,
      challenge: loginChallenge,
      account: options.username,
      passwordCipher: "",
      remember,
    });

    const origin = new URL(base).origin;
    /** Some gateways (e.g. DIP) return HTTP 200 + `{"redirect":"..."}` instead of 3xx Location. */
    let signinRedirectFromJson: string | undefined;

    // Single fixed RSA public key (STUDIOWEB_LOGIN_PUBLIC_KEY_PEM) unless the caller overrides via
    // --signin-public-key-file / KWEAVER_SIGNIN_RSA_PUBLIC_KEY. No fallback list, no candidate noise.
    const pem = pems[0];
    const encrypted = publicEncrypt(
      { key: pem, padding: cryptoConstants.RSA_PKCS1_PADDING },
      Buffer.from(options.password, "utf8"),
    );
    const rawB64 = encrypted.toString("base64");
    const passwordB64 = usePlainB64 ? rawB64 : formatPasswordBase64LikeRsaMin(rawB64);
    postBody.password = passwordB64;

    const postResp = await fetch(`${base}/oauth2/signin`, {
      method: "POST",
      headers: {
        Cookie: jar,
        "Content-Type": "application/json",
        Accept: "application/json, text/plain, */*",
        Origin: origin,
        Referer: signinUrl.href,
      },
      body: JSON.stringify(postBody),
      redirect: "manual",
    });
    jar = mergeCookieJarForSignin(jar, postResp);

    if (postResp.status !== 302 && postResp.status !== 303 && postResp.status !== 307) {
      const bodyText = await postResp.text();

      if (/RSA_private_decrypt/i.test(bodyText)) {
        throw new Error(
          "HTTP sign-in: RSA ciphertext rejected by server. The built-in STUDIOWEB_LOGIN_PUBLIC_KEY_PEM " +
            "does not match this deployment's `/oauth2/signin` public key. Provide the correct key via " +
            "--signin-public-key-file <pem> or KWEAVER_SIGNIN_RSA_PUBLIC_KEY=...",
        );
      }

      if (postResp.status === 200) {
        const ct = postResp.headers.get("content-type") ?? "";
        const looksLikeJson =
          ct.includes("application/json") || /^\s*\{/.test(bodyText);
        if (looksLikeJson) {
          let j: Record<string, unknown>;
          try {
            j = JSON.parse(bodyText) as Record<string, unknown>;
          } catch {
            throw new Error(`Sign-in failed: ${bodyText.slice(0, 500)}`);
          }
          const redir = j.redirect;
          if (typeof redir === "string" && redir.trim() !== "") {
            signinRedirectFromJson = redir.trim();
          } else {
            const msg =
              typeof j.message === "string"
                ? j.message
                : typeof j.error === "string"
                  ? j.error
                  : bodyText.slice(0, 500);
            throw new Error(`Sign-in failed: ${msg}`);
          }
        } else {
          throw new Error(
            "Sign-in POST returned 200 without redirect. Check password, CSRF, or RSA public key PEM.",
          );
        }
      } else {
        if (postResp.status === 401) {
          try {
            const j = JSON.parse(bodyText) as { code?: unknown; message?: unknown };
            const c = j.code;
            if (c === 401001017 || c === "401001017") {
              const msg =
                typeof j.message === "string" && j.message.trim() !== ""
                  ? j.message.trim()
                  : "Initial password must be changed before login.";
              throw new InitialPasswordChangeRequiredError({
                account: options.username,
                baseUrl: base,
                serverMessage: msg,
              });
            }
          } catch (e) {
            if (e instanceof InitialPasswordChangeRequiredError) throw e;
          }
        }
        throw new HttpError(postResp.status, postResp.statusText, bodyText);
      }
    }

    let code: string;
    if (signinRedirectFromJson) {
      const out = await followSigninRedirectsUntilCallback(
        new URL(signinRedirectFromJson, base).href,
        jar,
        state,
        redirectUri,
        base,
        scope,
      );
      code = out.code;
    } else if (postResp.status === 302 || postResp.status === 303 || postResp.status === 307) {
      const loc = postResp.headers.get("location");
      if (!loc) {
        throw new HttpError(postResp.status, "Missing Location after sign-in", "");
      }
      const out = await followSigninRedirectsUntilCallback(
        new URL(loc, base).href,
        jar,
        state,
        redirectUri,
        base,
        scope,
      );
      code = out.code;
    } else {
      throw new Error("HTTP sign-in: exhausted RSA key candidates without redirect");
    }

    const token = await exchangeCodeForToken(
      base,
      code,
      client.clientId,
      client.clientSecret,
      redirectUri,
      pkce?.verifier,
      options.tlsInsecure,
    );
    const copyCommand = buildCopyCommand(
      base,
      client.clientId,
      client.clientSecret,
      token.refreshToken,
      options.tlsInsecure,
    );
    process.stderr.write(
      "\nHTTP sign-in: copy this command for headless hosts:\n\n" + copyCommand + "\n\n",
    );
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
  const redirectUri = `http://localhost:${DEFAULT_REDIRECT_PORT}/callback`;
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
  if (isNoAuth(token.accessToken)) {
    return false;
  }
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
  if (isNoAuth(token.accessToken)) {
    throw new Error(`Cannot refresh no-auth session for ${baseUrl}.`);
  }
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
      fetchWithRetry(url, {
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
      tokenType: isNoAuth(rawToken) ? "none" : "bearer",
      scope: "",
      obtainedAt: new Date().toISOString(),
    };
  }

  if (!opts?.forceRefresh && envToken && !envBaseUrl) {
    const currentPlatformForEnv = getCurrentPlatform();
    if (currentPlatformForEnv) {
      const rawToken = envToken.replace(/^Bearer\s+/i, "");
      return {
        baseUrl: normalizeBaseUrl(currentPlatformForEnv),
        accessToken: rawToken,
        tokenType: isNoAuth(rawToken) ? "none" : "bearer",
        scope: "",
        obtainedAt: new Date().toISOString(),
      };
    }
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

  if (isNoAuth(token.accessToken)) {
    return token;
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
      if (isNoAuth(latest.accessToken)) {
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
      if (isNoAuth(token.accessToken)) {
        throw error;
      }
      const platformUrl = normalizeBaseUrl(token.baseUrl);
      // env-sourced token: no refresh_token / OAuth client — refresh is impossible.
      // Surface an env-aware hint instead of telling the user to `auth login` (which writes to disk).
      if (process.env.KWEAVER_TOKEN && !token.refreshToken) {
        throw new Error(
          `Authentication failed (401) for ${platformUrl}. Your KWEAVER_TOKEN appears to be invalid or expired.\n` +
            `  - Refresh the token and re-export: export KWEAVER_TOKEN=<new-token>\n` +
            `  - Or run \`kweaver auth login ${platformUrl}\` to save a full session (with refresh_token) to ~/.kweaver/.`,
          { cause: error },
        );
      }
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

function isTlsVerificationDisabledForProcess(): boolean {
  return (
    process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0" ||
    process.env.KWEAVER_TLS_INSECURE === "1" ||
    process.env.KWEAVER_TLS_INSECURE === "true"
  );
}

export function formatHttpError(error: unknown): string {
  if (error instanceof InitialPasswordChangeRequiredError) {
    return `${error.serverMessage} (code ${error.code})`;
  }
  if (error instanceof HttpError) {
    const oauthMessage = formatOAuthErrorBody(error.body);
    if (oauthMessage) {
      return `HTTP ${error.status} ${error.statusText}\n\n${oauthMessage}`;
    }
    const base = `${error.message}\n${error.body}`.trim();
    // Backend quirk: BKN returns 403 (sometimes 404) with body
    // `BknBackend.KnowledgeNetwork.NotFound` for unknown kn-id, which makes the
    // HTTP status look like a permission problem. Surface the real cause so
    // users don't waste time chasing auth.
    if (
      (error.status === 403 || error.status === 404) &&
      /BknBackend\.KnowledgeNetwork\.NotFound/.test(error.body)
    ) {
      return `${base}\nHint: this is a "knowledge network not found" error (the kn-id does not exist), not a permission/auth issue. Verify the kn-id you passed.`;
    }
    return base;
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
      const hint = isTlsVerificationDisabledForProcess()
        ? "Hint: TLS verification is already disabled for this process. Check network reachability, TLS termination, or proxy stability."
        : "Hint: use --insecure (-k) to skip TLS verification for self-signed certificates.";
      return `${error.message}: ${cause}\n${hint}`;
    }
    return error.message;
  }

  return String(error);
}
