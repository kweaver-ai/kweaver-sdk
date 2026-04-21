# Agent Member CLI (skill/tool/mcp) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship 9 sub-subcommands (`kweaver agent {skill|tool|mcp} {add|remove|list}`) that let users attach / detach / inspect agent members without hand-editing JSON, closing [issue #72](https://github.com/kweaver-ai/kweaver-sdk/issues/72).

**Architecture:** One pure mutation utility (`mutateConfigMembers`) + one orchestrator (`patchAgentMembers`) + three `MemberSpec` adapters (skill/tool/mcp) that plug into existing `getAgent` / `updateAgent` API calls. A separate `listAgentMembers` orchestrator handles the read path. All new code lives in a new file `packages/typescript/src/commands/agent-members.ts`; `agent.ts` only gains a dispatch branch.

**Tech Stack:** TypeScript, Node built-in `node:test`, existing `fetchTextOrThrow` / `HttpError` utilities, existing `getAgent` / `updateAgent` / `getSkill` API functions.

**Spec:** `docs/superpowers/specs/2026-04-21-agent-member-cli-design.md`

---

## File Structure

```
packages/typescript/
  src/
    commands/
      agent.ts                          — MODIFY: add skill|tool|mcp dispatch in runAgentCommand, update help text
      agent-members.ts                  — NEW: MemberSpec + mutateConfigMembers + patchAgentMembers + listAgentMembers + three command handlers
    api/
      toolboxes.ts                      — MODIFY (only if Task 1 finds no suitable fetch): add getToolboxById helper
      mcp-servers.ts                    — NEW (only if Task 1 probe shows mcp support): thin API wrapper
  test/
    agent-members-mutate.test.ts        — NEW: pure mutation tests
    agent-members-orchestrator.test.ts  — NEW: patchAgentMembers / listAgentMembers with fetch mocks
    agent-members-cmd.test.ts           — NEW: command parsing + help text + router wiring
    e2e/
      agent-member-skill.test.ts        — NEW: end-to-end on real platform, skill group only
docs/superpowers/plans/research/
  2026-04-21-agent-config-probe.md      — NEW: findings from Task 1
```

---

## Task 1: Probe Live Agent Config

**Why:** Spec deliberately left three platform-contract facts unresolved: (a) exact `config` paths for skills/tools/mcps, (b) id-field names inside each array element, (c) whether mcp is even supported today. These determine the `MemberSpec` constants and whether the mcp group ships in this plan.

**Files:**
- Create: `docs/superpowers/plans/research/2026-04-21-agent-config-probe.md`

- [ ] **Step 1: Find an agent that has skills attached on dip-poc**

Use the platform the user has already configured. Run:

```bash
kweaver agent personal-list --compact | head -50
```

Pick an agent id from the output — ideally one that already has a skill or tool attached. If none found, create a test agent first:

```bash
kweaver agent create --name "probe-agent" --profile "config shape probe"
```

- [ ] **Step 2: Fetch its full config**

```bash
kweaver agent get <agent-id> --save-config /tmp/agent-probe.json --verbose
```

Output file contains the full agent payload including `config`.

- [ ] **Step 3: Inspect the config's associative fields**

Read `/tmp/agent-probe.json` and look specifically inside `config` for:

