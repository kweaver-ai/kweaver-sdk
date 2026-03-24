import {
  clearPlatformSession,
  deletePlatform,
  getConfigDir,
  getCurrentPlatform,
  getPlatformAlias,
  hasPlatform,
  listPlatforms,
  loadTokenConfig,
  resolvePlatformIdentifier,
  setCurrentPlatform,
  setPlatformAlias,
} from "../config/store.js";
import {
  formatHttpError,
  normalizeBaseUrl,
  oauth2Login,
  playwrightLogin,
} from "../auth/oauth.js";

export async function runAuthCommand(args: string[]): Promise<number> {
  const target = args[0];
  const rest = args.slice(1);

  if (!target || target === "--help" || target === "-h") {
    console.log(`kweaver auth login <url> [options]   Login to a platform (browser OAuth2)
kweaver auth <url>                   Login (shorthand)
kweaver auth status [url]            Show current auth status
kweaver auth list                    List saved platforms
kweaver auth use <url>               Switch active platform
kweaver auth logout [url]            Logout (clear local token)
kweaver auth delete <url>            Delete saved credentials

Login options:
  --client-id <id>       Use an existing OAuth2 client ID instead of registering a new one.
                         Use the platform's web app client ID to get the same permissions
                         as the browser. Find it in DevTools: /oauth2/auth?client_id=<id>
  --client-secret <s>    Client secret (omit for public/PKCE clients)
  --alias <name>         Save platform with a short alias`);
    return 0;
  }

  if (target === "login") {
    const url = rest[0];
    if (!url) {
      console.error("Usage: kweaver auth login <platform-url>");
      return 1;
    }
    return runAuthCommand([url, ...rest.slice(1)]);
  }

  if (target && target !== "status" && target !== "list" && target !== "use" && target !== "delete" && target !== "logout") {
    try {
      const normalizedTarget = normalizeBaseUrl(target);
      const alias = readOption(args, "--alias");
      const username = readOption(args, "--username") ?? readOption(args, "-u");
      const password = readOption(args, "--password") ?? readOption(args, "-p");
      const usePlaywright = args.includes("--playwright");
      const clientId = readOption(args, "--client-id");
      const clientSecret = readOption(args, "--client-secret");

      let token;

      if (username && password) {
        // Headless Playwright login with credentials
        console.log("Logging in (headless)...");
        token = await playwrightLogin(normalizedTarget, { username, password });
      } else if (usePlaywright) {
        // Explicit Playwright fallback
        console.log("Opening browser for login (Playwright)...");
        token = await playwrightLogin(normalizedTarget);
      } else {
        // Default: OAuth2 authorization code flow (supports refresh_token)
        if (clientId) {
          console.log(`Opening browser for OAuth2 login (client: ${clientId})...`);
        } else {
          console.log("Opening browser for OAuth2 login...");
        }
        token = await oauth2Login(normalizedTarget, { clientId: clientId ?? undefined, clientSecret: clientSecret ?? undefined });
      }

      if (alias) {
        setPlatformAlias(normalizedTarget, alias);
      }

      console.log(`Config directory: ${getConfigDir()}`);
      if (alias) {
        console.log(`Alias: ${alias.toLowerCase()}`);
      } else {
        const savedAlias = getPlatformAlias(normalizedTarget);
        if (savedAlias) {
          console.log(`Alias: ${savedAlias}`);
        }
      }
      console.log(`Current platform: ${normalizedTarget}`);
      console.log(`Access token saved: yes`);
      if (token.refreshToken) {
        console.log(`Refresh token: yes (auto-refresh enabled)`);
      } else {
        console.log(`Refresh token: no (token will expire in 1 hour)`);
      }
      if (token.expiresAt) {
        console.log(`Token expires at: ${token.expiresAt}`);
      }
      return 0;
    } catch (error) {
      console.error(formatHttpError(error));
      return 1;
    }
  }

  if (target === "status") {
    const resolvedTarget = args[1] ? resolvePlatformIdentifier(args[1]) : undefined;
    const statusTarget =
      resolvedTarget && /^https?:\/\//.test(resolvedTarget) ? normalizeBaseUrl(resolvedTarget) : resolvedTarget ?? undefined;

    const platform = statusTarget ?? getCurrentPlatform();
    if (!platform) {
      console.error("No active platform. Run `kweaver auth login <platform-url>` first.");
      return 1;
    }

    const token = loadTokenConfig(platform);
    if (!token) {
      console.error(
        statusTarget ? `No saved token for ${statusTarget}.` : "No saved token found."
      );
      return 1;
    }

    const currentPlatform = getCurrentPlatform();
    const lines = [
      `Config directory: ${getConfigDir()}`,
      `Platform: ${token.baseUrl}`,
      `Current platform: ${token.baseUrl === currentPlatform ? "yes" : "no"}`,
      `Token present: yes`,
    ];

    lines.push(`Refresh token: ${token.refreshToken ? "yes (auto-refresh enabled)" : "no"}`);

    if (token.expiresAt) {
      const expiry = new Date(token.expiresAt);
      const remainingMs = expiry.getTime() - Date.now();
      if (remainingMs > 0) {
        const remainingMin = Math.ceil(remainingMs / 60_000);
        lines.push(`Token status: active (expires in ${remainingMin} min)`);
      } else if (token.refreshToken) {
        lines.push(`Token status: expired (will auto-refresh on next command)`);
      } else {
        lines.push(`Token status: expired (run \`kweaver auth login ${token.baseUrl}\` again)`);
      }
    }

    for (const line of lines) {
      console.log(line);
    }
    return 0;
  }

  if (target === "list") {
    const currentPlatform = getCurrentPlatform();
    const platforms = listPlatforms();
    if (platforms.length === 0) {
      console.error("No saved platforms found.");
      return 1;
    }

    console.log(`Config directory: ${getConfigDir()}`);
    for (const platform of platforms) {
      const marker = platform.baseUrl === currentPlatform ? "*" : "-";
      const aliasPart = platform.alias ? ` alias=${platform.alias}` : "";
      console.log(`${marker} ${platform.baseUrl}${aliasPart}  token=${platform.hasToken ? "yes" : "no"}`);
    }
    return 0;
  }

  if (target === "use") {
    const resolvedTarget = args[1] ? resolvePlatformIdentifier(args[1]) : "";
    const useTarget =
      resolvedTarget && /^https?:\/\//.test(resolvedTarget) ? normalizeBaseUrl(resolvedTarget) : resolvedTarget;
    if (!useTarget) {
      console.error("Usage: kweaver auth use <platform-url|alias>");
      return 1;
    }
    if (!hasPlatform(useTarget)) {
      console.error(`No saved token for ${useTarget}. Run \`kweaver auth login ${useTarget}\` first.`);
      return 1;
    }
    setCurrentPlatform(useTarget);
    console.log(`Current platform: ${useTarget}`);
    return 0;
  }

  if (target === "delete") {
    const resolvedTarget = args[1] ? resolvePlatformIdentifier(args[1]) : "";
    const deleteTarget =
      resolvedTarget && /^https?:\/\//.test(resolvedTarget) ? normalizeBaseUrl(resolvedTarget) : resolvedTarget;
    if (!deleteTarget) {
      console.error("Usage: kweaver auth delete <platform-url|alias>");
      return 1;
    }
    if (!hasPlatform(deleteTarget)) {
      console.error(`No saved token for ${deleteTarget}.`);
      return 1;
    }

    const wasCurrent = getCurrentPlatform() === deleteTarget;
    deletePlatform(deleteTarget);
    console.log(`Deleted platform: ${deleteTarget}`);
    if (wasCurrent) {
      const nextCurrent = getCurrentPlatform();
      console.log(`Current platform: ${nextCurrent ?? "none"}`);
    }
    return 0;
  }

  if (target === "logout") {
    const resolvedTarget = args[1] ? resolvePlatformIdentifier(args[1]) : getCurrentPlatform();
    const logoutTarget =
      resolvedTarget && /^https?:\/\//.test(resolvedTarget) ? normalizeBaseUrl(resolvedTarget) : resolvedTarget;
    if (!logoutTarget) {
      console.error("Usage: kweaver auth logout [platform-url|alias]");
      console.error("No current platform. Specify a platform to logout.");
      return 1;
    }
    if (!hasPlatform(logoutTarget)) {
      console.error(`No saved token for ${logoutTarget}.`);
      return 1;
    }
    clearPlatformSession(logoutTarget);
    console.log(`Logged out: ${logoutTarget}`);
    console.log(`Run \`kweaver auth login ${logoutTarget}\` to sign in again.`);
    return 0;
  }

  console.error("Usage: kweaver auth login <platform-url>");
  console.error("       kweaver auth <platform-url> [--alias <name>]");
  console.error("       kweaver auth status [platform-url|alias]");
  console.error("       kweaver auth list");
  console.error("       kweaver auth use <platform-url|alias>");
  console.error("       kweaver auth logout [platform-url|alias]");
  console.error("       kweaver auth delete <platform-url|alias>");
  return 1;
}

function readOption(args: string[], name: string): string | undefined {
  const index = args.findIndex((arg) => arg === name);
  if (index === -1) {
    return undefined;
  }

  return args[index + 1];
}
