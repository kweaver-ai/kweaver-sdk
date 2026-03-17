import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { run } from "../src/cli.js";
import {
  formatAuthStatusSummary,
  getClientProvisioningMessage,
} from "../src/commands/auth.js";
import {
  formatCallOutput,
  formatVerboseRequest,
  parseCallArgs,
  stripSseDoneMarker,
} from "../src/commands/call.js";
import {
  parseKnListArgs,
  parseKnGetArgs,
  parseKnCreateArgs,
  parseKnUpdateArgs,
  parseKnDeleteArgs,
  parseKnObjectTypeQueryArgs,
  parseKnActionTypeExecuteArgs,
  parseKnSearchArgs,
  formatSimpleKnList,
} from "../src/commands/bkn.js";
import {
  parseAgentListArgs,
  parseAgentSessionsArgs,
  parseAgentHistoryArgs,
  formatSimpleAgentList,
} from "../src/commands/agent.js";
import { parseTokenArgs } from "../src/commands/token.js";
import {
  buildAuthorizationUrl,
  buildAuthRedirectConfig,
  ensureValidToken,
  formatHttpError,
  getAuthorizationSuccessMessage,
} from "../src/auth/oauth.js";
import { HttpError, NetworkRequestError } from "../src/utils/http.js";

function createConfigDir(): string {
  return mkdtempSync(join(tmpdir(), "kweaver-cli-"));
}

async function importCliModule(configDir: string) {
  process.env.KWEAVERC_CONFIG_DIR = configDir;
  const moduleUrl = pathToFileURL(join(process.cwd(), "src/cli.ts")).href;
  return import(`${moduleUrl}?t=${Date.now()}-${Math.random()}`);
}

async function importAuthModule(configDir: string) {
  process.env.KWEAVERC_CONFIG_DIR = configDir;
  const moduleUrl = pathToFileURL(join(process.cwd(), "src/commands/auth.ts")).href;
  return import(`${moduleUrl}?t=${Date.now()}-${Math.random()}`);
}

async function importStoreModule(configDir: string) {
  process.env.KWEAVERC_CONFIG_DIR = configDir;
  const moduleUrl = pathToFileURL(join(process.cwd(), "src/config/store.ts")).href;
  return import(`${moduleUrl}?t=${Date.now()}-${Math.random()}`);
}

async function listen(server: ReturnType<typeof createServer>): Promise<number> {
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  return (server.address() as AddressInfo).port;
}

async function reservePort(): Promise<number> {
  const server = createServer();
  const port = await listen(server);
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
  return port;
}

test("parseCallArgs parses curl-style request flags", () => {
  const parsed = parseCallArgs([
    "https://dip.aishu.cn/api/demo",
    "-X",
    "POST",
    "-H",
    "accept: application/json",
    "-d",
    "{\"ping\":true}",
  ]);

  assert.equal(parsed.url, "https://dip.aishu.cn/api/demo");
  assert.equal(parsed.method, "POST");
  assert.equal(parsed.headers.get("accept"), "application/json");
  assert.equal(parsed.body, "{\"ping\":true}");
  assert.equal(parsed.pretty, true);
  assert.equal(parsed.verbose, false);
  assert.equal(parsed.businessDomain, "bd_public");
});

test("parseCallArgs defaults to POST when data is present", () => {
  const parsed = parseCallArgs(["https://dip.aishu.cn/api/demo", "-d", "x=1"]);
  assert.equal(parsed.method, "POST");
});

test("parseCallArgs supports pretty output", () => {
  const parsed = parseCallArgs(["https://dip.aishu.cn/api/demo", "--pretty"]);
  assert.equal(parsed.pretty, true);
});

test("parseCallArgs supports verbose output", () => {
  const parsed = parseCallArgs(["https://dip.aishu.cn/api/demo", "--verbose"]);
  assert.equal(parsed.verbose, true);
});

test("parseCallArgs supports custom business domain", () => {
  const parsed = parseCallArgs(["https://dip.aishu.cn/api/demo", "-bd", "bd_enterprise"]);
  assert.equal(parsed.businessDomain, "bd_enterprise");
});

test("parseTokenArgs accepts no flags", () => {
  assert.doesNotThrow(() => parseTokenArgs([]));
  assert.throws(() => parseTokenArgs(["--verbose"]), /Usage: kweaver token/);
});

test("run succeeds for help", async () => {
  assert.equal(await run(["--help"]), 0);
});

test("run fails for unknown commands", async () => {
  assert.equal(await run(["missing-command"]), 1);
});

test("run agent shows subcommand help", async () => {
  assert.equal(await run(["agent"]), 0);
});

test("run agent --help shows subcommand help", async () => {
  assert.equal(await run(["agent", "--help"]), 0);
});

test("run context-loader shows subcommand help", async () => {
  assert.equal(await run(["context-loader"]), 0);
});

test("run context-loader --help shows subcommand help", async () => {
  assert.equal(await run(["context-loader", "--help"]), 0);
});

