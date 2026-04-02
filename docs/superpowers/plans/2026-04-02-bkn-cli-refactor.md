# BKN CLI Refactor & Missing Commands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `commands/bkn.ts` (3,396 lines) into 4 capability-domain files and add 5 new CLI command groups (concept-group, action-schedule, job, relation-type-paths, resources).

**Architecture:** Extract handler functions and their parse helpers from `bkn.ts` into `bkn-schema.ts`, `bkn-query.ts`, `bkn-ops.ts` by capability domain. Add new HTTP functions in `api/bkn-backend.ts`. The routing entry point `runKnCommand()` stays in `bkn.ts` and imports handlers from the new files. Shared utilities (`parseOntologyQueryFlags`, `confirmYes`, `pollWithBackoff`, etc.) are exported from `bkn.ts` for the sub-files to import.

**Tech Stack:** TypeScript, Node.js built-in test runner, fetch API

---

## File Map

| File | Role | Action |
|------|------|--------|
| `src/commands/bkn.ts` | KN CRUD + routing + shared utils | Modify: extract handlers, add new routes |
| `src/commands/bkn-schema.ts` | Schema management commands | Create |
| `src/commands/bkn-query.ts` | Query & execution commands | Create |
| `src/commands/bkn-ops.ts` | Operations commands | Create |
| `src/api/bkn-backend.ts` | BKN backend HTTP functions | Modify: add new API functions |
| `test/cli.test.ts` | CLI tests | Modify: update imports, add new tests |
| `test/bkn-backend.test.ts` | API layer tests for new functions | Create |

---

### Task 1: Extract bkn-schema.ts — Schema management commands

Move object-type, relation-type, and action-type handlers from `bkn.ts` into `bkn-schema.ts`.

**Files:**
- Create: `src/commands/bkn-schema.ts`
- Modify: `src/commands/bkn.ts` (remove moved code, add imports, export shared utils)

- [ ] **Step 1: Export shared utilities from bkn.ts**

In `bkn.ts`, add `export` to these currently-private functions so sub-files can import them:
- `parseOntologyQueryFlags` (line 1274) — add `export`
- `confirmYes` (line 1398) — add `export`
- `detectPrimaryKey` (line 1371) — add `export`
- `detectDisplayKey` (line 1386) — add `export`
- `parseJsonObject` (line 641) — add `export`
- `parseSearchAfterArray` (line 716) — add `export`
- `DISPLAY_HINTS` (line 1368) — add `export`
- `TERMINAL_STATUSES` (find near action-type execute) — add `export`

Also export the `ObjectTypeUpdateParsed` type and any other types used by the moved handlers.

- [ ] **Step 2: Create bkn-schema.ts with moved handlers**

Create `src/commands/bkn-schema.ts`. Move these functions (cut from bkn.ts, paste into new file):

```typescript
// src/commands/bkn-schema.ts
import { ensureValidToken, formatHttpError } from "../auth/oauth.js";
import {
  listObjectTypes, getObjectType, createObjectTypes, updateObjectType, deleteObjectTypes,
  listRelationTypes, getRelationType, createRelationTypes, updateRelationType, deleteRelationTypes,
  listActionTypes,
} from "../api/knowledge-networks.js";
import {
  objectTypeQuery, objectTypeProperties,
  actionTypeQuery, actionTypeExecute, actionExecutionGet,
} from "../api/ontology-query.js";
import { listTablesWithColumns, scanMetadata, getDatasource } from "../api/datasources.js";
import { createDataView, findDataView } from "../api/dataviews.js";
import { formatCallOutput } from "./call.js";
import { resolveBusinessDomain } from "../config/store.js";
import {
  parseOntologyQueryFlags, confirmYes, pollWithBackoff,
  parseJsonObject, parseSearchAfterArray, DISPLAY_HINTS,
  type KnActionTypeExecuteOptions,
  type KnObjectTypeQueryOptions,
} from "./bkn.js";

// Move these functions here (lines from bkn.ts):
// - parseObjectTypeCreateArgs (907–989)
// - parseObjectTypeUpdateArgs (1090–1240) + ObjectTypeUpdateParsed type + stripObjectTypeForPut + applyObjectTypeMerge helpers
// - parseObjectTypeDeleteArgs (1241–1271)
// - parseKnObjectTypeQueryArgs (731–813) + KnObjectTypeQueryOptions interface (633–640)
// - parseKnActionTypeExecuteArgs (1313–1366) + KnActionTypeExecuteOptions interface (1303–1311)
// - parseRelationTypeCreateArgs (1598–1677)
// - parseRelationTypeUpdateArgs (1678–1719)
// - parseRelationTypeDeleteArgs (1720–1751)
// - TERMINAL_STATUSES constant
// - extractExecutionId, extractStatus helpers
// - runKnObjectTypeCommand (1409–1595)
// - runKnRelationTypeCommand (1752–1868)
// - runKnActionTypeCommand (1951–2090)

export { parseObjectTypeCreateArgs, parseKnObjectTypeQueryArgs, parseKnActionTypeExecuteArgs, parseRelationTypeCreateArgs };

export async function runKnObjectTypeCommand(args: string[]): Promise<number> { /* moved code */ }
export async function runKnRelationTypeCommand(args: string[]): Promise<number> { /* moved code */ }
export async function runKnActionTypeCommand(args: string[]): Promise<number> { /* moved code */ }
```

The actual function bodies are moved verbatim — no logic changes.

- [ ] **Step 3: Update bkn.ts to import from bkn-schema.ts**

In `bkn.ts`, replace the moved handler definitions with imports:

```typescript
import {
  runKnObjectTypeCommand,
  runKnRelationTypeCommand,
  runKnActionTypeCommand,
  parseObjectTypeCreateArgs,
  parseKnObjectTypeQueryArgs,
  parseKnActionTypeExecuteArgs,
  parseRelationTypeCreateArgs,
} from "./bkn-schema.js";
```

Remove the API imports that are no longer used in bkn.ts (e.g., `objectTypeQuery`, `actionTypeExecute`, etc.) — only if they're exclusively used by moved code.

Re-export parse functions that tests import from `bkn.js`:

