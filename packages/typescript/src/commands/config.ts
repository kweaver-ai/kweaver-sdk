import { listBusinessDomains } from "../api/business-domains.js";
import { fetchEacpUserInfo, resolveActivePlatform, withTokenRetry } from "../auth/oauth.js";
import { HttpError } from "../utils/http.js";
import {
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
    const active = resolveActivePlatform();
    if (!active) {
      console.error("No active platform. Run `kweaver auth login <url>` first.\n  Tip: set KWEAVER_BASE_URL to use this command without a saved login.");
      return 1;
    }
    const platform = active.url;
    const bd = resolveBusinessDomain(platform);
    const bdSource = process.env.KWEAVER_BUSINESS_DOMAIN
      ? "env"
      : loadPlatformBusinessDomain(platform)
        ? "config"
        : "default";
    const platformSuffix = active.source === "env" ? " (KWEAVER_BASE_URL)" : "";
    console.log(`Platform:        ${platform}${platformSuffix}`);
    console.log(`Business Domain: ${bd} (${bdSource})`);
    return 0;
  }

  if (sub === "set-bd") {
    const value = rest[0];
    if (!value || value.startsWith("-")) {
      console.error("Usage: kweaver config set-bd <value>");
      return 1;
    }
    const active = resolveActivePlatform();
    if (!active) {
      console.error("No active platform. Run `kweaver auth login <url>` first.\n  Tip: set KWEAVER_BASE_URL to write the business domain for that platform.");
      return 1;
    }
    const platform = active.url;
    savePlatformBusinessDomain(platform, value);
    const provenance = active.source === "env" ? `${platform} via KWEAVER_BASE_URL` : platform;
    console.log(`Business domain set to: ${value} (${provenance})`);
    return 0;
  }

  if (sub === "list-bd") {
    const active = resolveActivePlatform();
    if (!active) {
      console.error("No active platform. Run `kweaver auth login <url>` first.\n  Tip: set KWEAVER_BASE_URL and KWEAVER_TOKEN to use this command without a saved login.");
      return 1;
    }
    const platform = active.url;
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
      // Backend returns 401 + `invalid user_id` when the caller is an app
      // (service) token with no bound user. Probe EACP to confirm — only swap
      // the cryptic backend body for a one-liner when we can prove `type:"app"`.
      // See kweaver-core#263.
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
 * Two layers of evidence (signature + identity) keep us from probing EACP on
 * every random failure and from mislabeling real auth problems.
 */
async function maybeAppAccountMessage(
  error: unknown,
  baseUrl: string,
  accessToken: string,
  tlsInsecure: boolean | undefined,
): Promise<string | null> {
  // Detect 401 either as a direct HttpError or via the wrapping Error's
  // message ("Authentication failed (401)..." / "...status 401..."). We don't
  // rely solely on the `cause` chain because withTokenRetry may attempt a
  // token refresh and then wrap with the *refresh* error as cause, dropping
  // the original list-bd HttpError.
  if (!is401Error(error)) return null;
  if (!accessToken) return null;
  const info = await fetchEacpUserInfo(baseUrl, accessToken, tlsInsecure);
  if (info?.type !== "app") return null;
  return "This command does not support app accounts.";
}

/** True if the error or any cause looks like a 401 from the platform. */
function is401Error(error: unknown): boolean {
  const seen = new Set<unknown>();
  const queue: unknown[] = [error];
  while (queue.length) {
    const cur = queue.shift();
    if (!cur || seen.has(cur)) continue;
    seen.add(cur);
    if (cur instanceof HttpError && cur.status === 401) return true;
    if (cur instanceof Error) {
      if (/\b401\b/.test(cur.message)) return true;
      if (cur.cause) queue.push(cur.cause);
    }
    if (cur instanceof AggregateError) queue.push(...cur.errors);
  }
  return false;
}
