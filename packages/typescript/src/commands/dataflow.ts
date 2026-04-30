import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import columnify from "columnify";
import stringWidth from "string-width";
import yargs from "yargs";
import { ensureValidToken, formatHttpError, with401RefreshRetry } from "../auth/oauth.js";
import { resolveBusinessDomain } from "../config/store.js";
import {
  getDataflowLogsPage,
  listDataflowRuns,
  listDataflows,
  runDataflowWithFile,
  runDataflowWithRemoteUrl,
  type DataflowListItem,
  type DataflowLogItem,
  type DataflowRunItem,
} from "../api/dataflow2.js";
import { createDataflow, type DataflowCreateBody } from "../api/dataflow.js";
import { createVegaResource } from "../api/vega.js";
import { createKnowledgeNetwork } from "../api/knowledge-networks.js";
import {
  loadTemplate,
  listTemplates,
  renderTemplate,
  generateSourceIdentifier,
  getTemplatesDir,
} from "../utils/template-loader.js";

function renderTable(rows: Array<Record<string, string>>): string {
  if (rows.length === 0) return "";
  return columnify(rows, {
    showHeaders: true,
    preserveNewLines: true,
    stringLength: stringWidth,
    headingTransform: (heading: string) => heading,
  });
}

function buildListTableRows(items: DataflowListItem[]): Array<Record<string, string>> {
  return items.map((item) => ({
    "ID": item.id,
    "Title": item.title ?? "",
    "Status": item.status ?? "",
    "Trigger": item.trigger ?? "",
    "Creator": item.creator ?? "",
    "Updated At": item.updated_at != null ? String(item.updated_at) : "",
    "Version ID": item.version_id ?? "",
  }));
}

function buildRunTableRows(items: DataflowRunItem[]): Array<Record<string, string>> {
  return items.map((item) => ({
    "ID": item.id,
    "Status": item.status ?? "",
    "Started At": item.started_at != null ? String(item.started_at) : "",
    "Ended At": item.ended_at != null ? String(item.ended_at) : "",
    "Source Name": item.source?.name != null ? String(item.source.name) : "",
    "Content Type": item.source?.content_type != null ? String(item.source.content_type) : "",
    "Size": item.source?.size != null ? String(item.source.size) : "",
    "Reason": item.reason ?? "",
  }));
}

function parseSinceToLocalDayRange(value: string): { startTime: number; endTime: number } | null {
  // 只支持 YYYY-MM-DD 格式，解析为本地时区的一整天范围
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10) - 1; // Date month is 0-indexed
  const day = parseInt(match[3], 10);

  const start = new Date(year, month, day, 0, 0, 0);
  const end = new Date(year, month, day, 23, 59, 59);
  return {
    startTime: Math.floor(start.getTime() / 1000),
    endTime: Math.floor(end.getTime() / 1000),
  };
}

function formatDataflowLogSummary(item: DataflowLogItem): string {
  const duration = item.metadata?.duration ?? "-";
  return [
    `[${item.id}] ${item.taskId ?? ""} ${item.operator ?? ""}`,
    `Status: ${item.status ?? ""}`,
    `Started At: ${item.started_at ?? ""}`,
    `Updated At: ${item.updated_at ?? ""}`,
    `Duration: ${duration}`
  ].join("\n");
}

function formatIndentedJsonBlock(label: string, value: unknown): string {
  const pretty = JSON.stringify(value ?? {}, null, 4) ?? "{}";
  const indented = pretty
    .split("\n")
    .map((line) => `        ${line}`)
    .join("\n");
  return `    ${label}:\n${indented}`;
}

function formatDataflowLogOutput(item: DataflowLogItem, detail: boolean): string {
  const parts = [formatDataflowLogSummary(item)];
  if (detail) {
    parts.push("");
    parts.push(formatIndentedJsonBlock("input", item.inputs ?? {}));
    parts.push("");
    parts.push(formatIndentedJsonBlock("output", item.outputs ?? {}));
  }
  return parts.join("\n");
}

async function requireTokenAndBusinessDomain(businessDomain?: string): Promise<{
  baseUrl: string;
  accessToken: string;
  businessDomain: string;
}> {
  const token = await ensureValidToken();
  return {
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    businessDomain: businessDomain || resolveBusinessDomain(),
  };
}