1. A `skills` key — note its **shape**: is it `config.skills: [...]` (flat array of `{skill_id}`)? Or `config.skills: {skills: [{skill_id}, ...]}` (nested, as issue #72 shows)? Or something else?
2. A `tools` / `toolboxes` / similar key — note shape and id-field name (`tool_id` vs `toolbox_id`).
3. A `mcps` / `mcp_servers` / similar key — same.
4. If any key is absent because that agent has none attached, that's fine — note its absence, and if feasible, attach one via the platform web UI, re-fetch, and re-inspect.

- [ ] **Step 4: Write the probe report**

Create `docs/superpowers/plans/research/2026-04-21-agent-config-probe.md` with this template, filled in:

```markdown
# Agent Config Probe — 2026-04-21

Source: `kweaver agent get <agent-id>` on dip-poc, <date>.

## Skill attachment

- configPath: `config.skills.skills` (array)   ← FILL IN ACTUAL OBSERVED PATH
- idField: `skill_id`                          ← FILL IN
- Sample element: `{"skill_id": "sk_xxx"}`     ← FILL IN
- fetchById endpoint: `getSkill({skillId})` → returns `{status: "published"|"unpublish"|"offline", name, ...}`

## Tool attachment

- configPath: `???`                            ← FILL IN or mark ABSENT
- idField: `???`                               ← FILL IN
- Sample element: `???`
- Attachment unit: toolbox (container) / individual tool / other  ← CHOOSE ONE
- fetchById endpoint plan: `???` (may require listToolboxes + filter)

## MCP attachment

- configPath: `???` or ABSENT
- idField: `???`
- Sample element: `???`
- Platform support: YES / NO  ← if NO, mcp group is deferred out of this plan
- fetchById endpoint plan: `???`

## Decisions for this plan

- Tool command verb: `agent tool` or `agent toolbox` → ___
- MCP group: IN / DEFERRED (if DEFERRED, remove Tasks 10-12 from this plan before proceeding)
```

- [ ] **Step 5: Commit the probe report**

```bash
git add docs/superpowers/plans/research/2026-04-21-agent-config-probe.md
git commit -m "docs(plan): agent config probe findings for #72"
```

- [ ] **Step 6: Update this plan based on findings**

Edit this plan file in place:

1. In Task 2, replace `SKILL_SPEC.configPath = ["skills", "skills"]` with the actually-observed path.
2. In Task 7 / 8 / 9, replace the `<TOOL_CONFIG_PATH>` placeholder with the observed path and `<TOOL_ID_FIELD>` with the observed id-field name. Update the command verb if probe chose `toolbox` over `tool`.
3. If MCP is ABSENT: delete Tasks 10, 11, 12 from this plan entirely, and mark the mcp group as "deferred — tracked in follow-up issue" in Task 14's writeup.

Do NOT commit the plan edits separately — they'll flow in with Task 2.

---

## Task 2: Pure Mutation Utility (TDD)

**Files:**
- Create: `packages/typescript/src/commands/agent-members.ts`
- Test: `packages/typescript/test/agent-members-mutate.test.ts`

This task establishes the pure, synchronous, I/O-free core: given a config object, a path, an id-field name, and add/remove lists, produce the mutated config plus a report of what changed.

- [ ] **Step 1: Write failing tests**

Create `packages/typescript/test/agent-members-mutate.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { mutateConfigMembers } from "../src/commands/agent-members.js";

test("mutateConfigMembers adds ids to existing array", () => {
  const config = { skills: { skills: [{ skill_id: "sk_a" }] } };
  const { newConfig, report } = mutateConfigMembers({
    config,
    path: ["skills", "skills"],
    idField: "skill_id",
    addIds: ["sk_b", "sk_c"],
    removeIds: [],
  });
  assert.deepEqual(
    (newConfig as { skills: { skills: { skill_id: string }[] } }).skills.skills.map((x) => x.skill_id),
    ["sk_a", "sk_b", "sk_c"],
  );
  assert.deepEqual(report.added, ["sk_b", "sk_c"]);
  assert.deepEqual(report.alreadyAttached, []);
});

test("mutateConfigMembers dedupes already-attached ids", () => {
  const config = { skills: { skills: [{ skill_id: "sk_a" }] } };
  const { newConfig, report } = mutateConfigMembers({
    config,
    path: ["skills", "skills"],
    idField: "skill_id",
    addIds: ["sk_a", "sk_b"],
    removeIds: [],
  });
  assert.deepEqual(
    (newConfig as { skills: { skills: { skill_id: string }[] } }).skills.skills.map((x) => x.skill_id),
    ["sk_a", "sk_b"],
  );
  assert.deepEqual(report.added, ["sk_b"]);
  assert.deepEqual(report.alreadyAttached, ["sk_a"]);
});

test("mutateConfigMembers creates missing path nodes", () => {
  const config: Record<string, unknown> = {};
  const { newConfig, report } = mutateConfigMembers({
    config,
    path: ["skills", "skills"],
    idField: "skill_id",
    addIds: ["sk_a"],
    removeIds: [],
  });
  assert.deepEqual(
    (newConfig as { skills: { skills: { skill_id: string }[] } }).skills.skills,
    [{ skill_id: "sk_a" }],
  );
  assert.deepEqual(report.added, ["sk_a"]);
});

test("mutateConfigMembers removes ids and preserves order", () => {
  const config = {
    skills: { skills: [{ skill_id: "sk_a" }, { skill_id: "sk_b" }, { skill_id: "sk_c" }] },
  };
  const { newConfig, report } = mutateConfigMembers({
    config,
    path: ["skills", "skills"],
    idField: "skill_id",
    addIds: [],
    removeIds: ["sk_b"],
  });
  assert.deepEqual(
    (newConfig as { skills: { skills: { skill_id: string }[] } }).skills.skills.map((x) => x.skill_id),
    ["sk_a", "sk_c"],
  );
  assert.deepEqual(report.removed, ["sk_b"]);
  assert.deepEqual(report.notAttached, []);
});

test("mutateConfigMembers reports not-attached on remove miss", () => {
  const config = { skills: { skills: [{ skill_id: "sk_a" }] } };
  const { newConfig, report } = mutateConfigMembers({
    config,
    path: ["skills", "skills"],
    idField: "skill_id",
    addIds: [],
    removeIds: ["sk_a", "sk_missing"],
  });
  assert.deepEqual(
    (newConfig as { skills: { skills: { skill_id: string }[] } }).skills.skills,
    [],
  );
  assert.deepEqual(report.removed, ["sk_a"]);
  assert.deepEqual(report.notAttached, ["sk_missing"]);
});

test("mutateConfigMembers does not mutate input config", () => {
  const config = { skills: { skills: [{ skill_id: "sk_a" }] } };
  const original = JSON.parse(JSON.stringify(config));
  mutateConfigMembers({
    config,
    path: ["skills", "skills"],
    idField: "skill_id",
    addIds: ["sk_b"],
    removeIds: [],
  });
  assert.deepEqual(config, original);
});

test("mutateConfigMembers lists current ids", () => {
  const config = { skills: { skills: [{ skill_id: "sk_a" }, { skill_id: "sk_b" }] } };
  const { currentIds } = mutateConfigMembers({
    config,
    path: ["skills", "skills"],
    idField: "skill_id",
    addIds: [],
    removeIds: [],
  });
  assert.deepEqual(currentIds, ["sk_a", "sk_b"]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/typescript && npm test -- --test-name-pattern=mutateConfigMembers 2>&1 | head -40
```

Expected: all 7 tests FAIL with "Cannot find module" or "mutateConfigMembers is not a function".

- [ ] **Step 3: Implement the utility**

Create `packages/typescript/src/commands/agent-members.ts` with this content:

```ts
/**
 * Pure helpers and orchestrators for managing agent member associations
 * (skills, tools, mcps) via get → mutate(config) → update.
 */

export interface MutationReport {
  currentIds: string[];
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
  currentIds: string[];
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
  const newConfig = clone(input.config);
  const arr = ensureArrayAtPath(newConfig, input.path);

  const currentIds: string[] = arr.map((el) => String(el[input.idField] ?? ""));
  const currentSet = new Set(currentIds);

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
    currentIds: finalIds,
    report: {
      currentIds: finalIds,
      added,
      alreadyAttached,
      removed,
      notAttached,
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/typescript && npm test -- --test-name-pattern=mutateConfigMembers 2>&1 | tail -20
```

Expected: all 7 tests PASS.

- [ ] **Step 5: Run lint and full test suite**

```bash
cd packages/typescript && npm run lint && npm test 2>&1 | tail -10
```

Expected: no TypeScript errors; all tests pass (pre-existing tests untouched).

- [ ] **Step 6: Commit**

```bash
git add packages/typescript/src/commands/agent-members.ts packages/typescript/test/agent-members-mutate.test.ts docs/superpowers/plans/2026-04-21-agent-member-cli.md
git commit -m "feat(agent): pure config mutation utility for member management

Part of #72. Adds mutateConfigMembers — a pure, dependency-free helper
that adds/removes member ids inside a nested config array, handling
dedupe, missing-path creation, and order preservation. TDD-verified
with 7 unit tests.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: MemberSpec + patchAgentMembers Orchestrator (TDD)

**Files:**
- Modify: `packages/typescript/src/commands/agent-members.ts`
- Test: `packages/typescript/test/agent-members-orchestrator.test.ts`

Wraps `mutateConfigMembers` with the validate → fetch → mutate → write pipeline. The orchestrator is parameterized by a `MemberSpec` so the same code drives skill, tool, and mcp.

- [ ] **Step 1: Write failing tests**

Create `packages/typescript/test/agent-members-orchestrator.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  patchAgentMembers,
  type MemberSpec,
  type MemberFetchResult,
} from "../src/commands/agent-members.js";

