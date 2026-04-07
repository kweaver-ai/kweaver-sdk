import { ensureValidToken, formatHttpError } from "../auth/oauth.js";
import {
  listConceptGroups, getConceptGroup, createConceptGroup, updateConceptGroup,
  deleteConceptGroup, addConceptGroupMembers, removeConceptGroupMembers,
} from "../api/bkn-backend.js";
import {
  listObjectTypes,
  getObjectType,
  createObjectTypes,
  updateObjectType,
  deleteObjectTypes,
  listRelationTypes,
  getRelationType,
  createRelationTypes,
  updateRelationType,
  deleteRelationTypes,
  listActionTypes,
  getActionType,
  createActionTypes,
  updateActionType,
  deleteActionTypes,
} from "../api/knowledge-networks.js";
import {
  objectTypeQuery,
  objectTypeProperties,
  actionTypeQuery,
  actionTypeExecute,
  actionExecutionGet,
} from "../api/ontology-query.js";
import { getDataView } from "../api/dataviews.js";
import type { ViewField } from "../api/dataviews.js";
import { formatCallOutput } from "./call.js";
import { resolveBusinessDomain } from "../config/store.js";
import {
  parseOntologyQueryFlags,
  parseJsonObject,
  parseSearchAfterArray,
  confirmYes,
  pollWithBackoff,
} from "./bkn-utils.js";

// ── Object-type query options ──────────────────────────────────────────────────

export interface KnObjectTypeQueryOptions {
  knId: string;
  otId: string;
  body: string;
  pretty: boolean;
  businessDomain: string;
}

const MAX_OUTPUT_BYTES = 100_000;

/**
 * If a query response exceeds MAX_OUTPUT_BYTES, trim the datas array
 * to fit, preserving valid JSON and the search_after cursor for pagination.
 */
function truncateQueryResult(raw: string): string {
  if (raw.length <= MAX_OUTPUT_BYTES) {
    return raw;
  }

  let parsed: { datas?: unknown[]; search_after?: unknown; [k: string]: unknown };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    return raw;
  }

  const datas = parsed.datas;
  if (!Array.isArray(datas) || datas.length === 0) {
    return raw;
  }

  const originalCount = datas.length;
  while (datas.length > 1) {
    datas.pop();
    const candidate = JSON.stringify(parsed);
    if (candidate.length <= MAX_OUTPUT_BYTES) {
      const remaining = originalCount - datas.length;
      const sa = parsed.search_after;
      parsed._truncated = {
        returned: datas.length,
        total_fetched: originalCount,
        remaining,
        next_search_after: sa ?? null,
        hint: sa
          ? `Pass --search-after '${JSON.stringify(sa)}' --limit ${datas.length} to fetch the next page.`
          : `Reduce --limit to ${datas.length} or less to avoid truncation.`,
      };
      console.error(
        `[warn] Truncated ${originalCount} → ${datas.length} records (output exceeded ${Math.round(MAX_OUTPUT_BYTES / 1024)}KB). ${(parsed._truncated as { hint: string }).hint}`
      );
      return JSON.stringify(parsed);
    }
  }

  const sa = parsed.search_after;
  parsed._truncated = {
    returned: 1,
    total_fetched: originalCount,
    remaining: originalCount - 1,
    next_search_after: sa ?? null,
    hint: `Single record is very large. Use --limit 1 and --search-after to iterate.`,
  };
  console.error(
    `[warn] Truncated ${originalCount} → 1 record. Single record is very large. Use --limit 1 and --search-after to iterate.`
  );
  return JSON.stringify(parsed);
}

export function parseKnObjectTypeQueryArgs(args: string[]): KnObjectTypeQueryOptions {
  let pretty = true;
  let businessDomain = "";
  let limit: number | undefined;
  let searchAfter: unknown[] | undefined;
  const positionalArgs: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      throw new Error("help");
    }

    if (arg === "--pretty") {
      pretty = true;
      continue;
    }

    if (arg === "-bd" || arg === "--biz-domain") {
      businessDomain = args[i + 1] ?? "bd_public";
      if (!businessDomain || businessDomain.startsWith("-")) {
        throw new Error("Missing value for biz-domain flag");
      }
      i += 1;
      continue;
    }

    if (arg === "--limit") {
      const rawLimit = args[i + 1];
      const parsedLimit = parseInt(rawLimit ?? "", 10);
      if (!rawLimit || rawLimit.startsWith("-") || Number.isNaN(parsedLimit) || parsedLimit < 1) {
        throw new Error("Invalid value for --limit. Expected a positive integer.");
      }
      limit = parsedLimit;
      i += 1;
      continue;
    }

    if (arg === "--search-after") {
      const rawSearchAfter = args[i + 1];
      if (!rawSearchAfter) {
        throw new Error("Missing value for --search-after. Expected a JSON array string.");
      }
      searchAfter = parseSearchAfterArray(rawSearchAfter);
      i += 1;
      continue;
    }

    positionalArgs.push(arg);
  }

  const [knId, otId, bodyText = "{}"] = positionalArgs;
  if (!knId || !otId) {
    throw new Error(
      "Usage: kweaver bkn object-type query <kn-id> <ot-id> ['<json>'] [--limit <n>] [--search-after '<json-array>'] [--pretty] [-bd value]"
    );
  }
  if (positionalArgs.length > 3) {
    throw new Error(
      "Usage: kweaver bkn object-type query <kn-id> <ot-id> ['<json>'] [--limit <n>] [--search-after '<json-array>'] [--pretty] [-bd value]"
    );
  }

  const body = parseJsonObject(bodyText, "object-type query body must be a JSON object.");
  if (limit !== undefined) {
    body.limit = limit;
  }
  if (searchAfter !== undefined) {
    body.search_after = searchAfter;
  }
  if (typeof body.limit !== "number" || !Number.isFinite(body.limit) || body.limit < 1) {
    body.limit = 50;
  }

  if (!businessDomain) businessDomain = resolveBusinessDomain();
  return {
    knId,
    otId,
    body: JSON.stringify(body),
    pretty,
    businessDomain,
  };
}

// ── Object-type create/update/delete ───────────────────────────────────────────

/** Map database / dataview field types to ADP-accepted types (aligned with Python SDK). */
const ADP_FIELD_TYPE_MAP: Record<string, string> = {
  varchar: "string",
  char: "string",
  nvarchar: "string",
  longtext: "text",
  mediumtext: "text",
  tinytext: "text",
  bigint: "integer",
  int: "integer",
  smallint: "integer",
  tinyint: "integer",
  double: "float",
  real: "float",
  numeric: "decimal",
  number: "decimal",
  blob: "binary",
  longblob: "binary",
  bit: "boolean",
  bool: "boolean",
};

