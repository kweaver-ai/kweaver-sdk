import { createInterface } from "node:readline";
import { ensureValidToken, formatHttpError, with401RefreshRetry } from "../auth/oauth.js";
import {
  vegaHealth,
  listVegaCatalogs,
  getVegaCatalog,
  createVegaCatalog,
  updateVegaCatalog,
  deleteVegaCatalogs,
  vegaCatalogHealthStatus,
  testVegaCatalogConnection,
  discoverVegaCatalog,
  listVegaCatalogResources,
  listVegaResources,
  getVegaResource,
  queryVegaResourceData,
  createVegaResource,
  updateVegaResource,
  deleteVegaResources,
  listVegaConnectorTypes,
  getVegaConnectorType,
  registerVegaConnectorType,
  updateVegaConnectorType,
  deleteVegaConnectorType,
  setVegaConnectorTypeEnabled,
  createVegaDatasetDocs,
  updateVegaDatasetDocs,
  deleteVegaDatasetDocs,
  deleteVegaDatasetDocsQuery,
  buildVegaDataset,
  getVegaDatasetBuildStatus,
  executeVegaQuery,
  vegaSQLQuery,
  listAllVegaResources,
} from "../api/vega.js";
import { formatCallOutput } from "./call.js";
import { resolveBusinessDomain } from "../config/store.js";
import { renderHelp } from "../help/format.js";

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

const VEGA_HELP = renderHelp({
  tagline: "Vega observability — catalogs, resources, datasets, queries, connector types",
  usage: "kweaver vega <subcommand> [<action>] [flags]",
  sections: [
    {
      title: "SERVICE",
      items: [
        { name: "health", desc: "Check Vega service health" },
        { name: "stats", desc: "Show catalog statistics" },
        { name: "inspect", desc: "Health + catalog summary + running tasks" },
      ],
    },
    {
      title: "RESOURCES",
      items: [
        { name: "catalog", desc: "list / get / health / test-connection / discover / resources / create / update / delete" },
        { name: "resource", desc: "list / get / query / create / update / delete / list-all" },
        { name: "dataset", desc: "create-docs / update-docs / delete-docs / delete-docs-query / build / build-status" },
        { name: "query", desc: "execute — structured query (tables, joins, filters)" },
        { name: "sql", desc: "Direct SQL / DSL; use {{<resource_id>}} in SQL (quoted)" },
        { name: "connector-type", desc: "list / get / register / update / delete / enable" },
      ],
    },
  ],
  flags: [
    { name: "-bd, --biz-domain <s>", desc: "Business domain (default: bd_public)" },
    { name: "--pretty", desc: "Pretty-print JSON (default)" },
  ],
  inheritedFlags: "--base-url, --token, --user, --help",
  examples: [
    "kweaver vega health",
    "kweaver vega catalog list --status active",
    "kweaver vega sql --resource-type elasticsearch --query 'SELECT * FROM {{r-123}} LIMIT 10'",
  ],
  learnMore: [
    "Use `kweaver help all` for full per-action signatures",
    "Use `kweaver vega <subcommand> --help` for action-level details (where supported)",
  ],
});

function printVegaHelp(): void {
  console.log(VEGA_HELP);
}

// ---------------------------------------------------------------------------
// Common flag parser
// ---------------------------------------------------------------------------

function parseCommonFlags(args: string[]): {
  remaining: string[];
  businessDomain: string;
  pretty: boolean;
} {
  let businessDomain = "";
  let pretty = true;
  const remaining: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if ((arg === "-bd" || arg === "--biz-domain") && args[i + 1]) {
      businessDomain = args[++i];
      continue;
    }
    if (arg === "--pretty") {
      pretty = true;
      continue;
    }
    remaining.push(arg);
  }

  if (!businessDomain) businessDomain = resolveBusinessDomain();
  return { remaining, businessDomain, pretty };
}