interface MockAgentStore {
  agent: Record<string, unknown>;
  updateCalls: Record<string, unknown>[];
}

function makeDeps(store: MockAgentStore, members: Record<string, MemberFetchResult>) {
  return {
    getAgent: async (id: string) => {
      if (id !== "ag_1") throw new Error(`agent ${id} not found`);
      return JSON.stringify(store.agent);
    },
    updateAgent: async (id: string, body: Record<string, unknown>) => {
      store.updateCalls.push(body);
      return "ok";
    },
    fetchById: async (id: string): Promise<MemberFetchResult> => {
      if (!(id in members)) return { exists: false, published: false };
      return members[id]!;
    },
  };
}

function skillSpec(): MemberSpec {
  return {
    memberKind: "skill",
    configPath: ["skills", "skills"],
    idField: "skill_id",
  };
}

test("patchAgentMembers add happy path", async () => {
  const store: MockAgentStore = {
    agent: { id: "ag_1", name: "a", profile: "p", config: {} },
    updateCalls: [],
  };
  const deps = makeDeps(store, {
    sk_a: { exists: true, published: true, name: "alpha" },
  });

  const report = await patchAgentMembers({
    agentId: "ag_1",
    spec: skillSpec(),
    addIds: ["sk_a"],
    removeIds: [],
    strict: false,
    deps,
  });

  assert.equal(store.updateCalls.length, 1);
  const config = store.updateCalls[0]!.config as { skills: { skills: { skill_id: string }[] } };
  assert.deepEqual(config.skills.skills, [{ skill_id: "sk_a" }]);
  assert.deepEqual(report.added, ["sk_a"]);
  assert.deepEqual(report.warnings, []);
});

test("patchAgentMembers add aborts when any id does not exist", async () => {
  const store: MockAgentStore = {
    agent: { id: "ag_1", name: "a", profile: "p", config: {} },
    updateCalls: [],
  };
  const deps = makeDeps(store, {
    sk_a: { exists: true, published: true },
  });

  await assert.rejects(
    () =>
      patchAgentMembers({
        agentId: "ag_1",
        spec: skillSpec(),
        addIds: ["sk_a", "sk_missing"],
        removeIds: [],
        strict: false,
        deps,
      }),
    (err: Error) => /sk_missing.*not found/.test(err.message),
  );

  assert.equal(store.updateCalls.length, 0, "updateAgent must not be called when any id is missing");
});

test("patchAgentMembers add warns on draft in non-strict mode and still writes", async () => {
  const store: MockAgentStore = {
    agent: { id: "ag_1", name: "a", profile: "p", config: {} },
    updateCalls: [],
  };
  const deps = makeDeps(store, {
    sk_draft: { exists: true, published: false, name: "draft-one" },
  });

  const report = await patchAgentMembers({
    agentId: "ag_1",
    spec: skillSpec(),
    addIds: ["sk_draft"],
    removeIds: [],
    strict: false,
    deps,
  });

  assert.equal(store.updateCalls.length, 1);
  assert.deepEqual(report.added, ["sk_draft"]);
  assert.equal(report.warnings.length, 1);
  assert.match(report.warnings[0]!, /sk_draft.*draft/);
});

test("patchAgentMembers add errors on draft in strict mode and does not write", async () => {
  const store: MockAgentStore = {
    agent: { id: "ag_1", name: "a", profile: "p", config: {} },
    updateCalls: [],
  };
  const deps = makeDeps(store, {
    sk_draft: { exists: true, published: false },
  });

  await assert.rejects(
    () =>
      patchAgentMembers({
        agentId: "ag_1",
        spec: skillSpec(),
        addIds: ["sk_draft"],
        removeIds: [],
        strict: true,
        deps,
      }),
    (err: Error) => /sk_draft.*draft/.test(err.message),
  );

  assert.equal(store.updateCalls.length, 0);
});