export function normalizeAdpFieldType(raw: string | undefined): string {
  if (!raw) return "string";
  const lower = raw.toLowerCase().trim();
  return ADP_FIELD_TYPE_MAP[lower] ?? lower;
}

/**
 * Ensure each data_property has mapped_field (same-name mapping) for build engine compatibility.
 */
export function ensureMappedFieldOnDataProperty(prop: Record<string, unknown>): Record<string, unknown> {
  const name = String(prop.name ?? "");
  const ptype = normalizeAdpFieldType(prop.type != null ? String(prop.type) : undefined);
  const display = String(prop.display_name ?? name);
  const existing = prop.mapped_field;
  if (existing && typeof existing === "object" && !Array.isArray(existing)) {
    const mf = existing as Record<string, unknown>;
    const mfName = String(mf.name ?? name);
    const mfType = normalizeAdpFieldType(mf.type != null ? String(mf.type) : undefined) || ptype;
    const mfDisplay = String(mf.display_name ?? display);
    return {
      ...prop,
      type: ptype,
      mapped_field: { name: mfName, type: mfType, display_name: mfDisplay },
    };
  }
  return {
    ...prop,
    type: ptype,
    mapped_field: { name, type: ptype, display_name: display },
  };
}

function dataPropertiesFromViewFields(fields: ViewField[]): Record<string, unknown>[] {
  return fields.map((f) => {
    const t = normalizeAdpFieldType(f.type);
    const display = f.display_name?.trim() || f.name;
    return {
      name: f.name,
      display_name: display,
      type: t,
      mapped_field: { name: f.name, type: t, display_name: display },
    };
  });
}

function fallbackDataPropertiesFromKeys(primaryKeys: string[], displayKey: string): Record<string, unknown>[] {
  const names = [...new Set([...primaryKeys, displayKey])];
  return names.map((n) => {
    const t = "string";
    return {
      name: n,
      display_name: n,
      type: t,
      mapped_field: { name: n, type: t, display_name: n },
    };
  });
}

/** Result of parsing `object-type create`; may require async dataview GET to fill properties. */
export type ObjectTypeCreateParsed =
  | {
      mode: "complete";
      knId: string;
      body: string;
      businessDomain: string;
      branch: string;
      pretty: boolean;
    }
  | {
      mode: "needsDataview";
      knId: string;
      dataviewId: string;
      entry: Record<string, unknown>;
      businessDomain: string;
      branch: string;
      pretty: boolean;
    };

/** Parse object-type create args: --name --dataview-id --primary-key --display-key [--property '<json>' ...] */
export function parseObjectTypeCreateArgs(args: string[]): ObjectTypeCreateParsed {
  let name = "";
  let dataviewId = "";
  let primaryKey = "";
  let displayKey = "";
  let businessDomain = "";
  let branch = "main";
  let pretty = true;
  const properties: string[] = [];
  const positional: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") throw new Error("help");
    if (arg === "--name" && args[i + 1]) {
      name = args[++i];
      continue;
    }
    if (arg === "--dataview-id" && args[i + 1]) {
      dataviewId = args[++i];
      continue;
    }
    if (arg === "--primary-key" && args[i + 1]) {
      primaryKey = args[++i];
      continue;
    }
    if (arg === "--display-key" && args[i + 1]) {
      displayKey = args[++i];
      continue;
    }
    if (arg === "--property" && args[i + 1]) {
      properties.push(args[++i]);
      continue;
    }
    if ((arg === "-bd" || arg === "--biz-domain") && args[i + 1]) {
      businessDomain = args[++i];
      continue;
    }
    if (arg === "--branch" && args[i + 1]) {
      branch = args[++i];
      continue;
    }
    if (arg === "--pretty") {
      pretty = true;
      continue;
    }
    if (!arg.startsWith("-")) positional.push(arg);
  }

  const knId = positional[0];
  if (!knId || !name || !dataviewId || !primaryKey || !displayKey) {
    throw new Error(
      "Usage: kweaver bkn object-type create <kn-id> --name X --dataview-id Y --primary-key Z --display-key W"
    );
  }

  const entry: Record<string, unknown> = {
    branch,
    name,
    data_source: { type: "data_view", id: dataviewId },
    primary_keys: [primaryKey],
    display_key: displayKey,
  };
  if (properties.length > 0) {
    const raw = properties.map((p) => JSON.parse(p) as Record<string, unknown>);
    entry.data_properties = raw.map((row) => ensureMappedFieldOnDataProperty(row));
    const body = JSON.stringify({ entries: [entry] });
    if (!businessDomain) businessDomain = resolveBusinessDomain();
    return { mode: "complete", knId, body, businessDomain, branch, pretty };
  }

  if (!businessDomain) businessDomain = resolveBusinessDomain();
  return {
    mode: "needsDataview",
    knId,
    dataviewId,
    entry,
    businessDomain,
    branch,
    pretty,
  };
}

/**
 * Load dataview fields and build data_properties (with mapped_field). Used when no --property flags.
 */
export async function finalizeObjectTypeCreateFromDataview(options: {
  baseUrl: string;
  accessToken: string;
  dataviewId: string;
  entry: Record<string, unknown>;
  businessDomain: string;
}): Promise<string> {
  const { baseUrl, accessToken, dataviewId, entry, businessDomain } = options;
  const dv = await getDataView({
    baseUrl,
    accessToken,
    id: dataviewId,
    businessDomain,
  });
  const fields = dv.fields ?? [];
  const primaryKeys = Array.isArray(entry.primary_keys)
    ? (entry.primary_keys as string[])
    : [];
  const displayKey = String(entry.display_key ?? "");
  const next = { ...entry };
  next.data_properties =
    fields.length > 0
      ? dataPropertiesFromViewFields(fields)
      : fallbackDataPropertiesFromKeys(primaryKeys, displayKey);
  return JSON.stringify({ entries: [next] });
}

/** Fields merged via GET → modify → PUT (not raw body mode). */
export interface ObjectTypeMergeFields {
  name?: string;
  displayKey?: string;
  addProperties: Record<string, unknown>[];
  removeProperties: string[];
  tags?: string[];
  comment?: string;
  icon?: string;
  color?: string;
}

