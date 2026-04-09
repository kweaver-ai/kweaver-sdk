import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { run } from "../src/cli.js";
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
  parseKnBuildArgs,
  formatSimpleKnList,
  parseConceptGroupArgs,
  parseActionScheduleArgs,
  parseJobArgs,
  parseRelationTypeCreateArgs,
  parseRelationTypeUpdateArgs,
  parseRelationTypeDeleteArgs,
} from "../src/commands/bkn.js";
import { parseDsListArgs, parseImportCsvArgs } from "../src/commands/ds.js";
import {
  parseAgentListArgs,
  parseAgentSessionsArgs,
  parseAgentHistoryArgs,
  parseAgentGetArgs,
  parseAgentPersonalListArgs,
  parseAgentTemplateListArgs,
  parseAgentTemplateGetArgs,
  formatSimpleAgentList,
} from "../src/commands/agent.js";
import { parseTokenArgs } from "../src/commands/token.js";
import {
  ensureValidToken,
  formatHttpError,
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

test("run dv alias dispatches to dataview command", async () => {
  assert.equal(await run(["dv", "--help"]), 0);
});

test("help text shows dv alias", async () => {
  const lines: string[] = [];
  const orig = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  try {
    await run(["--help"]);
    const text = lines.join("\n");
    assert.ok(text.includes("dataview|dv"), "help should mention dv alias");
    assert.ok(text.includes("skill"), "help should mention skill command");
  } finally {
    console.log = orig;
  }
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

test("run skill shows subcommand help", async () => {
  assert.equal(await run(["skill"]), 0);
});

test("run skill subcommand help does not require auth", async () => {
  const configDir = createConfigDir();
  process.env.KWEAVERC_CONFIG_DIR = configDir;

  const lines: string[] = [];
  const orig = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    assert.equal(await run(["skill", "list", "--help"]), 0);
    assert.ok(lines.join("\n").includes("kweaver skill list"), "help should show skill list usage");
  } finally {
    console.log = orig;
  }
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

test("help text exposes auth as completing oauth login through local callback", async () => {
  assert.equal(await run(["help"]), 0);
});

test("run auth delete removes a saved platform by alias", async () => {
  const configDir = createConfigDir();
  const store = await importStoreModule(configDir);
  const auth = await importAuthModule(configDir);

  store.saveTokenConfig({
    baseUrl: "https://dip.aishu.cn",
    accessToken: "token-a",
    tokenType: "bearer",
    scope: "openid offline all",
    obtainedAt: "2026-03-11T00:00:00.000Z",
  });
  store.setPlatformAlias("https://dip.aishu.cn", "dip");
  store.setCurrentPlatform("https://dip.aishu.cn");

  store.saveTokenConfig({
    baseUrl: "https://adp.aishu.cn",
    accessToken: "token-b",
    tokenType: "bearer",
    scope: "openid offline all",
    obtainedAt: "2026-03-11T00:00:00.000Z",
  });

  assert.equal(await auth.runAuthCommand(["delete", "dip"]), 0);
  assert.equal(store.hasPlatform("https://dip.aishu.cn"), false);
  assert.equal(store.getCurrentPlatform(), "https://adp.aishu.cn");
});

test("run auth logout clears token for current platform", async () => {
  const configDir = createConfigDir();
  const store = await importStoreModule(configDir);
  const auth = await importAuthModule(configDir);

  store.saveTokenConfig({
    baseUrl: "https://dip.aishu.cn",
    accessToken: "token-a",
    tokenType: "bearer",
    scope: "openid offline all",
    obtainedAt: "2026-03-11T00:00:00.000Z",
  });
  store.setCurrentPlatform("https://dip.aishu.cn");

  assert.equal(store.loadTokenConfig("https://dip.aishu.cn")?.accessToken, "token-a");

  assert.equal(await auth.runAuthCommand(["logout"]), 0);

  assert.equal(store.loadTokenConfig("https://dip.aishu.cn"), null);
  assert.equal(store.getCurrentPlatform(), "https://dip.aishu.cn");
});

test("run auth export prints headless hint and copy command when credentials exist", async () => {
  const configDir = createConfigDir();
  const store = await importStoreModule(configDir);
  const auth = await importAuthModule(configDir);
  const base = "https://export-test.example.com";
  store.saveClientConfig(base, {
    baseUrl: base,
    clientId: "exp-cid",
    clientSecret: "exp-sec",
  });
  store.saveTokenConfig({
    baseUrl: base,
    accessToken: "at",
    tokenType: "Bearer",
    scope: "s",
    refreshToken: "exp-rt",
    obtainedAt: new Date().toISOString(),
  });
  store.setCurrentPlatform(base);

  const lines: string[] = [];
  const origLog = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    assert.equal(await auth.runAuthCommand(["export"]), 0);
  } finally {
    console.log = origLog;
  }
  const joined = lines.join("\n");
  assert.match(joined, /exp-cid/);
  assert.match(joined, /exp-sec/);
  assert.match(joined, /exp-rt/);
  assert.match(joined, /On a machine without a browser/);
  assert.match(joined, /--refresh-token/);
});

test("run auth export --json prints valid JSON credentials", async () => {
  const configDir = createConfigDir();
  const store = await importStoreModule(configDir);
  const auth = await importAuthModule(configDir);
  const base = "https://json-export.example.com";
  store.saveClientConfig(base, {
    baseUrl: base,
    clientId: "j-cid",
    clientSecret: "j-sec",
  });
  store.saveTokenConfig({
    baseUrl: base,
    accessToken: "at",
    tokenType: "Bearer",
    scope: "",
    refreshToken: "j-rt",
    obtainedAt: new Date().toISOString(),
  });
  store.setCurrentPlatform(base);

  let jsonLine = "";
  const origLog = console.log;
  console.log = (...args: unknown[]) => {
    jsonLine = args.map(String).join(" ");
  };
  try {
    assert.equal(await auth.runAuthCommand(["export", "--json"]), 0);
  } finally {
    console.log = origLog;
  }
  const data = JSON.parse(jsonLine) as {
    baseUrl: string;
    clientId: string;
    clientSecret: string;
    refreshToken: string;
  };
  assert.equal(data.baseUrl, base);
  assert.equal(data.clientId, "j-cid");
  assert.equal(data.clientSecret, "j-sec");
  assert.equal(data.refreshToken, "j-rt");
});

test("run auth export fails when refresh token is missing", async () => {
  const configDir = createConfigDir();
  const store = await importStoreModule(configDir);
  const auth = await importAuthModule(configDir);
  const base = "https://no-rt.example.com";
  store.saveClientConfig(base, {
    baseUrl: base,
    clientId: "c",
    clientSecret: "s",
  });
  store.saveTokenConfig({
    baseUrl: base,
    accessToken: "at",
    tokenType: "Bearer",
    scope: "",
    obtainedAt: new Date().toISOString(),
  });
  store.setCurrentPlatform(base);

  assert.equal(await auth.runAuthCommand(["export"]), 1);
});

test("run auth login --refresh-token without --client-secret exits 1", async () => {
  const configDir = createConfigDir();
  await importStoreModule(configDir);
  const auth = await importAuthModule(configDir);

  const code = await auth.runAuthCommand([
    "https://headless.example.com",
    "--refresh-token",
    "rt-only",
    "--client-id",
    "cid-only",
  ]);
  assert.equal(code, 1);
});

test("run auth login with --refresh-token exchanges and saves access token", async () => {
  const configDir = createConfigDir();
  const store = await importStoreModule(configDir);
  const auth = await importAuthModule(configDir);
  const base = "https://headless-login.example.com";

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const u = typeof input === "string" ? input : input.toString();
    assert.ok(u.includes("/oauth2/token"));
    return new Response(
      JSON.stringify({
        access_token: "cli-new-at",
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: "cli-new-rt",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  try {
    assert.equal(
      await auth.runAuthCommand([
        base,
        "--client-id",
        "h-cid",
        "--client-secret",
        "h-sec",
        "--refresh-token",
        "h-rt",
      ]),
      0,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(store.getCurrentPlatform(), base);
  const tok = store.loadTokenConfig(base);
  assert.equal(tok?.accessToken, "cli-new-at");
  assert.equal(tok?.refreshToken, "cli-new-rt");
  const client = store.loadClientConfig(base);
  assert.equal(client?.clientId, "h-cid");
  assert.equal(client?.clientSecret, "h-sec");
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
  assert.equal(opts.limit, 30);
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

test("parseKnObjectTypeQueryArgs defaults limit to 50 when omitted", () => {
  const opts = parseKnObjectTypeQueryArgs(["kn-123", "pod", '{"condition":{"operation":"and","sub_conditions":[]}}']);
  const body = JSON.parse(opts.body);
  assert.strictEqual(body.limit, 50);
});

test("parseKnObjectTypeQueryArgs validates --search-after json array", () => {
  assert.throws(
    () => parseKnObjectTypeQueryArgs(["kn-123", "pod", "--limit", "10", "--search-after", '{"cursor":"x"}']),
    /Expected a JSON array string/
  );
});

test("parseKnObjectTypeQueryArgs rejects unrecognized top-level keys", () => {
  assert.throws(
    () => parseKnObjectTypeQueryArgs(["kn-123", "pod", '{"material_number":"130-000238"}']),
    /Unrecognized top-level key.*"material_number"/
  );
});

test("parseKnObjectTypeQueryArgs rejects multiple unrecognized keys with hint", () => {
  assert.throws(
    () => parseKnObjectTypeQueryArgs(["kn-123", "pod", '{"status":"active","price":100}']),
    /Unrecognized top-level key.*"status".*"price"/
  );
});

test("parseKnObjectTypeQueryArgs accepts valid top-level keys", () => {
  const opts = parseKnObjectTypeQueryArgs([
    "kn-123",
    "pod",
    '{"limit":20,"condition":{"field":"name","operation":"==","value":"test"}}',
  ]);
  const body = JSON.parse(opts.body);
  assert.strictEqual(body.limit, 20);
  assert.deepEqual(body.condition, { field: "name", operation: "==", value: "test" });
});

test("parseAgentListArgs parses flags with defaults", () => {
  const opts = parseAgentListArgs([]);
  assert.equal(opts.name, "");
  assert.equal(opts.offset, 0);
  assert.equal(opts.limit, 30);
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
    assert.ok(help.includes("push <directory>"));
    assert.ok(help.includes("pull <kn-id>"));
    assert.ok(help.includes("object-type query"));
    assert.ok(help.includes("subgraph"));
    assert.ok(help.includes("action-type"));
    assert.ok(help.includes("action-log"));
  } finally {
    console.log = originalLog;
  }
});

test("KN_HELP includes relation-type-paths and resources", async () => {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  try {
    assert.equal(await run(["bkn", "--help"]), 0);
    const help = lines.join("\n");
    assert.ok(help.includes("relation-type-paths"));
    assert.ok(help.includes("resources"));
  } finally { console.log = originalLog; }
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

test("run bkn build --help shows build options", async () => {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    assert.equal(await run(["bkn", "build", "--help"]), 0);
    const help = lines.join("\n");
    assert.ok(help.includes("bkn build"));
    assert.ok(help.includes("--wait"));
    assert.ok(help.includes("--no-wait"));
    assert.ok(help.includes("--timeout"));
  } finally {
    console.log = originalLog;
  }
});

test("run bkn push --help shows push options", async () => {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    assert.equal(await run(["bkn", "push", "--help"]), 0);
    const help = lines.join("\n");
    assert.ok(help.includes("bkn push"));
    assert.ok(help.includes("<directory>"));
    assert.ok(help.includes("--branch"));
    assert.ok(help.includes("biz-domain"));
  } finally {
    console.log = originalLog;
  }
});

test("run bkn pull --help shows pull options", async () => {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    assert.equal(await run(["bkn", "pull", "--help"]), 0);
    const help = lines.join("\n");
    assert.ok(help.includes("bkn pull"));
    assert.ok(help.includes("<kn-id>"));
    assert.ok(help.includes("<directory>"));
    assert.ok(help.includes("--branch"));
  } finally {
    console.log = originalLog;
  }
});

test("run bkn object-type create --help shows create usage", async () => {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    assert.equal(await run(["bkn", "object-type", "create", "--help"]), 0);
    const help = lines.join("\n");
    assert.ok(help.includes("object-type create"));
    assert.ok(help.includes("--name"));
    assert.ok(help.includes("--dataview-id"));
    assert.ok(help.includes("--primary-key"));
    assert.ok(help.includes("--display-key"));
  } finally {
    console.log = originalLog;
  }
});

test("run bkn relation-type create --help shows create usage", async () => {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    assert.equal(await run(["bkn", "relation-type", "create", "--help"]), 0);
    const help = lines.join("\n");
    assert.ok(help.includes("relation-type create"));
    assert.ok(help.includes("--name"));
    assert.ok(help.includes("--source"));
    assert.ok(help.includes("--target"));
  } finally {
    console.log = originalLog;
  }
});

test("run agent get --help shows get options", async () => {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    assert.equal(await run(["agent", "get", "--help"]), 0);
    const help = lines.join("\n");
    assert.ok(help.includes("agent get"));
    assert.ok(help.includes("<agent_id>"));
    assert.ok(help.includes("--verbose"));
  } finally {
    console.log = originalLog;
  }
});

test("run ds --help shows ds subcommands", async () => {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    assert.equal(await run(["ds", "--help"]), 0);
    const help = lines.join("\n");
    assert.ok(help.includes("list"));
    assert.ok(help.includes("get"));
    assert.ok(help.includes("delete"));
    assert.ok(help.includes("tables"));
    assert.ok(help.includes("connect"));
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
  assert.equal(opts.limit, 30);
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
  assert.equal(opts.limit, 30);
});

test("parseAgentHistoryArgs parses --limit", () => {
  const opts = parseAgentHistoryArgs(["conv-abc", "--limit", "20"]);
  assert.equal(opts.limit, 20);
});

test("parseAgentHistoryArgs parses agentId and conversationId", () => {
  const opts = parseAgentHistoryArgs(["agent-xyz", "conv-abc"]);
  assert.equal(opts.agentId, "agent-xyz");
  assert.equal(opts.conversationId, "conv-abc");
  assert.equal(opts.pretty, true);
  assert.equal(opts.limit, 30);
});

test("parseAgentHistoryArgs parses -bd with single conversationId", () => {
  const opts = parseAgentHistoryArgs(["conv-abc", "-bd", "bd_enterprise"]);
  assert.equal(opts.conversationId, "conv-abc");
  assert.equal(opts.businessDomain, "bd_enterprise");
  assert.equal(opts.agentId, undefined);
});

test("parseAgentHistoryArgs parses -bd with agentId and conversationId", () => {
  const opts = parseAgentHistoryArgs(["agent-xyz", "conv-abc", "-bd", "bd_enterprise"]);
  assert.equal(opts.agentId, "agent-xyz");
  assert.equal(opts.conversationId, "conv-abc");
  assert.equal(opts.businessDomain, "bd_enterprise");
});

test("parseAgentHistoryArgs parses --compact", () => {
  const opts = parseAgentHistoryArgs(["conv-abc", "--compact"]);
  assert.equal(opts.conversationId, "conv-abc");
  assert.equal(opts.pretty, false);
});

test("parseAgentHistoryArgs parses all options with agentId and conversationId", () => {
  const opts = parseAgentHistoryArgs(["agent-xyz", "conv-abc", "--limit", "50", "-bd", "bd_custom", "--compact"]);
  assert.equal(opts.agentId, "agent-xyz");
  assert.equal(opts.conversationId, "conv-abc");
  assert.equal(opts.limit, 50);
  assert.equal(opts.businessDomain, "bd_custom");
  assert.equal(opts.pretty, false);
});

test("parseAgentHistoryArgs parses all options with single conversationId", () => {
  const opts = parseAgentHistoryArgs(["conv-abc", "--limit", "100", "-bd", "bd_enterprise", "--pretty"]);
  assert.equal(opts.agentId, undefined);
  assert.equal(opts.conversationId, "conv-abc");
  assert.equal(opts.limit, 100);
  assert.equal(opts.businessDomain, "bd_enterprise");
  assert.equal(opts.pretty, true);
});

test("parseAgentGetArgs parses agent_id and options", () => {
  const opts = parseAgentGetArgs(["agent-123", "--verbose", "-bd", "bd_enterprise"]);
  assert.equal(opts.agentId, "agent-123");
  assert.equal(opts.verbose, true);
  assert.equal(opts.businessDomain, "bd_enterprise");
  assert.equal(opts.pretty, true);
});

test("parseAgentGetArgs requires agent_id", () => {
  assert.throws(() => parseAgentGetArgs([]), /Missing agent_id/);
});

test("parseAgentGetArgs throws on unknown flag", () => {
  assert.throws(
    () => parseAgentGetArgs(["agent-123", "--unknown"]),
    /Unsupported agent get argument/
  );
});

// ─── Agent Personal List Tests ────────────────────────────────────────────────────────

test("parseAgentPersonalListArgs parses defaults", () => {
  const opts = parseAgentPersonalListArgs([]);
  assert.equal(opts.name, "");
  assert.equal(opts.pagination_marker_str, "");
  assert.equal(opts.publish_status, "");
  assert.equal(opts.publish_to_be, "");
  assert.equal(opts.size, 48);
  assert.equal(opts.businessDomain, "bd_public");
  assert.equal(opts.pretty, true);
  assert.equal(opts.verbose, false);
});

test("parseAgentPersonalListArgs parses --name and --size", () => {
  const opts = parseAgentPersonalListArgs(["--name", "test", "--size", "20"]);
  assert.equal(opts.name, "test");
  assert.equal(opts.size, 20);
});

test("parseAgentPersonalListArgs parses --publish-status and --publish-to-be", () => {
  const opts = parseAgentPersonalListArgs(["--publish-status", "published", "--publish-to-be", "yes"]);
  assert.equal(opts.publish_status, "published");
  assert.equal(opts.publish_to_be, "yes");
});

test("parseAgentPersonalListArgs parses -bd and --verbose", () => {
  const opts = parseAgentPersonalListArgs(["-bd", "bd_enterprise", "--verbose"]);
  assert.equal(opts.businessDomain, "bd_enterprise");
  assert.equal(opts.verbose, true);
});

test("parseAgentPersonalListArgs parses --pagination-marker", () => {
  const opts = parseAgentPersonalListArgs(["--pagination-marker", "marker123"]);
  assert.equal(opts.pagination_marker_str, "marker123");
});

test("parseAgentPersonalListArgs throws on unknown flag", () => {
  assert.throws(
    () => parseAgentPersonalListArgs(["--unknown"]),
    /Unsupported agent personal-list argument/
  );
});

// ─── Agent Template List Tests ────────────────────────────────────────────────────────

test("parseAgentTemplateListArgs parses defaults", () => {
  const opts = parseAgentTemplateListArgs([]);
  assert.equal(opts.category_id, "");
  assert.equal(opts.name, "");
  assert.equal(opts.pagination_marker_str, "");
  assert.equal(opts.size, 48);
  assert.equal(opts.businessDomain, "bd_public");
  assert.equal(opts.pretty, true);
  assert.equal(opts.verbose, false);
});

test("parseAgentTemplateListArgs parses --category-id and --name", () => {
  const opts = parseAgentTemplateListArgs(["--category-id", "cat123", "--name", "template"]);
  assert.equal(opts.category_id, "cat123");
  assert.equal(opts.name, "template");
});

test("parseAgentTemplateListArgs parses --size and -bd", () => {
  const opts = parseAgentTemplateListArgs(["--size", "100", "-bd", "bd_custom"]);
  assert.equal(opts.size, 100);
  assert.equal(opts.businessDomain, "bd_custom");
});

test("parseAgentTemplateListArgs parses --pagination-marker", () => {
  const opts = parseAgentTemplateListArgs(["--pagination-marker", "page2"]);
  assert.equal(opts.pagination_marker_str, "page2");
});

test("parseAgentTemplateListArgs parses --verbose", () => {
  const opts = parseAgentTemplateListArgs(["--verbose"]);
  assert.equal(opts.verbose, true);
});

test("parseAgentTemplateListArgs throws on unknown flag", () => {
  assert.throws(
    () => parseAgentTemplateListArgs(["--unknown"]),
    /Unsupported agent template-list argument/
  );
});

// ─── Agent Template Get Tests ──────────────────────────────────────────────────────────

test("parseAgentTemplateGetArgs requires template_id", () => {
  assert.throws(
    () => parseAgentTemplateGetArgs([]),
    /Missing template_id/
  );
});

test("parseAgentTemplateGetArgs parses template_id", () => {
  const opts = parseAgentTemplateGetArgs(["tpl-123"]);
  assert.equal(opts.templateId, "tpl-123");
  assert.equal(opts.businessDomain, "bd_public");
  assert.equal(opts.pretty, true);
  assert.equal(opts.verbose, false);
  assert.equal(opts.saveConfig, null);
});

test("parseAgentTemplateGetArgs parses -bd and --verbose", () => {
  const opts = parseAgentTemplateGetArgs(["tpl-456", "-bd", "bd_enterprise", "--verbose"]);
  assert.equal(opts.templateId, "tpl-456");
  assert.equal(opts.businessDomain, "bd_enterprise");
  assert.equal(opts.verbose, true);
});

test("parseAgentTemplateGetArgs parses --save-config", () => {
  const opts = parseAgentTemplateGetArgs(["tpl-789", "--save-config", "/tmp/config.json"]);
  assert.equal(opts.templateId, "tpl-789");
  assert.equal(opts.saveConfig, "/tmp/config.json");
});

test("parseAgentTemplateGetArgs throws on unknown flag", () => {
  assert.throws(
    () => parseAgentTemplateGetArgs(["tpl-123", "--unknown"]),
    /Unsupported agent template-get argument/
  );
});

test("parseKnBuildArgs parses kn-id with defaults", () => {
  const opts = parseKnBuildArgs(["kn-123"]);
  assert.equal(opts.knId, "kn-123");
  assert.equal(opts.wait, true);
  assert.equal(opts.timeout, 300);
  assert.equal(opts.businessDomain, "bd_public");
});

test("parseKnBuildArgs parses --no-wait and --timeout", () => {
  const opts = parseKnBuildArgs(["kn-456", "--no-wait", "--timeout", "60", "-bd", "bd_enterprise"]);
  assert.equal(opts.knId, "kn-456");
  assert.equal(opts.wait, false);
  assert.equal(opts.timeout, 60);
  assert.equal(opts.businessDomain, "bd_enterprise");
});

test("parseKnBuildArgs requires kn-id", () => {
  assert.throws(() => parseKnBuildArgs([]), /Missing kn-id/);
});

test("parseDsListArgs parses flags with defaults", () => {
  const opts = parseDsListArgs([]);
  assert.equal(opts.keyword, undefined);
  assert.equal(opts.type, undefined);
  assert.equal(opts.businessDomain, "bd_public");
  assert.equal(opts.pretty, true);
});

test("parseDsListArgs parses --keyword --type -bd", () => {
  const opts = parseDsListArgs(["--keyword", "mysql", "--type", "mysql", "-bd", "bd_enterprise"]);
  assert.equal(opts.keyword, "mysql");
  assert.equal(opts.type, "mysql");
  assert.equal(opts.businessDomain, "bd_enterprise");
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

// ── parseImportCsvArgs ────────────────────────────────────────────────────────

test("parseImportCsvArgs parses ds-id and --files with defaults", () => {
  const opts = parseImportCsvArgs(["ds-123", "--files", "data/*.csv"]);
  assert.equal(opts.datasourceId, "ds-123");
  assert.equal(opts.files, "data/*.csv");
  assert.equal(opts.tablePrefix, "");
  assert.equal(opts.batchSize, 500);
  assert.equal(opts.businessDomain, "bd_public");
});

test("parseImportCsvArgs parses -bd and --table-prefix", () => {
  const opts = parseImportCsvArgs([
    "ds-456", "--files", "x.csv", "--table-prefix", "pfx_",
    "-bd", "bd_enterprise", "--batch-size", "100",
  ]);
  assert.equal(opts.datasourceId, "ds-456");
  assert.equal(opts.files, "x.csv");
  assert.equal(opts.tablePrefix, "pfx_");
  assert.equal(opts.batchSize, 100);
  assert.equal(opts.businessDomain, "bd_enterprise");
});

test("parseImportCsvArgs rejects invalid batch-size", () => {
  assert.throws(
    () => parseImportCsvArgs(["ds-1", "--files", "x.csv", "--batch-size", "0"]),
    /--batch-size must be between 1 and 10000/
  );
  assert.throws(
    () => parseImportCsvArgs(["ds-1", "--files", "x.csv", "--batch-size", "99999"]),
    /--batch-size must be between 1 and 10000/
  );
});

test("parseImportCsvArgs --help throws help error", () => {
  assert.throws(
    () => parseImportCsvArgs(["--help"]),
    /help/
  );
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

test("ensureValidToken strips Bearer prefix from KWEAVER_TOKEN env var", async () => {
  process.env.KWEAVER_TOKEN = "Bearer my-raw-token";
  process.env.KWEAVER_BASE_URL = "https://env.example.com/";
  try {
    const result = await ensureValidToken();
    assert.equal(result.accessToken, "my-raw-token");
  } finally {
    delete process.env.KWEAVER_TOKEN;
    delete process.env.KWEAVER_BASE_URL;
  }
});

// ---------------------------------------------------------------------------
// Vega CLI command tests
// ---------------------------------------------------------------------------

test("run vega shows subcommand help", async () => {
  assert.equal(await run(["vega"]), 0);
});

test("run vega --help shows all subcommands", async () => {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  try {
    assert.equal(await run(["vega", "--help"]), 0);
    const help = lines.join("\n");
    assert.ok(help.includes("catalog list"));
    assert.ok(help.includes("catalog create"));
    assert.ok(help.includes("catalog update"));
    assert.ok(help.includes("catalog delete"));
    assert.ok(help.includes("resource list"));
    assert.ok(help.includes("resource create"));
    assert.ok(help.includes("resource update"));
    assert.ok(help.includes("resource delete"));
    assert.ok(help.includes("connector-type list"));
    assert.ok(help.includes("connector-type register"));
    assert.ok(help.includes("connector-type update"));
    assert.ok(help.includes("connector-type delete"));
    assert.ok(help.includes("connector-type enable"));
    assert.ok(help.includes("discovery-task list"));
    assert.ok(help.includes("discovery-task get"));
  } finally {
    console.log = originalLog;
  }
});

// -- catalog subcommands --

test("run vega catalog --help shows CRUD subcommands", async () => {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  try {
    assert.equal(await run(["vega", "catalog", "--help"]), 0);
    const help = lines.join("\n");
    assert.ok(help.includes("create"));
    assert.ok(help.includes("update"));
    assert.ok(help.includes("delete"));
    assert.ok(help.includes("list"));
    assert.ok(help.includes("get"));
    assert.ok(help.includes("health"));
    assert.ok(help.includes("test-connection"));
    assert.ok(help.includes("discover"));
    assert.ok(help.includes("resources"));
  } finally {
    console.log = originalLog;
  }
});

test("run vega catalog create --help shows options", async () => {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  try {
    assert.equal(await run(["vega", "catalog", "create", "--help"]), 0);
    const help = lines.join("\n");
    assert.ok(help.includes("--name"));
    assert.ok(help.includes("--connector-type"));
    assert.ok(help.includes("--connector-config"));
    assert.ok(help.includes("--tags"));
    assert.ok(help.includes("--description"));
  } finally {
    console.log = originalLog;
  }
});

test("run vega catalog create without required args exits 1", async () => {
  const errors: string[] = [];
  const originalErr = console.error;
  console.error = (...args: unknown[]) => { errors.push(args.map(String).join(" ")); };
  try {
    assert.equal(await run(["vega", "catalog", "create"]), 1);
    assert.ok(errors.join("\n").includes("Usage:"));
  } finally {
    console.error = originalErr;
  }
});

test("run vega catalog update --help shows options", async () => {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  try {
    assert.equal(await run(["vega", "catalog", "update", "--help"]), 0);
    const help = lines.join("\n");
    assert.ok(help.includes("--name"));
    assert.ok(help.includes("--connector-type"));
    assert.ok(help.includes("--tags"));
    assert.ok(help.includes("--description"));
    assert.ok(help.includes("--connector-config"));
  } finally {
    console.log = originalLog;
  }
});

test("run vega catalog update without id exits 1", async () => {
  const errors: string[] = [];
  const originalErr = console.error;
  console.error = (...args: unknown[]) => { errors.push(args.map(String).join(" ")); };
  try {
    assert.equal(await run(["vega", "catalog", "update"]), 1);
    assert.ok(errors.join("\n").includes("Usage:"));
  } finally {
    console.error = originalErr;
  }
});

test("run vega catalog delete --help shows options", async () => {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  try {
    assert.equal(await run(["vega", "catalog", "delete", "--help"]), 0);
    const help = lines.join("\n");
    assert.ok(help.includes("-y"));
  } finally {
    console.log = originalLog;
  }
});

test("run vega catalog delete without ids exits 1", async () => {
  const errors: string[] = [];
  const originalErr = console.error;
  console.error = (...args: unknown[]) => { errors.push(args.map(String).join(" ")); };
  try {
    assert.equal(await run(["vega", "catalog", "delete"]), 1);
    assert.ok(errors.join("\n").includes("Usage:"));
  } finally {
    console.error = originalErr;
  }
});

// -- resource subcommands --

test("run vega resource --help shows CRUD subcommands", async () => {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  try {
    assert.equal(await run(["vega", "resource", "--help"]), 0);
    const help = lines.join("\n");
    assert.ok(help.includes("create"));
    assert.ok(help.includes("update"));
    assert.ok(help.includes("delete"));
    assert.ok(help.includes("list"));
    assert.ok(help.includes("get"));
    assert.ok(help.includes("query"));
  } finally {
    console.log = originalLog;
  }
});

test("run vega resource create --help shows options", async () => {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  try {
    assert.equal(await run(["vega", "resource", "create", "--help"]), 0);
    const help = lines.join("\n");
    assert.ok(help.includes("--catalog-id"));
    assert.ok(help.includes("--name"));
    assert.ok(help.includes("--category"));
    assert.ok(help.includes("--source-identifier"));
    assert.ok(help.includes("--database"));
    assert.ok(help.includes("-d"));
  } finally {
    console.log = originalLog;
  }
});

test("run vega resource create without required args exits 1", async () => {
  const errors: string[] = [];
  const originalErr = console.error;
  console.error = (...args: unknown[]) => { errors.push(args.map(String).join(" ")); };
  try {
    assert.equal(await run(["vega", "resource", "create"]), 1);
    assert.ok(errors.join("\n").includes("Usage:"));
  } finally {
    console.error = originalErr;
  }
});

test("run vega resource update --help shows options", async () => {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  try {
    assert.equal(await run(["vega", "resource", "update", "--help"]), 0);
    const help = lines.join("\n");
    assert.ok(help.includes("--name"));
    assert.ok(help.includes("--status"));
    assert.ok(help.includes("--tags"));
    assert.ok(help.includes("-d"));
  } finally {
    console.log = originalLog;
  }
});

test("run vega resource update without id exits 1", async () => {
  const errors: string[] = [];
  const originalErr = console.error;
  console.error = (...args: unknown[]) => { errors.push(args.map(String).join(" ")); };
  try {
    assert.equal(await run(["vega", "resource", "update"]), 1);
    assert.ok(errors.join("\n").includes("Usage:"));
  } finally {
    console.error = originalErr;
  }
});

test("run vega resource delete --help shows options", async () => {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  try {
    assert.equal(await run(["vega", "resource", "delete", "--help"]), 0);
    const help = lines.join("\n");
    assert.ok(help.includes("-y"));
  } finally {
    console.log = originalLog;
  }
});

test("run vega resource delete without ids exits 1", async () => {
  const errors: string[] = [];
  const originalErr = console.error;
  console.error = (...args: unknown[]) => { errors.push(args.map(String).join(" ")); };
  try {
    assert.equal(await run(["vega", "resource", "delete"]), 1);
    assert.ok(errors.join("\n").includes("Usage:"));
  } finally {
    console.error = originalErr;
  }
});

// -- connector-type subcommands --

test("run vega connector-type --help shows CRUD subcommands", async () => {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  try {
    assert.equal(await run(["vega", "connector-type", "--help"]), 0);
    const help = lines.join("\n");
    assert.ok(help.includes("list"));
    assert.ok(help.includes("get"));
    assert.ok(help.includes("register"));
    assert.ok(help.includes("update"));
    assert.ok(help.includes("delete"));
    assert.ok(help.includes("enable"));
  } finally {
    console.log = originalLog;
  }
});

test("run vega connector-type register --help shows options", async () => {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  try {
    assert.equal(await run(["vega", "connector-type", "register", "--help"]), 0);
    const help = lines.join("\n");
    assert.ok(help.includes("-d"));
  } finally {
    console.log = originalLog;
  }
});

test("run vega connector-type register without data exits 1", async () => {
  const errors: string[] = [];
  const originalErr = console.error;
  console.error = (...args: unknown[]) => { errors.push(args.map(String).join(" ")); };
  try {
    assert.equal(await run(["vega", "connector-type", "register"]), 1);
    assert.ok(errors.join("\n").includes("Usage:"));
  } finally {
    console.error = originalErr;
  }
});

test("run vega connector-type update --help shows options", async () => {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  try {
    assert.equal(await run(["vega", "connector-type", "update", "--help"]), 0);
    const help = lines.join("\n");
    assert.ok(help.includes("-d"));
  } finally {
    console.log = originalLog;
  }
});

test("run vega connector-type update without args exits 1", async () => {
  const errors: string[] = [];
  const originalErr = console.error;
  console.error = (...args: unknown[]) => { errors.push(args.map(String).join(" ")); };
  try {
    assert.equal(await run(["vega", "connector-type", "update"]), 1);
    assert.ok(errors.join("\n").includes("Usage:"));
  } finally {
    console.error = originalErr;
  }
});

test("run vega connector-type delete --help shows options", async () => {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  try {
    assert.equal(await run(["vega", "connector-type", "delete", "--help"]), 0);
    const help = lines.join("\n");
    assert.ok(help.includes("-y"));
  } finally {
    console.log = originalLog;
  }
});

test("run vega connector-type delete without type exits 1", async () => {
  const errors: string[] = [];
  const originalErr = console.error;
  console.error = (...args: unknown[]) => { errors.push(args.map(String).join(" ")); };
  try {
    assert.equal(await run(["vega", "connector-type", "delete"]), 1);
    assert.ok(errors.join("\n").includes("Usage:"));
  } finally {
    console.error = originalErr;
  }
});

test("run vega connector-type enable --help shows usage", async () => {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  try {
    assert.equal(await run(["vega", "connector-type", "enable", "--help"]), 0);
    const help = lines.join("\n");
    assert.ok(help.includes("--enabled"));
  } finally {
    console.log = originalLog;
  }
});

test("run vega connector-type enable without args exits 1", async () => {
  const errors: string[] = [];
  const originalErr = console.error;
  console.error = (...args: unknown[]) => { errors.push(args.map(String).join(" ")); };
  try {
    assert.equal(await run(["vega", "connector-type", "enable"]), 1);
    assert.ok(errors.join("\n").includes("Usage:"));
  } finally {
    console.error = originalErr;
  }
});

// -- discovery-task subcommands --

test("run vega discovery-task --help shows subcommands", async () => {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  try {
    assert.equal(await run(["vega", "discovery-task", "--help"]), 0);
    const help = lines.join("\n");
    assert.ok(help.includes("list"));
    assert.ok(help.includes("get"));
  } finally {
    console.log = originalLog;
  }
});

test("run vega discovery-task list --help shows options", async () => {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  try {
    assert.equal(await run(["vega", "discovery-task", "list", "--help"]), 0);
    const help = lines.join("\n");
    assert.ok(help.includes("--status"));
    assert.ok(help.includes("--limit"));
  } finally {
    console.log = originalLog;
  }
});

test("run vega discovery-task get --help shows usage", async () => {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  try {
    assert.equal(await run(["vega", "discovery-task", "get", "--help"]), 0);
    const help = lines.join("\n");
    assert.ok(help.includes("discovery-task get"));
  } finally {
    console.log = originalLog;
  }
});

test("run vega discovery-task get without id exits 1", async () => {
  const errors: string[] = [];
  const originalErr = console.error;
  console.error = (...args: unknown[]) => { errors.push(args.map(String).join(" ")); };
  try {
    assert.equal(await run(["vega", "discovery-task", "get"]), 1);
    assert.ok(errors.join("\n").includes("Usage:"));
  } finally {
    console.error = originalErr;
  }
});

test("run vega unknown-subcommand exits 1", async () => {
  const errors: string[] = [];
  const originalErr = console.error;
  console.error = (...args: unknown[]) => { errors.push(args.map(String).join(" ")); };
  try {
    assert.equal(await run(["vega", "nonexistent"]), 1);
    assert.ok(errors.join("\n").includes("Unknown"));
  } finally {
    console.error = originalErr;
  }
});

test("parseConceptGroupArgs parses list args", () => {
  const opts = parseConceptGroupArgs(["list", "kn-1"]);
  assert.equal(opts.action, "list");
  assert.equal(opts.knId, "kn-1");
});

test("parseConceptGroupArgs parses create with body", () => {
  const opts = parseConceptGroupArgs(["create", "kn-1", '{"name":"g1"}']);
  assert.equal(opts.action, "create");
  assert.equal(opts.knId, "kn-1");
  assert.equal(opts.body, '{"name":"g1"}');
});

test("parseConceptGroupArgs parses delete with -y", () => {
  const opts = parseConceptGroupArgs(["delete", "kn-1", "cg-1", "-y"]);
  assert.equal(opts.action, "delete");
  assert.equal(opts.knId, "kn-1");
  assert.equal(opts.itemId, "cg-1");
  assert.equal(opts.yes, true);
});

test("parseConceptGroupArgs parses add-members", () => {
  const opts = parseConceptGroupArgs(["add-members", "kn-1", "cg-1", "ot-1,ot-2"]);
  assert.equal(opts.action, "add-members");
  assert.equal(opts.knId, "kn-1");
  assert.equal(opts.itemId, "cg-1");
  assert.equal(opts.extra, "ot-1,ot-2");
});

test("parseConceptGroupArgs parses remove-members with -y", () => {
  const opts = parseConceptGroupArgs(["remove-members", "kn-1", "cg-1", "ot-1", "-y"]);
  assert.equal(opts.action, "remove-members");
  assert.equal(opts.itemId, "cg-1");
  assert.equal(opts.extra, "ot-1");
  assert.equal(opts.yes, true);
});

test("parseConceptGroupArgs throws help on --help", () => {
  assert.throws(() => parseConceptGroupArgs(["--help"]), { message: "help" });
  assert.throws(() => parseConceptGroupArgs([]), { message: "help" });
});

test("parseActionScheduleArgs parses list", () => {
  const opts = parseActionScheduleArgs(["list", "kn-1"]);
  assert.equal(opts.action, "list");
  assert.equal(opts.knId, "kn-1");
});

test("parseActionScheduleArgs parses set-status", () => {
  const opts = parseActionScheduleArgs(["set-status", "kn-1", "s-1", "enabled"]);
  assert.equal(opts.action, "set-status");
  assert.equal(opts.knId, "kn-1");
  assert.equal(opts.itemId, "s-1");
  assert.equal(opts.extra, "enabled");
});

test("parseActionScheduleArgs parses delete with -y", () => {
  const opts = parseActionScheduleArgs(["delete", "kn-1", "s-1,s-2", "-y"]);
  assert.equal(opts.action, "delete");
  assert.equal(opts.itemId, "s-1,s-2");
  assert.equal(opts.yes, true);
});

test("parseActionScheduleArgs throws help on --help", () => {
  assert.throws(() => parseActionScheduleArgs(["--help"]), { message: "help" });
  assert.throws(() => parseActionScheduleArgs([]), { message: "help" });
});

test("parseJobArgs parses list", () => {
  const opts = parseJobArgs(["list", "kn-1"]);
  assert.equal(opts.action, "list");
  assert.equal(opts.knId, "kn-1");
});

test("parseJobArgs parses tasks", () => {
  const opts = parseJobArgs(["tasks", "kn-1", "j-1"]);
  assert.equal(opts.action, "tasks");
  assert.equal(opts.knId, "kn-1");
  assert.equal(opts.itemId, "j-1");
});

test("parseJobArgs parses delete with -y", () => {
  const opts = parseJobArgs(["delete", "kn-1", "j-1,j-2", "-y"]);
  assert.equal(opts.action, "delete");
  assert.equal(opts.itemId, "j-1,j-2");
  assert.equal(opts.yes, true);
});

test("parseJobArgs throws help on --help", () => {
  assert.throws(() => parseJobArgs(["--help"]), { message: "help" });
  assert.throws(() => parseJobArgs([]), { message: "help" });
});

// ── concept-group additional parse tests ────────────────────────────────────

test("parseConceptGroupArgs parses get", () => {
  const opts = parseConceptGroupArgs(["get", "kn-1", "cg-1"]);
  assert.equal(opts.action, "get");
  assert.equal(opts.knId, "kn-1");
  assert.equal(opts.itemId, "cg-1");
});

test("parseConceptGroupArgs parses update with body", () => {
  const opts = parseConceptGroupArgs(["update", "kn-1", "cg-1", '{"name":"g2"}']);
  assert.equal(opts.action, "update");
  assert.equal(opts.knId, "kn-1");
  assert.equal(opts.itemId, "cg-1");
  assert.equal(opts.extra, '{"name":"g2"}');
});

test("parseConceptGroupArgs parses -bd flag", () => {
  const opts = parseConceptGroupArgs(["list", "kn-1", "-bd", "bd_enterprise"]);
  assert.equal(opts.action, "list");
  assert.equal(opts.businessDomain, "bd_enterprise");
});

test("parseConceptGroupArgs throws on missing kn-id", () => {
  assert.throws(() => parseConceptGroupArgs(["list"]), /Missing kn-id/);
});

// ── action-schedule additional parse tests ──────────────────────────────────

test("parseActionScheduleArgs parses get", () => {
  const opts = parseActionScheduleArgs(["get", "kn-1", "s-1"]);
  assert.equal(opts.action, "get");
  assert.equal(opts.knId, "kn-1");
  assert.equal(opts.itemId, "s-1");
});

test("parseActionScheduleArgs parses create with body", () => {
  const opts = parseActionScheduleArgs(["create", "kn-1", '{"cron":"* * * * *"}']);
  assert.equal(opts.action, "create");
  assert.equal(opts.knId, "kn-1");
  assert.equal(opts.body, '{"cron":"* * * * *"}');
});

test("parseActionScheduleArgs parses update with body", () => {
  const opts = parseActionScheduleArgs(["update", "kn-1", "s-1", '{"cron":"0 * * * *"}']);
  assert.equal(opts.action, "update");
  assert.equal(opts.knId, "kn-1");
  assert.equal(opts.itemId, "s-1");
  assert.equal(opts.extra, '{"cron":"0 * * * *"}');
});

test("parseActionScheduleArgs parses -bd flag", () => {
  const opts = parseActionScheduleArgs(["list", "kn-1", "-bd", "bd_enterprise"]);
  assert.equal(opts.businessDomain, "bd_enterprise");
});

test("parseActionScheduleArgs throws on missing kn-id", () => {
  assert.throws(() => parseActionScheduleArgs(["list"]), /Missing kn-id/);
});

// ── job additional parse tests ──────────────────────────────────────────────

test("parseJobArgs parses get", () => {
  const opts = parseJobArgs(["get", "kn-1", "j-1"]);
  assert.equal(opts.action, "get");
  assert.equal(opts.knId, "kn-1");
  assert.equal(opts.itemId, "j-1");
});

test("parseJobArgs parses -bd flag", () => {
  const opts = parseJobArgs(["list", "kn-1", "-bd", "bd_enterprise"]);
  assert.equal(opts.businessDomain, "bd_enterprise");
});

test("parseJobArgs throws on missing kn-id", () => {
  assert.throws(() => parseJobArgs(["list"]), /Missing kn-id/);
});

// ── relation-type create parse tests ────────────────────────────────────────

test("parseRelationTypeCreateArgs parses all required flags", () => {
  const opts = parseRelationTypeCreateArgs([
    "kn-1", "--name", "knows", "--source", "ot-1", "--target", "ot-2",
  ]);
  assert.equal(opts.knId, "kn-1");
  const body = JSON.parse(opts.body);
  assert.equal(body.entries[0].name, "knows");
  assert.equal(body.entries[0].source_object_type_id, "ot-1");
  assert.equal(body.entries[0].target_object_type_id, "ot-2");
});

test("parseRelationTypeCreateArgs parses --mapping", () => {
  const opts = parseRelationTypeCreateArgs([
    "kn-1", "--name", "rt", "--source", "ot-1", "--target", "ot-2",
    "--mapping", "src_prop:tgt_prop",
  ]);
  const body = JSON.parse(opts.body);
  assert.equal(body.entries[0].mapping_rules[0].source_property.name, "src_prop");
  assert.equal(body.entries[0].mapping_rules[0].target_property.name, "tgt_prop");
});

test("parseRelationTypeCreateArgs throws on missing required flags", () => {
  assert.throws(
    () => parseRelationTypeCreateArgs(["kn-1", "--name", "rt"]),
    /Usage/
  );
});

// ── relation-type update parse tests ────────────────────────────────────────

test("parseRelationTypeUpdateArgs includes source/target/type/mapping_rules", () => {
  const opts = parseRelationTypeUpdateArgs([
    "kn-1", "rt-1", "--source", "ot-1", "--target", "ot-2",
    "--name", "new-name", "--type", "data_view",
    "--mapping", "material_name:material_name",
  ]);
  assert.equal(opts.knId, "kn-1");
  assert.equal(opts.rtId, "rt-1");
  const body = JSON.parse(opts.body);
  assert.equal(body.source_object_type_id, "ot-1");
  assert.equal(body.target_object_type_id, "ot-2");
  assert.equal(body.name, "new-name");
  assert.equal(body.type, "data_view");
  assert.equal(body.mapping_rules[0].source_property.name, "material_name");
  assert.equal(body.mapping_rules[0].target_property.name, "material_name");
});

test("parseRelationTypeUpdateArgs defaults type to direct, empty mapping_rules", () => {
  const opts = parseRelationTypeUpdateArgs([
    "kn-1", "rt-1", "--source", "ot-1", "--target", "ot-2",
  ]);
  const body = JSON.parse(opts.body);
  assert.equal(body.source_object_type_id, "ot-1");
  assert.equal(body.target_object_type_id, "ot-2");
  assert.equal(body.type, "direct");
  assert.deepEqual(body.mapping_rules, []);
  assert.equal(body.name, undefined);
});

test("parseRelationTypeUpdateArgs supports multiple --mapping flags", () => {
  const opts = parseRelationTypeUpdateArgs([
    "kn-1", "rt-1", "--source", "ot-1", "--target", "ot-2",
    "--mapping", "a:b", "--mapping", "c:d",
  ]);
  const body = JSON.parse(opts.body);
  assert.equal(body.mapping_rules.length, 2);
  assert.equal(body.mapping_rules[1].source_property.name, "c");
});

test("parseRelationTypeUpdateArgs throws on invalid mapping format", () => {
  assert.throws(
    () => parseRelationTypeUpdateArgs([
      "kn-1", "rt-1", "--source", "ot-1", "--target", "ot-2", "--mapping", "bad",
    ]),
    /Invalid mapping format/
  );
});

test("parseRelationTypeUpdateArgs throws on missing --source/--target", () => {
  assert.throws(
    () => parseRelationTypeUpdateArgs(["kn-1", "rt-1", "--name", "x"]),
    /--source and --target are required/
  );
});

test("parseRelationTypeUpdateArgs throws on missing kn-id or rt-id", () => {
  assert.throws(
    () => parseRelationTypeUpdateArgs(["kn-1"]),
    /Usage/
  );
});

test("parseRelationTypeUpdateArgs throws help on --help", () => {
  assert.throws(() => parseRelationTypeUpdateArgs(["--help"]), { message: "help" });
});

// ── relation-type delete parse tests ────────────────────────────────────────

test("parseRelationTypeDeleteArgs parses kn-id and rt-ids", () => {
  const opts = parseRelationTypeDeleteArgs(["kn-1", "rt-1,rt-2"]);
  assert.equal(opts.knId, "kn-1");
  assert.equal(opts.rtIds, "rt-1,rt-2");
  assert.equal(opts.yes, false);
});

test("parseRelationTypeDeleteArgs parses -y flag", () => {
  const opts = parseRelationTypeDeleteArgs(["kn-1", "rt-1", "-y"]);
  assert.equal(opts.yes, true);
});

test("parseRelationTypeDeleteArgs throws on missing args", () => {
  assert.throws(
    () => parseRelationTypeDeleteArgs(["kn-1"]),
    /Usage|Missing/
  );
});
