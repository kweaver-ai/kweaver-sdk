import {
  autoSelectBusinessDomain,
  clearPlatformSession,
  deletePlatform,
  getConfigDir,
  getCurrentPlatform,
  getPlatformAlias,
  hasPlatform,
  listPlatforms,
  loadClientConfig,
  loadTokenConfig,
  resolvePlatformIdentifier,
  setCurrentPlatform,
  setPlatformAlias,
} from "../config/store.js";
import {
  buildCopyCommand,
  formatHttpError,
  normalizeBaseUrl,
  oauth2Login,
  playwrightLogin,
  refreshTokenLogin,
} from "../auth/oauth.js";

export async function runAuthCommand(args: string[]): Promise<number> {
  const target = args[0];
  const rest = args.slice(1);

  if (!target || target === "--help" || target === "-h") {
    console.log(`kweaver auth login <url> [options]   Login to a platform (browser OAuth2 by default)
kweaver auth <url>                   Login (shorthand; same options as login)
kweaver auth export [url|alias] [--json]   Export credentials; run printed command on a headless host
kweaver auth status [url|alias]      Show current auth status
kweaver auth list                    List saved platforms
kweaver auth use <url|alias>         Switch active platform
kweaver auth logout [url|alias]      Logout (clear local token)
kweaver auth delete <url|alias>      Delete saved credentials

Login options:
  --alias <name>         Save platform with a short alias (use with use / status / logout)
  --client-id <id>       Use an existing OAuth2 client ID instead of registering a new one.
                         Use the platform's web app client ID to get the same permissions
                         as the browser. Find it in DevTools: /oauth2/auth?client_id=<id>
  --client-secret <s>    Client secret (omit for public/PKCE clients)
  --refresh-token <t>    Use on a machine without a browser: exchange refresh token for access token.
                         Requires --client-id and --client-secret.
                         Get these from the callback page after browser login or \`auth export\`.
  -u, --username         Username (with -p triggers Playwright headless login)
  -p, --password         Password
  --playwright           Force Playwright browser login even without -u/-p
  --insecure, -k         Skip TLS certificate verification (self-signed / dev HTTPS only)`);

    return 0;
  }

  if (target === "login") {
    if (rest[0] === "--help" || rest[0] === "-h") {
      console.log(`kweaver auth login <platform-url> [--alias <name>] [-u user] [-p pass] [--playwright] [--refresh-token T --client-id ID --client-secret S]`);
      return 0;
    }
    const url = rest[0];
    if (!url || url.startsWith("-")) {
      console.error(
        "Usage: kweaver auth login <platform-url> [--alias <name>] [-u user] [-p pass] [--playwright]",
      );
      return 1;
    }
    return runAuthCommand([url, ...rest.slice(1)]);
  }

  if (target === "export") {
    return runAuthExportCommand(rest);
  }

  const LOGIN_SUBCOMMANDS = new Set(["status", "list", "use", "delete", "logout", "export"]);
  if (target && !LOGIN_SUBCOMMANDS.has(target)) {
    try {
      const normalizedTarget = normalizeBaseUrl(target);
      const alias = readOption(args, "--alias");
      const username = readOption(args, "--username") ?? readOption(args, "-u");
      const password = readOption(args, "--password") ?? readOption(args, "-p");
      const usePlaywright = args.includes("--playwright");
      const clientId = readOption(args, "--client-id");
      const clientSecret = readOption(args, "--client-secret");
      const refreshToken = readOption(args, "--refresh-token");
      const tlsInsecure = args.includes("--insecure") || args.includes("-k");

      let token;

      if (refreshToken) {
        if (!clientId || !clientSecret) {
          console.error("--refresh-token requires --client-id and --client-secret.\n");
          console.error("Get these values from the callback page after a browser login or `kweaver auth export`.");
          return 1;
        }
        console.log("Logging in with refresh token (no browser)...");
        token = await refreshTokenLogin(normalizedTarget, {
          clientId, clientSecret, refreshToken, tlsInsecure,
        });
      } else if (username && password) {
        // Headless Playwright login with credentials
        console.log("Logging in (headless)...");
        token = await playwrightLogin(normalizedTarget, { username, password, tlsInsecure });
      } else if (usePlaywright) {
        // Explicit Playwright fallback
        console.log("Opening browser for login (Playwright)...");
        token = await playwrightLogin(normalizedTarget, { tlsInsecure });
      } else {
        // Default: OAuth2 authorization code flow (supports refresh_token)
        if (clientId) {
          console.log(`Opening browser for OAuth2 login (client: ${clientId})...`);
        } else {
          console.log("Opening browser for OAuth2 login...");
        }
        token = await oauth2Login(normalizedTarget, {
          clientId: clientId ?? undefined,
          clientSecret: clientSecret ?? undefined,
          tlsInsecure,
        });
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
      const selectedBd = await autoSelectBusinessDomain(normalizedTarget, token.accessToken, {
        tlsInsecure: token.tlsInsecure,
      });
      console.log(`Business domain: ${selectedBd}`);
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
    if (token.tlsInsecure) {
      lines.push(`TLS: certificate verification disabled (saved; dev only)`);
    }

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

  console.error("Usage: kweaver auth login <platform-url> [--alias <name>] [-u user] [-p pass] [--playwright]");
  console.error("       kweaver auth export [platform-url|alias] [--json]");
  console.error("       kweaver auth status [platform-url|alias]");
  console.error("       kweaver auth list");
  console.error("       kweaver auth use <platform-url|alias>");
  console.error("       kweaver auth logout [platform-url|alias]");
  console.error("       kweaver auth delete <platform-url|alias>");
  return 1;
}

async function runAuthExportCommand(args: string[]): Promise<number> {
  if (args[0] === "--help" || args[0] === "-h") {
    console.log(`kweaver auth export [platform-url|alias] [--json]

Export OAuth2 credentials for copying to a headless host (no browser there).
Prints clientId, clientSecret, refreshToken, and a command to run on that machine.

Options:
  --json   Output as JSON (machine-readable)`);
    return 0;
  }

  const jsonOutput = args.includes("--json");
  const positional = args.find((a) => !a.startsWith("-"));
  const resolved = positional ? resolvePlatformIdentifier(positional) : null;
  const platform = resolved && /^https?:\/\//.test(resolved) ? normalizeBaseUrl(resolved) : resolved ?? getCurrentPlatform();

  if (!platform) {
    console.error("No active platform. Run `kweaver auth login <platform-url>` first.");
    return 1;
  }

  const client = loadClientConfig(platform);
  const token = loadTokenConfig(platform);

  const clientId = client?.clientId ?? "";
  const clientSecret = client?.clientSecret ?? "";
  const refreshToken = token?.refreshToken ?? "";
  const tlsInsecure = token?.tlsInsecure;

  if (!clientId || !refreshToken) {
    console.error(
      `Incomplete credentials for ${platform}.\n` +
        (!clientId ? "  Missing: client registration (client.json)\n" : "") +
        (!refreshToken ? "  Missing: refresh token (token.json)\n" : "") +
        `Run \`kweaver auth login ${platform}\` first.`,
    );
    return 1;
  }

  if (jsonOutput) {
    console.log(JSON.stringify({
      baseUrl: platform,
      clientId,
      clientSecret,
      refreshToken,
      ...(tlsInsecure ? { tlsInsecure: true } : {}),
    }));
    return 0;
  }

  const cmd = buildCopyCommand(platform, clientId, clientSecret, refreshToken, tlsInsecure);

  console.log(`Platform:       ${platform}`);
  console.log(`Client ID:      ${clientId}`);
  console.log(`Client Secret:  ${clientSecret || "(none)"}`);
  console.log(`Refresh Token:  ${refreshToken}`);
  console.log("");
  console.log("On a machine without a browser, run:\n");
  console.log(`  ${cmd}`);
  console.log("");
  console.log("Keep these credentials secure.");
  return 0;
}

function readOption(args: string[], name: string): string | undefined {
  const index = args.findIndex((arg) => arg === name);
  if (index === -1) {
    return undefined;
  }

  return args[index + 1];
}