function confirmYes(prompt: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${prompt} [y/N] `, (answer) => {
      rl.close();
      const trimmed = answer.trim().toLowerCase();
      resolve(trimmed === "y" || trimmed === "yes");
    });
  });
}

// ---------------------------------------------------------------------------
// Main router
// ---------------------------------------------------------------------------

export async function runVegaCommand(args: string[]): Promise<number> {
  const [subcommand, ...rest] = args;

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    printVegaHelp();
    return 0;
  }

  const dispatch = (): Promise<number> => {
    if (subcommand === "health") return runVegaHealthCommand(rest);
    if (subcommand === "stats") return runVegaStatsCommand(rest);
    if (subcommand === "inspect") return runVegaInspectCommand(rest);
    if (subcommand === "catalog") return runVegaCatalogCommand(rest);
    if (subcommand === "resource") return runVegaResourceCommand(rest);
    if (subcommand === "dataset") return runVegaDatasetCommand(rest);
    if (subcommand === "query") return runVegaQueryCommand(rest);
    if (subcommand === "sql") return runVegaSql(rest);
    if (subcommand === "connector-type") return runVegaConnectorTypeCommand(rest);
    return Promise.resolve(-1);
  };

  try {
    return await with401RefreshRetry(async () => {
      const code = await dispatch();
      if (code === -1) {
        console.error(`Unknown vega subcommand: ${subcommand}`);
        return 1;
      }
      return code;
    });
  } catch (error) {
    console.error(formatHttpError(error));
    return 1;
  }
}

// ---------------------------------------------------------------------------
// Top-level: health
// ---------------------------------------------------------------------------

async function runVegaHealthCommand(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      renderHelp({
        tagline: "Check Vega service health.",
        usage: "kweaver vega health [flags]",
      }),
    );
    return 0;
  }

  const { businessDomain, pretty } = parseCommonFlags(args);
  const token = await ensureValidToken();
  const body = await vegaHealth({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    businessDomain,
  });
  console.log(formatCallOutput(body, pretty));
  return 0;
}

// ---------------------------------------------------------------------------
// Top-level: stats
// ---------------------------------------------------------------------------

async function runVegaStatsCommand(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      renderHelp({
        tagline: "Show catalog statistics.",
        usage: "kweaver vega stats [flags]",
      }),
    );
    return 0;
  }

  const { businessDomain, pretty } = parseCommonFlags(args);
  try {
    const token = await ensureValidToken();
    const body = await listVegaCatalogs({
      baseUrl: token.baseUrl,
      accessToken: token.accessToken,
      limit: 100,
      businessDomain,
    });

    const parsed = JSON.parse(body) as Record<string, unknown>;
    const entries = Array.isArray(parsed) ? parsed : (parsed.entries ?? parsed.data ?? parsed.items ?? parsed.catalogs ?? []);
    const count = Array.isArray(entries) ? entries.length : 0;

    const stats = { catalog_count: count };
    console.log(pretty ? JSON.stringify(stats, null, 2) : JSON.stringify(stats));
    return 0;
  } catch (error) {
    console.error(formatHttpError(error));
    return 1;
  }
}

// ---------------------------------------------------------------------------
// Top-level: inspect
// ---------------------------------------------------------------------------

async function runVegaInspectCommand(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      renderHelp({
        tagline: "Health + catalog summary.",
        usage: "kweaver vega inspect [flags]",
      }),
    );
    return 0;
  }

  const { businessDomain, pretty } = parseCommonFlags(args);
  const token = await ensureValidToken();
  const base = { baseUrl: token.baseUrl, accessToken: token.accessToken, businessDomain };

  const result: Record<string, unknown> = {};

  // Health — best-effort
  try {
    const healthBody = await vegaHealth(base);
    result.health = JSON.parse(healthBody);
  } catch (err) {
    console.error(`warn: health check failed: ${err instanceof Error ? err.message : String(err)}`);
    result.health = null;
  }

  // Catalogs — best-effort
  try {
    const catalogsBody = await listVegaCatalogs({ ...base, limit: 100 });
    const parsed = JSON.parse(catalogsBody) as Record<string, unknown>;
    const entries = Array.isArray(parsed) ? parsed : (parsed.entries ?? parsed.data ?? parsed.items ?? parsed.catalogs ?? []);
    result.catalog_count = Array.isArray(entries) ? entries.length : 0;
  } catch (err) {
    console.error(`warn: catalog list failed: ${err instanceof Error ? err.message : String(err)}`);
    result.catalog_count = null;
  }

  console.log(pretty ? JSON.stringify(result, null, 2) : JSON.stringify(result));
  return 0;
}

// ---------------------------------------------------------------------------
// Catalog router
// ---------------------------------------------------------------------------

async function runVegaCatalogCommand(args: string[]): Promise<number> {
  const [sub, ...rest] = args;

  if (!sub || sub === "--help" || sub === "-h") {
    console.log(
      renderHelp({
        tagline: "Manage Vega catalogs.",
        usage: "kweaver vega catalog <subcommand> [flags]",
        sections: [
          {
            title: "AVAILABLE COMMANDS",
            items: [
              { name: "list", desc: "List catalogs (filter by status, paginate)" },
              { name: "get", desc: "Get catalog by id" },
              { name: "health", desc: "Health-check one or more catalogs (or --all)" },
              { name: "test-connection", desc: "Test catalog connectivity" },
              { name: "discover", desc: "Trigger discovery for a catalog" },
              { name: "resources", desc: "List resources within a catalog" },
              { name: "create", desc: "Create a catalog (name + connector-type + config)" },
              { name: "update", desc: "Update catalog fields" },
              { name: "delete", desc: "Delete one or more catalogs (-y to skip confirm)" },
            ],
          },
        ],
      }),
    );
    return 0;
  }

  if (sub === "list") return await runCatalogList(rest);
  if (sub === "get") return await runCatalogGet(rest);
  if (sub === "health") return await runCatalogHealth(rest);
  if (sub === "test-connection") return await runCatalogTestConnection(rest);
  if (sub === "discover") return await runCatalogDiscover(rest);
  if (sub === "resources") return await runCatalogResources(rest);
  if (sub === "create") return await runCatalogCreate(rest);
  if (sub === "update") return await runCatalogUpdate(rest);
  if (sub === "delete") return await runCatalogDelete(rest);

  console.error(`Unknown catalog subcommand: ${sub}`);
  return 1;
}

// ---------------------------------------------------------------------------
// catalog list
// ---------------------------------------------------------------------------

async function runCatalogList(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      renderHelp({
        tagline: "List Vega catalogs.",
        usage: "kweaver vega catalog list [flags]",
        flags: [
          { name: "--status <s>", desc: "Filter by status" },
          { name: "--limit <n>", desc: "Max results (default: 30)" },
          { name: "--offset <n>", desc: "Offset" },
          { name: "-bd, --biz-domain", desc: "Business domain (default: bd_public)" },
          { name: "--pretty", desc: "Pretty-print JSON (default)" },
        ],
      }),
    );
    return 0;
  }

  let status: string | undefined;
  let limit = 30;
  let offset: number | undefined;
  const { remaining, businessDomain, pretty } = parseCommonFlags(args);

  for (let i = 0; i < remaining.length; i += 1) {
    const arg = remaining[i];
    if (arg === "--status" && remaining[i + 1]) {
      status = remaining[++i];
      continue;
    }
    if (arg === "--limit" && remaining[i + 1]) {
      limit = parseInt(remaining[++i], 10);
      continue;
    }
    if (arg === "--offset" && remaining[i + 1]) {
      offset = parseInt(remaining[++i], 10);
      continue;
    }
  }

  const token = await ensureValidToken();
  const body = await listVegaCatalogs({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    status,
    limit,
    offset,
    businessDomain,
  });
  console.log(formatCallOutput(body, pretty));
  return 0;
}

// ---------------------------------------------------------------------------
// catalog get
// ---------------------------------------------------------------------------

async function runCatalogGet(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      renderHelp({
        tagline: "Get a Vega catalog by ID.",
        usage: "kweaver vega catalog get <id> [flags]",
      }),
    );
    return 0;
  }

  const { remaining, businessDomain, pretty } = parseCommonFlags(args);
  const id = remaining.find((a) => !a.startsWith("-"));
  if (!id) {
    console.error("Usage: kweaver vega catalog get <id>");
    return 1;
  }

  const token = await ensureValidToken();
  const body = await getVegaCatalog({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    id,
    businessDomain,
  });
  console.log(formatCallOutput(body, pretty));
  return 0;
}

// ---------------------------------------------------------------------------
// catalog health
// ---------------------------------------------------------------------------

async function runCatalogHealth(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      renderHelp({
        tagline: "Check health of one or more Vega catalogs.",
        usage: "kweaver vega catalog health <ids...> | --all",
        flags: [
          { name: "--all", desc: "Check health of all catalogs" },
        ],
        inheritedFlags: "--base-url, --token, --user, --help",
        examples: [
          "kweaver vega catalog health c-123 c-456",
          "kweaver vega catalog health --all",
        ],
      }),
    );
    return 0;
  }

  const { remaining, businessDomain, pretty } = parseCommonFlags(args);
  const useAll = remaining.includes("--all");
  const positionalIds = remaining.filter((a) => !a.startsWith("-"));

  const token = await ensureValidToken();
  const base = { baseUrl: token.baseUrl, accessToken: token.accessToken, businessDomain };

  let ids: string;
  if (useAll) {
    const catalogsBody = await listVegaCatalogs({ ...base, limit: 100 });
    const parsed = JSON.parse(catalogsBody) as Record<string, unknown>;
    const entries = Array.isArray(parsed) ? parsed : (parsed.entries ?? parsed.data ?? parsed.items ?? parsed.catalogs ?? []);
    if (!Array.isArray(entries) || entries.length === 0) {
      console.error("No catalogs found.");
      return 1;
    }
    ids = (entries as Array<Record<string, unknown>>)
      .map((e) => String(e.id ?? e.catalog_id ?? ""))
      .filter(Boolean)
      .join(",");
  } else if (positionalIds.length > 0) {
    ids = positionalIds.join(",");
  } else {
    console.error("Usage: kweaver vega catalog health <ids...> | --all");
    return 1;
  }

  const body = await vegaCatalogHealthStatus({ ...base, ids });
  console.log(formatCallOutput(body, pretty));
  return 0;
}

// ---------------------------------------------------------------------------
// catalog test-connection
// ---------------------------------------------------------------------------

async function runCatalogTestConnection(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      renderHelp({
        tagline: "Test catalog connector connectivity.",
        usage: "kweaver vega catalog test-connection <id>",
        inheritedFlags: "--base-url, --token, --user, --help",
        examples: ["kweaver vega catalog test-connection c-123"],
      }),
    );
    return 0;
  }

  const { remaining, businessDomain, pretty } = parseCommonFlags(args);
  const id = remaining.find((a) => !a.startsWith("-"));
  if (!id) {
    console.error("Usage: kweaver vega catalog test-connection <id>");
    return 1;
  }

  const token = await ensureValidToken();
  const body = await testVegaCatalogConnection({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    id,
    businessDomain,
  });
  console.log(formatCallOutput(body, pretty));
  return 0;
}

// ---------------------------------------------------------------------------
// catalog discover
// ---------------------------------------------------------------------------

async function runCatalogDiscover(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      renderHelp({
        tagline: "Trigger catalog resource discovery.",
        usage: "kweaver vega catalog discover <id> [--wait]",
        flags: [
          { name: "--wait", desc: "Wait for discovery to complete" },
        ],
        inheritedFlags: "--base-url, --token, --user, --help",
        examples: [
          "kweaver vega catalog discover c-123",
          "kweaver vega catalog discover c-123 --wait",
        ],
      }),
    );
    return 0;
  }

  const { remaining, businessDomain, pretty } = parseCommonFlags(args);
  const wait = remaining.includes("--wait");
  const id = remaining.find((a) => !a.startsWith("-"));
  if (!id) {
    console.error("Usage: kweaver vega catalog discover <id> [--wait]");
    return 1;
  }

  const token = await ensureValidToken();
  const body = await discoverVegaCatalog({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    id,
    wait: wait ? true : undefined,
    businessDomain,
  });
  console.log(formatCallOutput(body, pretty));
  return 0;
}

// ---------------------------------------------------------------------------
// catalog resources
// ---------------------------------------------------------------------------

async function runCatalogResources(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      renderHelp({
        tagline: "List resources for a catalog.",
        usage: "kweaver vega catalog resources <id> [flags]",
        flags: [
          { name: "--category <s>", desc: "Filter by category" },
          { name: "--limit <n>", desc: "Max results (default: 30)" },
        ],
        inheritedFlags: "--base-url, --token, --user, --help",
        examples: [
          "kweaver vega catalog resources c-123",
          "kweaver vega catalog resources c-123 --category table --limit 50",
        ],
      }),
    );
    return 0;
  }

  let category: string | undefined;
  let limit = 30;
  const { remaining, businessDomain, pretty } = parseCommonFlags(args);

  const positionals: string[] = [];
  for (let i = 0; i < remaining.length; i += 1) {
    const arg = remaining[i];
    if (arg === "--category" && remaining[i + 1]) {
      category = remaining[++i];
      continue;
    }
    if (arg === "--limit" && remaining[i + 1]) {
      limit = parseInt(remaining[++i], 10);
      continue;
    }
    if (!arg.startsWith("-")) {
      positionals.push(arg);
    }
  }

  const id = positionals[0];
  if (!id) {
    console.error("Usage: kweaver vega catalog resources <id> [--category X] [--limit N]");
    return 1;
  }

  const token = await ensureValidToken();
  const body = await listVegaCatalogResources({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    id,
    category,
    limit,
    businessDomain,
  });
  console.log(formatCallOutput(body, pretty));
  return 0;
}

// ---------------------------------------------------------------------------
// catalog create
// ---------------------------------------------------------------------------

async function runCatalogCreate(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      renderHelp({
        tagline: "Create a Vega catalog.",
        usage: "kweaver vega catalog create [flags]",
        flags: [
          { name: "--name <s>", desc: "Catalog name (required)" },
          { name: "--connector-type <s>", desc: "Connector type (required)" },
          { name: "--connector-config <j>", desc: "Connector config JSON (required)" },
          { name: "--tags <t1,t2>", desc: "Comma-separated tags" },
          { name: "--description <s>", desc: "Description" },
        ],
        inheritedFlags: "--base-url, --token, --user, --help",
        examples: [
          "kweaver vega catalog create --name my-cat --connector-type mysql --connector-config '{\"host\":\"...\"}'",
        ],
      }),
    );
    return 0;
  }

  let name: string | undefined;
  let connectorType: string | undefined;
  let connectorConfig: string | undefined;
  let tags: string | undefined;
  let description: string | undefined;
  const { remaining, businessDomain, pretty } = parseCommonFlags(args);

  for (let i = 0; i < remaining.length; i += 1) {
    const arg = remaining[i];
    if (arg === "--name" && remaining[i + 1]) {
      name = remaining[++i];
      continue;
    }
    if (arg === "--connector-type" && remaining[i + 1]) {
      connectorType = remaining[++i];
      continue;
    }
    if (arg === "--connector-config" && remaining[i + 1]) {
      connectorConfig = remaining[++i];
      continue;
    }
    if (arg === "--tags" && remaining[i + 1]) {
      tags = remaining[++i];
      continue;
    }
    if (arg === "--description" && remaining[i + 1]) {
      description = remaining[++i];
      continue;
    }
  }

  if (!name || !connectorType || !connectorConfig) {
    console.error("Usage: kweaver vega catalog create --name <name> --connector-type <type> --connector-config <json>");
    return 1;
  }

  const payload: Record<string, unknown> = {
    name,
    connector_type: connectorType,
    connector_config: JSON.parse(connectorConfig),
  };
  if (tags) payload.tags = tags.split(",");
  if (description) payload.description = description;

  const token = await ensureValidToken();
  const body = await createVegaCatalog({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    body: JSON.stringify(payload),
    businessDomain,
  });
  console.log(formatCallOutput(body, pretty));
  return 0;
}

// ---------------------------------------------------------------------------
// catalog update
// ---------------------------------------------------------------------------

async function runCatalogUpdate(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      renderHelp({
        tagline: "Update a Vega catalog.",
        usage: "kweaver vega catalog update <id> [flags]",
        flags: [
          { name: "--name <s>", desc: "New name" },
          { name: "--connector-type <t>", desc: "Connector type (e.g. mysql, opensearch)" },
          { name: "--tags <t1,t2>", desc: "Comma-separated tags" },
          { name: "--description <s>", desc: "Description" },
          { name: "--connector-config <j>", desc: "Connector config JSON" },
        ],
        inheritedFlags: "--base-url, --token, --user, --help",
        examples: [
          "kweaver vega catalog update c-123 --name new-name",
          "kweaver vega catalog update c-123 --tags prod,critical",
        ],
      }),
    );
    return 0;
  }

  let name: string | undefined;
  let connectorType: string | undefined;
  let tags: string | undefined;
  let description: string | undefined;
  let connectorConfig: string | undefined;
  const { remaining, businessDomain, pretty } = parseCommonFlags(args);

  const positionals: string[] = [];
  for (let i = 0; i < remaining.length; i += 1) {
    const arg = remaining[i];
    if (arg === "--name" && remaining[i + 1]) {
      name = remaining[++i];
      continue;
    }
    if (arg === "--connector-type" && remaining[i + 1]) {
      connectorType = remaining[++i];
      continue;
    }
    if (arg === "--tags" && remaining[i + 1]) {
      tags = remaining[++i];
      continue;
    }
    if (arg === "--description" && remaining[i + 1]) {
      description = remaining[++i];
      continue;
    }
    if (arg === "--connector-config" && remaining[i + 1]) {
      connectorConfig = remaining[++i];
      continue;
    }
    if (!arg.startsWith("-")) {
      positionals.push(arg);
    }
  }

  const id = positionals[0];
  if (!id) {
    console.error("Usage: kweaver vega catalog update <id> [--name X] [--connector-type X] [--tags X] [--description X] [--connector-config X]");
    return 1;
  }

  const payload: Record<string, unknown> = {};
  if (name) payload.name = name;
  if (connectorType) payload.connector_type = connectorType;
  if (tags) payload.tags = tags.split(",");
  if (description) payload.description = description;
  if (connectorConfig) payload.connector_config = JSON.parse(connectorConfig);

  const token = await ensureValidToken();
  const body = await updateVegaCatalog({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    id,
    body: JSON.stringify(payload),
    businessDomain,
  });
  console.log(formatCallOutput(body || "{}", pretty));
  return 0;
}

// ---------------------------------------------------------------------------
// catalog delete
// ---------------------------------------------------------------------------

async function runCatalogDelete(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      renderHelp({
        tagline: "Delete one or more Vega catalogs.",
        usage: "kweaver vega catalog delete <ids...> [-y]",
        flags: [
          { name: "-y, --yes", desc: "Skip confirmation" },
        ],
        inheritedFlags: "--base-url, --token, --user, --help",
        examples: [
          "kweaver vega catalog delete c-123",
          "kweaver vega catalog delete c-123 c-456 -y",
        ],
      }),
    );
    return 0;
  }

  let skipConfirm = false;
  const { remaining, businessDomain } = parseCommonFlags(args);

  const positionals: string[] = [];
  for (let i = 0; i < remaining.length; i += 1) {
    const arg = remaining[i];
    if (arg === "-y" || arg === "--yes") {
      skipConfirm = true;
      continue;
    }
    if (!arg.startsWith("-")) {
      positionals.push(arg);
    }
  }

  if (positionals.length === 0) {
    console.error("Usage: kweaver vega catalog delete <ids...> [-y]");
    return 1;
  }

  const ids = positionals.join(",");

  if (!skipConfirm) {
    const ok = await confirmYes(`Delete catalog(s) ${ids}?`);
    if (!ok) { console.error("Aborted."); return 1; }
  }

  const token = await ensureValidToken();
  await deleteVegaCatalogs({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    ids,
    businessDomain,
  });
  console.error(`Deleted ${ids}`);
  return 0;
}

// ---------------------------------------------------------------------------
// Resource router
// ---------------------------------------------------------------------------

async function runVegaResourceCommand(args: string[]): Promise<number> {
  const [sub, ...rest] = args;

  if (!sub || sub === "--help" || sub === "-h") {
    console.log(
      renderHelp({
        tagline: "Manage Vega resources.",
        usage: "kweaver vega resource <subcommand> [flags]",
        sections: [
          {
            title: "AVAILABLE COMMANDS",
            items: [
              { name: "list", desc: "List resources (filter by catalog / category / status)" },
              { name: "list-all", desc: "List all resources across catalogs" },
              { name: "get", desc: "Get resource by id" },
              { name: "query", desc: "Query resource data (JSON body)" },
              { name: "create", desc: "Create a resource (--catalog-id --name --category)" },
              { name: "update", desc: "Update resource fields" },
              { name: "delete", desc: "Delete one or more resources (-y to skip confirm)" },
            ],
          },
        ],
        inheritedFlags: "--base-url, --token, --user, --help",
      }),
    );
    return 0;
  }

  if (sub === "list") return await runResourceList(rest);
  if (sub === "list-all") return await runResourceListAll(rest);
  if (sub === "get") return await runResourceGet(rest);
  if (sub === "query") return await runResourceQuery(rest);
  if (sub === "create") return await runResourceCreate(rest);
  if (sub === "update") return await runResourceUpdate(rest);
  if (sub === "delete") return await runResourceDelete(rest);

  console.error(`Unknown resource subcommand: ${sub}`);
  return 1;
}

// ---------------------------------------------------------------------------
// resource list
// ---------------------------------------------------------------------------

async function runResourceList(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      renderHelp({
        tagline: "List Vega resources.",
        usage: "kweaver vega resource list [flags]",
        flags: [
          { name: "--catalog-id <s>", desc: "Filter by catalog" },
          { name: "--category <s>", desc: "Filter by category" },
          { name: "--status <s>", desc: "Filter by status" },
          { name: "--limit <n>", desc: "Max results (default: 30)" },
          { name: "--offset <n>", desc: "Offset" },
          { name: "-bd, --biz-domain", desc: "Business domain (default: bd_public)" },
          { name: "--pretty", desc: "Pretty-print JSON (default)" },
        ],
        inheritedFlags: "--base-url, --token, --user, --help",
      }),
    );
    return 0;
  }

  let catalogId: string | undefined;
  let category: string | undefined;
  let status: string | undefined;
  let limit = 30;
  let offset: number | undefined;
  const { remaining, businessDomain, pretty } = parseCommonFlags(args);

  for (let i = 0; i < remaining.length; i += 1) {
    const arg = remaining[i];
    if (arg === "--catalog-id" && remaining[i + 1]) {
      catalogId = remaining[++i];
      continue;
    }
    if (arg === "--category" && remaining[i + 1]) {
      category = remaining[++i];
      continue;
    }
    if (arg === "--status" && remaining[i + 1]) {
      status = remaining[++i];
      continue;
    }
    if (arg === "--limit" && remaining[i + 1]) {
      limit = parseInt(remaining[++i], 10);
      continue;
    }
    if (arg === "--offset" && remaining[i + 1]) {
      offset = parseInt(remaining[++i], 10);
      continue;
    }
  }

  const token = await ensureValidToken();
  const body = await listVegaResources({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    catalogId,
    category,
    status,
    limit,
    offset,
    businessDomain,
  });
  console.log(formatCallOutput(body, pretty));
  return 0;
}

// ---------------------------------------------------------------------------
// resource list-all
// ---------------------------------------------------------------------------

async function runResourceListAll(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      renderHelp({
        tagline: "List all Vega resources.",
        usage: "kweaver vega resource list-all [flags]",
        flags: [
          { name: "--limit <n>", desc: "Max results (default: 30)" },
          { name: "--offset <n>", desc: "Offset" },
          { name: "-bd, --biz-domain", desc: "Business domain (default: bd_public)" },
          { name: "--pretty", desc: "Pretty-print JSON (default)" },
        ],
        inheritedFlags: "--base-url, --token, --user, --help",
      }),
    );
    return 0;
  }

  let limit = 30;
  let offset: number | undefined;
  const { remaining, businessDomain, pretty } = parseCommonFlags(args);

  for (let i = 0; i < remaining.length; i += 1) {
    const arg = remaining[i];
    if (arg === "--limit" && remaining[i + 1]) {
      limit = parseInt(remaining[++i], 10);
      continue;
    }
    if (arg === "--offset" && remaining[i + 1]) {
      offset = parseInt(remaining[++i], 10);
      continue;
    }
  }

  const token = await ensureValidToken();
  const body = await listAllVegaResources({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    limit,
    offset,
    businessDomain,
  });
  console.log(formatCallOutput(body, pretty));
  return 0;
}

// ---------------------------------------------------------------------------
// resource get
// ---------------------------------------------------------------------------

async function runResourceGet(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      renderHelp({
        tagline: "Get a Vega resource by id.",
        usage: "kweaver vega resource get <id> [flags]",
        inheritedFlags: "--base-url, --token, --user, --help",
      }),
    );
    return 0;
  }

  const { remaining, businessDomain, pretty } = parseCommonFlags(args);
  const id = remaining.find((a) => !a.startsWith("-"));
  if (!id) {
    console.error("Usage: kweaver vega resource get <id>");
    return 1;
  }

  const token = await ensureValidToken();
  const body = await getVegaResource({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    id,
    businessDomain,
  });
  console.log(formatCallOutput(body, pretty));
  return 0;
}

// ---------------------------------------------------------------------------
// resource query
// ---------------------------------------------------------------------------

async function runResourceQuery(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      renderHelp({
        tagline: "Query a Vega resource.",
        usage: "kweaver vega resource query <id> -d <json-body> [flags]",
        flags: [
          { name: "-d, --data <json>", desc: "Request body (JSON string)" },
        ],
        inheritedFlags: "--base-url, --token, --user, --help",
      }),
    );
    return 0;
  }

  let data: string | undefined;
  const { remaining, businessDomain, pretty } = parseCommonFlags(args);

  const positionals: string[] = [];
  for (let i = 0; i < remaining.length; i += 1) {
    const arg = remaining[i];
    if ((arg === "-d" || arg === "--data") && remaining[i + 1]) {
      data = remaining[++i];
      continue;
    }
    if (!arg.startsWith("-")) {
      positionals.push(arg);
    }
  }

  const id = positionals[0];
  if (!id || !data) {
    console.error("Usage: kweaver vega resource query <id> -d <json-body>");
    return 1;
  }

  const token = await ensureValidToken();
  const body = await queryVegaResourceData({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    id,
    body: data,
    businessDomain,
  });
  console.log(formatCallOutput(body, pretty));
  return 0;
}

// ---------------------------------------------------------------------------
// resource create
// ---------------------------------------------------------------------------

async function runResourceCreate(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      renderHelp({
        tagline: "Create a Vega resource.",
        usage: "kweaver vega resource create [flags]",
        flags: [
          { name: "--catalog-id <cid>", desc: "Catalog ID (required)" },
          { name: "--name <name>", desc: "Resource name (required)" },
          { name: "--category <cat>", desc: "Category (required)" },
          { name: "--source-identifier <si>", desc: "Source identifier" },
          { name: "--database <db>", desc: "Database name" },
          { name: "-d, --data <json>", desc: "Additional fields as JSON" },
        ],
        inheritedFlags: "--base-url, --token, --user, --help",
      }),
    );
    return 0;
  }

  let catalogId: string | undefined;
  let name: string | undefined;
  let category: string | undefined;
  let sourceIdentifier: string | undefined;
  let database: string | undefined;
  let data: string | undefined;
  const { remaining, businessDomain, pretty } = parseCommonFlags(args);

  for (let i = 0; i < remaining.length; i += 1) {
    const arg = remaining[i];
    if (arg === "--catalog-id" && remaining[i + 1]) { catalogId = remaining[++i]; continue; }
    if (arg === "--name" && remaining[i + 1]) { name = remaining[++i]; continue; }
    if (arg === "--category" && remaining[i + 1]) { category = remaining[++i]; continue; }
    if (arg === "--source-identifier" && remaining[i + 1]) { sourceIdentifier = remaining[++i]; continue; }
    if (arg === "--database" && remaining[i + 1]) { database = remaining[++i]; continue; }
    if ((arg === "-d" || arg === "--data") && remaining[i + 1]) { data = remaining[++i]; continue; }
  }

  if (!catalogId || !name || !category) {
    console.error("Usage: kweaver vega resource create --catalog-id <cid> --name <name> --category <cat>");
    return 1;
  }

  const payload: Record<string, unknown> = { catalog_id: catalogId, name, category };
  if (sourceIdentifier) payload.source_identifier = sourceIdentifier;
  if (database) payload.database = database;
  if (data) Object.assign(payload, JSON.parse(data));

  const token = await ensureValidToken();
  const body = await createVegaResource({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    body: JSON.stringify(payload),
    businessDomain,
  });
  console.log(formatCallOutput(body, pretty));
  return 0;
}

// ---------------------------------------------------------------------------
// resource update
// ---------------------------------------------------------------------------

async function runResourceUpdate(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      renderHelp({
        tagline: "Update a Vega resource.",
        usage: "kweaver vega resource update <id> [flags]",
        flags: [
          { name: "--name <name>", desc: "Resource name" },
          { name: "--status <s>", desc: "Status" },
          { name: "--tags <t1,t2>", desc: "Comma-separated tags" },
          { name: "-d, --data <json>", desc: "Additional fields as JSON" },
        ],
        inheritedFlags: "--base-url, --token, --user, --help",
      }),
    );
    return 0;
  }

  let name: string | undefined;
  let status: string | undefined;
  let tags: string | undefined;
  let data: string | undefined;
  const { remaining, businessDomain, pretty } = parseCommonFlags(args);

  const positionals: string[] = [];
  for (let i = 0; i < remaining.length; i += 1) {
    const arg = remaining[i];
    if (arg === "--name" && remaining[i + 1]) { name = remaining[++i]; continue; }
    if (arg === "--status" && remaining[i + 1]) { status = remaining[++i]; continue; }
    if (arg === "--tags" && remaining[i + 1]) { tags = remaining[++i]; continue; }
    if ((arg === "-d" || arg === "--data") && remaining[i + 1]) { data = remaining[++i]; continue; }
    if (!arg.startsWith("-")) positionals.push(arg);
  }

  const id = positionals[0];
  if (!id) {
    console.error("Usage: kweaver vega resource update <id> [--name X] [--status X] [--tags X] [-d json]");
    return 1;
  }

  const payload: Record<string, unknown> = {};
  if (name) payload.name = name;
  if (status) payload.status = status;
  if (tags) payload.tags = tags.split(",");
  if (data) Object.assign(payload, JSON.parse(data));

  const token = await ensureValidToken();
  const body = await updateVegaResource({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    id,
    body: JSON.stringify(payload),
    businessDomain,
  });
  console.log(formatCallOutput(body || "{}", pretty));
  return 0;
}

// ---------------------------------------------------------------------------
// resource delete
// ---------------------------------------------------------------------------

async function runResourceDelete(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      renderHelp({
        tagline: "Delete Vega resources.",
        usage: "kweaver vega resource delete <ids...> [flags]",
        flags: [
          { name: "-y, --yes", desc: "Skip confirmation prompt" },
        ],
        inheritedFlags: "--base-url, --token, --user, --help",
      }),
    );
    return 0;
  }

  let yes = false;
  const { remaining, businessDomain } = parseCommonFlags(args);
  const positionals: string[] = [];

  for (const arg of remaining) {
    if (arg === "-y" || arg === "--yes") { yes = true; continue; }
    if (!arg.startsWith("-")) positionals.push(arg);
  }

  if (positionals.length === 0) {
    console.error("Usage: kweaver vega resource delete <ids...> [-y]");
    return 1;
  }

  const ids = positionals.join(",");
  if (!yes) {
    const confirmed = await confirmYes(`Delete resource(s) ${ids}?`);
    if (!confirmed) { console.error("Aborted."); return 1; }
  }

  const token = await ensureValidToken();
  await deleteVegaResources({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    ids,
    businessDomain,
  });
  console.error(`Deleted ${ids}`);
  return 0;
}

// ---------------------------------------------------------------------------
// Dataset router
// ---------------------------------------------------------------------------

async function runVegaDatasetCommand(args: string[]): Promise<number> {
  const [sub, ...rest] = args;

  if (!sub || sub === "--help" || sub === "-h") {
    console.log(
      renderHelp({
        tagline: "Manage Vega dataset documents and builds.",
        usage: "kweaver vega dataset <subcommand> [flags]",
        sections: [
          {
            title: "AVAILABLE COMMANDS",
            items: [
              { name: "create-docs", desc: "Create documents in a dataset resource" },
              { name: "update-docs", desc: "Update documents (by id) in a dataset resource" },
              { name: "delete-docs", desc: "Delete documents by id" },
              { name: "delete-docs-query", desc: "Delete documents by filter query" },
              { name: "build", desc: "Build a dataset (full / incremental / realtime)" },
              { name: "build-status", desc: "Get build task status" },
            ],
          },
        ],
        inheritedFlags: "--base-url, --token, --user, --help",
      }),
    );
    return 0;
  }

  if (sub === "create-docs") return await runDatasetCreateDocs(rest);
  if (sub === "update-docs") return await runDatasetUpdateDocs(rest);
  if (sub === "delete-docs") return await runDatasetDeleteDocs(rest);
  if (sub === "delete-docs-query") return await runDatasetDeleteDocsQuery(rest);
  if (sub === "build") return await runDatasetBuild(rest);
  if (sub === "build-status") return await runDatasetBuildStatus(rest);

  console.error(`Unknown dataset subcommand: ${sub}`);
  return 1;
}

// ---------------------------------------------------------------------------
// dataset create-docs
// ---------------------------------------------------------------------------

async function runDatasetCreateDocs(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      renderHelp({
        tagline: "Create dataset documents.",
        usage: "kweaver vega dataset create-docs <resource-id> -d <json-array>",
        flags: [
          { name: "-d, --data <json>", desc: "Array of documents (JSON string)" },
        ],
        inheritedFlags: "--base-url, --token, --user, --help",
      }),
    );
    return 0;
  }

  let data: string | undefined;
  const { remaining, businessDomain, pretty } = parseCommonFlags(args);

  const positionals: string[] = [];
  for (let i = 0; i < remaining.length; i += 1) {
    const arg = remaining[i];
    if ((arg === "-d" || arg === "--data") && remaining[i + 1]) { data = remaining[++i]; continue; }
    if (!arg.startsWith("-")) positionals.push(arg);
  }

  const id = positionals[0];
  if (!id || !data) {
    console.error("Usage: kweaver vega dataset create-docs <resource-id> -d <json-array>");
    return 1;
  }

  const token = await ensureValidToken();
  const body = await createVegaDatasetDocs({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    id,
    body: data,
    businessDomain,
  });
  console.log(formatCallOutput(body, pretty));
  return 0;
}

// ---------------------------------------------------------------------------
// dataset update-docs
// ---------------------------------------------------------------------------

async function runDatasetUpdateDocs(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      renderHelp({
        tagline: "Update dataset documents.",
        usage: "kweaver vega dataset update-docs <resource-id> -d <json-array>",
        flags: [
          { name: "-d, --data <json>", desc: "Array of documents with ids (JSON string)" },
        ],
        inheritedFlags: "--base-url, --token, --user, --help",
      }),
    );
    return 0;
  }

  let data: string | undefined;
  const { remaining, businessDomain, pretty } = parseCommonFlags(args);

  const positionals: string[] = [];
  for (let i = 0; i < remaining.length; i += 1) {
    const arg = remaining[i];
    if ((arg === "-d" || arg === "--data") && remaining[i + 1]) { data = remaining[++i]; continue; }
    if (!arg.startsWith("-")) positionals.push(arg);
  }

  const id = positionals[0];
  if (!id || !data) {
    console.error("Usage: kweaver vega dataset update-docs <resource-id> -d <json-array>");
    return 1;
  }

  const token = await ensureValidToken();
  const body = await updateVegaDatasetDocs({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    id,
    body: data,
    businessDomain,
  });
  console.log(formatCallOutput(body || "{}", pretty));
  return 0;
}

// ---------------------------------------------------------------------------
// dataset delete-docs
// ---------------------------------------------------------------------------

async function runDatasetDeleteDocs(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      renderHelp({
        tagline: "Delete dataset documents by id.",
        usage: "kweaver vega dataset delete-docs <resource-id> <doc-ids...>",
        sections: [
          {
            title: "Positional args",
            items: [
              { name: "resource-id", desc: "The dataset resource ID" },
              { name: "doc-ids", desc: "One or more document IDs (comma-joined)" },
            ],
          },
        ],
        inheritedFlags: "--base-url, --token, --user, --help",
      }),
    );
    return 0;
  }

  const { remaining, businessDomain, pretty } = parseCommonFlags(args);
  const positionals = remaining.filter((a) => !a.startsWith("-"));

  const id = positionals[0];
  const docIds = positionals.slice(1);
  if (!id || docIds.length === 0) {
    console.error("Usage: kweaver vega dataset delete-docs <resource-id> <doc-ids...>");
    return 1;
  }

  const token = await ensureValidToken();
  const body = await deleteVegaDatasetDocs({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    id,
    docIds: docIds.join(","),
    businessDomain,
  });
  console.log(formatCallOutput(body || "{}", pretty));
  return 0;
}

// ---------------------------------------------------------------------------
// dataset delete-docs-query
// ---------------------------------------------------------------------------

async function runDatasetDeleteDocsQuery(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      renderHelp({
        tagline: "Delete dataset documents matching a filter.",
        usage: "kweaver vega dataset delete-docs-query <resource-id> -d <filter-json>",
        flags: [
          { name: "-d, --data <json>", desc: "Filter condition (JSON string)" },
        ],
        inheritedFlags: "--base-url, --token, --user, --help",
      }),
    );
    return 0;
  }

  let data: string | undefined;
  const { remaining, businessDomain, pretty } = parseCommonFlags(args);

  const positionals: string[] = [];
  for (let i = 0; i < remaining.length; i += 1) {
    const arg = remaining[i];
    if ((arg === "-d" || arg === "--data") && remaining[i + 1]) { data = remaining[++i]; continue; }
    if (!arg.startsWith("-")) positionals.push(arg);
  }

  const id = positionals[0];
  if (!id || !data) {
    console.error("Usage: kweaver vega dataset delete-docs-query <resource-id> -d <filter-json>");
    return 1;
  }

  const token = await ensureValidToken();
  const body = await deleteVegaDatasetDocsQuery({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    id,
    body: data,
    businessDomain,
  });
  console.log(formatCallOutput(body || "{}", pretty));
  return 0;
}

// ---------------------------------------------------------------------------
// dataset build
// ---------------------------------------------------------------------------

async function runDatasetBuild(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      renderHelp({
        tagline: "Build a Vega dataset.",
        usage: "kweaver vega dataset build <resource-id> [options]",
        flags: [
          { name: "--mode <mode>", desc: "Build mode: full, incremental, realtime (default: full)" },
        ],
        inheritedFlags: "--base-url, --token, --user, --help",
      }),
    );
    return 0;
  }

  let mode = "full";
  const { remaining, businessDomain, pretty } = parseCommonFlags(args);

  const positionals: string[] = [];
  for (let i = 0; i < remaining.length; i += 1) {
    const arg = remaining[i];
    if (arg === "--mode" && remaining[i + 1]) { mode = remaining[++i]; continue; }
    if (!arg.startsWith("-")) positionals.push(arg);
  }

  const id = positionals[0];
  if (!id) {
    console.error("Usage: kweaver vega dataset build <resource-id> [--mode full|incremental|realtime]");
    return 1;
  }

  const token = await ensureValidToken();
  const body = await buildVegaDataset({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    id,
    mode,
    businessDomain,
  });
  console.log(formatCallOutput(body, pretty));
  return 0;
}

// ---------------------------------------------------------------------------
// dataset build-status
// ---------------------------------------------------------------------------

async function runDatasetBuildStatus(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      renderHelp({
        tagline: "Get dataset build status.",
        usage: "kweaver vega dataset build-status <resource-id> <task-id>",
        inheritedFlags: "--base-url, --token, --user, --help",
      }),
    );
    return 0;
  }

  const { remaining, businessDomain, pretty } = parseCommonFlags(args);
  const positionals = remaining.filter((a) => !a.startsWith("-"));

  const id = positionals[0];
  const taskId = positionals[1];
  if (!id || !taskId) {
    console.error("Usage: kweaver vega dataset build-status <resource-id> <task-id>");
    return 1;
  }

  const token = await ensureValidToken();
  const body = await getVegaDatasetBuildStatus({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    id,
    taskId,
    businessDomain,
  });
  console.log(formatCallOutput(body, pretty));
  return 0;
}

// ---------------------------------------------------------------------------
// Query router
// ---------------------------------------------------------------------------

async function runVegaQueryCommand(args: string[]): Promise<number> {
  const [sub, ...rest] = args;

  if (!sub || sub === "--help" || sub === "-h") {
    console.log(
      renderHelp({
        tagline: "Execute structured Vega queries.",
        usage: "kweaver vega query <subcommand> [flags]",
        sections: [
          {
            title: "AVAILABLE COMMANDS",
            items: [
              { name: "execute", desc: "Execute a structured query (-d <json>)" },
            ],
          },
        ],
        inheritedFlags: "--base-url, --token, --user, --help",
      }),
    );
    return 0;
  }

  if (sub === "execute") return await runQueryExecute(rest);

  console.error(`Unknown query subcommand: ${sub}`);
  return 1;
}

// ---------------------------------------------------------------------------
// query execute
// ---------------------------------------------------------------------------

async function runQueryExecute(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      renderHelp({
        tagline: "Execute a Vega query.",
        usage: "kweaver vega query execute -d <json>",
        flags: [
          { name: "-d, --data <json>", desc: "Query body (tables, joins, output_fields, filter_condition, sort, limit, ...)" },
        ],
        inheritedFlags: "--base-url, --token, --user, --help",
      }),
    );
    return 0;
  }

  let data: string | undefined;
  const { remaining, businessDomain, pretty } = parseCommonFlags(args);

  for (let i = 0; i < remaining.length; i += 1) {
    const arg = remaining[i];
    if ((arg === "-d" || arg === "--data") && remaining[i + 1]) { data = remaining[++i]; continue; }
  }

  if (!data) {
    console.error("Usage: kweaver vega query execute -d <json>");
    return 1;
  }

  const token = await ensureValidToken();
  const body = await executeVegaQuery({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    body: data,
    businessDomain,
  });
  console.log(formatCallOutput(body, pretty));
  return 0;
}

// ---------------------------------------------------------------------------
// sql (POST /resources/query)
// ---------------------------------------------------------------------------

async function runVegaSql(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      renderHelp({
        tagline: "POST /api/vega-backend/v1/resources/query — execute SQL (MySQL/MariaDB/PostgreSQL) or OpenSearch DSL.",
        usage: [
          "kweaver vega sql --resource-type <type> --query \"<sql-or-dsl>\"",
          "kweaver vega sql -d <json>",
        ].join("\n"),
        sections: [
          {
            title: "Simple mode (no JSON escaping for query + type)",
            items: [
              { name: "--resource-type <t>", desc: "Required with --query unless using -d" },
              { name: "--query <string>", desc: "One shell argument: the full SQL (or DSL string). Always quote it." },
            ],
          },
          {
            title: "Advanced mode (full request body, optional fields)",
            items: [
              { name: "-d, --data <json>", desc: "Raw JSON body. When present, this mode is used and any --query / --resource-type are ignored." },
            ],
          },
          {
            title: "Resource placeholders (how to reference Vega tables in SQL)",
            items: [
              { name: "{{<resource_id>}}", desc: "Required token form: double braces around the Vega resource id (from vega resource list / get)." },
              { name: "{{.<resource_id>}}", desc: "Alternate form with a dot after {{ ; same replacement and routing." },
            ],
          },
          {
            title: "Body fields (JSON / simple mode mapping)",
            items: [
              { name: "query", desc: "(required) SQL string or OpenSearch DSL object" },
              { name: "resource_type", desc: "(required) e.g. mysql, mariadb, postgresql, opensearch (see vega connector-type list)" },
              { name: "stream_size", desc: "optional batch size for streaming (100–10000, default 10000)" },
              { name: "query_timeout", desc: "optional seconds (1–3600, default 60)" },
              { name: "query_id", desc: "optional cursor session id" },
            ],
          },
        ],
        flags: [
          { name: "-bd, --biz-domain <s>", desc: "Business domain (default: bd_public)" },
          { name: "--pretty", desc: "Pretty-print JSON (default)" },
        ],
        inheritedFlags: "--base-url, --token, --user, --help",
        examples: [
          "kweaver vega sql --resource-type mysql --query \"SELECT * FROM {{abc123xyz}} LIMIT 5\"",
          "kweaver vega sql -d '{\"resource_type\":\"mysql\",\"query\":\"SELECT * FROM {{abc123xyz}} LIMIT 5\"}'",
        ],
        learnMore: [
          "The backend swaps each placeholder for that resource's physical SourceIdentifier and picks the catalog connector.",
          "Without at least one placeholder, queries often fail (e.g. connector config is incomplete) unless a default connector exists.",
          "Do not use --type; use --resource-type.",
        ],
      }),
    );
    return 0;
  }

  let data: string | undefined;
  let query: string | undefined;
  let resourceType: string | undefined;
  const { remaining, businessDomain, pretty } = parseCommonFlags(args);

  for (let i = 0; i < remaining.length; i += 1) {
    const arg = remaining[i];
    if (arg === "--type") {
      console.error("Use --resource-type instead of --type (e.g. --resource-type mysql).");
      return 1;
    }
    if ((arg === "-d" || arg === "--data") && remaining[i + 1]) {
      data = remaining[++i];
      continue;
    }
    if (arg === "--query" && remaining[i + 1]) {
      query = remaining[++i];
      continue;
    }
    if (arg === "--resource-type" && remaining[i + 1]) {
      resourceType = remaining[++i];
      continue;
    }
  }

  let requestBody: string;

  if (data !== undefined) {
    try {
      JSON.parse(data);
    } catch {
      console.error(`Invalid JSON: ${data}`);
      return 1;
    }
    requestBody = data;
  } else {
    if (!query || !resourceType) {
      console.error(
        "Usage: kweaver vega sql --resource-type <type> --query \"<sql-or-dsl>\"\n       kweaver vega sql -d <json>",
      );
      return 1;
    }
    requestBody = JSON.stringify({ query, resource_type: resourceType });
  }

  const token = await ensureValidToken();
  const body = await vegaSQLQuery({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    body: requestBody,
    businessDomain,
  });
  console.log(formatCallOutput(body, pretty));
  return 0;
}

// ---------------------------------------------------------------------------
// Connector-type router
// ---------------------------------------------------------------------------

async function runVegaConnectorTypeCommand(args: string[]): Promise<number> {
  const [sub, ...rest] = args;

  if (!sub || sub === "--help" || sub === "-h") {
    console.log(
      renderHelp({
        tagline: "Manage Vega connector types.",
        usage: "kweaver vega connector-type <subcommand> [flags]",
        sections: [
          {
            title: "AVAILABLE COMMANDS",
            items: [
              { name: "list", desc: "List connector types" },
              { name: "get", desc: "Get connector type details" },
              { name: "register", desc: "Register a new connector type" },
              { name: "update", desc: "Update connector type" },
              { name: "delete", desc: "Delete connector type" },
              { name: "enable", desc: "Enable/disable connector type" },
            ],
          },
        ],
        inheritedFlags: "--base-url, --token, --user, --help",
      }),
    );
    return 0;
  }

  if (sub === "list") return await runConnectorTypeList(rest);
  if (sub === "get") return await runConnectorTypeGet(rest);
  if (sub === "register") return await runConnectorTypeRegister(rest);
  if (sub === "update") return await runConnectorTypeUpdate(rest);
  if (sub === "delete") return await runConnectorTypeDelete(rest);
  if (sub === "enable") return await runConnectorTypeEnable(rest);

  console.error(`Unknown connector-type subcommand: ${sub}`);
  return 1;
}

// ---------------------------------------------------------------------------
// connector-type list
// ---------------------------------------------------------------------------

async function runConnectorTypeList(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      renderHelp({
        tagline: "List Vega connector types.",
        usage: "kweaver vega connector-type list",
        inheritedFlags: "--base-url, --token, --user, --help",
      }),
    );
    return 0;
  }

  const { businessDomain, pretty } = parseCommonFlags(args);
  const token = await ensureValidToken();
  const body = await listVegaConnectorTypes({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    businessDomain,
  });
  console.log(formatCallOutput(body, pretty));
  return 0;
}

// ---------------------------------------------------------------------------
// connector-type get
// ---------------------------------------------------------------------------

async function runConnectorTypeGet(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      renderHelp({
        tagline: "Get connector type details.",
        usage: "kweaver vega connector-type get <type>",
        inheritedFlags: "--base-url, --token, --user, --help",
      }),
    );
    return 0;
  }

  const { remaining, businessDomain, pretty } = parseCommonFlags(args);
  const type = remaining.find((a) => !a.startsWith("-"));
  if (!type) {
    console.error("Usage: kweaver vega connector-type get <type>");
    return 1;
  }

  const token = await ensureValidToken();
  const body = await getVegaConnectorType({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    type,
    businessDomain,
  });
  console.log(formatCallOutput(body, pretty));
  return 0;
}

// ---------------------------------------------------------------------------
// connector-type register
// ---------------------------------------------------------------------------

async function runConnectorTypeRegister(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      renderHelp({
        tagline: "Register a new connector type.",
        usage: "kweaver vega connector-type register -d <json>",
        flags: [
          { name: "-d, --data <json>", desc: "Connector type definition (JSON string)" },
        ],
        inheritedFlags: "--base-url, --token, --user, --help",
      }),
    );
    return 0;
  }

  let data: string | undefined;
  const { remaining, businessDomain, pretty } = parseCommonFlags(args);

  for (let i = 0; i < remaining.length; i += 1) {
    const arg = remaining[i];
    if ((arg === "-d" || arg === "--data") && remaining[i + 1]) { data = remaining[++i]; continue; }
  }

  if (!data) {
    console.error("Usage: kweaver vega connector-type register -d <json>");
    return 1;
  }

  const token = await ensureValidToken();
  const body = await registerVegaConnectorType({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    body: data,
    businessDomain,
  });
  console.log(formatCallOutput(body, pretty));
  return 0;
}

// ---------------------------------------------------------------------------
// connector-type update
// ---------------------------------------------------------------------------

async function runConnectorTypeUpdate(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      renderHelp({
        tagline: "Update a connector type.",
        usage: "kweaver vega connector-type update <type> -d <json>",
        flags: [
          { name: "-d, --data <json>", desc: "Updated fields (JSON string)" },
        ],
        inheritedFlags: "--base-url, --token, --user, --help",
      }),
    );
    return 0;
  }

  let data: string | undefined;
  const { remaining, businessDomain, pretty } = parseCommonFlags(args);

  const positionals: string[] = [];
  for (let i = 0; i < remaining.length; i += 1) {
    const arg = remaining[i];
    if ((arg === "-d" || arg === "--data") && remaining[i + 1]) { data = remaining[++i]; continue; }
    if (!arg.startsWith("-")) positionals.push(arg);
  }

  const type = positionals[0];
  if (!type || !data) {
    console.error("Usage: kweaver vega connector-type update <type> -d <json>");
    return 1;
  }

  const token = await ensureValidToken();
  const body = await updateVegaConnectorType({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    type,
    body: data,
    businessDomain,
  });
  console.log(formatCallOutput(body || "{}", pretty));
  return 0;
}

// ---------------------------------------------------------------------------
// connector-type delete
// ---------------------------------------------------------------------------

async function runConnectorTypeDelete(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      renderHelp({
        tagline: "Delete a connector type.",
        usage: "kweaver vega connector-type delete <type> [-y]",
        flags: [
          { name: "-y, --yes", desc: "Skip confirmation prompt" },
        ],
        inheritedFlags: "--base-url, --token, --user, --help",
      }),
    );
    return 0;
  }

  let yes = false;
  const { remaining, businessDomain } = parseCommonFlags(args);
  const positionals: string[] = [];

  for (const arg of remaining) {
    if (arg === "-y" || arg === "--yes") { yes = true; continue; }
    if (!arg.startsWith("-")) positionals.push(arg);
  }

  const type = positionals[0];
  if (!type) {
    console.error("Usage: kweaver vega connector-type delete <type> [-y]");
    return 1;
  }

  if (!yes) {
    const confirmed = await confirmYes(`Delete connector type "${type}"?`);
    if (!confirmed) { console.error("Aborted."); return 1; }
  }

  const token = await ensureValidToken();
  await deleteVegaConnectorType({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    type,
    businessDomain,
  });
  console.error(`Deleted ${type}`);
  return 0;
}

// ---------------------------------------------------------------------------
// connector-type enable
// ---------------------------------------------------------------------------

async function runConnectorTypeEnable(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      renderHelp({
        tagline: "Enable or disable a connector type.",
        usage: "kweaver vega connector-type enable <type> --enabled <true|false>",
        flags: [
          { name: "--enabled <true|false>", desc: "Whether to enable the connector type" },
        ],
        inheritedFlags: "--base-url, --token, --user, --help",
      }),
    );
    return 0;
  }

  let enabled: boolean | undefined;
  const { remaining, businessDomain, pretty } = parseCommonFlags(args);

  const positionals: string[] = [];
  for (let i = 0; i < remaining.length; i += 1) {
    const arg = remaining[i];
    if (arg === "--enabled" && remaining[i + 1]) {
      enabled = remaining[++i] === "true";
      continue;
    }
    if (!arg.startsWith("-")) positionals.push(arg);
  }

  const type = positionals[0];
  if (!type || enabled === undefined) {
    console.error("Usage: kweaver vega connector-type enable <type> --enabled <true|false>");
    return 1;
  }

  const token = await ensureValidToken();
  const body = await setVegaConnectorTypeEnabled({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    type,
    enabled,
    businessDomain,
  });
  console.log(formatCallOutput(body || "{}", pretty));
  return 0;
}

