import { ensureValidToken, formatHttpError } from "../auth/oauth.js";
import {
  listMetrics,
  createMetrics,
  searchMetrics,
  validateMetrics,
  getMetric,
  updateMetric,
  deleteMetric,
  getMetrics,
  deleteMetrics,
} from "../api/bkn-metrics.js";
import { metricQueryData, metricDryRun } from "../api/ontology-query-metrics.js";
import { formatCallOutput } from "./call.js";
import { resolveBusinessDomain } from "../config/store.js";
import { parseJsonObject, parseSearchAfterArray, confirmYes } from "./bkn-utils.js";

const METRIC_HELP = `kweaver bkn metric <action> [args] [--pretty] [-bd <domain>]

Management (bkn-backend):
  list <kn-id> [--limit <n>] [--branch <b>] [--name-pattern <p>] [--sort update_time|name] [--direction asc|desc] [--offset <n>] [--tag <t>] [--group-id <id>]
  get <kn-id> <metric-id> [--branch <b>]
  get-batch <kn-id> <metric-ids>   (comma-separated)
  create <kn-id> '<json>'  [--branch] [--strict-mode true|false]
  search <kn-id> '<json>'  [--branch] [--strict-mode] [--limit <n>] [--search-after '<json>']
  validate <kn-id> '<json>'  [--branch] [--strict-mode] [--import-mode normal|ignore|overwrite]
  update <kn-id> <metric-id> '<json>'  [--branch] [--strict-mode]
  delete <kn-id> <metric-id> [-y]
  delete-batch <kn-id> <metric-ids>  [-y]

Query (ontology-query):
  query <kn-id> <metric-id> ['<json-body>']  [--branch] [--fill-null]
  dry-run <kn-id> '<json>'  [--branch] [--fill-null]

  list: default --limit 30. search/query JSON: default limit 50 in body when not set.`;

function parseListArgs(args: string[]): {
  knId: string;
  limit: number;
  pretty: boolean;
  businessDomain: string;
  branch?: string;
  namePattern?: string;
  sort?: "update_time" | "name";
  direction?: "asc" | "desc";
  offset?: number;
  tag?: string;
  groupId?: string;
} {
  let pretty = true;
  let businessDomain = "";
  let limit = 30;
  let branch: string | undefined;
  let namePattern: string | undefined;
  let sort: "update_time" | "name" | undefined;
  let direction: "asc" | "desc" | undefined;
  let offset: number | undefined;
  let tag: string | undefined;
  let groupId: string | undefined;
  const pos: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--help" || a === "-h") throw new Error("help");
    if (a === "--pretty") {
      pretty = true;
      continue;
    }
    if ((a === "-bd" || a === "--biz-domain") && args[i + 1]) {
      businessDomain = args[i + 1];
      i += 1;
      continue;
    }
    if (a === "--limit" && args[i + 1]) {
      const n = parseInt(args[i + 1], 10);
      if (Number.isNaN(n) || n < 1) throw new Error("Invalid --limit");
      limit = n;
      i += 1;
      continue;
    }
    if (a === "--branch" && args[i + 1]) {
      branch = args[i + 1];
      i += 1;
      continue;
    }
    if (a === "--name-pattern" && args[i + 1]) {
      namePattern = args[i + 1];
      i += 1;
      continue;
    }
    if (a === "--sort" && args[i + 1]) {
      const s = args[i + 1];
      if (s !== "update_time" && s !== "name") throw new Error("--sort must be update_time|name");
      sort = s;
      i += 1;
      continue;
    }
    if (a === "--direction" && args[i + 1]) {
      const d = args[i + 1];
      if (d !== "asc" && d !== "desc") throw new Error("--direction must be asc|desc");
      direction = d;
      i += 1;
      continue;
    }
    if (a === "--offset" && args[i + 1]) {
      offset = parseInt(args[i + 1], 10);
      i += 1;
      continue;
    }
    if (a === "--tag" && args[i + 1]) {
      tag = args[i + 1];
      i += 1;
      continue;
    }
    if (a === "--group-id" && args[i + 1]) {
      groupId = args[i + 1];
      i += 1;
      continue;
    }
    pos.push(a);
  }
  if (!businessDomain) businessDomain = resolveBusinessDomain();
  const [knId] = pos;
  if (!knId) throw new Error("Usage: kweaver bkn metric list <kn-id> [options]");
  return {
    knId,
    limit,
    pretty,
    businessDomain,
    branch,
    namePattern,
    sort,
    direction,
    offset,
    tag,
    groupId,
  };
}

