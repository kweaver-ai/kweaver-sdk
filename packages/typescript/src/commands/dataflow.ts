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
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const start = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), 0, 0, 0);
  const end = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), 23, 59, 59);
  return {
    startTime: Math.floor(start.getTime() / 1000),
    endTime: Math.floor(end.getTime() / 1000),
  };
}

function formatDataflowLogSummary(item: DataflowLogItem): string {
  const duration = item.metadata?.duration ?? "-";
  return [
    `commit ${item.id}`,
    `Author: ${item.operator ?? ""}`,
    `Status: ${item.status ?? ""}`,
    `Started At: ${item.started_at ?? ""}`,
    `Updated At: ${item.updated_at ?? ""}`,
    `Duration: ${duration}`,
    `Task ID: ${item.taskId ?? ""}`,
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
        command.option("biz-domain", {
          alias: "bd",
          type: "string",
        }),
      async (argv: any) => {
        exitCode = await with401RefreshRetry(async () => {
          const base = await requireTokenAndBusinessDomain(argv.bizDomain);
          const body = await listDataflows(base);
          const table = renderTable(buildListTableRows(body.dags));
          if (table) {
            console.log(table);
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
            if (total > 20) {
              const second = await listDataflowRuns({
                ...base,
                dagId: argv.dagId,
                page: 1,
                limit: total - 20,
                sortBy: "started_at",
                order: "desc",
                startTime: dayRange.startTime,
                endTime: dayRange.endTime,
              });
              results = results.concat(second.results);
            }
          }

          const table = renderTable(buildRunTableRows(results));
          if (table) {
            console.log(table);
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
          const body = await getDataflowLogsPage({
            ...base,
            dagId: argv.dagId,
            instanceId: argv.instanceId,
            page: 0,
            limit: -1,
          });
          for (const item of body.results) {
            console.log(formatDataflowLogOutput(item, argv.detail === true));
            console.log("");
          }
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