export type ObjectTypeUpdateParsed =
  | {
      mode: "body";
      knId: string;
      otId: string;
      body: string;
      businessDomain: string;
      pretty: boolean;
    }
  | {
      mode: "merge";
      knId: string;
      otId: string;
      merge: ObjectTypeMergeFields;
      businessDomain: string;
      pretty: boolean;
      branch: string;
    };

const OBJECT_TYPE_PUT_STRIP_KEYS = new Set([
  "status",
  "creator",
  "updater",
  "create_time",
  "update_time",
  "module_type",
  "kn_id",
]);

/** Prepare a GET response entry for PUT (drop read-only fields). */
export function stripObjectTypeForPut(entry: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...entry };
  for (const k of OBJECT_TYPE_PUT_STRIP_KEYS) {
    delete out[k];
  }
  return out;
}

/**
 * Apply merge flags onto a stripped object-type object (mutates copy).
 * - Add: property `name` not in list → append.
 * - Update: property `name` exists → replace entry (same as add; CLI also accepts `--update-property`).
 * - Delete: `--remove-property` removes by `name` before adds are applied.
 */
export function applyObjectTypeMerge(
  target: Record<string, unknown>,
  merge: ObjectTypeMergeFields,
): Record<string, unknown> {
  if (merge.name !== undefined) target.name = merge.name;
  if (merge.displayKey !== undefined) target.display_key = merge.displayKey;
  if (merge.comment !== undefined) target.comment = merge.comment;
  if (merge.icon !== undefined) target.icon = merge.icon;
  if (merge.color !== undefined) target.color = merge.color;
  if (merge.tags !== undefined) target.tags = merge.tags;

  let props = target.data_properties;
  if (!Array.isArray(props)) {
    props = [];
  } else {
    props = props.map((p) =>
      p && typeof p === "object" && !Array.isArray(p) ? { ...(p as Record<string, unknown>) } : p,
    );
  }
  const list = props as Record<string, unknown>[];
  for (const rm of merge.removeProperties) {
    for (let j = list.length - 1; j >= 0; j -= 1) {
      const n = list[j]?.name;
      if (typeof n === "string" && n === rm) list.splice(j, 1);
    }
  }
  for (const add of merge.addProperties) {
    const nm = add.name;
    if (typeof nm !== "string" || !nm) {
      throw new Error(
        "--add-property / --update-property JSON must include a non-empty string \"name\" field.",
      );
    }
    const idx = list.findIndex((p) => p?.name === nm);
    if (idx >= 0) list[idx] = add;
    else list.push(add);
  }
  target.data_properties = list;
  return target;
}

/** Parse object-type update: raw JSON body OR merge flags (GET-merge-PUT). */
export function parseObjectTypeUpdateArgs(args: string[]): ObjectTypeUpdateParsed {
  let name: string | undefined;
  let displayKey: string | undefined;
  let businessDomain = "";
  let pretty = true;
  let branch = "main";
  let comment: string | undefined;
  let icon: string | undefined;
  let color: string | undefined;
  let tagsJson: string | undefined;
  const addProperties: Record<string, unknown>[] = [];
  const removeProperties: string[] = [];
  const positional: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") throw new Error("help");
    if (arg === "--name" && args[i + 1]) {
      name = args[++i];
      continue;
    }
    if (arg === "--display-key" && args[i + 1]) {
      displayKey = args[++i];
      continue;
    }
    if ((arg === "--add-property" || arg === "--update-property") && args[i + 1]) {
      const raw = args[++i];
      addProperties.push(
        parseJsonObject(raw, `--add-property / --update-property must be valid JSON object: ${raw}`),
      );
      continue;
    }
    if (arg === "--remove-property" && args[i + 1]) {
      removeProperties.push(args[++i]);
      continue;
    }
    if (arg === "--tags" && args[i + 1]) {
      tagsJson = args[++i];
      continue;
    }
    if (arg === "--comment" && args[i + 1]) {
      comment = args[++i];
      continue;
    }
    if (arg === "--icon" && args[i + 1]) {
      icon = args[++i];
      continue;
    }
    if (arg === "--color" && args[i + 1]) {
      color = args[++i];
      continue;
    }
    if (arg === "--branch" && args[i + 1]) {
      branch = args[++i];
      continue;
    }
    if ((arg === "-bd" || arg === "--biz-domain") && args[i + 1]) {
      businessDomain = args[++i];
      continue;
    }
    if (arg === "--pretty") {
      pretty = true;
      continue;
    }
    if (!arg.startsWith("-")) positional.push(arg);
  }

  const [knId, otId, maybeBody] = positional;
  if (!knId || !otId) {
    throw new Error(
      "Usage: kweaver bkn object-type update <kn-id> <ot-id> [ '<full-json-body>' ] [--name ...] [--add-property|--update-property '<json>' ...] [--remove-property <name> ...]",
    );
  }

  const hasMergeFlags =
    name !== undefined ||
    displayKey !== undefined ||
    addProperties.length > 0 ||
    removeProperties.length > 0 ||
    tagsJson !== undefined ||
    comment !== undefined ||
    icon !== undefined ||
    color !== undefined;

  if (maybeBody !== undefined && maybeBody.trim().startsWith("{")) {
    if (hasMergeFlags) {
      throw new Error(
        "Do not combine a raw JSON body with --name/--add-property/--update-property/--remove-property and other merge flags.",
      );
    }
    if (!businessDomain) businessDomain = resolveBusinessDomain();
    return {
      mode: "body",
      knId,
      otId,
      body: maybeBody.trim(),
      businessDomain,
      pretty,
    };
  }

  if (maybeBody !== undefined) {
    throw new Error(
      `Unexpected third argument "${maybeBody}". For raw PUT body, pass a single JSON object starting with "{".`,
    );
  }

  let tags: string[] | undefined;
  if (tagsJson !== undefined) {
    try {
      const t = JSON.parse(tagsJson) as unknown;
      if (!Array.isArray(t) || !t.every((x) => typeof x === "string")) {
        throw new Error("invalid");
      }
      tags = t;
    } catch {
      throw new Error(`--tags must be a JSON array of strings, e.g. '["足球","球员"]'`);
    }
  }

  const merge: ObjectTypeMergeFields = {
    addProperties,
    removeProperties,
    ...(name !== undefined ? { name } : {}),
    ...(displayKey !== undefined ? { displayKey } : {}),
    ...(tags !== undefined ? { tags } : {}),
    ...(comment !== undefined ? { comment } : {}),
    ...(icon !== undefined ? { icon } : {}),
    ...(color !== undefined ? { color } : {}),
  };

  if (
    merge.name === undefined &&
    merge.displayKey === undefined &&
    merge.addProperties.length === 0 &&
    merge.removeProperties.length === 0 &&
    merge.tags === undefined &&
    merge.comment === undefined &&
    merge.icon === undefined &&
    merge.color === undefined
  ) {
    throw new Error(
      "No update fields. Use --name, --display-key, --add-property (new), --update-property (same as add; replaces by name), --remove-property, --tags, --comment, --icon, --color, or pass a full JSON object as the third argument.",
    );
  }

  if (!businessDomain) businessDomain = resolveBusinessDomain();
  return { mode: "merge", knId, otId, merge, businessDomain, pretty, branch };
}

