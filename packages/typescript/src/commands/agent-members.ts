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

// ── MemberSpec + orchestrator ───────────────────────────────────────────────

export interface MemberFetchResult {
  exists: boolean;
  published: boolean;
  name?: string;
  /** Optional free-form status label for `list` output; e.g. "published" | "draft" | "offline". */
  status?: string;
}

export interface MemberSpec {
  /** Human-readable noun used in error/warning messages. */
  memberKind: string;
  /** Path inside the agent `config` object where the member array lives. */
  configPath: string[];
  /** Key inside each array element that identifies the member. */
  idField: string;
}

export interface AgentMembersDeps {
  getAgent: (agentId: string) => Promise<string>;
  updateAgent: (agentId: string, body: Record<string, unknown>) => Promise<string>;
  fetchById: (id: string) => Promise<MemberFetchResult>;
}

export interface PatchAgentMembersInput {
  agentId: string;
  spec: MemberSpec;
  addIds: string[];
  removeIds: string[];
  strict: boolean;
  deps: AgentMembersDeps;
}

export interface PatchAgentMembersReport extends MutationReport {
  warnings: string[];
}

function mergeAgentBody(current: Record<string, unknown>, newConfig: Record<string, unknown>): Record<string, unknown> {
  return {
    name: current.name,
    profile: current.profile,
    avatar_type: current.avatar_type,
    avatar: current.avatar,
    product_key: current.product_key,
    config: newConfig,
  };
}

export async function patchAgentMembers(input: PatchAgentMembersInput): Promise<PatchAgentMembersReport> {
  const { agentId, spec, addIds, removeIds, strict, deps } = input;

  const warnings: string[] = [];

  // 1. validate (add only)
  if (addIds.length > 0) {
    const results = await Promise.all(
      addIds.map(async (id) => ({ id, info: await deps.fetchById(id) })),
    );
    const missing = results.filter((r) => !r.info.exists).map((r) => r.id);
    if (missing.length > 0) {
      throw new Error(
        `${spec.memberKind}(s) ${missing.join(", ")} not found (aborting, agent not modified)`,
      );
    }
    const drafts = results.filter((r) => r.info.exists && !r.info.published).map((r) => r.id);
    if (drafts.length > 0) {
      if (strict) {
        throw new Error(
          `${spec.memberKind}(s) ${drafts.join(", ")} are in draft status (aborted by --strict)`,
        );
      }
      for (const id of drafts) {
        warnings.push(`${spec.memberKind} ${id} is in draft status (use --strict to reject, or publish it first)`);
      }
    }
  }

  // 2. fetch current agent
  const currentRaw = await deps.getAgent(agentId);
  const current = JSON.parse(currentRaw) as Record<string, unknown>;
  const config = (current.config ?? {}) as Record<string, unknown>;

  // 3. mutate
  const { newConfig, report } = mutateConfigMembers({
    config,
    path: spec.configPath,
    idField: spec.idField,
    addIds,
    removeIds,
  });

  // Short-circuit: no-op (skip the write if neither add nor remove changed anything)
  const nothingChanged = report.added.length === 0 && report.removed.length === 0;
  if (nothingChanged) {
    return { ...report, warnings };
  }

  // 4. write
  await deps.updateAgent(agentId, mergeAgentBody(current, newConfig));

  // 5. report
  return { ...report, warnings };
}

// ── List orchestrator ────────────────────────────────────────────────────────

export interface ListAgentMembersInput {
  agentId: string;
  spec: MemberSpec;
  deps: Pick<AgentMembersDeps, "getAgent" | "fetchById">;
}

export interface ListedMember {
  id: string;
  name: string | null;
  status: string;
}

export async function listAgentMembers(input: ListAgentMembersInput): Promise<ListedMember[]> {
  const { agentId, spec, deps } = input;
  const currentRaw = await deps.getAgent(agentId);
  const current = JSON.parse(currentRaw) as Record<string, unknown>;
  const config = (current.config ?? {}) as Record<string, unknown>;

  // Read (don't create) the path. If any segment is missing, result is empty.
  let cursor: unknown = config;
  for (const key of spec.configPath) {
    if (cursor && typeof cursor === "object" && !Array.isArray(cursor) && key in (cursor as Record<string, unknown>)) {
      cursor = (cursor as Record<string, unknown>)[key];
    } else {
      return [];
    }
  }
  if (!Array.isArray(cursor)) return [];

  const ids = (cursor as Record<string, unknown>[]).map((el) => String(el[spec.idField] ?? ""));

  const results = await Promise.all(
    ids.map(async (id) => {
      try {
        const info = await deps.fetchById(id);
        return {
          id,
          name: info.name ?? null,
          status: info.status ?? (info.exists ? (info.published ? "published" : "unpublish") : "unknown"),
        };
      } catch {
        return { id, name: null, status: "unknown" };
      }
    }),
  );

  return results;
}