```typescript
export {
  parseObjectTypeCreateArgs,
  parseKnObjectTypeQueryArgs,
  parseKnActionTypeExecuteArgs,
  parseRelationTypeCreateArgs,
} from "./bkn-schema.js";
```

- [ ] **Step 4: Run tests to verify no regressions**

Run: `cd packages/typescript && npm test`
Expected: 423 tests pass, 0 fail

- [ ] **Step 5: Commit**

```bash
git add src/commands/bkn.ts src/commands/bkn-schema.ts
git commit -m "refactor(bkn): extract schema commands to bkn-schema.ts"
```

---

### Task 2: Extract bkn-query.ts — Query & execution commands

Move subgraph, action-execution, action-log, and search handlers.

**Files:**
- Create: `src/commands/bkn-query.ts`
- Modify: `src/commands/bkn.ts`

- [ ] **Step 1: Create bkn-query.ts with moved handlers**

```typescript
// src/commands/bkn-query.ts
import { ensureValidToken, formatHttpError } from "../auth/oauth.js";
import {
  subgraph,
  actionExecutionGet,
  actionLogsList, actionLogGet, actionLogCancel,
} from "../api/ontology-query.js";
import { semanticSearch } from "../api/semantic-search.js";
import { formatCallOutput } from "./call.js";
import { resolveBusinessDomain } from "../config/store.js";
import { parseOntologyQueryFlags } from "./bkn.js";

// Move these functions here (lines from bkn.ts):
// - runKnSubgraphCommand (1870–1950)
// - runKnActionExecutionCommand (2092–2133)
// - runKnActionLogCommand (2134–2262)
// - runKnSearchCommand (3208–3329) + parseKnSearchArgs (3162–3207)

export { parseKnSearchArgs };

export async function runKnSubgraphCommand(args: string[]): Promise<number> { /* moved */ }
export async function runKnActionExecutionCommand(args: string[]): Promise<number> { /* moved */ }
export async function runKnActionLogCommand(args: string[]): Promise<number> { /* moved */ }
export async function runKnSearchCommand(args: string[]): Promise<number> { /* moved */ }
```

- [ ] **Step 2: Update bkn.ts imports and re-exports**

```typescript
import {
  runKnSubgraphCommand,
  runKnActionExecutionCommand,
  runKnActionLogCommand,
  runKnSearchCommand,
  parseKnSearchArgs,
} from "./bkn-query.js";

export { parseKnSearchArgs } from "./bkn-query.js";
```

Remove now-unused imports from bkn.ts (`subgraph`, `actionLogsList`, etc.).

- [ ] **Step 3: Run tests**

Run: `cd packages/typescript && npm test`
Expected: 423 tests pass

- [ ] **Step 4: Commit**

```bash
git add src/commands/bkn.ts src/commands/bkn-query.ts
git commit -m "refactor(bkn): extract query commands to bkn-query.ts"
```

---

### Task 3: Extract bkn-ops.ts — Operations commands

Move build, validate, push, pull, export, stats, create-from-ds, create-from-csv handlers.

**Files:**
- Create: `src/commands/bkn-ops.ts`
- Modify: `src/commands/bkn.ts`

- [ ] **Step 1: Create bkn-ops.ts with moved handlers**

```typescript
// src/commands/bkn-ops.ts
import { execSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { loadNetwork, allObjects, allRelations, allActions, generateChecksum, validateNetwork } from "@kweaver-ai/bkn";
import {
  prepareBknDirectoryForImport,
  stripBknEncodingCliArgs,
  type BknEncodingImportOptions,
} from "../utils/bkn-encoding.js";
import { ensureValidToken, formatHttpError } from "../auth/oauth.js";
import { buildKnowledgeNetwork, getBuildStatus } from "../api/knowledge-networks.js";
import { listTablesWithColumns, scanMetadata, getDatasource } from "../api/datasources.js";
import { createDataView, findDataView } from "../api/dataviews.js";
import { downloadBkn, uploadBkn } from "../api/bkn-backend.js";
import { formatCallOutput } from "./call.js";
import { resolveBusinessDomain } from "../config/store.js";
import { runDsImportCsv } from "./ds.js";
import {
  pollWithBackoff, confirmYes, parseOntologyQueryFlags,
  detectPrimaryKey, detectDisplayKey, DISPLAY_HINTS,
  type KnListOptions,
} from "./bkn.js";

// Move these functions here (lines from bkn.ts):
// - runKnBuildCommand (2841–2974) + parseKnBuildArgs (2796–2840)
// - runKnValidateCommand (2975–3043)
// - runKnPushCommand (3044–3116)
// - runKnPullCommand (3117–3161)
// - runKnCreateFromDsCommand (2544–2705) + parseKnCreateFromDsArgs (2453–2543)
// - runKnCreateFromCsvCommand (3330–3396) + parseKnCreateFromCsvArgs (3255–3329)

export { parseKnBuildArgs };

export async function runKnBuildCommand(args: string[]): Promise<number> { /* moved */ }
export async function runKnValidateCommand(args: string[]): Promise<number> { /* moved */ }
export async function runKnPushCommand(args: string[]): Promise<number> { /* moved */ }
export async function runKnPullCommand(args: string[]): Promise<number> { /* moved */ }
export async function runKnCreateFromDsCommand(args: string[]): Promise<number> { /* moved */ }
export async function runKnCreateFromCsvCommand(args: string[]): Promise<number> { /* moved */ }
```

- [ ] **Step 2: Update bkn.ts imports and re-exports**

```typescript
import {
  runKnBuildCommand, runKnValidateCommand, runKnPushCommand, runKnPullCommand,
  runKnCreateFromDsCommand, runKnCreateFromCsvCommand,
  parseKnBuildArgs,
} from "./bkn-ops.js";

export { parseKnBuildArgs } from "./bkn-ops.js";
```

Remove now-unused imports from bkn.ts (filesystem, child_process, @kweaver-ai/bkn, etc.).

- [ ] **Step 3: Run tests**

Run: `cd packages/typescript && npm test`
Expected: 423 tests pass

- [ ] **Step 4: Commit**