/** Parse object-type delete args: <kn-id> <ot-ids> [-y] */
export function parseObjectTypeDeleteArgs(args: string[]): {
  knId: string;
  otIds: string;
  businessDomain: string;
  yes: boolean;
} {
  let businessDomain = "";
  let yes = false;
  const positional: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") throw new Error("help");
    if (arg === "--yes" || arg === "-y") {
      yes = true;
      continue;
    }
    if ((arg === "-bd" || arg === "--biz-domain") && args[i + 1]) {
      businessDomain = args[++i];
      continue;
    }
    if (!arg.startsWith("-")) positional.push(arg);
  }

  const [knId, otIds] = positional;
  if (!knId || !otIds) {
    throw new Error("Usage: kweaver bkn object-type delete <kn-id> <ot-ids> [-y]");
  }
  if (!businessDomain) businessDomain = resolveBusinessDomain();
  return { knId, otIds, businessDomain, yes };
}

// ── Action-type execute ────────────────────────────────────────────────────────

export interface KnActionTypeExecuteOptions {
  knId: string;
  atId: string;
  body: string;
  pretty: boolean;
  businessDomain: string;
  wait: boolean;
  timeout: number;
}

export function parseKnActionTypeExecuteArgs(args: string[]): KnActionTypeExecuteOptions {
  let pretty = true;
  let businessDomain = "";
  let wait = true;
  let timeout = 300;
  const positional: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      throw new Error("help");
    }
    if (arg === "--pretty") {
      pretty = true;
      continue;
    }
    if ((arg === "-bd" || arg === "--biz-domain") && args[i + 1]) {
      businessDomain = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--wait") {
      wait = true;
      continue;
    }
    if (arg === "--no-wait") {
      wait = false;
      continue;
    }
    if (arg === "--timeout" && args[i + 1]) {
      timeout = parseInt(args[i + 1], 10);
      if (Number.isNaN(timeout) || timeout < 1) timeout = 300;
      i += 1;
      continue;
    }
    positional.push(arg);
  }

  const [knId, atId, body] = positional;
  if (!knId || !atId || !body) {
    throw new Error("Missing kn-id, at-id, or body. Usage: kweaver bkn action-type execute <kn-id> <at-id> '<json>' [options]");
  }

  if (!businessDomain) businessDomain = resolveBusinessDomain();
  return {
    knId,
    atId,
    body,
    pretty,
    businessDomain,
    wait,
    timeout,
  };
}

// ── Action-type execute helpers ────────────────────────────────────────────────

const TERMINAL_STATUSES = ["SUCCESS", "FAILED", "CANCELLED"];

function extractExecutionId(body: string): string | null {
  try {
    const data = JSON.parse(body) as Record<string, unknown>;
    const id = data.execution_id ?? data.id;
    return typeof id === "string" ? id : null;
  } catch {
    return null;
  }
}

function extractStatus(body: string): string {
  try {
    const data = JSON.parse(body) as Record<string, unknown>;
    const status = data.status;
    return typeof status === "string" ? status : "";
  } catch {
    return "";
  }
}

// ── Relation-type create/update/delete ─────────────────────────────────────────

/** Parse relation-type create args: --name --source --target [--mapping src:tgt ...] */
export function parseRelationTypeCreateArgs(args: string[]): {
  knId: string;
  body: string;
  businessDomain: string;
  branch: string;
  pretty: boolean;
} {
  let name = "";
  let source = "";
  let target = "";
  let businessDomain = "";
  let branch = "main";
  let pretty = true;
  const mappings: Array<[string, string]> = [];
  const positional: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") throw new Error("help");
    if (arg === "--name" && args[i + 1]) {
      name = args[++i];
      continue;
    }
    if (arg === "--source" && args[i + 1]) {
      source = args[++i];
      continue;
    }
    if (arg === "--target" && args[i + 1]) {
      target = args[++i];
      continue;
    }
    if (arg === "--mapping" && args[i + 1]) {
      const m = args[++i];
      if (!m.includes(":")) {
        throw new Error(`Invalid mapping format '${m}'. Expected source_prop:target_prop.`);
      }
      const [s, t] = m.split(":", 2);
      mappings.push([s, t]);
      continue;
    }
    if ((arg === "-bd" || arg === "--biz-domain") && args[i + 1]) {
      businessDomain = args[++i];
      continue;
    }
    if (arg === "--branch" && args[i + 1]) {
      branch = args[++i];
      continue;
    }
    if (arg === "--pretty") {
      pretty = true;
      continue;
    }
    if (!arg.startsWith("-")) positional.push(arg);
  }

  const knId = positional[0];
  if (!knId || !name || !source || !target) {
    throw new Error(
      "Usage: kweaver bkn relation-type create <kn-id> --name X --source <ot-id> --target <ot-id> [--mapping src:tgt ...]"
    );
  }

  const entry: Record<string, unknown> = {
    branch,
    name,
    source_object_type_id: source,
    target_object_type_id: target,
    type: "direct",
    mapping_rules: mappings.map(([s, t]) => ({
      source_property: { name: s },
      target_property: { name: t },
    })),
  };
  const body = JSON.stringify({ entries: [entry] });

  if (!businessDomain) businessDomain = resolveBusinessDomain();
  return { knId, body, businessDomain, branch, pretty };
}