test("run context-loader help includes standard MCP short commands", async () => {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    await run(["context-loader"]);
    const help = lines.join("\n");
    assert.ok(help.includes("resource <uri>"), "help should include resource");
    assert.ok(help.includes("templates"), "help should include templates");
    assert.ok(help.includes("prompts"), "help should include prompts");
    assert.ok(help.includes("prompt <name>"), "help should include prompt");
    assert.ok(help.includes("tools/list"), "help should map tools to tools/list");
    assert.ok(help.includes("resources/list"), "help should map resources to resources/list");
  } finally {
    console.log = originalLog;
  }
});

test("run context alias invokes context-loader", async () => {
  assert.equal(await run(["context"]), 0);
});

test("run context-loader config show when not configured", async () => {
  const configDir = createConfigDir();
  process.env.KWEAVERC_CONFIG_DIR = configDir;

  const store = await importStoreModule(configDir);
  store.saveClientConfig({
    baseUrl: "https://dip.aishu.cn",
    clientId: "c",
    clientSecret: "s",
    redirectUri: "http://127.0.0.1:9010/cb",
    logoutRedirectUri: "http://127.0.0.1:9010/logout",
    scope: "openid",
  });
  store.saveTokenConfig({
    baseUrl: "https://dip.aishu.cn",
    accessToken: "t",
    tokenType: "bearer",
    scope: "openid",
    obtainedAt: new Date().toISOString(),
  });
  store.setCurrentPlatform("https://dip.aishu.cn");

  const cli = await importCliModule(configDir);
  const code = await cli.run(["context-loader", "config", "show"]);
  assert.equal(code, 0);
});

test("run context-loader config set use list", async () => {
  const configDir = createConfigDir();
  process.env.KWEAVERC_CONFIG_DIR = configDir;

  const store = await importStoreModule(configDir);
  store.saveClientConfig({
    baseUrl: "https://dip.aishu.cn",
    clientId: "c",
    clientSecret: "s",
    redirectUri: "http://127.0.0.1:9010/cb",
    logoutRedirectUri: "http://127.0.0.1:9010/logout",
    scope: "openid",
  });
  store.saveTokenConfig({
    baseUrl: "https://dip.aishu.cn",
    accessToken: "t",
    tokenType: "bearer",
    scope: "openid",
    obtainedAt: new Date().toISOString(),
  });
  store.setCurrentPlatform("https://dip.aishu.cn");

  const cli = await importCliModule(configDir);

  assert.equal(await cli.run(["context-loader", "config", "set", "--kn-id", "kn-123"]), 0);
  const kn = store.getCurrentContextLoaderKn();
  assert.ok(kn);
  assert.equal(kn.knId, "kn-123");
  assert.equal(kn.mcpUrl, "https://dip.aishu.cn/api/agent-retrieval/v1/mcp");

  assert.equal(await cli.run(["context-loader", "config", "set", "--kn-id", "kn-456", "--name", "project-a"]), 0);
  assert.equal(await cli.run(["context-loader", "config", "use", "project-a"]), 0);
  assert.equal(store.getCurrentContextLoaderKn()?.knId, "kn-456");

  assert.equal(await cli.run(["context-loader", "config", "list"]), 0);
});

test("buildAuthorizationUrl generates a complete oauth url from client config", () => {
  const authorizationUrl = buildAuthorizationUrl(
    {
      baseUrl: "https://dip.aishu.cn",
      clientId: "client-123",
      clientSecret: "secret-123",
      redirectUri: "http://127.0.0.1:9010/callback",
      logoutRedirectUri: "http://127.0.0.1:9010/successful-logout",
      scope: "openid offline all",
      lang: "zh-cn",
      product: "adp",
      xForwardedPrefix: "",
    },
    "state-123"
  );

  const url = new URL(authorizationUrl);
  assert.equal(url.origin, "https://dip.aishu.cn");
  assert.equal(url.pathname, "/oauth2/auth");
  assert.equal(url.searchParams.get("client_id"), "client-123");
  assert.equal(url.searchParams.get("redirect_uri"), "http://127.0.0.1:9010/callback");
  assert.equal(url.searchParams.get("scope"), "openid offline all");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("state"), "state-123");
  assert.equal(url.searchParams.get("lang"), "zh-cn");
  assert.equal(url.searchParams.get("product"), "adp");
});

test("buildAuthRedirectConfig uses localhost callback by default", () => {
  const config = buildAuthRedirectConfig({ port: 9010 });

  assert.equal(config.redirectUri, "http://127.0.0.1:9010/callback");
  assert.equal(config.logoutRedirectUri, "http://127.0.0.1:9010/successful-logout");
  assert.equal(config.listenHost, "127.0.0.1");
  assert.equal(config.listenPort, 9010);
  assert.equal(config.callbackPath, "/callback");
});

test("buildAuthRedirectConfig supports host and redirect override", () => {
  const config = buildAuthRedirectConfig({
    port: 9010,
    host: "0.0.0.0",
    redirectUriOverride: "https://auth.example.com/kweaver/callback",
  });

  assert.equal(config.redirectUri, "https://auth.example.com/kweaver/callback");
  assert.equal(config.logoutRedirectUri, "https://auth.example.com/kweaver/successful-logout");
  assert.equal(config.listenHost, "0.0.0.0");
  assert.equal(config.listenPort, 9010);
  assert.equal(config.callbackPath, "/kweaver/callback");
});