test("patchAgentMembers remove does not call fetchById", async () => {
  const store: MockAgentStore = {
    agent: {
      id: "ag_1",
      name: "a",
      profile: "p",
      config: { skills: { skills: [{ skill_id: "sk_a" }, { skill_id: "sk_b" }] } },
    },
    updateCalls: [],
  };
  let fetchCalls = 0;
  const deps = {
    getAgent: async () => JSON.stringify(store.agent),
    updateAgent: async (_id: string, body: Record<string, unknown>) => {
      store.updateCalls.push(body);
      return "ok";
    },
    fetchById: async () => {
      fetchCalls += 1;
      return { exists: true, published: true };
    },
  };

  const report = await patchAgentMembers({
    agentId: "ag_1",
    spec: skillSpec(),
    addIds: [],
    removeIds: ["sk_a", "sk_missing"],
    strict: false,
    deps,
  });

  assert.equal(fetchCalls, 0, "fetchById must not be invoked for remove");
  assert.equal(store.updateCalls.length, 1);
  assert.deepEqual(report.removed, ["sk_a"]);
  assert.deepEqual(report.notAttached, ["sk_missing"]);
});

test("patchAgentMembers preserves sibling config fields", async () => {
  const store: MockAgentStore = {
    agent: {
      id: "ag_1",
      name: "a",
      profile: "p",
      config: {
        system_prompt: "keep me",
        llms: [{ is_default: true, llm_config: { id: "m1", name: "n", max_tokens: 1 } }],
        data_source: { knowledge_network: [{ knowledge_network_id: "kn_x", knowledge_network_name: "" }] },
      },
    },
    updateCalls: [],
  };
  const deps = makeDeps(store, { sk_a: { exists: true, published: true } });

  await patchAgentMembers({
    agentId: "ag_1",
    spec: skillSpec(),
    addIds: ["sk_a"],
    removeIds: [],
    strict: false,
    deps,
  });

  const written = store.updateCalls[0]!.config as Record<string, unknown>;
  assert.equal(written.system_prompt, "keep me");
  assert.ok(Array.isArray(written.llms));
  assert.ok((written.data_source as Record<string, unknown>).knowledge_network);
  assert.ok((written.skills as Record<string, unknown>).skills);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/typescript && npm test -- --test-name-pattern=patchAgentMembers 2>&1 | head -20
```

Expected: all 6 tests FAIL with "patchAgentMembers is not exported" or similar.

- [ ] **Step 3: Extend agent-members.ts with spec + orchestrator**

Append to `packages/typescript/src/commands/agent-members.ts`:

```ts
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
        `${spec.memberKind}(s) not found: ${missing.join(", ")} (aborting, agent not modified)`,
      );
    }
    const drafts = results.filter((r) => r.info.exists && !r.info.published).map((r) => r.id);
    if (drafts.length > 0) {
      if (strict) {
        throw new Error(
          `${spec.memberKind}(s) not published: ${drafts.join(", ")} (aborted by --strict)`,
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

  // Short-circuit: no-op
  const nothingChanged =
    report.added.length === 0 && report.removed.length === 0;
  if (nothingChanged && (addIds.length > 0 || removeIds.length > 0)) {
    // Still call updateAgent? No — skipping avoids an unnecessary write round-trip.
    return { ...report, warnings };
  }
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/typescript && npm test -- --test-name-pattern=patchAgentMembers 2>&1 | tail -20
```

Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/typescript/src/commands/agent-members.ts packages/typescript/test/agent-members-orchestrator.test.ts
git commit -m "feat(agent): patchAgentMembers + listAgentMembers orchestrators

Part of #72. MemberSpec-parameterized orchestrators wrapping
mutateConfigMembers with validate → fetch → mutate → update flow.
TDD-verified against 6 scenarios: happy path, missing-id abort,
draft warn vs strict-abort, remove-without-fetchById, sibling field
preservation.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Skill Command Handlers (TDD)

**Files:**
- Modify: `packages/typescript/src/commands/agent-members.ts` — add `runAgentSkillCommand`
- Modify: `packages/typescript/src/commands/agent.ts` — dispatch `skill` subcommand and update help
- Test: `packages/typescript/test/agent-members-cmd.test.ts`

Wire the skill group end-to-end: argv parsing, the three subverbs (`add`/`remove`/`list`), help text, and skill-specific `fetchById` backed by `getSkill`.

- [ ] **Step 1: Write failing tests**

Create `packages/typescript/test/agent-members-cmd.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { runAgentCommand } from "../src/commands/agent.js";

const originalFetch = globalThis.fetch;

function createConfigDir(): string {
  return mkdtempSync(join(tmpdir(), "kweaver-agent-members-"));
}

async function importStoreModule(configDir: string) {
  process.env.KWEAVERC_CONFIG_DIR = configDir;
  const moduleUrl = pathToFileURL(join(process.cwd(), "src/config/store.ts")).href;
  return import(`${moduleUrl}?t=${Date.now()}-${Math.random()}`);
}

async function primeToken() {
  const configDir = createConfigDir();
  process.env.KWEAVERC_CONFIG_DIR = configDir;
  const store = await importStoreModule(configDir);
  store.saveTokenConfig({
    baseUrl: "https://dip.aishu.cn",
    accessToken: "token-test",
    tokenType: "bearer",
    scope: "openid",
    obtainedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  });
  store.setCurrentPlatform("https://dip.aishu.cn");
}

test("agent help lists skill subcommand", async () => {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  try {
    await runAgentCommand([]);
    assert.ok(lines.join("\n").includes("skill"), "help should mention skill");
  } finally {
    console.log = originalLog;
  }
});

test("agent skill help lists add/remove/list", async () => {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  try {
    await runAgentCommand(["skill", "--help"]);
    const help = lines.join("\n");
    assert.ok(help.includes("add"), "help should list add");
    assert.ok(help.includes("remove"), "help should list remove");
    assert.ok(help.includes("list"), "help should list list");
  } finally {
    console.log = originalLog;
  }
});

test("agent skill rejects unknown subverb", { concurrency: false }, async () => {
  await primeToken();
  const errors: string[] = [];
  const originalErr = console.error;
  console.error = (...args: unknown[]) => { errors.push(args.map(String).join(" ")); };
  try {
    const code = await runAgentCommand(["skill", "foobar", "ag_1"]);
    assert.equal(code, 1);
    assert.ok(errors.join("\n").toLowerCase().includes("unknown"), `expected 'unknown' in stderr, got: ${errors.join("\n")}`);
  } finally {
    console.error = originalErr;
  }
});

test("agent skill add — rejects missing id", { concurrency: false }, async () => {
  await primeToken();

  globalThis.fetch = async (urlInput: string | URL | Request) => {
    const urlStr = typeof urlInput === "string" ? urlInput : urlInput instanceof URL ? urlInput.href : urlInput.url;
    // getSkill probe fails → exists=false
    if (urlStr.includes("/skills/sk_missing")) {
      return new Response("not found", { status: 404 });
    }
    // agent get — should NOT be reached
    if (urlStr.includes("/agent-factory/v3/agent/")) {
      throw new Error("agent get called despite missing skill id");
    }
    return new Response("{}", { status: 200 });
  };

  const errors: string[] = [];
  const originalErr = console.error;
  console.error = (...args: unknown[]) => { errors.push(args.map(String).join(" ")); };
  try {
    const code = await runAgentCommand(["skill", "add", "ag_1", "sk_missing"]);
    assert.equal(code, 1);
    assert.match(errors.join("\n"), /sk_missing/);
  } finally {
    console.error = originalErr;
    globalThis.fetch = originalFetch;
  }
});

test("agent skill add — happy path writes and reports", { concurrency: false }, async () => {
  await primeToken();

  const updateBodies: string[] = [];
  globalThis.fetch = async (urlInput: string | URL | Request, init?: RequestInit) => {
    const urlStr = typeof urlInput === "string" ? urlInput : urlInput instanceof URL ? urlInput.href : urlInput.url;
    const method = (init?.method ?? "GET").toUpperCase();

    if (urlStr.includes("/skills/sk_a") && method === "GET") {
      return new Response(JSON.stringify({ data: { id: "sk_a", name: "alpha", status: "published" } }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }
    if (urlStr.includes("/agent-factory/v3/agent/ag_1") && method === "GET") {
      return new Response(JSON.stringify({ id: "ag_1", name: "A", profile: "P", config: {} }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }
    if (urlStr.includes("/agent-factory/v3/agent/ag_1") && method === "PUT") {
      updateBodies.push(String(init?.body ?? ""));
      return new Response("ok", { status: 200 });
    }
    throw new Error(`unexpected fetch ${method} ${urlStr}`);
  };

  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); };
  try {
    const code = await runAgentCommand(["skill", "add", "ag_1", "sk_a"]);
    assert.equal(code, 0);
    assert.equal(updateBodies.length, 1);
    const body = JSON.parse(updateBodies[0]!) as { config: { skills: { skills: { skill_id: string }[] } } };
    assert.deepEqual(body.config.skills.skills, [{ skill_id: "sk_a" }]);
    assert.ok(logs.join("\n").includes("sk_a"));
  } finally {
    console.log = originalLog;
    globalThis.fetch = originalFetch;
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/typescript && npm test -- --test-file-pattern=agent-members-cmd 2>&1 | head -30
```

Expected: tests FAIL because the dispatch branch doesn't exist yet.

- [ ] **Step 3: Append command handler to agent-members.ts**

Append to `packages/typescript/src/commands/agent-members.ts`:

```ts
// ── Skill command handler ────────────────────────────────────────────────────

import { getAgent, updateAgent } from "../api/agent-list.js";
import { getSkill } from "../api/skills.js";
import { ensureValidToken, formatHttpError } from "../auth/oauth.js";
import { resolveBusinessDomain } from "../config/store.js";

const SKILL_SPEC: MemberSpec = {
  memberKind: "skill",
  configPath: ["skills", "skills"],  // ← replace with Task 1 finding if different
  idField: "skill_id",                // ← replace with Task 1 finding if different
};

interface ParsedWriteArgs {
  agentId: string;
  ids: string[];
  strict: boolean;
  businessDomain: string;
}

function parseWriteArgs(args: string[], verb: "add" | "remove"): ParsedWriteArgs {
  const agentId = args[0];
  if (!agentId || agentId.startsWith("-")) {
    throw new Error(`Missing <agent-id> for ${verb}`);
  }
  const ids: string[] = [];
  let strict = false;
  let businessDomain = "";
  for (let i = 1; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === "--strict") { strict = true; continue; }
    if (arg === "-bd" || arg === "--biz-domain") {
      businessDomain = args[i + 1] ?? "";
      if (!businessDomain || businessDomain.startsWith("-")) {
        throw new Error("Missing value for biz-domain flag");
      }
      i += 1;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unsupported flag: ${arg}`);
    }
    ids.push(arg);
  }
  if (ids.length === 0) {
    throw new Error(`Missing <member-id> for ${verb}`);
  }
  return { agentId, ids, strict, businessDomain };
}

function printReport(kind: string, agentId: string, report: PatchAgentMembersReport): void {
  for (const w of report.warnings) process.stderr.write(`! ${w}\n`);
  for (const id of report.added) console.log(`✓ ${id}  added`);
  for (const id of report.alreadyAttached) console.log(`• ${id}  already attached (skipped)`);
  for (const id of report.removed) console.log(`✓ ${id}  removed`);
  for (const id of report.notAttached) console.log(`• ${id}  not attached (skipped)`);
  console.log(`Agent ${agentId} now has ${report.currentIds.length} ${kind}(s) attached.`);
}

async function runSkillAdd(args: string[]): Promise<number> {
  const parsed = parseWriteArgs(args, "add");
  const token = await ensureValidToken();
  const businessDomain = parsed.businessDomain || resolveBusinessDomain();

  const deps: AgentMembersDeps = {
    getAgent: (id) => getAgent({ baseUrl: token.baseUrl, accessToken: token.accessToken, agentId: id, businessDomain }),
    updateAgent: (id, body) => updateAgent({ baseUrl: token.baseUrl, accessToken: token.accessToken, agentId: id, body: JSON.stringify(body), businessDomain }),
    fetchById: async (id) => {
      try {
        const info = await getSkill({ baseUrl: token.baseUrl, accessToken: token.accessToken, skillId: id, businessDomain });
        return {
          exists: true,
          published: info.status === "published",
          name: info.name,
          status: info.status,
        };
      } catch {
        return { exists: false, published: false };
      }
    },
  };

  try {
    const report = await patchAgentMembers({
      agentId: parsed.agentId,
      spec: SKILL_SPEC,
      addIds: parsed.ids,
      removeIds: [],
      strict: parsed.strict,
      deps,
    });
    printReport("skill", parsed.agentId, report);
    return 0;
  } catch (error) {
    process.stderr.write(`✗ ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

async function runSkillRemove(args: string[]): Promise<number> {
  const parsed = parseWriteArgs(args, "remove");
  const token = await ensureValidToken();
  const businessDomain = parsed.businessDomain || resolveBusinessDomain();

  const deps: AgentMembersDeps = {
    getAgent: (id) => getAgent({ baseUrl: token.baseUrl, accessToken: token.accessToken, agentId: id, businessDomain }),
    updateAgent: (id, body) => updateAgent({ baseUrl: token.baseUrl, accessToken: token.accessToken, agentId: id, body: JSON.stringify(body), businessDomain }),
    fetchById: async () => ({ exists: true, published: true }),  // never invoked for remove
  };

  try {
    const report = await patchAgentMembers({
      agentId: parsed.agentId,
      spec: SKILL_SPEC,
      addIds: [],
      removeIds: parsed.ids,
      strict: false,
      deps,
    });
    printReport("skill", parsed.agentId, report);
    return 0;
  } catch (error) {
    process.stderr.write(`✗ ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

async function runSkillList(args: string[]): Promise<number> {
  const agentId = args[0];
  if (!agentId || agentId.startsWith("-")) {
    process.stderr.write("Missing <agent-id> for list\n");
    return 1;
  }
  let pretty = true;
  let businessDomain = "";
  for (let i = 1; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === "--pretty") { pretty = true; continue; }
    if (arg === "--compact") { pretty = false; continue; }
    if (arg === "-bd" || arg === "--biz-domain") {
      businessDomain = args[i + 1] ?? "";
      i += 1;
      continue;
    }
    process.stderr.write(`Unsupported flag: ${arg}\n`);
    return 1;
  }

  const token = await ensureValidToken();
  businessDomain = businessDomain || resolveBusinessDomain();

  const deps = {
    getAgent: (id: string) => getAgent({ baseUrl: token.baseUrl, accessToken: token.accessToken, agentId: id, businessDomain }),
    fetchById: async (id: string): Promise<MemberFetchResult> => {
      try {
        const info = await getSkill({ baseUrl: token.baseUrl, accessToken: token.accessToken, skillId: id, businessDomain });
        return { exists: true, published: info.status === "published", name: info.name, status: info.status };
      } catch {
        return { exists: false, published: false };
      }
    },
  };

  try {
    const rows = await listAgentMembers({ agentId, spec: SKILL_SPEC, deps });
    const output = rows.map((r) => ({ skill_id: r.id, name: r.name, status: r.status }));
    console.log(JSON.stringify(output, null, pretty ? 2 : 0));
    return 0;
  } catch (error) {
    process.stderr.write(`✗ ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

export async function runAgentSkillCommand(args: string[]): Promise<number> {
  const [verb, ...rest] = args;
  if (!verb || verb === "--help" || verb === "-h") {
    console.log(`kweaver agent skill

Subcommands:
  add <agent-id> <skill-id>... [--strict] [-bd <bd>]      Attach skills to an agent
  remove <agent-id> <skill-id>... [-bd <bd>]              Detach skills from an agent
  list <agent-id> [--pretty|--compact] [-bd <bd>]         List skills attached to an agent

Notes:
  --strict         On add, reject skills that exist but are not in 'published' status.
                   Default behaviour: warn and continue.
  Dedupe is automatic for add; remove silently skips not-attached ids.`);
    return 0;
  }
  try {
    if (verb === "add") return await runSkillAdd(rest);
    if (verb === "remove") return await runSkillRemove(rest);
    if (verb === "list") return await runSkillList(rest);
    process.stderr.write(`Unknown agent skill subcommand: ${verb}\n`);
    return 1;
  } catch (error) {
    process.stderr.write(`${formatHttpError(error)}\n`);
    return 1;
  }
}
```

- [ ] **Step 4: Wire dispatch in agent.ts**

In `packages/typescript/src/commands/agent.ts`, modify the imports at the top:

Add the import (next to other command-module imports, around line 2):

```ts
import { runAgentSkillCommand } from "./agent-members.js";
```

Then in `runAgentCommand` — inside the `dispatch` inner function (around agent.ts:693-710) — add before the `return -1;`:

```ts
    if (subcommand === "skill") return runAgentSkillCommand(rest);
```

Then in the help text of `runAgentCommand` (around agent.ts:668-689), add a line grouped with the chat/sessions block:

```
  skill <verb> ...                   Manage skills attached to an agent (add/remove/list)
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd packages/typescript && npm run lint && npm test -- --test-file-pattern=agent-members 2>&1 | tail -30
```

Expected: all mutateConfigMembers, patchAgentMembers, and cmd tests PASS; lint clean.

- [ ] **Step 6: Commit**

```bash
git add packages/typescript/src/commands/agent-members.ts packages/typescript/src/commands/agent.ts packages/typescript/test/agent-members-cmd.test.ts
git commit -m "feat(agent): kweaver agent skill {add,remove,list} for #72

Ships the skill member group end-to-end: argv parsing, dispatch in
runAgentCommand, help text, and skill-specific fetchById backed by
getSkill. Replaces the hand-edit-JSON workflow for skill attachment.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Tool Command Handlers

**Files:**
- Modify: `packages/typescript/src/commands/agent-members.ts` — add `runAgentToolCommand`
- Modify: `packages/typescript/src/commands/agent.ts` — dispatch
- Test: extend `packages/typescript/test/agent-members-cmd.test.ts`

Mirrors Task 4 for tools. Exact config path, id-field, and command verb (`tool` vs `toolbox`) come from Task 1's probe.

**Prerequisites from Task 1:**
- `<TOOL_CONFIG_PATH>` — replace with the path array observed in probe, e.g. `["tools", "tools"]` or `["toolboxes"]`
- `<TOOL_ID_FIELD>` — replace with observed id-field name, e.g. `"tool_id"` or `"toolbox_id"`
- `<TOOL_VERB>` — replace with `"tool"` or `"toolbox"` based on probe decision

- [ ] **Step 1: Add TOOL_SPEC and tool `fetchById` adapter**

In `packages/typescript/src/commands/agent-members.ts`, add alongside `SKILL_SPEC`:

```ts
import { listToolboxes, listTools } from "../api/toolboxes.js";

const TOOL_SPEC: MemberSpec = {
  memberKind: "<TOOL_VERB>",
  configPath: [<TOOL_CONFIG_PATH>],
  idField: "<TOOL_ID_FIELD>",
};
```

Write a tool-specific `fetchById`. Toolboxes/tools don't have a pure `getById` endpoint — if the verb is `toolbox`, use `listToolboxes({keyword: id})` and filter; if `tool`, use `listToolboxes` to enumerate boxes then `listTools({boxId})` to find the match. Extract this into a helper:

```ts
async function fetchToolInfo(
  ctx: { baseUrl: string; accessToken: string; businessDomain: string },
  id: string,
): Promise<MemberFetchResult> {
  // Implementation depends on Task 1 decision. Pseudo-code for the "toolbox as unit" case:
  try {
    const raw = await listToolboxes({ baseUrl: ctx.baseUrl, accessToken: ctx.accessToken, businessDomain: ctx.businessDomain });
    const parsed = JSON.parse(raw) as { data?: Array<{ box_id?: string; toolbox_id?: string; id?: string; box_name?: string; status?: string }> };
    const rows = parsed.data ?? [];
    const match = rows.find((r) => String(r.box_id ?? r.toolbox_id ?? r.id) === id);
    if (!match) return { exists: false, published: false };
    return {
      exists: true,
      published: match.status === "published",
      name: match.box_name,
      status: match.status,
    };
  } catch {
    return { exists: false, published: false };
  }
}
```

For the "individual tool" case, the equivalent is nested: `listToolboxes` → for each box `listTools({boxId})` → match `tool_id`. This is O(N*M); acceptable for now, issue #72 explicitly accepts N round-trips per fetch.

- [ ] **Step 2: Copy the three runners from Task 4 and rename**

In `agent-members.ts`, duplicate `runSkillAdd` / `runSkillRemove` / `runSkillList` as `runToolAdd` / `runToolRemove` / `runToolList`. Differences:

- Use `TOOL_SPEC` instead of `SKILL_SPEC`.
- `deps.fetchById` uses `fetchToolInfo` (add) or the never-invoked stub (remove).
- `printReport` second arg becomes `"<TOOL_VERB>"`.
- `list` output row becomes `{ <TOOL_ID_FIELD>: r.id, name: r.name, status: r.status }`.

Export a dispatcher:

```ts
export async function runAgentToolCommand(args: string[]): Promise<number> {
  const [verb, ...rest] = args;
  if (!verb || verb === "--help" || verb === "-h") {
    console.log(`kweaver agent <TOOL_VERB>
  add <agent-id> <id>... [--strict] [-bd <bd>]
  remove <agent-id> <id>... [-bd <bd>]
  list <agent-id> [--pretty|--compact] [-bd <bd>]`);
    return 0;
  }
  if (verb === "add") return runToolAdd(rest);
  if (verb === "remove") return runToolRemove(rest);
  if (verb === "list") return runToolList(rest);
  process.stderr.write(`Unknown agent <TOOL_VERB> subcommand: ${verb}\n`);
  return 1;
}
```

- [ ] **Step 3: Wire dispatch in agent.ts**

In the `dispatch` inner of `runAgentCommand`, add:

```ts
    if (subcommand === "<TOOL_VERB>") return runAgentToolCommand(rest);
```

And add a line to the help text.

- [ ] **Step 4: Add a happy-path test**

Append to `test/agent-members-cmd.test.ts` one test mirroring "agent skill add — happy path writes and reports" but targeting `["<TOOL_VERB>", "add", "ag_1", "tb_a"]` with mocks for `listToolboxes` / agent get+put.

- [ ] **Step 5: Run lint + full test suite**

```bash
cd packages/typescript && npm run lint && npm test 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/typescript/src/commands/agent-members.ts packages/typescript/src/commands/agent.ts packages/typescript/test/agent-members-cmd.test.ts
git commit -m "feat(agent): kweaver agent <TOOL_VERB> {add,remove,list} for #72

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: MCP Command Handlers

> **Gated on Task 1 probe.** If the probe determined MCP is not supported on the platform (no config field exists), DELETE this task and note the deferral in Task 8's writeup.

**Files:** same pattern as Task 5.

**Prerequisites from Task 1:**
- `<MCP_CONFIG_PATH>`, `<MCP_ID_FIELD>` from probe
- Whether a get-by-id or list endpoint exists on the platform for mcp servers

- [ ] **Step 1: Add `api/mcp-servers.ts` if absent**

If the probe found the platform API endpoints for mcp servers, create a thin wrapper matching the pattern of `api/skills.ts` — exports `getMcpServer` or `listMcpServers` as needed.

If only a list endpoint exists, the `fetchById` adapter uses list-and-filter like Task 5's tool adapter.

- [ ] **Step 2: Add MCP_SPEC + runners + dispatcher**

Same structure as Task 5, targeting `MCP_SPEC` and `runAgentMcpCommand`.

- [ ] **Step 3: Wire dispatch + help**

```ts
    if (subcommand === "mcp") return runAgentMcpCommand(rest);
```

- [ ] **Step 4: Add command test**

One happy-path test for `mcp add`.

- [ ] **Step 5: Lint + test**

```bash
cd packages/typescript && npm run lint && npm test 2>&1 | tail -10
```

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(agent): kweaver agent mcp {add,remove,list} for #72"
```

---

## Task 7: E2E Test for Skill Group

**Files:**
- Create: `packages/typescript/test/e2e/agent-member-skill.test.ts`

Reuse the existing e2e pattern (`test/e2e/*.test.ts`) and `~/.env.secrets` credential source.

- [ ] **Step 1: Find an existing e2e test to pattern-match**

```bash
ls /Users/xupeng/dev/github/kweaver-sdk/packages/typescript/test/e2e/
```

Read one (e.g., a bkn or skill e2e) to note the setup/teardown conventions.

- [ ] **Step 2: Write the e2e test**

Create `packages/typescript/test/e2e/agent-member-skill.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
// NOTE: follow the setup pattern from whichever sibling e2e test you read above —
// token loading, platform selection, cleanup helpers.

test("e2e: agent skill add/list/remove round-trip", async () => {
  // 1. Pre-req: a skill already registered + published on the platform (use a known fixture id).
  // 2. Pre-req: create a fresh test agent (kweaver agent create ...) and capture its id.
  // 3. Run: kweaver agent skill add <ag> <sk>  →  assert exit 0, assert list contains it.
  // 4. Run: kweaver agent skill list <ag>       →  assert sk appears with status "published".
  // 5. Run: kweaver agent skill remove <ag> <sk> → assert exit 0, assert list is empty.
  // 6. Cleanup: delete the test agent.
  //
  // Invoke via runAgentCommand directly (same pattern as test/agent.test.ts's
  // "run agent sessions prints conversations" test but without mocking fetch).
});
```

Fill in the pseudo-code with real runAgentCommand calls, capturing stdout via a log spy.

- [ ] **Step 3: Run the e2e test**

```bash
cd packages/typescript && npm run test:e2e -- --test-file-pattern=agent-member-skill 2>&1 | tail -20
```

Expected: PASS against the real platform.

- [ ] **Step 4: Commit**

```bash
git add packages/typescript/test/e2e/agent-member-skill.test.ts
git commit -m "test(e2e): agent skill member round-trip for #72

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Manual Verification + Issue Writeup

**Files:**
- None modified. Artifacts posted to GitHub issue #72.

Hand-verify the UX promise of the spec and post a close-out comment on issue #72.

- [ ] **Step 1: Build the CLI from this branch**

```bash
cd packages/typescript && npm run build
```

- [ ] **Step 2: Run the before/after comparison**

Pick a test agent on dip-poc. Record:

- **Before** the change (describe the old flow — copy from issue #72 original);
- **After** the change — run the new commands and capture actual terminal output:

```bash
kweaver agent skill list <agent-id> --compact
kweaver agent skill add <agent-id> <skill-id>
kweaver agent skill list <agent-id> --compact
kweaver agent skill remove <agent-id> <skill-id>
```

Verify:
1. Before add: skill not in list.
2. After add: skill in list with correct name + status.
3. `agent get <agent-id>` afterward: other config fields (llms, system_prompt, data_source) untouched.
4. After remove: skill gone from list.
5. Tool group: same round-trip.
6. MCP group (if shipped): same round-trip.

- [ ] **Step 3: Post a close-out comment on issue #72**

Use `gh issue comment 72 --repo kweaver-ai/kweaver-sdk --body-file <file>` with content:

- Summary of what shipped (9 / 6 / 3 subcommands depending on scope).
- Before/after terminal transcript from Step 2.
- What was explicitly deferred and why (llm, knowledge-network, `set` verb, flag form, agent trace fix — each cites its own follow-up rationale).
- Link to the merged PR when available.

- [ ] **Step 4: Final commit if any docs updated during verification**

```bash
git status
# if docs/superpowers/plans/research/2026-04-21-agent-config-probe.md was updated:
git commit -am "docs: final probe findings for #72 close-out"
```

---

## Self-Review

Ran a final pass against the spec:

- **Spec coverage:** Every spec section has a task. Section-to-task mapping:
  - "目标 UX" before/after → Task 8
  - "CLI 表面" 9 commands → Tasks 4, 5, 6
  - "底层机制" `patchAgentMembers` + `listAgentMembers` → Tasks 2, 3
  - "校验与用户可见输出" → Tasks 3 (logic), 4 (printReport)
  - "测试" 单元 / 集成 / e2e / 手工 → Tasks 2, 3, 4-6 (cmd), 7 (e2e), 8 (manual)
  - "文件改动清单" → matches File Structure header exactly
  - "已知 limitation" → surfaced in Task 8's writeup (the "deferred" list)

- **Placeholder scan:** Task 5 and Task 6 intentionally keep `<TOOL_*>` and `<MCP_*>` placeholders because Task 1 supplies those values — this is an explicit substitution step, not an unfilled gap. All other tasks have concrete code and commands.

- **Type consistency:** `MemberSpec`, `MemberFetchResult`, `AgentMembersDeps`, `PatchAgentMembersReport`, `MutationReport`, `mutateConfigMembers`, `patchAgentMembers`, `listAgentMembers` — names and shapes used identically across Tasks 2, 3, 4, 5, 6.
