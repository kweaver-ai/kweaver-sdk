import { ensureValidToken, formatHttpError } from "../auth/oauth.js";
import {
  vegaHealth,
  listVegaCatalogs,
  getVegaCatalog,
  vegaCatalogHealthStatus,
  testVegaCatalogConnection,
  discoverVegaCatalog,
  listVegaCatalogResources,
  listVegaResources,
  getVegaResource,
  queryVegaResourceData,
  previewVegaResource,
  listVegaConnectorTypes,
  getVegaConnectorType,
  listVegaDiscoverTasks,
} from "../api/vega.js";
import { formatCallOutput } from "./call.js";
import { resolveBusinessDomain } from "../config/store.js";

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

function printVegaHelp(): void {
  console.log(`kweaver vega

Subcommands:
  health                              Check Vega service health
  stats                               Show catalog statistics
  inspect                             Health + catalog summary + running tasks
  catalog list [--status X] [--limit N] [--offset N]
  catalog get <id>
  catalog health <ids...> | --all     Health-check catalogs
  catalog test-connection <id>        Test catalog connectivity
  catalog discover <id> [--wait]      Trigger discovery
  catalog resources <id> [--category X] [--limit N]
  resource list [--catalog-id X] [--category X] [--status X] [--limit N] [--offset N]
  resource get <id>
  resource query <id> -d <json-body>  Query resource data
  resource preview <id> [--limit N]   Preview resource data
  connector-type list                 List connector types
  connector-type get <type>           Get connector type details

Common flags:
  -bd, --biz-domain <s>   Business domain (default: bd_public)
  --pretty                Pretty-print JSON (default)`);
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

// ---------------------------------------------------------------------------
// Main router
// ---------------------------------------------------------------------------

export async function runVegaCommand(args: string[]): Promise<number> {
  const [subcommand, ...rest] = args;

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    printVegaHelp();
    return 0;
  }

  try {
    if (subcommand === "health") return await runVegaHealthCommand(rest);
    if (subcommand === "stats") return await runVegaStatsCommand(rest);
    if (subcommand === "inspect") return await runVegaInspectCommand(rest);
    if (subcommand === "catalog") return await runVegaCatalogCommand(rest);
    if (subcommand === "resource") return await runVegaResourceCommand(rest);
    if (subcommand === "connector-type") return await runVegaConnectorTypeCommand(rest);

    console.error(`Unknown vega subcommand: ${subcommand}`);
    return 1;
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
    console.log("kweaver vega health\n\nCheck Vega service health.");
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
    console.log("kweaver vega stats\n\nShow catalog statistics.");
    return 0;
  }

  const { businessDomain, pretty } = parseCommonFlags(args);
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
}

// ---------------------------------------------------------------------------
// Top-level: inspect
// ---------------------------------------------------------------------------

async function runVegaInspectCommand(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log("kweaver vega inspect\n\nHealth + catalog summary + running discover tasks.");
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

  // Running discover tasks — best-effort
  try {
    const tasksBody = await listVegaDiscoverTasks({ ...base, status: "running" });
    const parsed = JSON.parse(tasksBody) as Record<string, unknown>;
    const entries = Array.isArray(parsed) ? parsed : (parsed.entries ?? parsed.data ?? parsed.items ?? parsed.tasks ?? []);
    result.running_discover_tasks = Array.isArray(entries) ? entries.length : 0;
  } catch (err) {
    console.error(`warn: discover tasks query failed: ${err instanceof Error ? err.message : String(err)}`);
    result.running_discover_tasks = null;
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
    console.log(`kweaver vega catalog

Subcommands:
  list [--status X] [--limit N] [--offset N]
  get <id>
  health <ids...> | --all
  test-connection <id>
  discover <id> [--wait]
  resources <id> [--category X] [--limit N]`);
    return 0;
  }

  if (sub === "list") return await runCatalogList(rest);
  if (sub === "get") return await runCatalogGet(rest);
  if (sub === "health") return await runCatalogHealth(rest);
  if (sub === "test-connection") return await runCatalogTestConnection(rest);
  if (sub === "discover") return await runCatalogDiscover(rest);
  if (sub === "resources") return await runCatalogResources(rest);

  console.error(`Unknown catalog subcommand: ${sub}`);
  return 1;
}