test("login with --no-open prints headless instructions and accepts callback", async () => {
  const configDir = createConfigDir();
  process.env.KWEAVERC_CONFIG_DIR = configDir;

  const oauthServer = createServer((request, response) => {
    if (request.method === "POST" && request.url === "/oauth2/clients") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ client_id: "client-headless", client_secret: "secret-headless" }));
      return;
    }

    if (request.method === "POST" && request.url === "/oauth2/token") {
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          access_token: "token-headless",
          token_type: "bearer",
          scope: "openid offline all",
          refresh_token: "refresh-headless",
        })
      );
      return;
    }

    response.statusCode = 404;
    response.end("not found");
  });

  const platformPort = await listen(oauthServer);
  const callbackPort = await reservePort();
  const output: string[] = [];
  const originalConsoleLog = console.log;

  try {
    console.log = (...args: unknown[]) => {
      output.push(args.map(String).join(" "));
    };

    const loginPromise = import("../src/auth/oauth.js").then(({ login }) =>
      login({
        baseUrl: `http://127.0.0.1:${platformPort}`,
        port: callbackPort,
        clientName: "kweaver-test",
        open: false,
        forceRegister: true,
        host: "127.0.0.1",
        redirectUriOverride: "https://auth.example.com/kweaver/callback",
      })
    );

    let authorizationUrl = "";
    for (let attempt = 0; attempt < 50; attempt += 1) {
      authorizationUrl = output.find((line) => line.includes("/oauth2/auth?")) ?? "";
      if (authorizationUrl) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    assert.ok(authorizationUrl, "expected auth URL to be printed in headless mode");
    const state = new URL(authorizationUrl).searchParams.get("state");
    assert.ok(state, "expected auth URL to include state");

    const callbackResponse = await fetch(
      `http://127.0.0.1:${callbackPort}/kweaver/callback?code=code-headless&state=${state}`
    );
    assert.equal(callbackResponse.status, 200);
    assert.equal(await callbackResponse.text(), getAuthorizationSuccessMessage());

    const result = await loginPromise;
    assert.equal(result.client.redirectUri, "https://auth.example.com/kweaver/callback");
    assert.equal(result.callback.code, "code-headless");
    assert.equal(result.token.accessToken, "token-headless");

    assert.ok(output.includes("Authorization URL:"));
    assert.ok(output.includes("Redirect URI: https://auth.example.com/kweaver/callback"));
    assert.ok(output.includes(`Waiting for OAuth callback on http://127.0.0.1:${callbackPort}/kweaver/callback`));
    assert.ok(output.includes("If your browser is on another machine, use SSH port forwarding first:"));
    assert.ok(output.includes(`ssh -L ${callbackPort}:127.0.0.1:${callbackPort} user@server`));
  } finally {
    console.log = originalConsoleLog;
    await new Promise<void>((resolve, reject) => {
      oauthServer.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
});

test("getClientProvisioningMessage describes whether a client was reused or created", () => {
  assert.equal(getClientProvisioningMessage(true), "Registered a new OAuth client.");
  assert.equal(getClientProvisioningMessage(false), "Reusing existing OAuth client.");
});

test("help text exposes auth as completing oauth login through local callback", async () => {
  assert.equal(await run(["help"]), 0);
});

test("run auth delete removes a saved platform by alias", async () => {
  const configDir = createConfigDir();
  const store = await importStoreModule(configDir);
  const auth = await importAuthModule(configDir);

  store.saveClientConfig({
    baseUrl: "https://dip.aishu.cn",
    clientId: "client-a",
    clientSecret: "secret-a",
    redirectUri: "http://127.0.0.1:9010/callback",
    logoutRedirectUri: "http://127.0.0.1:9010/successful-logout",
    scope: "openid offline all",
  });
  store.saveTokenConfig({
    baseUrl: "https://dip.aishu.cn",
    accessToken: "token-a",
    tokenType: "bearer",
    scope: "openid offline all",
    obtainedAt: "2026-03-11T00:00:00.000Z",
  });
  store.setPlatformAlias("https://dip.aishu.cn", "dip");
  store.setCurrentPlatform("https://dip.aishu.cn");

  store.saveClientConfig({
    baseUrl: "https://adp.aishu.cn",
    clientId: "client-b",
    clientSecret: "secret-b",
    redirectUri: "http://127.0.0.1:9010/callback",
    logoutRedirectUri: "http://127.0.0.1:9010/successful-logout",
    scope: "openid offline all",
  });

  assert.equal(await auth.runAuthCommand(["delete", "dip"]), 0);
  assert.equal(store.hasPlatform("https://dip.aishu.cn"), false);
  assert.equal(store.getCurrentPlatform(), "https://adp.aishu.cn");
});

test("run auth logout clears token and callback but keeps client config", async () => {
  const configDir = createConfigDir();
  const store = await importStoreModule(configDir);
  const auth = await importAuthModule(configDir);

  store.saveClientConfig({
    baseUrl: "https://dip.aishu.cn",
    clientId: "client-a",
    clientSecret: "secret-a",
    redirectUri: "http://127.0.0.1:9010/callback",
    logoutRedirectUri: "http://127.0.0.1:9010/successful-logout",
    scope: "openid offline all",
  });
  store.saveTokenConfig({
    baseUrl: "https://dip.aishu.cn",
    accessToken: "token-a",
    tokenType: "bearer",
    scope: "openid offline all",
    obtainedAt: "2026-03-11T00:00:00.000Z",
  });
  store.saveCallbackSession({
    baseUrl: "https://dip.aishu.cn",
    redirectUri: "http://127.0.0.1:9010/callback",
    code: "code-1",
    state: "state-1",
    receivedAt: "2026-03-11T00:00:00.000Z",
  });
  store.setCurrentPlatform("https://dip.aishu.cn");

  assert.equal(store.loadTokenConfig("https://dip.aishu.cn")?.accessToken, "token-a");
  assert.equal(store.loadCallbackSession("https://dip.aishu.cn")?.code, "code-1");

  assert.equal(await auth.runAuthCommand(["logout"]), 0);

  assert.equal(store.hasPlatform("https://dip.aishu.cn"), true);
  assert.equal(store.loadClientConfig("https://dip.aishu.cn")?.clientId, "client-a");
  assert.equal(store.loadTokenConfig("https://dip.aishu.cn"), null);
  assert.equal(store.loadCallbackSession("https://dip.aishu.cn"), null);
  assert.equal(store.getCurrentPlatform(), "https://dip.aishu.cn");
});

test("formatAuthStatusSummary includes platform token and callback details", () => {
  const lines = formatAuthStatusSummary({
    client: {
      baseUrl: "https://dip.aishu.cn",
      clientId: "client-123",
      clientSecret: "secret-123",
      redirectUri: "http://127.0.0.1:9010/callback",
      logoutRedirectUri: "http://127.0.0.1:9010/successful-logout",
      scope: "openid offline all",
      lang: "zh-cn",
      product: "adp",
      xForwardedPrefix: "",
    },
    token: {
      baseUrl: "https://dip.aishu.cn",
      accessToken: "token-123",
      tokenType: "bearer",
      scope: "openid offline all",
      expiresAt: "2026-03-10T12:00:00.000Z",
      obtainedAt: "2026-03-10T11:00:00.000Z",
    },
    callback: {
      baseUrl: "https://dip.aishu.cn",
      redirectUri: "http://127.0.0.1:9010/callback",
      code: "code-123",
      state: "state-123",
      scope: "openid offline all",
      receivedAt: "2026-03-10T11:05:00.000Z",
    },
    isCurrent: true,
  });

  assert.ok(lines.includes("Platform: https://dip.aishu.cn"));
  assert.ok(lines.includes("Current platform: yes"));
  assert.ok(lines.includes("Token present: yes"));
  assert.ok(lines.includes("Callback recorded: yes"));
  assert.ok(lines.includes("Last callback at: 2026-03-10T11:05:00.000Z"));
  assert.ok(lines.includes("Last callback scope: openid offline all"));
});

test("formatHttpError expands network request failures with url and cause", () => {
  const message = formatHttpError(
    new NetworkRequestError(
      "POST",
      "https://adp.aishu.cn/oauth2/clients",
      "getaddrinfo ENOTFOUND adp.aishu.cn",
      "DNS lookup failed. Check whether the domain is correct and reachable from your network."
    )
  );

  assert.equal(
    message,
    "Network request failed\nMethod: POST\nURL: https://adp.aishu.cn/oauth2/clients\nCause: getaddrinfo ENOTFOUND adp.aishu.cn\nHint: DNS lookup failed. Check whether the domain is correct and reachable from your network."
  );
});

test("formatHttpError formats OAuth invalid_grant with readable hint", () => {
  const body = JSON.stringify({
    error: "invalid_grant",
    error_description:
      "The provided authorization grant (e.g., authorization code, resource owner credentials) or refresh token is invalid, expired, revoked, does not match the redirection URI used in the authorization request, or was issued to another client. The OAuth 2.0 Client ID from this request does not match the ID during the initial token issuance.",
  });
  const message = formatHttpError(new HttpError(400, "Bad Request", body));

  assert.ok(message.startsWith("HTTP 400 Bad Request"));
  assert.ok(message.includes("OAuth error: invalid_grant"));
  assert.ok(message.includes("Run `kweaver auth <platform-url>` again to log in"));
});

test("getAuthorizationSuccessMessage tells the user to close the page", () => {
  assert.equal(
    getAuthorizationSuccessMessage(),
    "Authorization succeeded. You can close this page and return to the terminal."
  );
});

test("formatCallOutput pretty prints json when requested", () => {
  assert.equal(formatCallOutput("{\"ok\":true}", true), '{\n  "ok": true\n}');
  assert.equal(formatCallOutput("plain text", true), "plain text");
  assert.equal(formatCallOutput("{\"ok\":true}", false), "{\"ok\":true}");
});

test("stripSseDoneMarker removes terminal done event from event streams", () => {
  const text = 'data: {"ok":true}\n\ndata: [DONE]\n';
  assert.equal(stripSseDoneMarker(text, "text/event-stream"), 'data: {"ok":true}');
  assert.equal(stripSseDoneMarker(text, "application/json"), text);
});

test("formatVerboseRequest prints method url headers and body state", () => {
  const lines = formatVerboseRequest({
    url: "https://dip.aishu.cn/api/demo",
    method: "GET",
    headers: new Headers({
      accept: "application/json",
      "x-business-domain": "bd_public",
    }),
    pretty: false,
    verbose: true,
    businessDomain: "bd_public",
  });

  assert.ok(lines.includes("Method: GET"));
  assert.ok(lines.includes("URL: https://dip.aishu.cn/api/demo"));
  assert.ok(lines.includes("Headers:"));
  assert.ok(lines.includes("  accept: application/json"));
  assert.ok(lines.includes("  x-business-domain: bd_public"));
  assert.ok(lines.includes("Body: empty"));
});

test("parseKnListArgs parses flags with defaults", () => {
  const opts = parseKnListArgs([]);
  assert.equal(opts.offset, 0);
  assert.equal(opts.limit, 50);
  assert.equal(opts.sort, "update_time");
  assert.equal(opts.direction, "desc");
  assert.equal(opts.businessDomain, "bd_public");
  assert.equal(opts.detail, false);
  assert.equal(opts.pretty, true);
  assert.equal(opts.verbose, false);
});

test("parseKnListArgs parses custom offset limit sort direction", () => {
  const opts = parseKnListArgs([
    "--limit",
    "10",
    "--offset",
    "5",
    "--sort",
    "create_time",
    "--direction",
    "asc",
    "--pretty",
    "-bd",
    "bd_enterprise",
  ]);
  assert.equal(opts.offset, 5);
  assert.equal(opts.limit, 10);
  assert.equal(opts.sort, "create_time");
  assert.equal(opts.direction, "asc");
  assert.equal(opts.businessDomain, "bd_enterprise");
  assert.equal(opts.pretty, true);
});

test("parseKnListArgs parses optional name_pattern and tag filters", () => {
  const opts = parseKnListArgs(["--name-pattern", "incident", "--tag", "prod", "--detail", "--verbose"]);
  assert.equal(opts.name_pattern, "incident");
  assert.equal(opts.tag, "prod");
  assert.equal(opts.detail, true);
  assert.equal(opts.verbose, true);
});

test("parseKnListArgs throws on unknown flag", () => {
  assert.throws(
    () => parseKnListArgs(["--unknown"]),
    /Unsupported kn list argument: --unknown/
  );
});

test("parseKnGetArgs parses kn-id stats export and pretty", () => {
  const opts = parseKnGetArgs(["kn-123", "--stats", "--export", "--pretty", "-bd", "bd_enterprise"]);
  assert.equal(opts.knId, "kn-123");
  assert.equal(opts.stats, true);
  assert.equal(opts.export, true);
  assert.equal(opts.pretty, true);
  assert.equal(opts.businessDomain, "bd_enterprise");
});

test("parseKnGetArgs requires kn-id", () => {
  assert.throws(() => parseKnGetArgs([]), /Missing kn-id/);
});

test("parseKnCreateArgs parses flag-based body and query params", () => {
  const opts = parseKnCreateArgs([
    "--name",
    "Incident Network",
    "--comment",
    "core network",
    "--tags",
    "prod,incident",
    "--icon",
    "bolt",
    "--color",
    "#fff000",
    "--branch",
    "main",
    "--base-branch",
    "",
    "--import-mode",
    "overwrite",
    "--validate-dependency",
    "false",
    "--pretty",
    "-bd",
    "bd_enterprise",
  ]);

  const body = JSON.parse(opts.body) as Record<string, unknown>;
  assert.equal(body.name, "Incident Network");
  assert.equal(body.comment, "core network");
  assert.deepEqual(body.tags, ["prod", "incident"]);
  assert.equal(body.icon, "bolt");
  assert.equal(body.color, "#fff000");
  assert.equal(body.branch, "main");
  assert.equal(body.base_branch, "");
  assert.equal(opts.import_mode, "overwrite");
  assert.equal(opts.validate_dependency, false);
  assert.equal(opts.pretty, true);
  assert.equal(opts.businessDomain, "bd_enterprise");
});

test("parseKnCreateArgs reads --body-file and rejects mixed flags", () => {
  const dir = createConfigDir();
  const bodyFile = join(dir, "kn-create.json");
  writeFileSync(bodyFile, JSON.stringify({ name: "Network", branch: "main", base_branch: "" }));

  const opts = parseKnCreateArgs(["--body-file", bodyFile]);
  assert.equal(opts.body, '{"name":"Network","branch":"main","base_branch":""}');

  assert.throws(
    () => parseKnCreateArgs(["--body-file", bodyFile, "--name", "Mixed"]),
    /Cannot use --body-file together/
  );
});

test("parseKnUpdateArgs parses kn-id and body flags", () => {
  const opts = parseKnUpdateArgs([
    "kn-123",
    "--name",
    "Updated Network",
    "--comment",
    "updated",
    "--tags",
    "one,two",
    "--branch",
    "main",
    "--base-branch",
    "",
    "--pretty",
  ]);

  assert.equal(opts.knId, "kn-123");
  assert.equal(opts.pretty, true);
  assert.deepEqual(JSON.parse(opts.body), {
    name: "Updated Network",
    comment: "updated",
    tags: ["one", "two"],
    branch: "main",
    base_branch: "",
  });
});

test("parseKnUpdateArgs requires kn-id and name when not using body file", () => {
  assert.throws(() => parseKnUpdateArgs([]), /Missing kn-id/);
  assert.throws(() => parseKnUpdateArgs(["kn-123"]), /--name is required/);
});

test("parseKnDeleteArgs parses kn-id and biz-domain", () => {
  const opts = parseKnDeleteArgs(["kn-123", "-bd", "bd_enterprise"]);
  assert.equal(opts.knId, "kn-123");
  assert.equal(opts.businessDomain, "bd_enterprise");
});

test("parseKnDeleteArgs requires kn-id", () => {
  assert.throws(() => parseKnDeleteArgs([]), /Missing kn-id/);
});

test("parseKnObjectTypeQueryArgs merges --limit and --search-after into body", () => {
  const opts = parseKnObjectTypeQueryArgs([
    "kn-123",
    "pod",
    '{"condition":{"operation":"and","sub_conditions":[]}}',
    "--limit",
    "100",
    "--search-after",
    '["cursor-1","cursor-2"]',
    "--pretty",
    "-bd",
    "bd_enterprise",
  ]);

  assert.equal(opts.knId, "kn-123");
  assert.equal(opts.otId, "pod");
  assert.equal(opts.pretty, true);
  assert.equal(opts.businessDomain, "bd_enterprise");
  assert.deepEqual(JSON.parse(opts.body), {
    condition: { operation: "and", sub_conditions: [] },
    limit: 100,
    search_after: ["cursor-1", "cursor-2"],
  });
});

test("parseKnObjectTypeQueryArgs allows body omission when --limit is provided", () => {
  const opts = parseKnObjectTypeQueryArgs(["kn-123", "pod", "--limit", "20"]);
  assert.deepEqual(JSON.parse(opts.body), { limit: 20 });
});

test("parseKnObjectTypeQueryArgs requires limit in body or flags", () => {
  assert.throws(
    () => parseKnObjectTypeQueryArgs(["kn-123", "pod", '{"condition":{"operation":"and","sub_conditions":[]}}']),
    /Missing limit/
  );
});

test("parseKnObjectTypeQueryArgs validates --search-after json array", () => {
  assert.throws(
    () => parseKnObjectTypeQueryArgs(["kn-123", "pod", "--limit", "10", "--search-after", '{"cursor":"x"}']),
    /Expected a JSON array string/
  );
});

test("parseAgentListArgs parses flags with defaults", () => {
  const opts = parseAgentListArgs([]);
  assert.equal(opts.name, "");
  assert.equal(opts.offset, 0);
  assert.equal(opts.limit, 50);
  assert.equal(opts.category_id, "");
  assert.equal(opts.custom_space_id, "");
  assert.equal(opts.is_to_square, 1);
  assert.equal(opts.businessDomain, "bd_public");
  assert.equal(opts.pretty, true);
  assert.equal(opts.verbose, false);
});

test("parseAgentListArgs parses custom name offset limit and body fields", () => {
  const opts = parseAgentListArgs([
    "--name",
    "my-agent",
    "--offset",
    "10",
    "--limit",
    "20",
    "--category-id",
    "cat-1",
    "--custom-space-id",
    "space-1",
    "--is-to-square",
    "0",
    "--verbose",
    "--pretty",
    "-bd",
    "bd_enterprise",
  ]);
  assert.equal(opts.name, "my-agent");
  assert.equal(opts.offset, 10);
  assert.equal(opts.limit, 20);
  assert.equal(opts.category_id, "cat-1");
  assert.equal(opts.custom_space_id, "space-1");
  assert.equal(opts.is_to_square, 0);
  assert.equal(opts.businessDomain, "bd_enterprise");
  assert.equal(opts.pretty, true);
  assert.equal(opts.verbose, true);
});

test("parseAgentListArgs throws on unknown flag", () => {
  assert.throws(
    () => parseAgentListArgs(["--unknown"]),
    /Unsupported agent list argument: --unknown/
  );
});

test("run bkn shows subcommand help", async () => {
  assert.equal(await run(["bkn"]), 0);
});

test("run bkn --help shows subcommand help", async () => {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    assert.equal(await run(["bkn", "--help"]), 0);
    const help = lines.join("\n");
    assert.ok(help.includes("list [options]"));
    assert.ok(help.includes("export <kn-id>"));
    assert.ok(help.includes("object-type query"));
    assert.ok(help.includes("subgraph"));
    assert.ok(help.includes("action-type"));
    assert.ok(help.includes("action-log"));
  } finally {
    console.log = originalLog;
  }
});

test("run bkn get --help shows get options", async () => {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    assert.equal(await run(["bkn", "get", "--help"]), 0);
    const help = lines.join("\n");
    assert.ok(help.includes("Get knowledge network detail"));
    assert.ok(help.includes("--stats"));
    assert.ok(help.includes("--export"));
  } finally {
    console.log = originalLog;
  }
});