```bash
git add src/commands/bkn.ts src/commands/bkn-ops.ts
git commit -m "refactor(bkn): extract ops commands to bkn-ops.ts"
```

---

### Task 4: Add API functions for new commands in bkn-backend.ts

Add all HTTP functions needed by the 5 new command groups.

**Files:**
- Modify: `src/api/bkn-backend.ts`
- Create: `test/bkn-backend.test.ts`

- [ ] **Step 1: Write failing tests for all new API functions**

Create `test/bkn-backend.test.ts`:

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import {
  listConceptGroups, getConceptGroup, createConceptGroup, updateConceptGroup,
  deleteConceptGroup, addConceptGroupMembers, removeConceptGroupMembers,
  listActionSchedules, getActionSchedule, createActionSchedule, updateActionSchedule,
  setActionScheduleStatus, deleteActionSchedules,
  listJobs, getJob, getJobTasks, deleteJobs,
  queryRelationTypePaths, listBknResources,
} from "../src/api/bkn-backend.js";

const originalFetch = globalThis.fetch;

test("listConceptGroups sends GET to /concept-groups", async () => {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    assert.equal(init?.method, "GET");
    assert.ok(url.endsWith("/knowledge-networks/kn-1/concept-groups"));
    return new Response("[]", { status: 200 });
  };
  try {
    await listConceptGroups({ baseUrl: "https://host", accessToken: "t", knId: "kn-1" });
  } finally { globalThis.fetch = originalFetch; }
});

test("getConceptGroup sends GET to /concept-groups/:id", async () => {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    assert.equal(init?.method, "GET");
    assert.ok(url.endsWith("/concept-groups/cg-1"));
    return new Response("{}", { status: 200 });
  };
  try {
    await getConceptGroup({ baseUrl: "https://host", accessToken: "t", knId: "kn-1", cgId: "cg-1" });
  } finally { globalThis.fetch = originalFetch; }
});

test("createConceptGroup sends POST to /concept-groups", async () => {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    assert.equal(init?.method, "POST");
    assert.ok(url.endsWith("/concept-groups"));
    assert.equal(init?.body, '{"name":"g1"}');
    return new Response("{}", { status: 201 });
  };
  try {
    await createConceptGroup({ baseUrl: "https://host", accessToken: "t", knId: "kn-1", body: '{"name":"g1"}' });
  } finally { globalThis.fetch = originalFetch; }
});

test("updateConceptGroup sends PUT to /concept-groups/:id", async () => {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    assert.equal(init?.method, "PUT");
    assert.ok(url.endsWith("/concept-groups/cg-1"));
    return new Response("{}", { status: 200 });
  };
  try {
    await updateConceptGroup({ baseUrl: "https://host", accessToken: "t", knId: "kn-1", cgId: "cg-1", body: '{}' });
  } finally { globalThis.fetch = originalFetch; }
});

test("deleteConceptGroup sends DELETE to /concept-groups/:id", async () => {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    assert.equal(init?.method, "DELETE");
    assert.ok(url.endsWith("/concept-groups/cg-1"));
    return new Response("", { status: 204 });
  };
  try {
    await deleteConceptGroup({ baseUrl: "https://host", accessToken: "t", knId: "kn-1", cgId: "cg-1" });
  } finally { globalThis.fetch = originalFetch; }
});

test("addConceptGroupMembers sends POST to /concept-groups/:id/object-types", async () => {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    assert.equal(init?.method, "POST");
    assert.ok(url.endsWith("/concept-groups/cg-1/object-types"));
    return new Response("{}", { status: 200 });
  };
  try {
    await addConceptGroupMembers({ baseUrl: "https://host", accessToken: "t", knId: "kn-1", cgId: "cg-1", body: '{"ot_ids":["ot-1"]}' });
  } finally { globalThis.fetch = originalFetch; }
});

test("removeConceptGroupMembers sends DELETE to /concept-groups/:id/object-types/:ids", async () => {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    assert.equal(init?.method, "DELETE");
    assert.ok(url.endsWith("/concept-groups/cg-1/object-types/ot-1,ot-2"));
    return new Response("", { status: 204 });
  };
  try {
    await removeConceptGroupMembers({ baseUrl: "https://host", accessToken: "t", knId: "kn-1", cgId: "cg-1", otIds: "ot-1,ot-2" });
  } finally { globalThis.fetch = originalFetch; }
});

test("listActionSchedules sends GET to /action-schedules", async () => {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    assert.equal(init?.method, "GET");
    assert.ok(url.endsWith("/action-schedules"));
    return new Response("[]", { status: 200 });
  };
  try {
    await listActionSchedules({ baseUrl: "https://host", accessToken: "t", knId: "kn-1" });
  } finally { globalThis.fetch = originalFetch; }
});

test("getActionSchedule sends GET to /action-schedules/:id", async () => {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    assert.equal(init?.method, "GET");
    assert.ok(url.endsWith("/action-schedules/s-1"));
    return new Response("{}", { status: 200 });
  };
  try {
    await getActionSchedule({ baseUrl: "https://host", accessToken: "t", knId: "kn-1", scheduleId: "s-1" });
  } finally { globalThis.fetch = originalFetch; }
});

test("createActionSchedule sends POST to /action-schedules", async () => {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    assert.equal(init?.method, "POST");
    assert.ok(url.endsWith("/action-schedules"));
    return new Response("{}", { status: 201 });
  };
  try {
    await createActionSchedule({ baseUrl: "https://host", accessToken: "t", knId: "kn-1", body: '{}' });
  } finally { globalThis.fetch = originalFetch; }
});

test("updateActionSchedule sends PUT to /action-schedules/:id", async () => {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    assert.equal(init?.method, "PUT");
    assert.ok(url.endsWith("/action-schedules/s-1"));
    return new Response("{}", { status: 200 });
  };
  try {
    await updateActionSchedule({ baseUrl: "https://host", accessToken: "t", knId: "kn-1", scheduleId: "s-1", body: '{}' });
  } finally { globalThis.fetch = originalFetch; }
});