// ---------------------------------------------------------------------------
// catalog list
// ---------------------------------------------------------------------------

async function runCatalogList(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`kweaver vega catalog list [options]

Options:
  --status <s>    Filter by status
  --limit <n>     Max results
  --offset <n>    Offset
  -bd, --biz-domain  Business domain (default: bd_public)
  --pretty         Pretty-print JSON (default)`);
    return 0;
  }

  let status: string | undefined;
  let limit: number | undefined;
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
    console.log("kweaver vega catalog get <id>");
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
    console.log(`kweaver vega catalog health <ids...> | --all

Options:
  --all   Check health of all catalogs`);
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
    console.log("kweaver vega catalog test-connection <id>");
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
    console.log(`kweaver vega catalog discover <id> [--wait]

Options:
  --wait   Wait for discovery to complete`);
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
    console.log(`kweaver vega catalog resources <id> [options]

Options:
  --category <s>   Filter by category
  --limit <n>      Max results`);
    return 0;
  }

  let category: string | undefined;
  let limit: number | undefined;
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
// Resource router
// ---------------------------------------------------------------------------

async function runVegaResourceCommand(args: string[]): Promise<number> {
  const [sub, ...rest] = args;

  if (!sub || sub === "--help" || sub === "-h") {
    console.log(`kweaver vega resource

Subcommands:
  list [--catalog-id X] [--category X] [--status X] [--limit N] [--offset N]
  get <id>
  query <id> -d <json-body>
  preview <id> [--limit N]`);
    return 0;
  }

  if (sub === "list") return await runResourceList(rest);
  if (sub === "get") return await runResourceGet(rest);
  if (sub === "query") return await runResourceQuery(rest);
  if (sub === "preview") return await runResourcePreview(rest);

  console.error(`Unknown resource subcommand: ${sub}`);
  return 1;
}

// ---------------------------------------------------------------------------
// resource list
// ---------------------------------------------------------------------------

async function runResourceList(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`kweaver vega resource list [options]

Options:
  --catalog-id <s>  Filter by catalog
  --category <s>    Filter by category
  --status <s>      Filter by status
  --limit <n>       Max results
  --offset <n>      Offset
  -bd, --biz-domain  Business domain (default: bd_public)
  --pretty           Pretty-print JSON (default)`);
    return 0;
  }

  let catalogId: string | undefined;
  let category: string | undefined;
  let status: string | undefined;
  let limit: number | undefined;
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
// resource get
// ---------------------------------------------------------------------------

async function runResourceGet(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log("kweaver vega resource get <id>");
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
    console.log(`kweaver vega resource query <id> -d <json-body>

Options:
  -d, --data <json>   Request body (JSON string)`);
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
// resource preview
// ---------------------------------------------------------------------------

async function runResourcePreview(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`kweaver vega resource preview <id> [--limit N]

Options:
  --limit <n>   Number of rows to preview (default: 10)`);
    return 0;
  }

  let limit: number | undefined;
  const { remaining, businessDomain, pretty } = parseCommonFlags(args);

  const positionals: string[] = [];
  for (let i = 0; i < remaining.length; i += 1) {
    const arg = remaining[i];
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
    console.error("Usage: kweaver vega resource preview <id> [--limit N]");
    return 1;
  }

  const token = await ensureValidToken();
  const body = await previewVegaResource({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    id,
    limit,
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
    console.log(`kweaver vega connector-type

Subcommands:
  list              List connector types
  get <type>        Get connector type details`);
    return 0;
  }

  if (sub === "list") return await runConnectorTypeList(rest);
  if (sub === "get") return await runConnectorTypeGet(rest);

  console.error(`Unknown connector-type subcommand: ${sub}`);
  return 1;
}

// ---------------------------------------------------------------------------
// connector-type list
// ---------------------------------------------------------------------------

async function runConnectorTypeList(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log("kweaver vega connector-type list");
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
    console.log("kweaver vega connector-type get <type>");
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
