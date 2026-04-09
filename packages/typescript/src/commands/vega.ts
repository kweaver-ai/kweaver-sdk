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
  listAllVegaResources,
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
  catalog create --name <n> --connector-type <t> --connector-config <json>
  catalog update <id> [--name X] [--connector-type X] [--tags X] [--description X]
  catalog delete <ids...> [-y]
  resource list [--catalog-id X] [--category X] [--status X] [--limit N] [--offset N]
  resource get <id>
  resource query <id> -d <json-body>  Query resource data
  resource create --catalog-id <cid> --name <n> --category <cat>
  resource update <id> [--name X] [--status X] [--tags X] [-d json]
  resource delete <ids...> [-y]
  resource list-all [--limit N] [--offset N]
  dataset create-docs <resource-id> -d <json-array>
  dataset update-docs <resource-id> -d <json-array>
  dataset delete-docs <resource-id> <doc-ids...>
  dataset delete-docs-query <resource-id> -d <filter-json>
  dataset build <resource-id> [--mode full|incremental|realtime]
  dataset build-status <resource-id> <task-id>
  query execute -d <json>
  connector-type list                 List connector types
  connector-type get <type>           Get connector type details
  connector-type register -d <json>   Register a new connector type
  connector-type update <type> -d <json>  Update connector type
  connector-type delete <type> [-y]   Delete connector type
  connector-type enable <type> --enabled <bool>  Enable/disable connector type
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
    console.log("kweaver vega inspect\n\nHealth + catalog summary.");
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
    console.log(`kweaver vega catalog

Subcommands:
  list [--status X] [--limit N] [--offset N]
  get <id>
  health <ids...> | --all
  test-connection <id>
  discover <id> [--wait]
  resources <id> [--category X] [--limit N]
  create --name <name> --connector-type <type> --connector-config <json> [--tags t1,t2] [--description X]
  update <id> [--name X] [--connector-type X] [--tags X] [--description X] [--connector-config X]
  delete <ids...> [-y]`);
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
    console.log(`kweaver vega catalog list [options]

Options:
  --status <s>    Filter by status
  --limit <n>     Max results (default: 30)
  --offset <n>    Offset
  -bd, --biz-domain  Business domain (default: bd_public)
  --pretty         Pretty-print JSON (default)`);
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
  --limit <n>      Max results (default: 30)`);
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
    console.log(`kweaver vega catalog create [options]

Options:
  --name <s>              Catalog name (required)
  --connector-type <s>    Connector type (required)
  --connector-config <j>  Connector config JSON (required)
  --tags <t1,t2>          Comma-separated tags
  --description <s>       Description`);
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
    console.log(`kweaver vega catalog update <id> [options]

Options:
  --name <s>              New name
  --connector-type <t>    Connector type (e.g. mysql, opensearch)
  --tags <t1,t2>          Comma-separated tags
  --description <s>       Description
  --connector-config <j>  Connector config JSON`);
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
    console.log(`kweaver vega catalog delete <ids...> [-y]

Options:
  -y, --yes   Skip confirmation`);
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
    console.log(`kweaver vega resource

Subcommands:
  list [--catalog-id X] [--category X] [--status X] [--limit N] [--offset N]
  list-all [--limit N] [--offset N]
  get <id>
  query <id> -d <json-body>
  create --catalog-id <cid> --name <name> --category <cat>
  update <id> [--name X] [--status X] [--tags X] [-d json]
  delete <ids...> [-y]`);
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
    console.log(`kweaver vega resource list [options]

Options:
  --catalog-id <s>  Filter by catalog
  --category <s>    Filter by category
  --status <s>      Filter by status
  --limit <n>       Max results (default: 30)
  --offset <n>      Offset
  -bd, --biz-domain  Business domain (default: bd_public)
  --pretty           Pretty-print JSON (default)`);
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
    console.log(`kweaver vega resource list-all [options]

Options:
  --limit <n>       Max results (default: 30)
  --offset <n>      Offset
  -bd, --biz-domain  Business domain (default: bd_public)
  --pretty           Pretty-print JSON (default)`);
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
// resource create
// ---------------------------------------------------------------------------

async function runResourceCreate(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`kweaver vega resource create [options]

Options:
  --catalog-id <cid>          Catalog ID (required)
  --name <name>               Resource name (required)
  --category <cat>            Category (required)
  --source-identifier <si>    Source identifier
  --database <db>             Database name
  -d, --data <json>           Additional fields as JSON`);
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
    console.log(`kweaver vega resource update <id> [options]

Options:
  --name <name>       Resource name
  --status <s>        Status
  --tags <t1,t2>      Comma-separated tags
  -d, --data <json>   Additional fields as JSON`);
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
    console.log(`kweaver vega resource delete <ids...> [-y]

Options:
  -y, --yes   Skip confirmation prompt`);
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
    console.log(`kweaver vega dataset

Subcommands:
  create-docs <resource-id> -d <json-array>
  update-docs <resource-id> -d <json-array>
  delete-docs <resource-id> <doc-ids...>
  delete-docs-query <resource-id> -d <filter-json>
  build <resource-id> [--mode full|incremental|realtime]
  build-status <resource-id> <task-id>`);
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
    console.log(`kweaver vega dataset create-docs <resource-id> -d <json-array>

Options:
  -d, --data <json>   Array of documents (JSON string)`);
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
    console.log(`kweaver vega dataset update-docs <resource-id> -d <json-array>

Options:
  -d, --data <json>   Array of documents with ids (JSON string)`);
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
    console.log(`kweaver vega dataset delete-docs <resource-id> <doc-ids...>

Positional args:
  resource-id   The dataset resource ID
  doc-ids       One or more document IDs (comma-joined)`);
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
    console.log(`kweaver vega dataset delete-docs-query <resource-id> -d <filter-json>

Options:
  -d, --data <json>   Filter condition (JSON string)`);
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
    console.log(`kweaver vega dataset build <resource-id> [options]

Options:
  --mode <mode>   Build mode: full, incremental, realtime (default: full)`);
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
    console.log(`kweaver vega dataset build-status <resource-id> <task-id>`);
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
    console.log(`kweaver vega query

Subcommands:
  execute -d <json>   Execute a query`);
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
    console.log(`kweaver vega query execute -d <json>

Options:
  -d, --data <json>   Query body (tables, joins, output_fields, filter_condition, sort, limit, ...)`);
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
// Connector-type router
// ---------------------------------------------------------------------------

async function runVegaConnectorTypeCommand(args: string[]): Promise<number> {
  const [sub, ...rest] = args;

  if (!sub || sub === "--help" || sub === "-h") {
    console.log(`kweaver vega connector-type

Subcommands:
  list                            List connector types
  get <type>                      Get connector type details
  register -d <json>              Register a new connector type
  update <type> -d <json>         Update connector type
  delete <type> [-y]              Delete connector type
  enable <type> --enabled <bool>  Enable/disable connector type`);
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

// ---------------------------------------------------------------------------
// connector-type register
// ---------------------------------------------------------------------------

async function runConnectorTypeRegister(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`kweaver vega connector-type register -d <json>

Options:
  -d, --data <json>   Connector type definition (JSON string)`);
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
    console.log(`kweaver vega connector-type update <type> -d <json>

Options:
  -d, --data <json>   Updated fields (JSON string)`);
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
    console.log(`kweaver vega connector-type delete <type> [-y]

Options:
  -y, --yes   Skip confirmation prompt`);
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
    console.log(`kweaver vega connector-type enable <type> --enabled <true|false>`);
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