function parseCommonKnFlags(
  rest: string[],
  withYes: boolean
): {
  filtered: string[];
  pretty: boolean;
  businessDomain: string;
  branch?: string;
  strictMode?: boolean;
  importMode?: "normal" | "ignore" | "overwrite";
  fillNull?: boolean;
  yes: boolean;
} {
  let pretty = true;
  let businessDomain = "";
  let branch: string | undefined;
  let strictMode: boolean | undefined;
  let importMode: "normal" | "ignore" | "overwrite" | undefined;
  let fillNull: boolean | undefined;
  let yes = false;
  const out: string[] = [];
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === "--help" || a === "-h") throw new Error("help");
    if (a === "--pretty") {
      pretty = true;
      continue;
    }
    if (withYes && (a === "-y" || a === "--yes")) {
      yes = true;
      continue;
    }
    if ((a === "-bd" || a === "--biz-domain") && rest[i + 1]) {
      businessDomain = rest[i + 1];
      i += 1;
      continue;
    }
    if (a === "--branch" && rest[i + 1]) {
      branch = rest[i + 1];
      i += 1;
      continue;
    }
    if (a === "--strict-mode" && rest[i + 1]) {
      strictMode = rest[i + 1] === "true" || rest[i + 1] === "1";
      i += 1;
      continue;
    }
    if (a === "--import-mode" && rest[i + 1]) {
      const m = rest[i + 1] as "normal" | "ignore" | "overwrite";
      if (m !== "normal" && m !== "ignore" && m !== "overwrite") {
        throw new Error("--import-mode must be normal|ignore|overwrite");
      }
      importMode = m;
      i += 1;
      continue;
    }
    if (a === "--fill-null") {
      fillNull = true;
      continue;
    }
    out.push(a);
  }
  if (!businessDomain) businessDomain = resolveBusinessDomain();
  return { filtered: out, pretty, businessDomain, branch, strictMode, importMode, fillNull, yes };
}