test("run bkn list --help shows verbose option", async () => {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    assert.equal(await run(["bkn", "list", "--help"]), 0);
    const help = lines.join("\n");
    assert.ok(help.includes("--detail"));
    assert.ok(help.includes("--verbose"));
    assert.ok(!help.includes("--simple"));
  } finally {
    console.log = originalLog;
  }
});

test("run bkn create --help shows create options", async () => {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    assert.equal(await run(["bkn", "create", "--help"]), 0);
    const help = lines.join("\n");
    assert.ok(help.includes("--body-file"));
    assert.ok(help.includes("--import-mode"));
    assert.ok(help.includes("--validate-dependency"));
  } finally {
    console.log = originalLog;
  }
});

test("run bkn object-type --help shows list query and properties usage", async () => {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    assert.equal(await run(["bkn", "object-type", "--help"]), 0);
    const help = lines.join("\n");
    assert.ok(help.includes("object-type list"));
    assert.ok(help.includes("object-type query"));
    assert.ok(help.includes("object-type properties"));
    assert.ok(help.includes("<kn-id>"));
    assert.ok(help.includes("<ot-id>"));
    assert.ok(help.includes("--limit <n>"));
    assert.ok(help.includes("--search-after"));
  } finally {
    console.log = originalLog;
  }
});

