/**
 * Pure helpers and orchestrators for managing agent member associations
 * (skills, tools, mcps) via get → mutate(config) → update.
 */

export interface MutationReport {
  finalIds: string[];
  added: string[];
  alreadyAttached: string[];
  removed: string[];
  notAttached: string[];
}

export interface MutateConfigMembersInput {
  config: Record<string, unknown>;
  path: string[];
  idField: string;
  addIds: string[];
  removeIds: string[];
}

export interface MutateConfigMembersResult {
  newConfig: Record<string, unknown>;
  report: MutationReport;
  finalIds: string[];
}

/** Deep-clone a JSON-serializable object so mutations don't leak to callers. */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Descend into `config` along `path`, creating empty objects and a terminal
 * empty array along the way if any node is missing. Returns the terminal array.
 */
function ensureArrayAtPath(
  root: Record<string, unknown>,
  path: string[],
): Record<string, unknown>[] {
  let cursor: Record<string, unknown> = root;
  for (let i = 0; i < path.length - 1; i += 1) {
    const key = path[i]!;
    const next = cursor[key];
    if (next === undefined || next === null) {
      cursor[key] = {};
    } else if (typeof next !== "object" || Array.isArray(next)) {
      throw new Error(
        `Config path conflict at ${path.slice(0, i + 1).join(".")}: expected object, got ${Array.isArray(next) ? "array" : typeof next}`,
      );
    }
    cursor = cursor[key] as Record<string, unknown>;
  }
  const terminalKey = path[path.length - 1]!;
  const terminal = cursor[terminalKey];
  if (terminal === undefined || terminal === null) {
    cursor[terminalKey] = [];
  } else if (!Array.isArray(terminal)) {
    throw new Error(
      `Config path conflict at ${path.join(".")}: expected array, got ${typeof terminal}`,
    );
  }
  return cursor[terminalKey] as Record<string, unknown>[];
}

export function mutateConfigMembers(input: MutateConfigMembersInput): MutateConfigMembersResult {
  if (input.path.length === 0) {
    throw new Error("mutateConfigMembers: path must have at least one segment");
  }
  const newConfig = clone(input.config);
  const arr = ensureArrayAtPath(newConfig, input.path);

  const existingIds: string[] = arr.map((el) => String(el[input.idField] ?? ""));
  const currentSet = new Set(existingIds);

  const added: string[] = [];
  const alreadyAttached: string[] = [];
  for (const id of input.addIds) {
    if (currentSet.has(id)) {
      alreadyAttached.push(id);
    } else {
      arr.push({ [input.idField]: id });
      currentSet.add(id);
      added.push(id);
    }
  }

  const removeSet = new Set(input.removeIds);
  const removed: string[] = [];
  const notAttached: string[] = [];
  if (removeSet.size > 0) {
    const survivors: Record<string, unknown>[] = [];
    const survivingIdSet = new Set<string>();
    for (const el of arr) {
      const id = String(el[input.idField] ?? "");
      if (removeSet.has(id)) {
        if (!removed.includes(id)) removed.push(id);
        continue;
      }
      survivors.push(el);
      survivingIdSet.add(id);
    }
    for (const id of input.removeIds) {
      if (!removed.includes(id) && !survivingIdSet.has(id)) {
        notAttached.push(id);
      }
    }
    arr.length = 0;
    arr.push(...survivors);
  }

  const finalIds = arr.map((el) => String(el[input.idField] ?? ""));

  return {
    newConfig,
    finalIds,
    report: {
      finalIds,
      added,
      alreadyAttached,
      removed,
      notAttached,
    },
  };
}
