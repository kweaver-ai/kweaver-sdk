import { listBusinessDomains } from "../api/business-domains.js";
import { withTokenRetry } from "../auth/oauth.js";
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
    const platform = getCurrentPlatform();
    if (!platform) {
      console.error("No active platform. Run `kweaver auth login <url>` first.");
      return 1;
    }
    const bd = resolveBusinessDomain(platform);
    const source = process.env.KWEAVER_BUSINESS_DOMAIN
      ? "env"
      : loadPlatformBusinessDomain(platform)
        ? "config"
        : "default";
    console.log(`Platform:        ${platform}`);
    console.log(`Business Domain: ${bd} (${source})`);
    return 0;
  }

  if (sub === "set-bd") {
    const value = rest[0];
    if (!value || value.startsWith("-")) {
      console.error("Usage: kweaver config set-bd <value>");
      return 1;
    }
    const platform = getCurrentPlatform();
    if (!platform) {
      console.error("No active platform. Run `kweaver auth login <url>` first.");
      return 1;
    }
    savePlatformBusinessDomain(platform, value);
    console.log(`Business domain set to: ${value}`);
    return 0;
  }

  if (sub === "list-bd") {
    const platform = getCurrentPlatform();
    if (!platform) {
      console.error("No active platform. Run `kweaver auth login <url>` first.");
      return 1;
    }
    try {
      const rows = await withTokenRetry((token) =>
        listBusinessDomains({
          baseUrl: platform,
          accessToken: token.accessToken,
          tlsInsecure: token.tlsInsecure,
        }),
      );
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