test("run bkn subgraph --help shows usage", async () => {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    assert.equal(await run(["bkn", "subgraph", "--help"]), 0);
    const help = lines.join("\n");
    assert.ok(help.includes("subgraph <kn-id>"));
    assert.ok(help.includes("'<json>'"));
  } finally {
    console.log = originalLog;
  }
});

test("run bkn action-type --help shows list query and execute with side effects note", async () => {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    assert.equal(await run(["bkn", "action-type", "--help"]), 0);
    const help = lines.join("\n");
    assert.ok(help.includes("action-type list"));
    assert.ok(help.includes("action-type query"));
    assert.ok(help.includes("action-type execute"));
    assert.ok(help.includes("side effects"));
  } finally {
    console.log = originalLog;
  }
});

test("run bkn action-execution --help shows get usage", async () => {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    assert.equal(await run(["bkn", "action-execution", "--help"]), 0);
    const help = lines.join("\n");
    assert.ok(help.includes("action-execution get"));
    assert.ok(help.includes("<execution-id>"));
  } finally {
    console.log = originalLog;
  }
});

test("run bkn action-log --help shows list get cancel", async () => {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    assert.equal(await run(["bkn", "action-log", "--help"]), 0);
    const help = lines.join("\n");
    assert.ok(help.includes("action-log list"));
    assert.ok(help.includes("action-log get"));
    assert.ok(help.includes("action-log cancel"));
  } finally {
    console.log = originalLog;
  }
});