export async function runKnMetricCommand(args: string[]): Promise<number> {
  const [action, ...rest] = args;
  if (!action || action === "--help" || action === "-h") {
    console.log(METRIC_HELP);
    return 0;
  }

  try {
    const token = await ensureValidToken();
    const b = { baseUrl: token.baseUrl, accessToken: token.accessToken };

    if (action === "list") {
      const p = parseListArgs(rest);
      const out = await listMetrics({
        ...b,
        knId: p.knId,
        businessDomain: p.businessDomain,
        limit: p.limit,
        branch: p.branch,
        namePattern: p.namePattern,
        sort: p.sort,
        direction: p.direction,
        offset: p.offset,
        tag: p.tag,
        groupId: p.groupId,
      });
      console.log(formatCallOutput(out, p.pretty));
      return 0;
    }

    if (action === "get") {
      const o = parseCommonKnFlags(rest, false);
      const [knId, metricId] = o.filtered;
      if (!knId || !metricId) {
        console.error("Usage: kweaver bkn metric get <kn-id> <metric-id> [options]");
        return 1;
      }
      const out = await getMetric({ ...b, knId, businessDomain: o.businessDomain, metricId, branch: o.branch });
      console.log(formatCallOutput(out, o.pretty));
      return 0;
    }

    if (action === "get-batch") {
      const o = parseCommonKnFlags(rest, false);
      const [knId, metricIds] = o.filtered;
      if (!knId || !metricIds) {
        console.error("Usage: kweaver bkn metric get-batch <kn-id> <comma-separated-ids>");
        return 1;
      }
      const out = await getMetrics({ ...b, knId, businessDomain: o.businessDomain, metricIds, branch: o.branch });
      console.log(formatCallOutput(out, o.pretty));
      return 0;
    }

    if (action === "create") {
      const o = parseCommonKnFlags(rest, false);
      const [knId, bodyJson] = o.filtered;
      if (!knId || !bodyJson) {
        console.error("Usage: kweaver bkn metric create <kn-id> '<json>' [options]");
        return 1;
      }
      const out = await createMetrics({
        ...b,
        knId,
        businessDomain: o.businessDomain,
        body: bodyJson,
        branch: o.branch,
        strictMode: o.strictMode,
      });
      console.log(formatCallOutput(out, o.pretty));
      return 0;
    }

    if (action === "search") {
      let limit: number | undefined;
      let searchAfter: unknown[] | undefined;
      const r: string[] = [];
      for (let i = 0; i < rest.length; i += 1) {
        const a = rest[i];
        if (a === "--limit" && rest[i + 1]) {
          limit = parseInt(rest[i + 1], 10);
          if (Number.isNaN(limit) || limit! < 1) throw new Error("Invalid --limit");
          i += 1;
          continue;
        }
        if (a === "--search-after" && rest[i + 1]) {
          searchAfter = parseSearchAfterArray(rest[i + 1]);
          i += 1;
          continue;
        }
        r.push(a);
      }
      const o = parseCommonKnFlags(r, false);
      const [knId, bodyText] = o.filtered;
      if (!knId || !bodyText) {
        console.error("Usage: kweaver bkn metric search <kn-id> '<json>' [options]");
        return 1;
      }
      const obj = parseJsonObject(bodyText, "search body must be a JSON object.");
      if (limit !== undefined) (obj as Record<string, unknown>).limit = limit;
      if (searchAfter !== undefined) (obj as Record<string, unknown>).search_after = searchAfter;
      if (typeof (obj as { limit?: unknown }).limit !== "number" || !Number.isFinite((obj as { limit: number }).limit)) {
        (obj as { limit: number }).limit = 50;
      }
      const out = await searchMetrics({
        ...b,
        knId,
        businessDomain: o.businessDomain,
        body: JSON.stringify(obj),
        branch: o.branch,
        strictMode: o.strictMode,
      });
      console.log(formatCallOutput(out, o.pretty));
      return 0;
    }

    if (action === "validate") {
      const o = parseCommonKnFlags(rest, false);
      const [knId, bodyJson] = o.filtered;
      if (!knId || !bodyJson) {
        console.error("Usage: kweaver bkn metric validate <kn-id> '<json>' [options]");
        return 1;
      }
      const out = await validateMetrics({
        ...b,
        knId,
        businessDomain: o.businessDomain,
        body: bodyJson,
        branch: o.branch,
        strictMode: o.strictMode,
        importMode: o.importMode,
      });
      console.log(formatCallOutput(out, o.pretty));
      return 0;
    }

    if (action === "update") {
      const o = parseCommonKnFlags(rest, false);
      const [knId, metricId, bodyJson] = o.filtered;
      if (!knId || !metricId || !bodyJson) {
        console.error("Usage: kweaver bkn metric update <kn-id> <metric-id> '<json>' [options]");
        return 1;
      }
      const out = await updateMetric({
        ...b,
        knId,
        businessDomain: o.businessDomain,
        metricId,
        body: bodyJson,
        branch: o.branch,
        strictMode: o.strictMode,
      });
      console.log(formatCallOutput(out, o.pretty));
      return 0;
    }

    if (action === "delete") {
      const o = parseCommonKnFlags(rest, true);
      const [knId, metricId] = o.filtered;
      if (!knId || !metricId) {
        console.error("Usage: kweaver bkn metric delete <kn-id> <metric-id> [-y]");
        return 1;
      }
      if (!o.yes) {
        const ok = await confirmYes(`Delete metric ${metricId}?`);
        if (!ok) {
          console.log("Cancelled.");
          return 0;
        }
      }
      const out = await deleteMetric({ ...b, knId, businessDomain: o.businessDomain, metricId, branch: o.branch });
      console.log(formatCallOutput(out, o.pretty));
      return 0;
    }

    if (action === "delete-batch") {
      const o = parseCommonKnFlags(rest, true);
      const [knId, metricIds] = o.filtered;
      if (!knId || !metricIds) {
        console.error("Usage: kweaver bkn metric delete-batch <kn-id> <comma-separated-ids> [-y]");
        return 1;
      }
      if (!o.yes) {
        const ok = await confirmYes(`Delete metrics ${metricIds}?`);
        if (!ok) {
          console.log("Cancelled.");
          return 0;
        }
      }
      const out = await deleteMetrics({ ...b, knId, businessDomain: o.businessDomain, metricIds, branch: o.branch });
      console.log(formatCallOutput(out, o.pretty));
      return 0;
    }

    if (action === "query") {
      const o = parseCommonKnFlags(rest, false);
      const { fillNull, branch, filtered, pretty, businessDomain } = o;
      const [knId, metricId, bodyText = "{}"] = filtered;
      if (!knId || !metricId) {
        console.error("Usage: kweaver bkn metric query <kn-id> <metric-id> ['<json>'] [--branch] [--fill-null]");
        return 1;
      }
      const body = parseJsonObject(bodyText, "metric query body must be a JSON object.");
      if (typeof (body as { limit?: unknown }).limit !== "number" || !Number.isFinite((body as { limit: number }).limit)) {
        (body as { limit: number }).limit = 50;
      }
      const out = await metricQueryData({
        ...b,
        knId,
        businessDomain,
        metricId,
        body: JSON.stringify(body),
        branch,
        fillNull,
      });
      console.log(formatCallOutput(out, pretty));
      return 0;
    }

    if (action === "dry-run") {
      const o = parseCommonKnFlags(rest, false);
      const { fillNull, branch, filtered, pretty, businessDomain } = o;
      const [knId, bodyText] = filtered;
      if (!knId || !bodyText) {
        console.error("Usage: kweaver bkn metric dry-run <kn-id> '<json>' [--branch] [--fill-null]");
        return 1;
      }
      parseJsonObject(bodyText, "dry-run body must be a JSON object.");
      const out = await metricDryRun({
        ...b,
        knId,
        businessDomain,
        body: bodyText,
        branch,
        fillNull,
      });
      console.log(formatCallOutput(out, pretty));
      return 0;
    }

    console.error(`Unknown bkn metric action: ${action}. Use --help.`);
    return 1;
  } catch (error) {
    if (error instanceof Error && error.message === "help") {
      console.log(METRIC_HELP);
      return 0;
    }
    console.error(formatHttpError(error));
    return 1;
  }
}