test("setActionScheduleStatus sends PUT to /action-schedules/:id/status", async () => {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    assert.equal(init?.method, "PUT");
    assert.ok(url.endsWith("/action-schedules/s-1/status"));
    assert.equal(init?.body, '{"status":"enabled"}');
    return new Response("{}", { status: 200 });
  };
  try {
    await setActionScheduleStatus({ baseUrl: "https://host", accessToken: "t", knId: "kn-1", scheduleId: "s-1", body: '{"status":"enabled"}' });
  } finally { globalThis.fetch = originalFetch; }
});

test("deleteActionSchedules sends DELETE to /action-schedules/:ids", async () => {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    assert.equal(init?.method, "DELETE");
    assert.ok(url.endsWith("/action-schedules/s-1,s-2"));
    return new Response("", { status: 204 });
  };
  try {
    await deleteActionSchedules({ baseUrl: "https://host", accessToken: "t", knId: "kn-1", scheduleIds: "s-1,s-2" });
  } finally { globalThis.fetch = originalFetch; }
});

test("listJobs sends GET to /jobs", async () => {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    assert.equal(init?.method, "GET");
    assert.ok(url.includes("/jobs"));
    return new Response("[]", { status: 200 });
  };
  try {
    await listJobs({ baseUrl: "https://host", accessToken: "t", knId: "kn-1" });
  } finally { globalThis.fetch = originalFetch; }
});

test("getJob sends GET to /jobs/:id", async () => {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    assert.equal(init?.method, "GET");
    assert.ok(url.endsWith("/jobs/j-1"));
    return new Response("{}", { status: 200 });
  };
  try {
    await getJob({ baseUrl: "https://host", accessToken: "t", knId: "kn-1", jobId: "j-1" });
  } finally { globalThis.fetch = originalFetch; }
});

test("getJobTasks sends GET to /jobs/:id/tasks", async () => {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    assert.equal(init?.method, "GET");
    assert.ok(url.endsWith("/jobs/j-1/tasks"));
    return new Response("[]", { status: 200 });
  };
  try {
    await getJobTasks({ baseUrl: "https://host", accessToken: "t", knId: "kn-1", jobId: "j-1" });
  } finally { globalThis.fetch = originalFetch; }
});

test("deleteJobs sends DELETE to /jobs/:ids", async () => {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    assert.equal(init?.method, "DELETE");
    assert.ok(url.endsWith("/jobs/j-1,j-2"));
    return new Response("", { status: 204 });
  };
  try {
    await deleteJobs({ baseUrl: "https://host", accessToken: "t", knId: "kn-1", jobIds: "j-1,j-2" });
  } finally { globalThis.fetch = originalFetch; }
});

test("queryRelationTypePaths sends POST to /relation-type-paths", async () => {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    assert.equal(init?.method, "POST");
    assert.ok(url.endsWith("/relation-type-paths"));
    return new Response("{}", { status: 200 });
  };
  try {
    await queryRelationTypePaths({ baseUrl: "https://host", accessToken: "t", knId: "kn-1", body: '{}' });
  } finally { globalThis.fetch = originalFetch; }
});

test("listBknResources sends GET to /resources", async () => {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    assert.equal(init?.method, "GET");
    assert.ok(url.endsWith("/resources"));
    return new Response("[]", { status: 200 });
  };
  try {
    await listBknResources({ baseUrl: "https://host", accessToken: "t" });
  } finally { globalThis.fetch = originalFetch; }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/typescript && npx tsx --test test/bkn-backend.test.ts`
Expected: All 18 tests fail (functions not exported)

- [ ] **Step 3: Implement API functions in bkn-backend.ts**

Append to `src/api/bkn-backend.ts`:

```typescript
// ── Base options for BKN backend API calls ──────────────────────────────────

export interface BknBackendBaseOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
}

export interface BknBackendKnOptions extends BknBackendBaseOptions {
  knId: string;
}

const BKN_BASE = "/api/bkn-backend/v1";

function knUrl(baseUrl: string, knId: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return `${base}${BKN_BASE}/knowledge-networks/${encodeURIComponent(knId)}/${path}`;
}

function baseUrlOnly(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return `${base}${BKN_BASE}/${path}`;
}

async function bknGet(url: string, accessToken: string, businessDomain = "bd_public"): Promise<string> {
  const response = await fetch(url, { method: "GET", headers: buildHeaders(accessToken, businessDomain) });
  const body = await response.text();
  if (!response.ok) throw new HttpError(response.status, response.statusText, body);
  return body;
}

async function bknPost(url: string, accessToken: string, reqBody: string, businessDomain = "bd_public"): Promise<string> {
  const response = await fetch(url, {
    method: "POST",
    headers: { ...buildHeaders(accessToken, businessDomain), "content-type": "application/json" },
    body: reqBody,
  });
  const body = await response.text();
  if (!response.ok) throw new HttpError(response.status, response.statusText, body);
  return body;
}

async function bknPut(url: string, accessToken: string, reqBody: string, businessDomain = "bd_public"): Promise<string> {
  const response = await fetch(url, {
    method: "PUT",
    headers: { ...buildHeaders(accessToken, businessDomain), "content-type": "application/json" },
    body: reqBody,
  });
  const body = await response.text();
  if (!response.ok) throw new HttpError(response.status, response.statusText, body);
  return body;
}

async function bknDelete(url: string, accessToken: string, businessDomain = "bd_public"): Promise<string> {
  const response = await fetch(url, { method: "DELETE", headers: buildHeaders(accessToken, businessDomain) });
  const body = await response.text();
  if (!response.ok) throw new HttpError(response.status, response.statusText, body);
  return body;
}

// ── Concept Group ───────────────────────────────────────────────────────────

export interface ConceptGroupOptions extends BknBackendKnOptions { cgId: string; }
export interface ConceptGroupBodyOptions extends BknBackendKnOptions { body: string; }
export interface ConceptGroupMutateOptions extends ConceptGroupOptions { body: string; }
export interface ConceptGroupRemoveMembersOptions extends ConceptGroupOptions { otIds: string; }

export async function listConceptGroups(opts: BknBackendKnOptions): Promise<string> {
  return bknGet(knUrl(opts.baseUrl, opts.knId, "concept-groups"), opts.accessToken, opts.businessDomain);
}