test("run agent list --help shows list options", async () => {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    assert.equal(await run(["agent", "list", "--help"]), 0);
    const help = lines.join("\n");
    assert.ok(help.includes("List published agents"));
    assert.ok(help.includes("--name"));
    assert.ok(help.includes("--offset"));
    assert.ok(help.includes("--limit"));
    assert.ok(help.includes("--verbose"));
    assert.ok(help.includes("--pretty"));
  } finally {
    console.log = originalLog;
  }
});

test("formatSimpleKnList keeps only name id description", () => {
  const output = formatSimpleKnList(
    JSON.stringify({
      entries: [
        { id: "kn-1", name: "Network A", comment: "Desc A", extra: true },
        { id: "kn-2", name: "Network B" },
      ],
      total_count: 2,
    }),
    true
  );

  assert.equal(
    output,
    JSON.stringify(
      [
        { name: "Network A", id: "kn-1", description: "Desc A" },
        { name: "Network B", id: "kn-2", description: "" },
      ],
      null,
      2
    )
  );
});

test("formatSimpleKnList can include detail in simplified output", () => {
  const output = formatSimpleKnList(
    JSON.stringify({
      entries: [
        { id: "kn-1", name: "Network A", comment: "Desc A", detail: "Detail A", extra: true },
        { id: "kn-2", name: "Network B", detail: 123 },
      ],
      total_count: 2,
    }),
    true,
    true
  );

  assert.equal(
    output,
    JSON.stringify(
      [
        { name: "Network A", id: "kn-1", description: "Desc A", detail: "Detail A" },
        { name: "Network B", id: "kn-2", description: "", detail: "" },
      ],
      null,
      2
    )
  );
});

