import { listBusinessDomains } from "../api/business-domains.js";
import { normalizeBaseUrl, requireUserToken, withTokenRetry } from "../auth/oauth.js";

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
    try {
      const rows = await withTokenRetry((token) => {
        // business-system requires a user-bound token; app tokens get a cryptic
        // 401/invalid_user_id from the backend. Fail fast with a clear message
        // that includes the caller's resolved identity.
        requireUserToken(token);
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
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to list business domains: ${message}`);
      return 1;
    }
  }

  console.error(`Unknown config subcommand: ${sub}`);
  console.log(HELP);
  return 1;
}
