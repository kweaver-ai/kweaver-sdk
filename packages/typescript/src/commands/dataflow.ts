import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
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

function formatDataflowListRow(item: DataflowListItem): string {
  return [
    item.id,
    item.title ?? "",
    item.status ?? "",
    item.trigger ?? "",
    item.creator ?? "",
    item.updated_at ?? "",
    item.version_id ?? "",
  ].join(" ");
}

function formatDataflowRunRow(item: DataflowRunItem): string {
  return [
    item.id,
    item.status ?? "",
    item.started_at ?? "",
    item.ended_at ?? "",
    item.source?.name ?? "",
    item.source?.content_type ?? "",
    item.source?.size ?? "",
    item.reason ?? "",
  ].join(" ");
}

function formatDataflowLogBlock(item: DataflowLogItem): string {
  const duration = item.metadata?.duration ?? "-";
  const summary = `[${item.id}] ${item.status ?? ""} ${item.operator ?? ""} started_at=${item.started_at ?? ""} updated_at=${item.updated_at ?? ""} duration=${duration} taskId=${item.taskId ?? ""}`;
  const input = `input: ${JSON.stringify(item.inputs ?? {})}`;
  const output = `output: ${JSON.stringify(item.outputs ?? {})}`;
  return `${summary}\n${input}\n${output}`;
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
          for (const item of body.dags) {
            console.log(formatDataflowListRow(item));
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
          .option("biz-domain", { alias: "bd", type: "string" }),
      async (argv: any) => {
        exitCode = await with401RefreshRetry(async () => {
          const base = await requireTokenAndBusinessDomain(argv.bizDomain);
          const body = await listDataflowRuns({ ...base, dagId: argv.dagId });
          for (const item of body.results) {
            console.log(formatDataflowRunRow(item));
          }
          return 0;
        });
      },
    )
    .command(
      "logs <dagId> <instanceId>",
      "Fetch paged logs for one run",
      (command: any) =>
        command
          .positional("dagId", { type: "string" })
          .positional("instanceId", { type: "string" })
          .option("biz-domain", { alias: "bd", type: "string" }),
      async (argv: any) => {
        exitCode = await with401RefreshRetry(async () => {
          const base = await requireTokenAndBusinessDomain(argv.bizDomain);
          for (let page = 0; ; page += 1) {
            const body = await getDataflowLogsPage({
              ...base,
              dagId: argv.dagId,
              instanceId: argv.instanceId,
              page,
              limit: 10,
            });
            if (body.results.length === 0) break;
            for (const item of body.results) {
              console.log(formatDataflowLogBlock(item));
              console.log("");
            }
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