test("formatSimpleAgentList keeps only name id description", () => {
  const output = formatSimpleAgentList(
    JSON.stringify({
      entries: [
        { id: "agent-1", name: "Agent A", description: "Desc A", extra: true },
        { id: "agent-2", name: "Agent B", comment: "Desc B" },
      ],
    }),
    true
  );

  assert.equal(
    output,
    JSON.stringify(
      [
        { name: "Agent A", id: "agent-1", description: "Desc A" },
        { name: "Agent B", id: "agent-2", description: "Desc B" },
      ],
      null,
      2
    )
  );
});

test("parseKnDeleteArgs parses --yes flag to skip confirmation", () => {
  const opts = parseKnDeleteArgs(["kn-123", "--yes"]);
  assert.equal(opts.knId, "kn-123");
  assert.equal(opts.yes, true);
});

test("parseKnDeleteArgs defaults yes to false", () => {
  const opts = parseKnDeleteArgs(["kn-123"]);
  assert.equal(opts.yes, false);
});

test("parseKnDeleteArgs accepts -y shorthand", () => {
  const opts = parseKnDeleteArgs(["kn-123", "-y"]);
  assert.equal(opts.yes, true);
});

test("parseKnActionTypeExecuteArgs defaults to wait=true timeout=300", () => {
  const opts = parseKnActionTypeExecuteArgs(["kn-123", "at-456", "{}"]);
  assert.equal(opts.wait, true);
  assert.equal(opts.timeout, 300);
});