/** Parse relation-type update args: --source and --target are required by the API */
export function parseRelationTypeUpdateArgs(args: string[]): {
  knId: string;
  rtId: string;
  body: string;
  businessDomain: string;
  pretty: boolean;
} {
  let name: string | undefined;
  let source: string | undefined;
  let target: string | undefined;
  let type: string | undefined;
  const mappings: [string, string][] = [];
  let businessDomain = "";
  let pretty = true;
  const positional: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") throw new Error("help");
    if (arg === "--name" && args[i + 1]) {
      name = args[++i];
      continue;
    }
    if (arg === "--source" && args[i + 1]) {
      source = args[++i];
      continue;
    }
    if (arg === "--target" && args[i + 1]) {
      target = args[++i];
      continue;
    }
    if (arg === "--type" && args[i + 1]) {
      type = args[++i];
      continue;
    }
    if (arg === "--mapping" && args[i + 1]) {
      const m = args[++i];
      if (!m.includes(":")) {
        throw new Error(`Invalid mapping format '${m}'. Expected source_prop:target_prop.`);
      }
      const [s, t] = m.split(":", 2);
      mappings.push([s, t]);
      continue;
    }
    if ((arg === "-bd" || arg === "--biz-domain") && args[i + 1]) {
      businessDomain = args[++i];
      continue;
    }
    if (arg === "--pretty") {
      pretty = true;
      continue;
    }
    if (!arg.startsWith("-")) positional.push(arg);
  }

  const [knId, rtId] = positional;
  if (!knId || !rtId) {
    throw new Error("Usage: kweaver bkn relation-type update <kn-id> <rt-id> --source <ot-id> --target <ot-id> [--name X] [--type direct|data_view] [--mapping src:tgt ...] [--type direct|data_view] [--mapping src:tgt ...]");
  }
  if (!source || !target) {
    throw new Error("--source and --target are required for relation-type update (API requires source_object_type_id and target_object_type_id).");
  }
  const body: Record<string, unknown> = {
    source_object_type_id: source,
    target_object_type_id: target,
    type: type || "direct",
    mapping_rules: mappings.map(([s, t]) => ({
      source_property: { name: s },
      target_property: { name: t },
    })),
  };
  if (name !== undefined) body.name = name;
  if (!businessDomain) businessDomain = resolveBusinessDomain();
  return { knId, rtId, body: JSON.stringify(body), businessDomain, pretty };
}

/** Parse relation-type delete args: <kn-id> <rt-ids> [-y] */
export function parseRelationTypeDeleteArgs(args: string[]): {
  knId: string;
  rtIds: string;
  businessDomain: string;
  yes: boolean;
} {
  let businessDomain = "";
  let yes = false;
  const positional: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") throw new Error("help");
    if (arg === "--yes" || arg === "-y") {
      yes = true;
      continue;
    }
    if ((arg === "-bd" || arg === "--biz-domain") && args[i + 1]) {
      businessDomain = args[++i];
      continue;
    }
    if (!arg.startsWith("-")) positional.push(arg);
  }

  const [knId, rtIds] = positional;
  if (!knId || !rtIds) {
    throw new Error("Usage: kweaver bkn relation-type delete <kn-id> <rt-ids> [-y]");
  }
  if (!businessDomain) businessDomain = resolveBusinessDomain();
  return { knId, rtIds, businessDomain, yes };
}

// ── Command handlers ───────────────────────────────────────────────────────────

export async function runKnObjectTypeCommand(args: string[]): Promise<number> {
  const [action, ...rest] = args;
  if (!action || action === "--help" || action === "-h") {
    console.log(`kweaver bkn object-type list <kn-id> [--pretty] [-bd value]
kweaver bkn object-type get <kn-id> <ot-id> [--pretty] [-bd value]
kweaver bkn object-type create <kn-id> --name X --dataview-id Y --primary-key Z --display-key W [--property '<json>' ...]
kweaver bkn object-type update <kn-id> <ot-id> [--name X] [--display-key Y] [--add-property|--update-property '<json>' ...] [--remove-property N ...] [--tags '["a","b"]'] [--comment S] [--icon I] [--color C] [--branch main]
  kweaver bkn object-type update <kn-id> <ot-id> '<full-json-body>'
kweaver bkn object-type delete <kn-id> <ot-ids> [-y]
kweaver bkn object-type query <kn-id> <ot-id> ['<json>'] [--limit <n>] [--search-after '<json-array>'] [--pretty] [-bd value]
kweaver bkn object-type properties <kn-id> <ot-id> '<json>' [--pretty] [-bd value]

list: List object types (schema) from ontology-manager.
get: Get single object type details.
create/update/delete: Schema CRUD (create requires dataview-id). update: merge flags (--add-property / --update-property / --remove-property, etc.) GET-merge-PUT; or full JSON as third arg.
query: Query via ontology-query API. Default limit is 50 if not specified. Use --search-after for pagination.
properties: Query instance properties by primary key.

properties JSON format: {"_instance_identities":[{"<primary-key>":"<value>"}],"properties":["prop1","prop2"]}`);
    return 0;
  }

  try {
    if (action === "get") {
      const parsed = parseOntologyQueryFlags(rest);
      const [knId, otId] = parsed.filteredArgs;
      if (!knId || !otId) {
        console.error("Usage: kweaver bkn object-type get <kn-id> <ot-id> [options]");
        return 1;
      }
      const token = await ensureValidToken();
      const body = await getObjectType({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        knId,
        otId,
        businessDomain: parsed.businessDomain,
      });
      console.log(formatCallOutput(body, parsed.pretty));
      return 0;
    }

    if (action === "create") {
      const opts = parseObjectTypeCreateArgs(rest);
      const token = await ensureValidToken();
      let bodyStr: string;
      if (opts.mode === "needsDataview") {
        try {
          bodyStr = await finalizeObjectTypeCreateFromDataview({
            baseUrl: token.baseUrl,
            accessToken: token.accessToken,
            dataviewId: opts.dataviewId,
            entry: opts.entry,
            businessDomain: opts.businessDomain,
          });
        } catch (e) {
          console.error(formatHttpError(e));
          return 1;
        }
      } else {
        bodyStr = opts.body;
      }
      const body = await createObjectTypes({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        knId: opts.knId,
        body: bodyStr,
        businessDomain: opts.businessDomain,
        branch: opts.branch,
      });
      console.log(formatCallOutput(body, opts.pretty));
      return 0;
    }

    if (action === "update") {
      const opts = parseObjectTypeUpdateArgs(rest);
      const token = await ensureValidToken();
      let putBody: string;
      if (opts.mode === "body") {
        putBody = opts.body;
      } else {
        const raw = await getObjectType({
          baseUrl: token.baseUrl,
          accessToken: token.accessToken,
          knId: opts.knId,
          otId: opts.otId,
          businessDomain: opts.businessDomain,
          branch: opts.branch,
        });
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const entryUnknown = parsed.entries;
        const entry =
          Array.isArray(entryUnknown) && entryUnknown.length > 0 && entryUnknown[0] && typeof entryUnknown[0] === "object"
            ? (entryUnknown[0] as Record<string, unknown>)
            : parsed;
        if (!entry || typeof entry !== "object") {
          throw new Error("Unexpected object-type GET response shape.");
        }
        const stripped = stripObjectTypeForPut(entry);
        applyObjectTypeMerge(stripped, opts.merge);
        putBody = JSON.stringify(stripped);
      }
      const body = await updateObjectType({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        knId: opts.knId,
        otId: opts.otId,
        body: putBody,
        businessDomain: opts.businessDomain,
      });
      console.log(formatCallOutput(body, opts.pretty));
      return 0;
    }

    if (action === "delete") {
      const opts = parseObjectTypeDeleteArgs(rest);
      if (!opts.yes) {
        const confirmed = await confirmYes(`Delete object type(s) ${opts.otIds}?`);
        if (!confirmed) {
          console.error("Aborted.");
          return 1;
        }
      }
      const token = await ensureValidToken();
      await deleteObjectTypes({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        knId: opts.knId,
        otIds: opts.otIds,
        businessDomain: opts.businessDomain,
      });
      console.log(`Deleted ${opts.otIds}`);
      return 0;
    }

    if (action === "list") {
      const parsed = parseOntologyQueryFlags(rest);
      const [knId] = parsed.filteredArgs;
      if (!knId) {
        console.error("Usage: kweaver bkn object-type list <kn-id> [options]");
        return 1;
      }
      const token = await ensureValidToken();
      const body = await listObjectTypes({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        knId,
        businessDomain: parsed.businessDomain,
      });
      console.log(formatCallOutput(body, parsed.pretty));
      return 0;
    }

    if (action === "query") {
      const options = parseKnObjectTypeQueryArgs(rest);
      const token = await ensureValidToken();
      const result = await objectTypeQuery({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        knId: options.knId,
        otId: options.otId,
        body: options.body,
        businessDomain: options.businessDomain,
      });
      console.log(formatCallOutput(truncateQueryResult(result), options.pretty));
      return 0;
    }

    if (action === "properties") {
      const parsed = parseOntologyQueryFlags(rest);
      const [knId, otId, body] = parsed.filteredArgs;
      if (!knId || !otId || !body) {
        console.error(`Usage: kweaver bkn object-type properties <kn-id> <ot-id> '<json>' [options]
JSON: {"_instance_identities":[{"<primary-key>":"<value>"}],"properties":["prop1","prop2"]}`);
        return 1;
      }

      const token = await ensureValidToken();
      const result = await objectTypeProperties({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        knId,
        otId,
        body,
        businessDomain: parsed.businessDomain,
      });
      console.log(formatCallOutput(result, parsed.pretty));
      return 0;
    }

    console.error(`Unknown object-type action: ${action}. Use list, get, create, update, delete, query, or properties.`);
    return 1;
  } catch (error) {
    if (error instanceof Error && error.message === "help") {
      console.log(`kweaver bkn object-type create <kn-id> --name X --dataview-id Y --primary-key Z --display-key W [--property '<json>' ...]
kweaver bkn object-type update <kn-id> <ot-id> [--name X] [--display-key Y] [--add-property|--update-property '<json>' ...] [--remove-property N ...] [--tags '["a"]'] [--comment S] [--icon I] [--color C] [--branch main]
  kweaver bkn object-type update <kn-id> <ot-id> '<full-json-body>'
kweaver bkn object-type delete <kn-id> <ot-ids> [-y]`);
      return 0;
    }
    console.error(formatHttpError(error));
    return 1;
  }
}