export async function getConceptGroup(opts: ConceptGroupOptions): Promise<string> {
  return bknGet(knUrl(opts.baseUrl, opts.knId, `concept-groups/${encodeURIComponent(opts.cgId)}`), opts.accessToken, opts.businessDomain);
}

export async function createConceptGroup(opts: ConceptGroupBodyOptions): Promise<string> {
  return bknPost(knUrl(opts.baseUrl, opts.knId, "concept-groups"), opts.accessToken, opts.body, opts.businessDomain);
}

export async function updateConceptGroup(opts: ConceptGroupMutateOptions): Promise<string> {
  return bknPut(knUrl(opts.baseUrl, opts.knId, `concept-groups/${encodeURIComponent(opts.cgId)}`), opts.accessToken, opts.body, opts.businessDomain);
}

export async function deleteConceptGroup(opts: ConceptGroupOptions): Promise<string> {
  return bknDelete(knUrl(opts.baseUrl, opts.knId, `concept-groups/${encodeURIComponent(opts.cgId)}`), opts.accessToken, opts.businessDomain);
}

export async function addConceptGroupMembers(opts: ConceptGroupMutateOptions): Promise<string> {
  return bknPost(knUrl(opts.baseUrl, opts.knId, `concept-groups/${encodeURIComponent(opts.cgId)}/object-types`), opts.accessToken, opts.body, opts.businessDomain);
}

export async function removeConceptGroupMembers(opts: ConceptGroupRemoveMembersOptions): Promise<string> {
  return bknDelete(knUrl(opts.baseUrl, opts.knId, `concept-groups/${encodeURIComponent(opts.cgId)}/object-types/${opts.otIds}`), opts.accessToken, opts.businessDomain);
}

// ── Action Schedule ─────────────────────────────────────────────────────────

export interface ActionScheduleOptions extends BknBackendKnOptions { scheduleId: string; }
export interface ActionScheduleBodyOptions extends BknBackendKnOptions { body: string; }
export interface ActionScheduleMutateOptions extends ActionScheduleOptions { body: string; }
export interface ActionScheduleDeleteOptions extends BknBackendKnOptions { scheduleIds: string; }

export async function listActionSchedules(opts: BknBackendKnOptions): Promise<string> {
  return bknGet(knUrl(opts.baseUrl, opts.knId, "action-schedules"), opts.accessToken, opts.businessDomain);
}

export async function getActionSchedule(opts: ActionScheduleOptions): Promise<string> {
  return bknGet(knUrl(opts.baseUrl, opts.knId, `action-schedules/${encodeURIComponent(opts.scheduleId)}`), opts.accessToken, opts.businessDomain);
}

export async function createActionSchedule(opts: ActionScheduleBodyOptions): Promise<string> {
  return bknPost(knUrl(opts.baseUrl, opts.knId, "action-schedules"), opts.accessToken, opts.body, opts.businessDomain);
}

export async function updateActionSchedule(opts: ActionScheduleMutateOptions): Promise<string> {
  return bknPut(knUrl(opts.baseUrl, opts.knId, `action-schedules/${encodeURIComponent(opts.scheduleId)}`), opts.accessToken, opts.body, opts.businessDomain);
}

export async function setActionScheduleStatus(opts: ActionScheduleMutateOptions): Promise<string> {
  return bknPut(knUrl(opts.baseUrl, opts.knId, `action-schedules/${encodeURIComponent(opts.scheduleId)}/status`), opts.accessToken, opts.body, opts.businessDomain);
}

export async function deleteActionSchedules(opts: ActionScheduleDeleteOptions): Promise<string> {
  return bknDelete(knUrl(opts.baseUrl, opts.knId, `action-schedules/${opts.scheduleIds}`), opts.accessToken, opts.businessDomain);
}

// ── Job ─────────────────────────────────────────────────────────────────────

export interface JobOptions extends BknBackendKnOptions { jobId: string; }
export interface JobDeleteOptions extends BknBackendKnOptions { jobIds: string; }

export async function listJobs(opts: BknBackendKnOptions): Promise<string> {
  return bknGet(knUrl(opts.baseUrl, opts.knId, "jobs"), opts.accessToken, opts.businessDomain);
}

export async function getJob(opts: JobOptions): Promise<string> {
  return bknGet(knUrl(opts.baseUrl, opts.knId, `jobs/${encodeURIComponent(opts.jobId)}`), opts.accessToken, opts.businessDomain);
}

export async function getJobTasks(opts: JobOptions): Promise<string> {
  return bknGet(knUrl(opts.baseUrl, opts.knId, `jobs/${encodeURIComponent(opts.jobId)}/tasks`), opts.accessToken, opts.businessDomain);
}

export async function deleteJobs(opts: JobDeleteOptions): Promise<string> {
  return bknDelete(knUrl(opts.baseUrl, opts.knId, `jobs/${opts.jobIds}`), opts.accessToken, opts.businessDomain);
}

// ── Relation Type Paths & Resources ─────────────────────────────────────────

export interface RelationTypePathsOptions extends BknBackendKnOptions { body: string; }

export async function queryRelationTypePaths(opts: RelationTypePathsOptions): Promise<string> {
  return bknPost(knUrl(opts.baseUrl, opts.knId, "relation-type-paths"), opts.accessToken, opts.body, opts.businessDomain);
}

