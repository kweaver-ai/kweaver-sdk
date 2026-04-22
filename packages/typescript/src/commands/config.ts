import { listBusinessDomains } from "../api/business-domains.js";
import { fetchEacpUserInfo, normalizeBaseUrl, withTokenRetry } from "../auth/oauth.js";
import { HttpError } from "../utils/http.js";

// Resolve platform URL: saved current platform > KWEAVER_BASE_URL (normalized to
// match what `auth login` writes, so env users share the same platforms/<key>/ dir).
function resolvePlatformUrl(): string | undefined {
  const saved = getCurrentPlatform();
  if (saved) return saved;
  const env = process.env.KWEAVER_BASE_URL?.trim();
  return env ? normalizeBaseUrl(env) : undefined;
}
import {
  getCurrentPlatform,
  loadPlatformBusinessDomain,
  resolveBusinessDomain,
  savePlatformBusinessDomain,
} from "../config/store.js";

const HELP = `kweaver config

Subcommands:
  set-bd <value>    Set the default business domain for the current platform
  list-bd           List business domains as JSON (requires login)
  show              Show current config (platform, business domain)
  --help            Show this message

Examples:
  kweaver config set-bd 54308785-4438-43df-9490-a7fd11df5765
  kweaver config list-bd
  kweaver config show`;

export async function runConfigCommand(args: string[]): Promise<number> {
  const [sub, ...rest] = args;

  if (!sub || sub === "--help" || sub === "-h" || sub === "help") {
    console.log(HELP);
    return 0;
  }

  if (sub === "show") {
    const platform = resolvePlatformUrl();
    if (!platform) {
      console.error("No active platform. Run `kweaver auth login <url>` first.\n  Tip: set KWEAVER_BASE_URL to use this command without a saved login.");
      return 1;
    }
    const bd = resolveBusinessDomain(platform);
    const source = process.env.KWEAVER_BUSINESS_DOMAIN
      ? "env"
      : loadPlatformBusinessDomain(platform)
        ? "config"
        : "default";
    const platformSource = getCurrentPlatform() ? "" : " (KWEAVER_BASE_URL)";
    console.log(`Platform:        ${platform}${platformSource}`);
    console.log(`Business Domain: ${bd} (${source})`);
    return 0;
  }

  if (sub === "set-bd") {
    const value = rest[0];
    if (!value || value.startsWith("-")) {
      console.error("Usage: kweaver config set-bd <value>");
      return 1;
    }
    const platform = resolvePlatformUrl();
    if (!platform) {
      console.error("No active platform. Run `kweaver auth login <url>` first.\n  Tip: set KWEAVER_BASE_URL to write the business domain for that platform.");
      return 1;
    }
    savePlatformBusinessDomain(platform, value);
    console.log(`Business domain set to: ${value} (${getCurrentPlatform() ? platform : `${platform} via KWEAVER_BASE_URL`})`);
    return 0;
  }

  if (sub === "list-bd") {
    const platform = resolvePlatformUrl();
    if (!platform) {
      console.error("No active platform. Run `kweaver auth login <url>` first.\n  Tip: set KWEAVER_BASE_URL and KWEAVER_TOKEN to use this command without a saved login.");
      return 1;
    }
    let lastAccessToken = "";
    let lastTlsInsecure: boolean | undefined;
    try {
      const rows = await withTokenRetry((token) => {
        lastAccessToken = token.accessToken;
        lastTlsInsecure = token.tlsInsecure;
        return listBusinessDomains({
          baseUrl: platform,
          accessToken: token.accessToken,
          tlsInsecure: token.tlsInsecure,
        });
      });
      const currentId = resolveBusinessDomain(platform);
      const payload = {
        currentId,
        domains: rows.map((r) => ({
          ...r,
          current: r.id === currentId,
        })),
      };
      console.log(JSON.stringify(payload, null, 2));
      return 0;
    } catch (error) {
      // The backend returns 401 + `invalid user_id` when the caller is an app
      // (service) token with no bound user. Probe EACP to confirm — if the
      // token really is `type:"app"`, swap the cryptic backend error for a
      // one-liner. Anything else falls through unchanged. See kweaver-core#263.
      const friendly = await maybeAppAccountMessage(error, platform, lastAccessToken, lastTlsInsecure);
      const message = friendly ?? (error instanceof Error ? error.message : String(error));
      console.error(`Failed to list business domains: ${message}`);
      return 1;
    }
  }

  console.error(`Unknown config subcommand: ${sub}`);
  console.log(HELP);
  return 1;
}

/**
 * Detect "app account hit a user-scoped endpoint" by signature, then confirm
 * with EACP. Returns a short user-facing message if the call really came from
 * an app token, otherwise `null` (caller falls back to the original error).
 *
 * Two layers of evidence are required (signature first, identity second) so
 * we don't probe EACP on every random failure and don't mislabel real auth
 * problems with a misleading "use a user account" hint.
 */
async function maybeAppAccountMessage(
  error: unknown,
  baseUrl: string,
  accessToken: string,
  tlsInsecure: boolean | undefined,
): Promise<string | null> {
  // Unwrap: withTokenRetry wraps the original HttpError in a friendlier Error
  // when its alive-probe succeeds; for app tokens the probe endpoint returns
  // 2xx, so we drill into `cause` to recover the real backend body.
  const httpErr =
    error instanceof HttpError
      ? error
      : error instanceof Error && error.cause instanceof HttpError
        ? error.cause
        : null;
  if (!httpErr) return null;
  if (httpErr.status !== 401) return null;
  if (!/invalid user_id|get userinfo failed/.test(httpErr.body)) return null;
  if (!accessToken) return null;
  const info = await fetchEacpUserInfo(baseUrl, accessToken, tlsInsecure);
  if (info?.type !== "app") return null;
  return "This command does not support app accounts.";
}