export async function runDataflowCommand(args: string[]): Promise<number> {
  let exitCode = 0;

  const parser = yargs(args)
    .scriptName("kweaver dataflow")
    .exitProcess(false)
    .help()
    .version(false)
    .strict()
    .fail((message: string, error?: Error) => {
      throw error ?? new Error(message);
    })
    .command(
      "list",
      "List all dataflows",
      (command: any) =>
        command
          .option("biz-domain", {
            alias: "bd",
            type: "string",
          })
          .option("table", {
            type: "boolean",
            default: false,
            describe: "Output as human-readable table instead of JSON",
          }),
      async (argv: any) => {
        exitCode = await with401RefreshRetry(async () => {
          const base = await requireTokenAndBusinessDomain(argv.bizDomain);
          const body = await listDataflows(base);
          if (argv.table) {
            const table = renderTable(buildListTableRows(body.dags));
            if (table) {
              console.log(table);
            }
          } else {
            console.log(JSON.stringify(body, null, 2));
          }
          return 0;
        });
      },
    )
    .command(
      "run <dagId>",
      "Trigger one dataflow run",
      (command: any) =>
        command
          .positional("dagId", { type: "string" })
          .option("file", { type: "string" })
          .option("url", { type: "string" })
          .option("name", { type: "string" })
          .option("biz-domain", { alias: "bd", type: "string" })
          .check((argv: any) => {
            const hasFile = typeof argv.file === "string";
            const hasUrl = typeof argv.url === "string";
            if (hasFile === hasUrl) {
              throw new Error("Exactly one of --file or --url is required.");
            }
            if (hasUrl && typeof argv.name !== "string") {
              throw new Error("--url requires --name.");
            }
            return true;
          }),
      async (argv: any) => {
        exitCode = await with401RefreshRetry(async () => {
          const base = await requireTokenAndBusinessDomain(argv.bizDomain);
          if (typeof argv.file === "string") {
            await access(argv.file, constants.R_OK);
            const fileBytes = await readFile(argv.file);
            const fileName = argv.file.split(/[\\/]/).pop() || "upload.bin";
            const body = await runDataflowWithFile({
              ...base,
              dagId: argv.dagId,
              fileName,
              fileBytes,
            });
            console.log(body.dag_instance_id);
            return 0;
          }

          const body = await runDataflowWithRemoteUrl({
            ...base,
            dagId: argv.dagId,
            url: String(argv.url),
            name: String(argv.name),
          });
          console.log(body.dag_instance_id);
          return 0;
        });
      },
    )
    .command(
      "runs <dagId>",
      "List run records for one dataflow",
      (command: any) =>
        command
          .positional("dagId", { type: "string" })
          .option("since", { type: "string" })
          .option("table", {
            type: "boolean",
            default: false,
            describe: "Output as human-readable table instead of JSON",
          })
          .option("biz-domain", { alias: "bd", type: "string" }),
      async (argv: any) => {
        exitCode = await with401RefreshRetry(async () => {
          const base = await requireTokenAndBusinessDomain(argv.bizDomain);
          const dayRange = typeof argv.since === "string" ? parseSinceToLocalDayRange(argv.since) : null;
          let results: DataflowRunItem[] = [];

          if (!dayRange) {
            const body = await listDataflowRuns({
              ...base,
              dagId: argv.dagId,
              page: 0,
              limit: 20,
              sortBy: "started_at",
              order: "desc",
            });
            results = body.results;
          } else {
            const first = await listDataflowRuns({
              ...base,
              dagId: argv.dagId,
              page: 0,
              limit: 20,
              sortBy: "started_at",
              order: "desc",
              startTime: dayRange.startTime,
              endTime: dayRange.endTime,
            });
            results = [...first.results];
            const total = first.total ?? first.results.length;
            for (let page = 1; page * 20 < total; page += 1) {
              const next = await listDataflowRuns({
                ...base,
                dagId: argv.dagId,
                page,
                limit: 20,
                sortBy: "started_at",
                order: "desc",
                startTime: dayRange.startTime,
                endTime: dayRange.endTime,
              });
              results = results.concat(next.results);
            }
          }

          if (argv.table) {
            const table = renderTable(buildRunTableRows(results));
            if (table) {
              console.log(table);
            }
          } else {
            console.log(JSON.stringify(results, null, 2));
          }
          return 0;
        });
      },
    )
    .command(
      "logs <dagId> <instanceId>",
      "Show logs for one run in summary or detail mode",
      (command: any) =>
        command
          .positional("dagId", { type: "string" })
          .positional("instanceId", { type: "string" })
          .option("detail", { type: "boolean", default: false })
          .option("biz-domain", { alias: "bd", type: "string" }),
      async (argv: any) => {
        exitCode = await with401RefreshRetry(async () => {
          const base = await requireTokenAndBusinessDomain(argv.bizDomain);
          let seen = 0;
          for (let page = 0; ; page += 1) {
            const body = await getDataflowLogsPage({
              ...base,
              dagId: argv.dagId,
              instanceId: argv.instanceId,
              page,
              limit: 100,
            });
            if (body.results.length === 0) break;
            for (const item of body.results) {
              console.log(formatDataflowLogOutput(item, argv.detail === true));
              console.log("");
            }
            seen += body.results.length;
            if ((body.total ?? 0) > 0 && seen >= (body.total ?? 0)) break;
          }
          return 0;
        });
      },
    )
    .command(
      "templates",
      "List all available templates",
      {
        json: { type: "boolean", default: false, describe: "Output as JSON" },
      },
      (argv: any) => {
        const templatesDir = getTemplatesDir();

        return Promise.all([
          listTemplates("dataset", templatesDir),
          listTemplates("bkn", templatesDir),
          listTemplates("dataflow", templatesDir),
        ]).then(([datasetTemplates, bknTemplates, dataflowTemplates]) => {
          if (argv.json) {
            console.log(JSON.stringify({
              dataset: datasetTemplates,
              bkn: bknTemplates,
              dataflow: dataflowTemplates,
            }, null, 2));
          } else {
            console.log("Dataset Templates:");
            for (const t of datasetTemplates) {
              console.log(`  - ${t.name.padEnd(18)} ${t.description}`);
            }
            console.log("");
            console.log("BKN Templates:");
            for (const t of bknTemplates) {
              console.log(`  - ${t.name.padEnd(18)} ${t.description}`);
            }
            console.log("");
            console.log("Dataflow Templates:");
            for (const t of dataflowTemplates) {
              console.log(`  - ${t.name.padEnd(18)} ${t.description}`);
            }
          }
        });
      },
    )
    .command(
      "create-dataset",
      "Create a dataset from a template",
      (command: any) =>
        command
          .option("template", { type: "string", demandOption: true, describe: "Template name" })
          .option("set", { type: "array", string: true, describe: "Set parameter (key=value), can be used multiple times" })
          .option("json", { type: "boolean", default: false, describe: "Output as JSON" })
          .option("biz-domain", { alias: "bd", type: "string" }),
      async (argv: any) => {
        exitCode = await with401RefreshRetry(async () => {
          const base = await requireTokenAndBusinessDomain(argv.bizDomain);
          const templatesDir = getTemplatesDir();

          // Parse --set arguments
          const args: Record<string, string> = {};
          if (argv.set) {
            for (const item of argv.set as string[]) {
              const eqIdx = item.indexOf("=");
              if (eqIdx > 0) {
                const key = item.slice(0, eqIdx);
                const value = item.slice(eqIdx + 1);
                args[key] = value;
              }
            }
          }

          // Load template
          const loaded = await loadTemplate(argv.template, "dataset", templatesDir);
          if (!loaded) {
            console.error(`Template not found: ${argv.template}`);
            return 1;
          }

          // Auto-generate source_identifier if not provided
          if (!args["source_identifier"]) {
            const prefixMap: Record<string, string> = {
              "document": "dataflow_document",
              "document-content": "dataflow_content",
              "document-element": "dataflow_element",
            };
            const prefix = prefixMap[loaded.manifest.name] || "dataflow";
            args["source_identifier"] = generateSourceIdentifier(prefix);
          }

          // Render template
          const rendered = renderTemplate(loaded.template, loaded.manifest, args);

          // Create dataset via API
          const response = await createVegaResource({
            ...base,
            body: JSON.stringify(rendered),
          });

          const result = JSON.parse(response);
          if (argv.json) {
            console.log(JSON.stringify({ success: true, id: result.id, name: args.name }, null, 2));
          } else {
            console.log(`dataset created: id=${result.id}`);
          }
          return 0;
        });
      },
    )
    .command(
      "create-bkn",
      "Create a BKN (knowledge network) from a template",
      (command: any) =>
        command
          .option("template", { type: "string", demandOption: true, describe: "Template name" })
          .option("set", { type: "array", string: true, describe: "Set parameter (key=value), can be used multiple times" })
          .option("json", { type: "boolean", default: false, describe: "Output as JSON" })
          .option("biz-domain", { alias: "bd", type: "string" }),
      async (argv: any) => {
        exitCode = await with401RefreshRetry(async () => {
          const base = await requireTokenAndBusinessDomain(argv.bizDomain);
          const templatesDir = getTemplatesDir();

          // Parse --set arguments
          const args: Record<string, string> = {};
          if (argv.set) {
            for (const item of argv.set as string[]) {
              const eqIdx = item.indexOf("=");
              if (eqIdx > 0) {
                const key = item.slice(0, eqIdx);
                const value = item.slice(eqIdx + 1);
                args[key] = value;
              }
            }
          }

          // Load template
          const loaded = await loadTemplate(argv.template, "bkn", templatesDir);
          if (!loaded) {
            console.error(`Template not found: ${argv.template}`);
            return 1;
          }

          // Render template
          const rendered = renderTemplate(loaded.template, loaded.manifest, args);
          rendered.business_domain = base.businessDomain;

          // Create BKN via API
          const response = await createKnowledgeNetwork({
            ...base,
            body: JSON.stringify(rendered),
            validate_dependency: false,
          });

          const result = JSON.parse(response);
          if (argv.json) {
            console.log(JSON.stringify({ success: true, id: result.id, name: args.name }, null, 2));
          } else {
            console.log(`bkn created: id=${result.id}`);
          }
          return 0;
        });
      },
    )
    .command(
      "create [json]",
      "Create a new dataflow (DAG) from a JSON definition or template",
      (command: any) =>
        command
          .positional("json", {
            type: "string",
            describe: "JSON body string or @file-path to read from file",
          })
          .option("template", { type: "string", describe: "Template name (use instead of json)" })
          .option("set", { type: "array", string: true, describe: "Set parameter (key=value), can be used multiple times" })
          .option("biz-domain", { alias: "bd", type: "string" })
          .check((argv: any) => {
            const hasJson = typeof argv.json === "string";
            const hasTemplate = typeof argv.template === "string";
            if (hasJson && hasTemplate) {
              throw new Error("Cannot use both json and --template");
            }
            if (!hasJson && !hasTemplate) {
              throw new Error("Either json or --template is required");
            }
            return true;
          }),
      async (argv: any) => {
        exitCode = await with401RefreshRetry(async () => {
          const base = await requireTokenAndBusinessDomain(argv.bizDomain);

          let body: DataflowCreateBody;

          if (argv.template) {
            // Use template
            const templatesDir = getTemplatesDir();

            // Parse --set arguments
            const args: Record<string, string> = {};
            if (argv.set) {
              for (const item of argv.set as string[]) {
                const eqIdx = item.indexOf("=");
                if (eqIdx > 0) {
                  const key = item.slice(0, eqIdx);
                  const value = item.slice(eqIdx + 1);
                  args[key] = value;
                }
              }
            }

            const loaded = await loadTemplate(argv.template, "dataflow", templatesDir);
            if (!loaded) {
              console.error(`Template not found: ${argv.template}`);
              return 1;
            }

            body = renderTemplate(loaded.template, loaded.manifest, args) as unknown as DataflowCreateBody;
          } else {
            // Use JSON
            let raw: string = argv.json;
            if (raw.startsWith("@")) {
              const filePath = raw.slice(1);
              await access(filePath, constants.R_OK);
              raw = (await readFile(filePath, "utf8")).toString();
            }
            body = JSON.parse(raw) as DataflowCreateBody;
          }

          const dagId = await createDataflow({ ...base, body });
          console.log(JSON.stringify({ id: dagId }, null, 2));
          return 0;
        });
      },
    )
    .demandCommand(1);

  try {
    await parser.parseAsync();
    return exitCode;
  } catch (error) {
    console.error(formatHttpError(error));
    return 1;
  }
}