export async function runKnRelationTypeCommand(args: string[]): Promise<number> {
  const [action, ...rest] = args;
  if (!action || action === "--help" || action === "-h") {
    console.log(`kweaver bkn relation-type list <kn-id> [--pretty] [-bd value]
kweaver bkn relation-type get <kn-id> <rt-id> [--pretty] [-bd value]
kweaver bkn relation-type create <kn-id> --name X --source <ot-id> --target <ot-id> [--mapping src:tgt ...]
kweaver bkn relation-type update <kn-id> <rt-id> --source <ot-id> --target <ot-id> [--name X] [--type direct|data_view] [--mapping src:tgt ...]
kweaver bkn relation-type delete <kn-id> <rt-ids> [-y]

list: List relation types (schema) from ontology-manager.
get: Get single relation type details.
create/update/delete: Schema CRUD.`);
    return 0;
  }

  try {
    if (action === "get") {
      const parsed = parseOntologyQueryFlags(rest);
      const [knId, rtId] = parsed.filteredArgs;
      if (!knId || !rtId) {
        console.error("Usage: kweaver bkn relation-type get <kn-id> <rt-id> [options]");
        return 1;
      }
      const token = await ensureValidToken();
      const body = await getRelationType({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        knId,
        rtId,
        businessDomain: parsed.businessDomain,
      });
      console.log(formatCallOutput(body, parsed.pretty));
      return 0;
    }

    if (action === "create") {
      const opts = parseRelationTypeCreateArgs(rest);
      const token = await ensureValidToken();
      const body = await createRelationTypes({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        knId: opts.knId,
        body: opts.body,
        businessDomain: opts.businessDomain,
        branch: opts.branch,
      });
      console.log(formatCallOutput(body, opts.pretty));
      return 0;
    }

    if (action === "update") {
      const opts = parseRelationTypeUpdateArgs(rest);
      const token = await ensureValidToken();
      const body = await updateRelationType({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        knId: opts.knId,
        rtId: opts.rtId,
        body: opts.body,
        businessDomain: opts.businessDomain,
      });
      console.log(formatCallOutput(body, opts.pretty));
      return 0;
    }

    if (action === "delete") {
      const opts = parseRelationTypeDeleteArgs(rest);
      if (!opts.yes) {
        const confirmed = await confirmYes(`Delete relation type(s) ${opts.rtIds}?`);
        if (!confirmed) {
          console.error("Aborted.");
          return 1;
        }
      }
      const token = await ensureValidToken();
      await deleteRelationTypes({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        knId: opts.knId,
        rtIds: opts.rtIds,
        businessDomain: opts.businessDomain,
      });
      console.log(`Deleted ${opts.rtIds}`);
      return 0;
    }

    if (action === "list") {
      const parsed = parseOntologyQueryFlags(rest);
      const [knId] = parsed.filteredArgs;
      if (!knId) {
        console.error("Usage: kweaver bkn relation-type list <kn-id> [options]");
        return 1;
      }
      const token = await ensureValidToken();
      const body = await listRelationTypes({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        knId,
        businessDomain: parsed.businessDomain,
      });
      console.log(formatCallOutput(body, parsed.pretty));
      return 0;
    }

    console.error(`Unknown relation-type action: ${action}. Use list, get, create, update, or delete.`);
    return 1;
  } catch (error) {
    if (error instanceof Error && error.message === "help") {
      console.log(`kweaver bkn relation-type create <kn-id> --name X --source <ot-id> --target <ot-id> [--mapping src:tgt ...]
kweaver bkn relation-type update <kn-id> <rt-id> --source <ot-id> --target <ot-id> [--name X] [--type direct|data_view] [--mapping src:tgt ...]
kweaver bkn relation-type delete <kn-id> <rt-ids> [-y]`);
      return 0;
    }
    console.error(formatHttpError(error));
    return 1;
  }
}