export async function listBknResources(opts: BknBackendBaseOptions): Promise<string> {
  return bknGet(baseUrlOnly(opts.baseUrl, "resources"), opts.accessToken, opts.businessDomain);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/typescript && npm test`
Expected: All tests pass (existing 423 + 18 new)

- [ ] **Step 5: Commit**

```bash
git add src/api/bkn-backend.ts test/bkn-backend.test.ts
git commit -m "feat(api): add bkn-backend API functions for concept-group, action-schedule, job, relation-type-paths, resources"
```

---

### Task 5: Add concept-group CLI commands in bkn-schema.ts

**Files:**
- Modify: `src/commands/bkn-schema.ts`
- Modify: `src/commands/bkn.ts` (add route + help text)
- Modify: `test/cli.test.ts` (add tests)

- [ ] **Step 1: Write failing tests for parseConceptGroupArgs and help text**

Add to `test/cli.test.ts`:

```typescript
import {
  parseConceptGroupArgs,
} from "../src/commands/bkn-schema.js";

test("parseConceptGroupArgs parses list args", () => {
  const opts = parseConceptGroupArgs(["list", "kn-1"]);
  assert.equal(opts.action, "list");
  assert.equal(opts.knId, "kn-1");
});

test("parseConceptGroupArgs parses create with body", () => {
  const opts = parseConceptGroupArgs(["create", "kn-1", '{"name":"g1"}']);
  assert.equal(opts.action, "create");
  assert.equal(opts.knId, "kn-1");
  assert.equal(opts.body, '{"name":"g1"}');
});

test("parseConceptGroupArgs parses delete with -y", () => {
  const opts = parseConceptGroupArgs(["delete", "kn-1", "cg-1", "-y"]);
  assert.equal(opts.action, "delete");
  assert.equal(opts.knId, "kn-1");
  assert.equal(opts.itemId, "cg-1");
  assert.equal(opts.yes, true);
});

test("parseConceptGroupArgs parses add-members", () => {
  const opts = parseConceptGroupArgs(["add-members", "kn-1", "cg-1", "ot-1,ot-2"]);
  assert.equal(opts.action, "add-members");
  assert.equal(opts.knId, "kn-1");
  assert.equal(opts.itemId, "cg-1");
  assert.equal(opts.extra, "ot-1,ot-2");
});

test("parseConceptGroupArgs parses remove-members with -y", () => {
  const opts = parseConceptGroupArgs(["remove-members", "kn-1", "cg-1", "ot-1", "-y"]);
  assert.equal(opts.action, "remove-members");
  assert.equal(opts.itemId, "cg-1");
  assert.equal(opts.extra, "ot-1");
  assert.equal(opts.yes, true);
});

test("run bkn concept-group --help shows all actions", async () => {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  try {
    assert.equal(await run(["bkn", "concept-group", "--help"]), 0);
    const help = lines.join("\n");
    assert.ok(help.includes("concept-group list"));
    assert.ok(help.includes("concept-group create"));
    assert.ok(help.includes("add-members"));
    assert.ok(help.includes("remove-members"));
  } finally { console.log = originalLog; }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/typescript && npm test`
Expected: New tests fail

- [ ] **Step 3: Implement parseConceptGroupArgs and runKnConceptGroupCommand**

Add to `src/commands/bkn-schema.ts`:

```typescript
import {
  listConceptGroups, getConceptGroup, createConceptGroup, updateConceptGroup,
  deleteConceptGroup, addConceptGroupMembers, removeConceptGroupMembers,
} from "../api/bkn-backend.js";

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
```

- [ ] **Step 4: Add route and help text in bkn.ts**

In `bkn.ts`, add to `KN_HELP`:
```
  concept-group list|get|create|update|delete|add-members|remove-members <kn-id> ...
```

In `runKnCommand` dispatch:
```typescript
if (subcommand === "concept-group") return runKnConceptGroupCommand(rest);
```

Add import:
```typescript
import { runKnConceptGroupCommand } from "./bkn-schema.js";
```

- [ ] **Step 5: Run tests**

Run: `cd packages/typescript && npm test`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/commands/bkn-schema.ts src/commands/bkn.ts test/cli.test.ts
git commit -m "feat(bkn): add concept-group CLI commands"
```

---

### Task 6: Add action-schedule CLI commands in bkn-ops.ts

**Files:**
- Modify: `src/commands/bkn-ops.ts`
- Modify: `src/commands/bkn.ts` (add route + help text)
- Modify: `test/cli.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `test/cli.test.ts`:

```typescript
import {
  parseActionScheduleArgs,
} from "../src/commands/bkn-ops.js";

test("parseActionScheduleArgs parses list", () => {
  const opts = parseActionScheduleArgs(["list", "kn-1"]);
  assert.equal(opts.action, "list");
  assert.equal(opts.knId, "kn-1");
});

test("parseActionScheduleArgs parses set-status", () => {
  const opts = parseActionScheduleArgs(["set-status", "kn-1", "s-1", "enabled"]);
  assert.equal(opts.action, "set-status");
  assert.equal(opts.knId, "kn-1");
  assert.equal(opts.itemId, "s-1");
  assert.equal(opts.extra, "enabled");
});

test("parseActionScheduleArgs parses delete with -y", () => {
  const opts = parseActionScheduleArgs(["delete", "kn-1", "s-1,s-2", "-y"]);
  assert.equal(opts.action, "delete");
  assert.equal(opts.itemId, "s-1,s-2");
  assert.equal(opts.yes, true);
});

test("run bkn action-schedule --help shows all actions", async () => {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  try {
    assert.equal(await run(["bkn", "action-schedule", "--help"]), 0);
    const help = lines.join("\n");
    assert.ok(help.includes("action-schedule list"));
    assert.ok(help.includes("set-status"));
  } finally { console.log = originalLog; }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/typescript && npm test`
Expected: New tests fail

- [ ] **Step 3: Implement parseActionScheduleArgs and runKnActionScheduleCommand**

Add to `src/commands/bkn-ops.ts`:

```typescript
import {
  listActionSchedules, getActionSchedule, createActionSchedule,
  updateActionSchedule, setActionScheduleStatus, deleteActionSchedules,
} from "../api/bkn-backend.js";

export interface ActionScheduleParsed {
  action: string;
  knId: string;
  itemId: string;
  body: string;
  extra: string;
  yes: boolean;
  pretty: boolean;
  businessDomain: string;
}

export function parseActionScheduleArgs(args: string[]): ActionScheduleParsed {
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
  if (!knId) throw new Error("Missing kn-id. Usage: kweaver bkn action-schedule <action> <kn-id> ...");
  if (!businessDomain) businessDomain = resolveBusinessDomain();

  return { action, knId, itemId: itemId || "", body: itemId || "", extra: extra || "", yes, pretty, businessDomain };
}

export async function runKnActionScheduleCommand(args: string[]): Promise<number> {
  let parsed: ActionScheduleParsed;
  try {
    parsed = parseActionScheduleArgs(args);
  } catch (error) {
    if (error instanceof Error && error.message === "help") {
      console.log(`kweaver bkn action-schedule <action> <kn-id> [args] [--pretty] [-bd value]

Actions:
  list <kn-id>                                    List action schedules
  get <kn-id> <schedule-id>                       Get schedule details
  create <kn-id> '<json>'                         Create schedule
  update <kn-id> <schedule-id> '<json>'           Update schedule
  set-status <kn-id> <schedule-id> <status>       Enable/disable schedule (enabled|disabled)
  delete <kn-id> <schedule-ids> [-y]              Delete schedule(s) (comma-separated)`);
      return 0;
    }
    console.error(formatHttpError(error));
    return 1;
  }

  const { action, knId, itemId, body, extra, yes, pretty, businessDomain } = parsed;
  const token = await ensureValidToken();
  const base = { baseUrl: token.baseUrl, accessToken: token.accessToken, businessDomain };

  if (action === "list") {
    const result = await listActionSchedules({ ...base, knId });
    console.log(formatCallOutput(result, pretty));
    return 0;
  }
  if (action === "get") {
    if (!itemId) { console.error("Missing schedule-id"); return 1; }
    const result = await getActionSchedule({ ...base, knId, scheduleId: itemId });
    console.log(formatCallOutput(result, pretty));
    return 0;
  }
  if (action === "create") {
    if (!itemId) { console.error("Missing JSON body"); return 1; }
    const result = await createActionSchedule({ ...base, knId, body });
    console.log(formatCallOutput(result, pretty));
    return 0;
  }
  if (action === "update") {
    if (!itemId || !extra) { console.error("Missing schedule-id or JSON body"); return 1; }
    const result = await updateActionSchedule({ ...base, knId, scheduleId: itemId, body: extra });
    console.log(formatCallOutput(result, pretty));
    return 0;
  }
  if (action === "set-status") {
    if (!itemId || !extra) { console.error("Missing schedule-id or status"); return 1; }
    const result = await setActionScheduleStatus({ ...base, knId, scheduleId: itemId, body: JSON.stringify({ status: extra }) });
    console.log(formatCallOutput(result, pretty));
    return 0;
  }
  if (action === "delete") {
    if (!itemId) { console.error("Missing schedule-ids"); return 1; }
    if (!yes) {
      const confirmed = await confirmYes(`Delete action schedule(s) ${itemId}?`);
      if (!confirmed) { console.log("Cancelled."); return 0; }
    }
    const result = await deleteActionSchedules({ ...base, knId, scheduleIds: itemId });
    console.log(formatCallOutput(result, pretty));
    return 0;
  }

  console.error(`Unknown action-schedule action: ${action}`);
  return 1;
}
```

- [ ] **Step 4: Add route and help text in bkn.ts**

In `KN_HELP`:
```
  action-schedule list|get|create|update|set-status|delete <kn-id> ...
```

In dispatch:
```typescript
if (subcommand === "action-schedule") return runKnActionScheduleCommand(rest);
```

- [ ] **Step 5: Run tests**

Run: `cd packages/typescript && npm test`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/commands/bkn-ops.ts src/commands/bkn.ts test/cli.test.ts
git commit -m "feat(bkn): add action-schedule CLI commands"
```

---

### Task 7: Add job CLI commands in bkn-ops.ts

**Files:**
- Modify: `src/commands/bkn-ops.ts`
- Modify: `src/commands/bkn.ts`
- Modify: `test/cli.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `test/cli.test.ts`:

```typescript
import {
  parseJobArgs,
} from "../src/commands/bkn-ops.js";

test("parseJobArgs parses list", () => {
  const opts = parseJobArgs(["list", "kn-1"]);
  assert.equal(opts.action, "list");
  assert.equal(opts.knId, "kn-1");
});

test("parseJobArgs parses tasks", () => {
  const opts = parseJobArgs(["tasks", "kn-1", "j-1"]);
  assert.equal(opts.action, "tasks");
  assert.equal(opts.knId, "kn-1");
  assert.equal(opts.itemId, "j-1");
});

test("parseJobArgs parses delete with -y", () => {
  const opts = parseJobArgs(["delete", "kn-1", "j-1,j-2", "-y"]);
  assert.equal(opts.action, "delete");
  assert.equal(opts.itemId, "j-1,j-2");
  assert.equal(opts.yes, true);
});

test("run bkn job --help shows all actions", async () => {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  try {
    assert.equal(await run(["bkn", "job", "--help"]), 0);
    const help = lines.join("\n");
    assert.ok(help.includes("job list"));
    assert.ok(help.includes("job tasks"));
  } finally { console.log = originalLog; }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/typescript && npm test`

- [ ] **Step 3: Implement parseJobArgs and runKnJobCommand**

Add to `src/commands/bkn-ops.ts`:

```typescript
import {
  listJobs, getJob, getJobTasks, deleteJobs,
} from "../api/bkn-backend.js";

export interface JobParsed {
  action: string;
  knId: string;
  itemId: string;
  yes: boolean;
  pretty: boolean;
  businessDomain: string;
}

export function parseJobArgs(args: string[]): JobParsed {
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

  const [knId, itemId] = positional;
  if (!knId) throw new Error("Missing kn-id. Usage: kweaver bkn job <action> <kn-id> ...");
  if (!businessDomain) businessDomain = resolveBusinessDomain();

  return { action, knId, itemId: itemId || "", yes, pretty, businessDomain };
}

export async function runKnJobCommand(args: string[]): Promise<number> {
  let parsed: JobParsed;
  try {
    parsed = parseJobArgs(args);
  } catch (error) {
    if (error instanceof Error && error.message === "help") {
      console.log(`kweaver bkn job <action> <kn-id> [args] [--pretty] [-bd value]

Actions:
  list <kn-id>                    List jobs
  get <kn-id> <job-id>            Get job details
  tasks <kn-id> <job-id>          List tasks within a job
  delete <kn-id> <job-ids> [-y]   Delete job(s) (comma-separated)`);
      return 0;
    }
    console.error(formatHttpError(error));
    return 1;
  }

  const { action, knId, itemId, yes, pretty, businessDomain } = parsed;
  const token = await ensureValidToken();
  const base = { baseUrl: token.baseUrl, accessToken: token.accessToken, businessDomain };

  if (action === "list") {
    const result = await listJobs({ ...base, knId });
    console.log(formatCallOutput(result, pretty));
    return 0;
  }
  if (action === "get") {
    if (!itemId) { console.error("Missing job-id"); return 1; }
    const result = await getJob({ ...base, knId, jobId: itemId });
    console.log(formatCallOutput(result, pretty));
    return 0;
  }
  if (action === "tasks") {
    if (!itemId) { console.error("Missing job-id"); return 1; }
    const result = await getJobTasks({ ...base, knId, jobId: itemId });
    console.log(formatCallOutput(result, pretty));
    return 0;
  }
  if (action === "delete") {
    if (!itemId) { console.error("Missing job-ids"); return 1; }
    if (!yes) {
      const confirmed = await confirmYes(`Delete job(s) ${itemId}?`);
      if (!confirmed) { console.log("Cancelled."); return 0; }
    }
    const result = await deleteJobs({ ...base, knId, jobIds: itemId });
    console.log(formatCallOutput(result, pretty));
    return 0;
  }

  console.error(`Unknown job action: ${action}`);
  return 1;
}
```

- [ ] **Step 4: Add route and help text in bkn.ts**

In `KN_HELP`:
```
  job list|get|tasks|delete <kn-id> ...
```

In dispatch:
```typescript
if (subcommand === "job") return runKnJobCommand(rest);
```

- [ ] **Step 5: Run tests**

Run: `cd packages/typescript && npm test`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/commands/bkn-ops.ts src/commands/bkn.ts test/cli.test.ts
git commit -m "feat(bkn): add job CLI commands"
```

---

### Task 8: Add relation-type-paths and resources CLI commands in bkn-query.ts

**Files:**
- Modify: `src/commands/bkn-query.ts`
- Modify: `src/commands/bkn.ts`
- Modify: `test/cli.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `test/cli.test.ts`:

```typescript
test("run bkn relation-type-paths --help shows usage", async () => {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  try {
    assert.equal(await run(["bkn", "relation-type-paths", "--help"]), 0);
    const help = lines.join("\n");
    assert.ok(help.includes("relation-type-paths"));
    assert.ok(help.includes("<kn-id>"));
  } finally { console.log = originalLog; }
});

test("run bkn resources --help shows usage", async () => {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  try {
    assert.equal(await run(["bkn", "resources", "--help"]), 0);
    const help = lines.join("\n");
    assert.ok(help.includes("resources"));
  } finally { console.log = originalLog; }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/typescript && npm test`

- [ ] **Step 3: Implement runKnRelationTypePathsCommand and runKnResourcesCommand**

Add to `src/commands/bkn-query.ts`:

```typescript
import { queryRelationTypePaths, listBknResources } from "../api/bkn-backend.js";

export async function runKnRelationTypePathsCommand(args: string[]): Promise<number> {
  const parsed = parseOntologyQueryFlags(args);
  const [knId, body] = parsed.filteredArgs;

  if (!knId || !body) {
    console.log(`kweaver bkn relation-type-paths <kn-id> '<json>' [--pretty] [-bd value]

Query relation type paths between object types.`);
    return knId && !body ? 1 : 0;
  }

  const token = await ensureValidToken();
  const result = await queryRelationTypePaths({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    knId,
    body,
    businessDomain: parsed.businessDomain,
  });
  console.log(formatCallOutput(result, parsed.pretty));
  return 0;
}

export async function runKnResourcesCommand(args: string[]): Promise<number> {
  const parsed = parseOntologyQueryFlags(args);

  if (parsed.filteredArgs.includes("--help") || parsed.filteredArgs.includes("-h")) {
    console.log(`kweaver bkn resources [--pretty] [-bd value]

List available resources.`);
    return 0;
  }

  const token = await ensureValidToken();
  const result = await listBknResources({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    businessDomain: parsed.businessDomain,
  });
  console.log(formatCallOutput(result, parsed.pretty));
  return 0;
}
```

- [ ] **Step 4: Add routes and help text in bkn.ts**

In `KN_HELP`:
```
  relation-type-paths <kn-id> '<json>'   Query relation type paths between OTs
  resources                              List available resources
```

In dispatch:
```typescript
if (subcommand === "relation-type-paths") return runKnRelationTypePathsCommand(rest);
if (subcommand === "resources") return runKnResourcesCommand(rest);
```

- [ ] **Step 5: Run tests**

Run: `cd packages/typescript && npm test`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/commands/bkn-query.ts src/commands/bkn.ts test/cli.test.ts
git commit -m "feat(bkn): add relation-type-paths and resources CLI commands"
```

---

### Task 9: Final verification and cleanup

**Files:**
- All modified files

- [ ] **Step 1: Run full test suite**

Run: `cd packages/typescript && npm test`
Expected: All tests pass (original 423 + new tests)

- [ ] **Step 2: Verify bkn.ts line count reduced**

Run: `wc -l src/commands/bkn.ts src/commands/bkn-schema.ts src/commands/bkn-query.ts src/commands/bkn-ops.ts`
Expected: bkn.ts significantly smaller, each sub-file under ~1500 lines

- [ ] **Step 3: Verify all help text**

Run these and check output:
```bash
npx tsx src/cli.ts bkn --help
npx tsx src/cli.ts bkn concept-group --help
npx tsx src/cli.ts bkn action-schedule --help
npx tsx src/cli.ts bkn job --help
npx tsx src/cli.ts bkn relation-type-paths --help
npx tsx src/cli.ts bkn resources --help
```

- [ ] **Step 4: Verify no unused imports in bkn.ts**

Check that bkn.ts no longer imports modules only used by moved code (e.g., `child_process`, `@kweaver-ai/bkn`, etc.).

- [ ] **Step 5: Final commit if any cleanup needed**

```bash
git add -A
git commit -m "chore(bkn): cleanup unused imports after refactor"
```
