import { isNoAuth } from "../config/no-auth.js";
import {
  autoSelectBusinessDomain,
  clearPlatformSession,
  deletePlatform,
  deleteUser,
  getActiveUser,
  getConfigDir,
  getCurrentPlatform,
  getPlatformAlias,
  hasPlatform,
  listPlatforms,
  listUserProfiles,
  listUsers,
  loadClientConfig,
  loadTokenConfig,
  loadUserTokenConfig,
  resolveBusinessDomain,
  resolvePlatformIdentifier,
  resolveUserId,
  saveNoAuthPlatform,
  setActiveUser,
  setCurrentPlatform,
  setPlatformAlias,
} from "../config/store.js";
import { readFile } from "node:fs/promises";
import { decodeJwtPayload } from "../config/jwt.js";
import { eacpModifyPassword } from "../auth/eacp-modify-password.js";
import {
  buildCopyCommand,
  enrichEnvToken,
  formatHttpError,
  InitialPasswordChangeRequiredError,
  normalizeBaseUrl,
  oauth2Login,
  oauth2PasswordSigninLogin,
  promptForUsername,
  promptForPassword,
  refreshTokenLogin,
} from "../auth/oauth.js";

export async function runAuthCommand(args: string[]): Promise<number> {
  const target = args[0];
  const rest = args.slice(1);

  if (!target || target === "--help" || target === "-h") {
    console.log(`kweaver auth login <url> [options]   Login to a platform (browser OAuth2 by default)
kweaver auth <url>                   Login (shorthand; same options as login)
kweaver auth whoami [url|alias] [--json]  Show current user identity (from id_token)
kweaver auth export [url|alias] [--json]   Export credentials; run printed command on a headless host
kweaver auth status [url|alias]      Show current auth status
kweaver auth list                    List all platforms and users (tree view)
kweaver auth use <url|alias>         Switch active platform
kweaver auth users [url|alias]       List all user profiles (with usernames) for a platform
kweaver auth switch [url|alias] --user <id|username>  Switch active user for a platform
kweaver auth logout [url|alias] [--user <id>]  Logout (clear local token)
kweaver auth delete <url|alias> [--user <id>]  Delete saved credentials
kweaver auth change-password [<url>] [-u <account>] [-o <old>] [-n <new>]  Change password

Login options:
  --alias <name>         Save platform with a short alias (use with use / status / logout)
  --client-id <id>       Use an existing OAuth2 client ID instead of registering a new one.
                         Use the platform's web app client ID to get the same permissions
                         as the browser. Find it in DevTools: /oauth2/auth?client_id=<id>
  --client-secret <s>    Client secret (omit for public/PKCE clients)
  --refresh-token <t>    Use on a machine without a browser: exchange refresh token for access token.
                         Requires --client-id and --client-secret.
                         Get these from the callback page after browser login or \`auth export\`.
  --port <n>             Local callback port (default: 9010). Use when 9010 is occupied.
  --no-browser           Do not open a browser. Without -u/-p: print the auth URL and prompt for the
                         callback URL or code (stdin). With -u and/or -p: route through HTTP sign-in
                         (any missing credential is prompted; password is hidden when stdin is a TTY).
  -u, --username         Username for HTTP /oauth2/signin (POST). If -p is omitted, password is prompted.
  -p, --password         Password for HTTP /oauth2/signin (POST). If -u is omitted, username is prompted.
  --http-signin          Force HTTP /oauth2/signin (no browser). Missing -u/-p are prompted from stdin.
  --new-password <pwd>   After HTTP sign-in error 401001017 (initial password), set the new password non-interactively, then retry login.
  --insecure, -k         Skip TLS certificate verification (self-signed / dev HTTPS only)
  --no-auth              Save platform without OAuth (servers with no authentication). Same as detecting OAuth 404 during login.`);

    return 0;
  }

  if (target === "login") {
    if (rest[0] === "--help" || rest[0] === "-h") {
      console.log(`kweaver auth login <platform-url> [--alias <name>] [--no-auth] [--no-browser] [-u user] [-p pass] [--new-password <pwd>] [--http-signin] [--refresh-token T --client-id ID --client-secret S]`);
      return 0;
    }
    const url = rest[0];
    if (!url || url.startsWith("-")) {
      console.error(
        "Usage: kweaver auth login <platform-url> [--alias <name>] [-u user] [-p pass]",
      );
      return 1;
    }
    return runAuthCommand([url, ...rest.slice(1)]);
  }

  if (target === "whoami") {
    return await runAuthWhoamiCommand(rest);
  }

  if (target === "export") {
    return runAuthExportCommand(rest);
  }

  if (target === "users") {
    return runAuthUsersCommand(rest);
  }

  if (target === "switch") {
    return runAuthSwitchCommand(rest);
  }

  if (target === "change-password") {
    return runAuthChangePasswordCommand(rest);
  }

  const LOGIN_SUBCOMMANDS = new Set(["status", "list", "use", "delete", "logout", "export", "whoami", "users", "switch"]);
  if (target && !LOGIN_SUBCOMMANDS.has(target)) {
    try {
      const normalizedTarget = normalizeBaseUrl(target);
      const alias = readOption(args, "--alias");
      let username = readOption(args, "--username") ?? readOption(args, "-u");
      let password = readOption(args, "--password") ?? readOption(args, "-p");
      const httpSignin = args.includes("--http-signin");
      const oauthProduct = readOption(args, "--oauth-product");
      const signinPublicKeyFile = readOption(args, "--signin-public-key-file");
      const clientId = readOption(args, "--client-id");
      const clientSecret = readOption(args, "--client-secret");
      const refreshToken = readOption(args, "--refresh-token");
      const customPortStr = readOption(args, "--port");
      const customPort = customPortStr ? parseInt(customPortStr, 10) : undefined;
      const tlsInsecure = args.includes("--insecure") || args.includes("-k");
      const noAuth = args.includes("--no-auth");
      const noBrowser = args.includes("--no-browser");
      const newPasswordFlag = readOption(args, "--new-password");

      if (args.includes("--redirect-uri")) {
        console.error("Warning: --redirect-uri is deprecated and ignored. The redirect URI is always http://127.0.0.1:<port>/callback.");
      }

      const KNOWN_LOGIN_FLAGS = new Set([
        "--alias", "--client-id", "--client-secret", "--refresh-token",
        "--port", "--no-browser", "--username", "-u", "--password", "-p",
        "--http-signin",
        "--new-password",
        "--oauth-product",
        "--signin-public-key-file",
        "--insecure", "-k", "--no-auth", "--redirect-uri",
      ]);
      const KNOWN_VALUE_FLAGS = new Set([
        "--alias", "--client-id", "--client-secret", "--refresh-token",
        "--port", "--username", "-u", "--password", "-p", "--redirect-uri",
        "--new-password",
        "--oauth-product",
        "--signin-public-key-file",
      ]);
      for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a.startsWith("-") && a !== target && !KNOWN_LOGIN_FLAGS.has(a)) {
          console.error(`Unknown option: ${a}`);
          console.error("Run 'kweaver auth --help' to see available options.");
          return 1;
        }
        if (KNOWN_VALUE_FLAGS.has(a)) i++;
      }

      if (customPort !== undefined && (Number.isNaN(customPort) || customPort < 1 || customPort > 65535)) {
        console.error("Invalid --port value. Expected a number between 1 and 65535.");
        return 1;
      }

      if (noAuth && refreshToken) {
        console.error("--no-auth cannot be used with --refresh-token.");
        return 1;
      }
      if (noAuth && noBrowser) {
        console.error("--no-auth does not require a browser; --no-browser is ignored.");
      }
      if (noAuth && (username || password || httpSignin)) {
        console.error("--no-auth cannot be used with HTTP sign-in or -u/-p.");
        return 1;
      }
      if (newPasswordFlag !== undefined && (!username || !password)) {
        console.error("--new-password requires -u/--username and -p/--password (HTTP sign-in).");
        return 1;
      }
      if (noBrowser && httpSignin) {
        // HTTP sign-in already runs without a browser; --no-browser is a no-op signal here.
        console.error("--http-signin already runs without a browser; --no-browser is redundant and ignored.");
      }
      if (httpSignin && refreshToken) {
        console.error("--http-signin cannot be used with --refresh-token.");
        return 1;
      }
      if (noBrowser && refreshToken) {
        console.error("--no-browser cannot be used with --refresh-token.");
        return 1;
      }

      // Headless credential login: if the user signalled HTTP sign-in (--http-signin,
      // or partial -u/-p, or --no-browser combined with -u/-p) but didn't provide both
      // credentials inline, prompt for the missing one(s) on stderr. Password is read
      // without echo when stdin is a TTY.
      const wantsCredentialLogin =
        !noAuth && !refreshToken &&
        (httpSignin || (noBrowser && (username || password)) || (!!username !== !!password));
      if (wantsCredentialLogin) {
        if (!username) username = await promptForUsername("Username");
        if (!password) password = await promptForPassword("Password");
      }

      let token;

      if (noAuth) {
        token = saveNoAuthPlatform(normalizedTarget, { tlsInsecure });
      } else if (refreshToken) {
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
        console.log("Logging in (HTTP /oauth2/signin)...");
        token = await loginWithInitialPasswordRecovery(
          normalizedTarget,
          {
            username,
            password,
            tlsInsecure,
            port: customPort,
            clientId: clientId ?? undefined,
            clientSecret: clientSecret ?? undefined,
            oauthProduct: oauthProduct ?? undefined,
            signinPublicKeyPemPath: signinPublicKeyFile ?? undefined,
          },
          { newPasswordFlag, tlsInsecure },
        );
      } else {
        if (noBrowser) {
          console.log("OAuth2 login (no browser — open the URL on any device, then paste the callback URL or code)...");
        } else if (clientId) {
          console.log(`Opening browser for OAuth2 login (client: ${clientId})...`);
        } else {
          console.log("Opening browser for OAuth2 login...");
        }
        token = await oauth2Login(normalizedTarget, {
          clientId: clientId ?? undefined,
          clientSecret: clientSecret ?? undefined,
          tlsInsecure, port: customPort, noBrowser,
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
      const activeUser = getActiveUser(normalizedTarget);
      if (activeUser) {
        const userLabel = token.displayName ? `${token.displayName} (${activeUser})` : activeUser;
        console.log(`User: ${userLabel}`);
      }
      if (isNoAuth(token.accessToken)) {
        console.log(`Authentication: none (no-auth mode)`);
      } else {
        console.log(`Access token saved: yes`);
      }
      if (!isNoAuth(token.accessToken) && token.refreshToken) {
        console.log(`Refresh token: yes (auto-refresh enabled)`);
      } else if (!isNoAuth(token.accessToken)) {
        console.log(`Refresh token: no (token will expire in 1 hour)`);
      }
      if (token.expiresAt) {
        console.log(`Token expires at: ${token.expiresAt}`);
      }
      const selectedBd = isNoAuth(token.accessToken)
        ? resolveBusinessDomain(normalizedTarget)
        : await autoSelectBusinessDomain(normalizedTarget, token.accessToken, {
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
      const envRaw = process.env.KWEAVER_BASE_URL?.trim();
      const envUrl = envRaw ? normalizeBaseUrl(envRaw) : undefined;
      const envToken = process.env.KWEAVER_TOKEN?.trim();
      if (!envUrl || !envToken) {
        console.error(
          "No active platform. Run `kweaver auth login <platform-url>` first.\n" +
          "  Tip: set KWEAVER_BASE_URL and KWEAVER_TOKEN to use this command without a saved login.",
        );
        return 1;
      }
      console.log(`Config directory: ${getConfigDir()}`);
      console.log(`Platform:         ${envUrl} (KWEAVER_BASE_URL)`);
      console.log(`Token present:    yes (KWEAVER_TOKEN)`);
      console.log(`Refresh token:    n/a (env)`);
      return 0;
    }

    const token = loadTokenConfig(platform);
    if (!token) {
      console.error(
        statusTarget ? `No saved token for ${statusTarget}.` : "No saved token found.",
      );
      return 1;
    }

    const currentPlatform = getCurrentPlatform();
    const lines = [
      `Config directory: ${getConfigDir()}`,
      `Platform: ${token.baseUrl}`,
      `Current platform: ${token.baseUrl === currentPlatform ? "yes" : "no"}`,
    ];

    if (isNoAuth(token.accessToken)) {
      lines.push(`Authentication: none (no-auth mode)`);
      lines.push(`User: default (built-in profile for no-auth platforms)`);
    } else {
      const statusActiveUser = getActiveUser(platform);
      if (statusActiveUser) {
        const statusDisplayName = token.displayName;
        const userLabel = statusDisplayName ? `${statusDisplayName} (${statusActiveUser})` : statusActiveUser;
        lines.push(`User: ${userLabel}`);
      }

      lines.push(`Token present: yes`);
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
      const aliasPart = platform.alias ? ` (${platform.alias})` : "";
      const tok = loadTokenConfig(platform.baseUrl);
      const noAuthPart = tok && isNoAuth(tok.accessToken) ? " (no-auth)" : "";
      console.log(`${marker} ${platform.baseUrl}${aliasPart}${noAuthPart}`);

      const profiles = listUserProfiles(platform.baseUrl);
      const activeUser = getActiveUser(platform.baseUrl);
      for (let i = 0; i < profiles.length; i++) {
        const p = profiles[i];
        const isLast = i === profiles.length - 1;
        const branch = isLast ? "└──" : "├──";
        const activeMarker = p.userId === activeUser ? " *" : "";
        const label = p.username ? `${p.username} (${p.userId})` : p.userId;
        console.log(`  ${branch} ${label}${activeMarker}`);
      }
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
    const deleteUserArg = readOption(args, "--user");
    const positionalArgs = args.slice(1).filter((a) => a !== "--user" && a !== deleteUserArg);
    const resolvedTarget = positionalArgs[0] ? resolvePlatformIdentifier(positionalArgs[0]) : "";
    const deleteTarget =
      resolvedTarget && /^https?:\/\//.test(resolvedTarget) ? normalizeBaseUrl(resolvedTarget) : resolvedTarget;
    if (!deleteTarget) {
      console.error("Usage: kweaver auth delete <platform-url|alias> [--user <userId|username>]");
      return 1;
    }
    if (!hasPlatform(deleteTarget)) {
      console.error(`No saved token for ${deleteTarget}.`);
      return 1;
    }

    if (deleteUserArg) {
      const deleteUserId = resolveUserId(deleteTarget, deleteUserArg) ?? deleteUserArg;
      deleteUser(deleteTarget, deleteUserId);
      console.log(`Deleted user ${deleteUserId} from ${deleteTarget}`);
      return 0;
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
    const logoutUserArg = readOption(args, "--user");
    const positionalArgs = args.slice(1).filter((a) => a !== "--user" && a !== logoutUserArg);
    const resolvedTarget = positionalArgs[0] ? resolvePlatformIdentifier(positionalArgs[0]) : getCurrentPlatform();
    const logoutTarget =
      resolvedTarget && /^https?:\/\//.test(resolvedTarget) ? normalizeBaseUrl(resolvedTarget) : resolvedTarget;
    if (!logoutTarget) {
      console.error("Usage: kweaver auth logout [platform-url|alias] [--user <userId|username>]");
      console.error("No current platform. Specify a platform to logout.");
      return 1;
    }
    if (!hasPlatform(logoutTarget)) {
      console.error(`No saved token for ${logoutTarget}.`);
      return 1;
    }
    const logoutUserId = logoutUserArg ? resolveUserId(logoutTarget, logoutUserArg) ?? logoutUserArg : undefined;
    clearPlatformSession(logoutTarget, logoutUserId);
    const userHint = logoutUserId ? ` (user: ${logoutUserId})` : "";
    console.log(`Logged out: ${logoutTarget}${userHint}`);
    console.log(`Run \`kweaver auth login ${logoutTarget}\` to sign in again.`);
    return 0;
  }

  console.error("Usage: kweaver auth login <platform-url> [--alias <name>] [-u user] [-p pass]");
  console.error("       kweaver auth whoami [platform-url|alias] [--json]");
  console.error("       kweaver auth export [platform-url|alias] [--json]");
  console.error("       kweaver auth status [platform-url|alias]");
  console.error("       kweaver auth list");
  console.error("       kweaver auth use <platform-url|alias>");
  console.error("       kweaver auth users [platform-url|alias]");
  console.error("       kweaver auth switch [platform-url|alias] --user <userId>");
  console.error("       kweaver auth logout [platform-url|alias] [--user <userId>]");
  console.error("       kweaver auth delete <platform-url|alias> [--user <userId>]");
  return 1;
}

function resolvePlatformArg(args: string[]): string | null {
  const positional = args.find((a) => !a.startsWith("-"));
  const resolved = positional ? resolvePlatformIdentifier(positional) : null;
  if (resolved && /^https?:\/\//.test(resolved)) return normalizeBaseUrl(resolved);
  return resolved ?? getCurrentPlatform();
}

function runAuthUsersCommand(args: string[]): number {
  if (args[0] === "--help" || args[0] === "-h") {
    console.log(`kweaver auth users [platform-url|alias]

List all user profiles stored for a platform.
Each line shows: userId (username) where username is decoded from the id_token.
You can use either userId or username with --user in switch/logout/delete.`);
    return 0;
  }

  const platform = resolvePlatformArg(args);
  if (!platform) {
    console.error("No active platform. Run `kweaver auth login <platform-url>` first.");
    return 1;
  }

  const profiles = listUserProfiles(platform);
  if (profiles.length === 0) {
    console.error(`No user profiles for ${platform}.`);
    return 1;
  }

  const active = getActiveUser(platform);
  console.log(`Platform: ${platform}`);
  for (const p of profiles) {
    const marker = p.userId === active ? "*" : "-";
    const displayName = p.username ? ` (${p.username})` : "";
    console.log(`${marker} ${p.userId}${displayName}`);
  }
  return 0;
}

function runAuthSwitchCommand(args: string[]): number {
  if (args[0] === "--help" || args[0] === "-h") {
    console.log(`kweaver auth switch [platform-url|alias] --user <userId|username>

Switch the active user for a platform.
You can specify either the userId (sub claim) or the username (preferred_username from id_token).`);
    return 0;
  }

  const userArg = readOption(args, "--user");
  if (!userArg) {
    console.error("Usage: kweaver auth switch [platform-url|alias] --user <userId|username>");
    return 1;
  }

  const filteredArgs = args.filter((a) => a !== "--user" && a !== userArg);
  const platform = resolvePlatformArg(filteredArgs);
  if (!platform) {
    console.error("No active platform. Run `kweaver auth login <platform-url>` first.");
    return 1;
  }

  const resolvedId = resolveUserId(platform, userArg);
  if (!resolvedId) {
    console.error(`User '${userArg}' not found for ${platform}.`);
    const profiles = listUserProfiles(platform);
    if (profiles.length > 0) {
      const hints = profiles.map((p) => p.username ? `${p.userId} (${p.username})` : p.userId);
      console.error(`Available users: ${hints.join(", ")}`);
    }
    return 1;
  }

  setActiveUser(platform, resolvedId);
  const profiles = listUserProfiles(platform);
  const profile = profiles.find((p) => p.userId === resolvedId);
  const displayName = profile?.username ? ` (${profile.username})` : "";
  console.log(`Switched to user ${resolvedId}${displayName} on ${platform}`);
  return 0;
}

async function runAuthWhoamiCommand(args: string[]): Promise<number> {
  if (args[0] === "--help" || args[0] === "-h") {
    console.log(`kweaver auth whoami [platform-url|alias] [--json] [--refresh]

Show current user identity. Resolves the bound user / app from EACP
(/api/eacp/v1/user/get), with a fallback to id_token claims for saved sessions.
In env-token mode the resolved identity is cached on disk per platform; pass
--refresh to discard the cache and re-probe.

Options:
  --json     Output as JSON (machine-readable)
  --refresh  Bypass and overwrite the cached env-token identity (env-token mode only)`);
    return 0;
  }

  const jsonOutput = args.includes("--json");
  const refresh = args.includes("--refresh");
  const positional = args.find((a) => !a.startsWith("-"));
  const resolved = positional ? resolvePlatformIdentifier(positional) : null;
  const platform = resolved && /^https?:\/\//.test(resolved) ? normalizeBaseUrl(resolved) : resolved ?? getCurrentPlatform();

  if (!platform) {
    const envRaw = process.env.KWEAVER_BASE_URL?.trim();
    const envUrl = envRaw ? normalizeBaseUrl(envRaw) : undefined;
    const envToken = process.env.KWEAVER_TOKEN?.trim();
    if (!envUrl || !envToken) {
      console.error("No active platform. Run `kweaver auth login <platform-url>` first.");
      return 1;
    }
    const accessToken = envToken.replace(/^Bearer\s+/i, "");
    // Resolve via the same three-tier lookup business commands use (memory →
    // disk → EACP), so whoami matches whatever the next API call would see.
    // `--refresh` bypasses both caches and overwrites the persisted entry.
    const userInfo = await enrichEnvToken(envUrl, accessToken, { forceRefresh: refresh });
    const payload = userInfo ? null : decodeJwtPayload(accessToken);

    if (jsonOutput) {
      const out: Record<string, unknown> = { platform: envUrl, source: "env" };
      if (userInfo) out.userInfo = userInfo;
      if (payload) Object.assign(out, payload);
      console.log(JSON.stringify(out, null, 2));
      return 0;
    }
    console.log(`Platform: ${envUrl}`);
    console.log(`Source:   env (KWEAVER_TOKEN)`);
    if (userInfo) {
      console.log(`Type:     ${userInfo.type}`);
      console.log(`User ID:  ${userInfo.id}`);
      if (userInfo.account) console.log(`Account:  ${userInfo.account}`);
      if (userInfo.name) console.log(`Name:     ${userInfo.name}`);
    } else if (payload) {
      const uname = payload.preferred_username ?? payload.name;
      if (uname) console.log(`Username: ${uname}`);
      console.log(`User ID:  ${payload.sub ?? "(unknown)"}`);
      console.log(`Issuer:   ${payload.iss ?? "(unknown)"}`);
      if (payload.iat) console.log(`Issued:   ${new Date((payload.iat as number) * 1000).toISOString()}`);
      if (payload.exp) console.log(`Expires:  ${new Date((payload.exp as number) * 1000).toISOString()}`);
    } else {
      console.log(`User info unavailable: opaque access token and EACP did not respond.`);
      console.log(`Hint: run \`kweaver auth login ${envUrl}\` to obtain a full session, or check connectivity to ${envUrl}.`);
    }
    return 0;
  }

  const token = loadTokenConfig(platform);
  if (!token) {
    console.error(`No saved token for ${platform}.`);
    return 1;
  }

  // Prefer the persisted EACP identity (covers both user and app sessions);
  // fall back to id_token claims for older sessions saved before this field existed.
  const userInfo = token.userInfo ?? null;
  const payload = token.idToken ? decodeJwtPayload(token.idToken) : null;

  if (!userInfo && !payload) {
    console.error(
      `No identity available for ${platform}. The saved session has no userInfo and no decodable id_token. Re-login.`,
    );
    return 1;
  }

  const displayNameValue = token.displayName ?? null;

  if (jsonOutput) {
    const out: Record<string, unknown> = { platform };
    if (userInfo) out.userInfo = userInfo;
    if (payload) Object.assign(out, payload);
    if (displayNameValue) out.displayName = displayNameValue;
    console.log(JSON.stringify(out, null, 2));
    return 0;
  }

  console.log(`Platform: ${platform}`);
  if (userInfo) {
    console.log(`Type:     ${userInfo.type}`);
    console.log(`User ID:  ${userInfo.id}`);
    if (userInfo.account) console.log(`Account:  ${userInfo.account}`);
    if (userInfo.name) console.log(`Name:     ${userInfo.name}`);
  } else {
    if (displayNameValue) console.log(`Username: ${displayNameValue}`);
    console.log(`User ID:  ${payload?.sub ?? "(unknown)"}`);
  }
  if (payload) {
    if (payload.iss) console.log(`Issuer:   ${payload.iss}`);
    if (payload.sid) console.log(`Session:  ${payload.sid}`);
    if (payload.iat) console.log(`Issued:   ${new Date((payload.iat as number) * 1000).toISOString()}`);
    if (payload.exp) console.log(`Expires:  ${new Date((payload.exp as number) * 1000).toISOString()}`);
  }
  return 0;
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

const EACP_NEW_PWD_MIN = 6;
const EACP_NEW_PWD_MAX = 100;

function validateNewPasswordLengthForEacp(pwd: string): void {
  if (pwd.length < EACP_NEW_PWD_MIN || pwd.length > EACP_NEW_PWD_MAX) {
    throw new Error(
      `New password must be between ${EACP_NEW_PWD_MIN} and ${EACP_NEW_PWD_MAX} characters.`,
    );
  }
}

function formatEacpModifyFailure(
  status: number,
  json: unknown | undefined,
  body: string,
): string {
  if (json && typeof json === "object" && json !== null) {
    const o = json as { message?: unknown; cause?: unknown };
    const msg =
      typeof o.message === "string" && o.message.trim() !== ""
        ? o.message
        : typeof o.cause === "string"
          ? o.cause
          : "";
    if (msg) return `Password change failed (HTTP ${status}): ${msg}`;
  }
  return `Password change failed (HTTP ${status}): ${body.slice(0, 500)}`;
}

async function promptYesNo(message: string): Promise<boolean> {
  const { createInterface } = await import("node:readline");
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return await new Promise<boolean>((resolve, reject) => {
    let answered = false;
    rl.on("close", () => {
      if (!answered) reject(new Error("Login cancelled."));
    });
    rl.question(`${message} [Y/n] `, (answer) => {
      answered = true;
      rl.close();
      const a = answer.trim().toLowerCase();
      resolve(a === "" || a === "y" || a === "yes");
    });
  });
}

async function loginWithInitialPasswordRecovery(
  normalizedTarget: string,
  signinOpts: Parameters<typeof oauth2PasswordSigninLogin>[1],
  recovery: { newPasswordFlag: string | undefined; tlsInsecure: boolean },
) {
  try {
    return await oauth2PasswordSigninLogin(normalizedTarget, signinOpts);
  } catch (e) {
    if (!(e instanceof InitialPasswordChangeRequiredError)) throw e;
    const err = e;
    const account = signinOpts.username;
    const oldPwd = signinOpts.password;

    let newPwd: string | undefined = recovery.newPasswordFlag;

    if (newPwd !== undefined) {
      validateNewPasswordLengthForEacp(newPwd);
    } else if (process.stderr.isTTY) {
      process.stderr.write(`${err.serverMessage}\n`);
      const ok = await promptYesNo(
        `Account "${account}" must change its initial password. Proceed with password change now?`,
      );
      if (!ok) {
        throw new Error("Initial password change declined. Run again when ready.");
      }
      const np1 = await promptForPassword("New password (6-100 characters)");
      const np2 = await promptForPassword("Confirm new password");
      if (np1 !== np2) {
        throw new Error("New passwords do not match.");
      }
      validateNewPasswordLengthForEacp(np1);
      newPwd = np1;
    } else {
      throw new Error(
        "This account must change its initial password (error 401001017). Re-run with --new-password <password> (non-interactive).",
      );
    }

    const mod = await eacpModifyPassword(normalizedTarget, {
      account,
      oldPassword: oldPwd,
      newPassword: newPwd,
      tlsInsecure: recovery.tlsInsecure,
    });
    if (!mod.ok) {
      throw new Error(formatEacpModifyFailure(mod.status, mod.json, mod.body));
    }

    return oauth2PasswordSigninLogin(normalizedTarget, {
      ...signinOpts,
      password: newPwd,
    });
  }
}

async function runAuthChangePasswordCommand(args: string[]): Promise<number> {
  if (args[0] === "--help" || args[0] === "-h") {
    console.log(`kweaver auth change-password [<platform-url>] [options]

Change the EACP account password via POST /api/eacp/v1/auth1/modifypassword.
No saved OAuth token is required.

Options:
  -u, --account <name>       Account / login name. On TTY, defaults to the current active user
                             after a confirmation prompt. Required in non-interactive mode.
  -o, --old-password <pwd>   Current password (omit on TTY to be prompted)
  -n, --new-password <pwd>   New password, 6-100 characters (omit on TTY to be prompted)
  --insecure, -k             Skip TLS certificate verification (defaults to the platform's saved
                             preference set at login with -k; pass to override per-call)

Platform URL is optional; defaults to the current active platform (kweaver auth use).`);
    return 0;
  }

  const KNOWN_CP_FLAGS = new Set([
    "-u",
    "--account",
    "-o",
    "--old-password",
    "-n",
    "--new-password",
    "--insecure",
    "-k",
    "--help",
    "-h",
  ]);
  const KNOWN_CP_VALUE = new Set([
    "-u",
    "--account",
    "-o",
    "--old-password",
    "-n",
    "--new-password",
  ]);

  // First positional (if present and not a flag) is the platform URL or alias.
  const positional = args[0] && !args[0].startsWith("-") ? args[0] : undefined;
  const flagArgs = positional ? args.slice(1) : args;

  for (let i = 0; i < flagArgs.length; i++) {
    const a = flagArgs[i];
    if (a.startsWith("-") && !KNOWN_CP_FLAGS.has(a)) {
      console.error(`Unknown option: ${a}`);
      console.error("Run 'kweaver auth change-password --help' for usage.");
      return 1;
    }
    if (KNOWN_CP_VALUE.has(a)) i++;
  }

  const normalizedTarget = resolvePlatformArg(positional ? [positional] : []);
  if (!normalizedTarget) {
    console.error(
      "No platform resolved. Pass <platform-url|alias> or run `kweaver auth use <url|alias>` first.",
    );
    return 1;
  }

  let account =
    readOption(flagArgs, "--account") ?? readOption(flagArgs, "-u");
  let oldPassword = readOption(flagArgs, "--old-password") ?? readOption(flagArgs, "-o");
  let newPassword = readOption(flagArgs, "--new-password") ?? readOption(flagArgs, "-n");
  const explicitTlsInsecure = flagArgs.includes("--insecure") || flagArgs.includes("-k");

  // Resolve the active user's saved token; we use it both to default the account
  // and to inherit the platform's saved tlsInsecure preference (set at login with -k).
  const activeUser = getActiveUser(normalizedTarget);
  const activeToken = activeUser ? loadUserTokenConfig(normalizedTarget, activeUser) : null;
  const tlsInsecure = explicitTlsInsecure || activeToken?.tlsInsecure === true;

  const interactive = process.stdin.isTTY === true && process.stderr.isTTY === true;
  const accountWasExplicit = !!account?.trim();

  // Account resolution (with safety guards):
  // - Explicit -u always wins.
  // - Non-TTY + no -u: REFUSE. Silently using the active account in CI / pipes
  //   would let scripts modify the wrong account's password without warning.
  // - TTY + no -u: default to the active user's displayName, but require an
  //   interactive yes/no confirmation before proceeding.
  if (!accountWasExplicit) {
    const defaultAccount = activeToken?.displayName?.trim();
    if (!defaultAccount) {
      console.error(
        "Cannot determine current account on the platform. Pass -u/--account, or log in first (kweaver auth login ...).",
      );
      return 1;
    }
    if (!interactive) {
      console.error(
        `Refusing to default account in non-interactive mode. Pass -u/--account explicitly (would have used "${defaultAccount}").`,
      );
      return 1;
    }
    const ok = await promptYesNo(
      `Change password for account "${defaultAccount}" on ${normalizedTarget}?`,
    );
    if (!ok) {
      console.error("Aborted by user.");
      return 1;
    }
    account = defaultAccount;
  }

  const trimmedAccount = account!.trim();
  try {
    if (!interactive) {
      if (!oldPassword || !newPassword) {
        console.error(
          "In non-interactive mode, --old-password and --new-password are required.",
        );
        return 1;
      }
    } else {
      if (!oldPassword) {
        oldPassword = await promptForPassword("Old password");
      }
      if (!newPassword) {
        const n1 = await promptForPassword("New password (6-100 characters)");
        const n2 = await promptForPassword("Confirm new password");
        if (n1 !== n2) {
          console.error("New passwords do not match.");
          return 1;
        }
        newPassword = n1;
      }
    }

    validateNewPasswordLengthForEacp(newPassword!);

    const result = await eacpModifyPassword(normalizedTarget, {
      account: trimmedAccount,
      oldPassword: oldPassword!,
      newPassword: newPassword!,
      tlsInsecure,
    });

    if (!result.ok) {
      console.error(
        `${formatEacpModifyFailure(result.status, result.json, result.body)} (account="${trimmedAccount}")`,
      );
      return 1;
    }

    console.log(`Password changed for ${trimmedAccount} on ${normalizedTarget}`);
    return 0;
  } catch (e) {
    console.error(`${formatHttpError(e)}\n(account="${trimmedAccount}")`);
    return 1;
  }
}