export async function runKnActionTypeCommand(args: string[]): Promise<number> {
  const [action, ...rest] = args;
  if (!action || action === "--help" || action === "-h") {
    console.log(`kweaver bkn action-type list <kn-id> [--pretty] [-bd value]
kweaver bkn action-type get <kn-id> <at-id> [--pretty] [-bd value]
kweaver bkn action-type create <kn-id> '<json>' [--pretty] [-bd value]
kweaver bkn action-type update <kn-id> <at-id> '<json>' [--pretty] [-bd value]
kweaver bkn action-type delete <kn-id> <at-ids> [-y] [--pretty] [-bd value]
kweaver bkn action-type query <kn-id> <at-id> '<json>' [--pretty] [-bd value]
kweaver bkn action-type execute <kn-id> <at-id> '<json>' [--pretty] [-bd value] [--wait|--no-wait] [--timeout n]

list: List action types (schema) from ontology-manager.
get: Get a single action type by ID.
create: Create action type(s) (POST JSON body).
update: Update an action type (PUT JSON body).
delete: Delete action type(s) by ID(s).
query/execute: Query or execute actions. execute has side effects - only use when explicitly requested.
  --wait (default)    Poll until execution completes
  --no-wait           Return immediately after starting execution
  --timeout <seconds> Max wait time when --wait (default: 300)`);
    return 0;
  }

  if (action === "list") {
    try {
      const parsed = parseOntologyQueryFlags(rest);
      const [knId] = parsed.filteredArgs;
      if (!knId) {
        console.error("Usage: kweaver bkn action-type list <kn-id> [options]");
        return 1;
      }
      const token = await ensureValidToken();
      const body = await listActionTypes({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        knId,
        businessDomain: parsed.businessDomain,
      });
      console.log(formatCallOutput(body, parsed.pretty));
      return 0;
    } catch (error) {
      console.error(formatHttpError(error));
      return 1;
    }
  }

  if (action === "get") {
    try {
      const parsed = parseOntologyQueryFlags(rest);
      const [knId, atId] = parsed.filteredArgs;
      if (!knId || !atId) {
        console.error("Usage: kweaver bkn action-type get <kn-id> <at-id>");
        return 1;
      }
      const token = await ensureValidToken();
      const body = await getActionType({ baseUrl: token.baseUrl, accessToken: token.accessToken, knId, atId, businessDomain: parsed.businessDomain });
      console.log(formatCallOutput(body, parsed.pretty));
      return 0;
    } catch (error) {
      console.error(formatHttpError(error));
      return 1;
    }
  }

  if (action === "create") {
    try {
      const parsed = parseOntologyQueryFlags(rest);
      const [knId, bodyJson] = parsed.filteredArgs;
      if (!knId || !bodyJson) {
        console.error("Usage: kweaver bkn action-type create <kn-id> '<json>'");
        return 1;
      }
      const token = await ensureValidToken();
      const result = await createActionTypes({ baseUrl: token.baseUrl, accessToken: token.accessToken, knId, body: bodyJson, businessDomain: parsed.businessDomain });
      console.log(formatCallOutput(result, parsed.pretty));
      return 0;
    } catch (error) {
      console.error(formatHttpError(error));
      return 1;
    }
  }

  if (action === "update") {
    try {
      const parsed = parseOntologyQueryFlags(rest);
      const [knId, atId, bodyJson] = parsed.filteredArgs;
      if (!knId || !atId || !bodyJson) {
        console.error("Usage: kweaver bkn action-type update <kn-id> <at-id> '<json>'");
        return 1;
      }
      const token = await ensureValidToken();
      const result = await updateActionType({ baseUrl: token.baseUrl, accessToken: token.accessToken, knId, atId, body: bodyJson, businessDomain: parsed.businessDomain });
      console.log(formatCallOutput(result, parsed.pretty));
      return 0;
    } catch (error) {
      console.error(formatHttpError(error));
      return 1;
    }
  }

  if (action === "delete") {
    try {
      const parsed = parseOntologyQueryFlags(rest);
      const yes = parsed.filteredArgs.includes("-y") || parsed.filteredArgs.includes("--yes");
      const positional = parsed.filteredArgs.filter(a => a !== "-y" && a !== "--yes");
      const [knId, atIds] = positional;
      if (!knId || !atIds) {
        console.error("Usage: kweaver bkn action-type delete <kn-id> <at-ids> [-y]");
        return 1;
      }
      if (!yes) {
        const confirmed = await confirmYes(`Delete action type(s) ${atIds}?`);
        if (!confirmed) {
          console.log("Cancelled.");
          return 0;
        }
      }
      const token = await ensureValidToken();
      await deleteActionTypes({ baseUrl: token.baseUrl, accessToken: token.accessToken, knId, atIds, businessDomain: parsed.businessDomain });
      console.log("Deleted.");
      return 0;
    } catch (error) {
      console.error(formatHttpError(error));
      return 1;
    }
  }

  if (action === "query") {
    let filteredArgs: string[];
    let pretty: boolean;
    let businessDomain: string;
    try {
      const parsed = parseOntologyQueryFlags(rest);
      filteredArgs = parsed.filteredArgs;
      pretty = parsed.pretty;
      businessDomain = parsed.businessDomain;
    } catch (error) {
      if (error instanceof Error && error.message === "help") return 0;
      throw error;
    }
    const [knId, atId, body] = filteredArgs;
    if (!knId || !atId || !body) {
      console.error("Usage: kweaver bkn action-type query <kn-id> <at-id> '<json>' [options]");
      return 1;
    }
    try {
      const token = await ensureValidToken();
      const result = await actionTypeQuery({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        knId,
        atId,
        body,
        businessDomain,
      });
      console.log(formatCallOutput(result, pretty));
      return 0;
    } catch (error) {
      console.error(formatHttpError(error));
      return 1;
    }
  }

  if (action === "execute") {
    let options: KnActionTypeExecuteOptions;
    try {
      options = parseKnActionTypeExecuteArgs(rest);
    } catch (error) {
      if (error instanceof Error && error.message === "help") return 0;
      console.error(formatHttpError(error));
      return 1;
    }
    try {
      const token = await ensureValidToken();
      const base = {
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        knId: options.knId,
        atId: options.atId,
        body: options.body,
        businessDomain: options.businessDomain,
      };
      const result = await actionTypeExecute(base);
      if (!options.wait) {
        console.log(formatCallOutput(result, options.pretty));
        return 0;
      }
      const executionId = extractExecutionId(result);
      if (!executionId) {
        console.log(formatCallOutput(result, options.pretty));
        return 0;
      }
      let lastBody = result;
      try {
        lastBody = await pollWithBackoff({
          fn: async () => {
            const status = extractStatus(lastBody);
            if (TERMINAL_STATUSES.includes(status.toUpperCase())) {
              return { done: true, value: lastBody };
            }
            lastBody = await actionExecutionGet({
              baseUrl: token.baseUrl,
              accessToken: token.accessToken,
              knId: options.knId,
              executionId,
              businessDomain: options.businessDomain,
            });
            return { done: false, value: lastBody };
          },
          interval: 2000,
          timeout: options.timeout * 1000,
        });
      } catch {
        console.error(`Action execution did not complete within ${options.timeout}s`);
        console.log(formatCallOutput(lastBody, options.pretty));
        return 1;
      }
      const finalStatus = extractStatus(lastBody);
      console.log(formatCallOutput(lastBody, options.pretty));
      return finalStatus.toUpperCase() === "SUCCESS" ? 0 : 1;
    } catch (error) {
      console.error(formatHttpError(error));
      return 1;
    }
  }

  console.error(`Unknown action-type action: ${action}. Use list, get, create, update, delete, query, or execute.`);
  return 1;
}