test("parseKnActionTypeExecuteArgs parses --no-wait", () => {
  const opts = parseKnActionTypeExecuteArgs(["kn-123", "at-456", "{}", "--no-wait"]);
  assert.equal(opts.wait, false);
});

test("parseKnActionTypeExecuteArgs parses --timeout", () => {
  const opts = parseKnActionTypeExecuteArgs(["kn-123", "at-456", "{}", "--timeout", "60"]);
  assert.equal(opts.timeout, 60);
});

test("parseAgentSessionsArgs requires agent_id", () => {
  assert.throws(() => parseAgentSessionsArgs([]), /Missing agent_id/);
});

test("parseAgentSessionsArgs parses positional agent_id", () => {
  const opts = parseAgentSessionsArgs(["agent-123"]);
  assert.equal(opts.agentId, "agent-123");
  assert.equal(opts.businessDomain, "bd_public");
  assert.equal(opts.pretty, true);
  assert.equal(opts.limit, undefined);
});

test("parseAgentSessionsArgs parses --limit and -bd", () => {
  const opts = parseAgentSessionsArgs(["agent-123", "--limit", "10", "-bd", "bd_enterprise"]);
  assert.equal(opts.limit, 10);
  assert.equal(opts.businessDomain, "bd_enterprise");
});

test("parseAgentHistoryArgs requires conversation_id", () => {
  assert.throws(() => parseAgentHistoryArgs([]), /Missing conversation_id/);
});

test("parseAgentHistoryArgs parses positional conversation_id", () => {
  const opts = parseAgentHistoryArgs(["conv-abc"]);
  assert.equal(opts.conversationId, "conv-abc");
  assert.equal(opts.pretty, true);
  assert.equal(opts.limit, undefined);
});

test("parseAgentHistoryArgs parses --limit", () => {
  const opts = parseAgentHistoryArgs(["conv-abc", "--limit", "20"]);
  assert.equal(opts.limit, 20);
});

// ── parseKnSearchArgs ─────────────────────────────────────────────────────────

test("parseKnSearchArgs parses kn-id and query with defaults", () => {
  const opts = parseKnSearchArgs(["kn_medical", "高血压", "治疗"]);
  assert.equal(opts.knId, "kn_medical");
  assert.equal(opts.query, "高血压 治疗");
  assert.equal(opts.maxConcepts, 10);
  assert.equal(opts.mode, "keyword_vector_retrieval");
  assert.equal(opts.pretty, false);
});

test("parseKnSearchArgs parses --max-concepts --mode --pretty -bd", () => {
  const opts = parseKnSearchArgs([
    "kn_medical", "感冒", "--max-concepts", "5", "--mode", "vector", "--pretty", "-bd", "bd_test",
  ]);
  assert.equal(opts.knId, "kn_medical");
  assert.equal(opts.query, "感冒");
  assert.equal(opts.maxConcepts, 5);
  assert.equal(opts.mode, "vector");
  assert.equal(opts.pretty, true);
  assert.equal(opts.businessDomain, "bd_test");
});

test("parseKnSearchArgs requires kn-id and query", () => {
  assert.throws(() => parseKnSearchArgs([]), /Usage/);
  assert.throws(() => parseKnSearchArgs(["kn_medical"]), /Usage/);
});

test("parseKnSearchArgs throws on unknown flag", () => {
  assert.throws(() => parseKnSearchArgs(["kn1", "q", "--unknown"]), /Unknown flag/);
});

test("parseKnSearchArgs --help throws isHelp error", () => {
  try {
    parseKnSearchArgs(["--help"]);
    assert.fail("should have thrown");
  } catch (err) {
    assert.equal((err as { isHelp?: boolean }).isHelp, true);
  }
});

test("ensureValidToken returns env token when KWEAVER_TOKEN and KWEAVER_BASE_URL are set", async () => {
  process.env.KWEAVER_TOKEN = "env-token-123";
  process.env.KWEAVER_BASE_URL = "https://env.example.com/";
  try {
    const result = await ensureValidToken();
    assert.equal(result.accessToken, "env-token-123");
    assert.equal(result.baseUrl, "https://env.example.com");
  } finally {
    delete process.env.KWEAVER_TOKEN;
    delete process.env.KWEAVER_BASE_URL;
  }
});