// ── Concept-group commands ─────────────────────────────────────────────────────

export interface ConceptGroupParsed {
  action: string;
  knId: string;
  itemId: string;
  body: string;
  extra: string;
  yes: boolean;
  pretty: boolean;
  businessDomain: string;
}

export function parseConceptGroupArgs(args: string[]): ConceptGroupParsed {
  const [action, ...rest] = args;
  if (!action || action === "--help" || action === "-h") throw new Error("help");

  let pretty = true;
  let businessDomain = "";
  let yes = false;
  const positional: string[] = [];

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === "--help" || arg === "-h") throw new Error("help");
    if (arg === "--pretty") { pretty = true; continue; }
    if ((arg === "-bd" || arg === "--biz-domain") && rest[i + 1]) { businessDomain = rest[++i]; continue; }
    if (arg === "-y" || arg === "--yes") { yes = true; continue; }
    positional.push(arg);
  }

  const [knId, itemId, extra] = positional;
  if (!knId) throw new Error("Missing kn-id. Usage: kweaver bkn concept-group <action> <kn-id> ...");
  if (!businessDomain) businessDomain = resolveBusinessDomain();

  return { action, knId, itemId: itemId || "", body: itemId || "", extra: extra || "", yes, pretty, businessDomain };
}

export async function runKnConceptGroupCommand(args: string[]): Promise<number> {
  let parsed: ConceptGroupParsed;
  try {
    parsed = parseConceptGroupArgs(args);
  } catch (error) {
    if (error instanceof Error && error.message === "help") {
      console.log(`kweaver bkn concept-group <action> <kn-id> [args] [--pretty] [-bd value]

Actions:
  list <kn-id>                              List concept groups
  get <kn-id> <cg-id>                       Get concept group details
  create <kn-id> '<json>'                   Create concept group
  update <kn-id> <cg-id> '<json>'           Update concept group
  delete <kn-id> <cg-id> [-y]              Delete concept group
  add-members <kn-id> <cg-id> <ot-ids>     Add object type members (comma-separated)
  remove-members <kn-id> <cg-id> <ot-ids> [-y]  Remove object type members`);
      return 0;
    }
    console.error(formatHttpError(error));
    return 1;
  }

  const { action, knId, itemId, body, extra, yes, pretty, businessDomain } = parsed;
  const token = await ensureValidToken();
  const base = { baseUrl: token.baseUrl, accessToken: token.accessToken, businessDomain };

  if (action === "list") {
    const result = await listConceptGroups({ ...base, knId });
    console.log(formatCallOutput(result, pretty));
    return 0;
  }
  if (action === "get") {
    if (!itemId) { console.error("Missing cg-id"); return 1; }
    const result = await getConceptGroup({ ...base, knId, cgId: itemId });
    console.log(formatCallOutput(result, pretty));
    return 0;
  }
  if (action === "create") {
    if (!itemId) { console.error("Missing JSON body"); return 1; }
    const result = await createConceptGroup({ ...base, knId, body });
    console.log(formatCallOutput(result, pretty));
    return 0;
  }
  if (action === "update") {
    if (!itemId || !extra) { console.error("Missing cg-id or JSON body"); return 1; }
    const result = await updateConceptGroup({ ...base, knId, cgId: itemId, body: extra });
    console.log(formatCallOutput(result, pretty));
    return 0;
  }
  if (action === "delete") {
    if (!itemId) { console.error("Missing cg-id"); return 1; }
    if (!yes) {
      const confirmed = await confirmYes(`Delete concept group ${itemId}?`);
      if (!confirmed) { console.log("Cancelled."); return 0; }
    }
    const result = await deleteConceptGroup({ ...base, knId, cgId: itemId });
    console.log(formatCallOutput(result, pretty));
    return 0;
  }
  if (action === "add-members") {
    if (!itemId || !extra) { console.error("Missing cg-id or ot-ids"); return 1; }
    const result = await addConceptGroupMembers({ ...base, knId, cgId: itemId, body: JSON.stringify({ ot_ids: extra.split(",") }) });
    console.log(formatCallOutput(result, pretty));
    return 0;
  }
  if (action === "remove-members") {
    if (!itemId || !extra) { console.error("Missing cg-id or ot-ids"); return 1; }
    if (!yes) {
      const confirmed = await confirmYes(`Remove members ${extra} from concept group ${itemId}?`);
      if (!confirmed) { console.log("Cancelled."); return 0; }
    }
    const result = await removeConceptGroupMembers({ ...base, knId, cgId: itemId, otIds: extra });
    console.log(formatCallOutput(result, pretty));
    return 0;
  }

  console.error(`Unknown concept-group action: ${action}`);
  return 1;
}
