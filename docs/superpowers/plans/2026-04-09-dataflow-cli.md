# Dataflow CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new TypeScript `kweaver dataflow` command group that supports `list`, `run`, `runs`, and `logs` using the `automation/v2` dataflow endpoints without affecting the existing `api/dataflow.ts`.

**Architecture:** Keep the change isolated. Add a new `api/dataflow2.ts` for v2 HTTP calls, a new `commands/dataflow.ts` that uses local `yargs` parsing only for the `dataflow` command group, and a small top-level CLI wiring change in `cli.ts`. Render list-style summaries in the command layer, and keep tests split between API behavior, command behavior, and top-level routing.

**Tech Stack:** TypeScript, Node.js built-in test runner, `yargs`, existing KWeaver auth/config helpers, `fetch`

---

## File Map

- Create: `packages/typescript/src/api/dataflow2.ts`
  - Thin wrappers for the v2 dataflow list, run, runs, and logs endpoints
- Modify: `packages/typescript/src/commands/dataflow.ts`
  - Implement `runDataflowCommand(args)` with local `yargs` subcommands and output formatting
- Modify: `packages/typescript/src/cli.ts`
  - Add `dataflow` import, routing, and top-level help text
- Modify: `packages/typescript/test/dataflow.test.ts`
  - Add API-level tests for `dataflow2.ts`
- Modify: `packages/typescript/test/cli.test.ts`
  - Add top-level CLI routing/help coverage for `dataflow`
- Create: `packages/typescript/test/dataflow-command.test.ts`
  - Command-layer tests for `list`, `run`, `runs`, and `logs`
- Modify: `packages/typescript/README.md`
  - Add `dataflow` command references if the CLI command list is documented there
- Modify: `packages/typescript/README.zh.md`
  - Add the same command references in Chinese

## Task 1: Confirm the Logs Endpoint Contract

**Files:**
- Check: `docs/superpowers/specs/2026-04-02-dataflow-cli-design.md`
- Check: backend contract source or internal reference used by the team

- [ ] **Step 1: Confirm the exact logs endpoint path**

Record the exact backend route shape for `dagId` + `instanceId` log retrieval before writing implementation code.

Expected outcome: one confirmed path that supports paged fetches with `page` and `limit`.

- [ ] **Step 2: Update the spec if the exact path differs from current assumptions**

If needed, revise the plan/spec references before touching implementation code so the command help and tests are not built on guesswork.

- [ ] **Step 3: Commit spec-only contract clarification if changed**

```bash
git add docs/superpowers/specs/2026-04-02-dataflow-cli-design.md
git commit -m "docs(spec): clarify dataflow logs endpoint"
```

## Task 2: Add Failing API Tests for `dataflow2.ts`

**Files:**
- Modify: `packages/typescript/test/dataflow.test.ts`
- Create later: `packages/typescript/src/api/dataflow2.ts`

- [ ] **Step 1: Write a failing test for listing dataflows**

Add a new test in `packages/typescript/test/dataflow.test.ts` that expects:

```ts
const body = await listDataflows({ baseUrl: BASE, accessToken: TOKEN });
assert.equal(url, `${BASE}/api/automation/v2/dags?type=data-flow&page=0&limit=-1`);
assert.equal(body.dags[0]?.id, "dag-001");
```

- [ ] **Step 2: Run the single test to verify it fails**

Run: `npm test --workspace packages/typescript -- --test-name-pattern="listDataflows"`

Expected: FAIL because `listDataflows` does not exist yet.

- [ ] **Step 3: Write failing tests for the two run modes**

Add one test for multipart upload and one for remote URL JSON:

```ts
await runDataflowWithFile({ baseUrl: BASE, accessToken: TOKEN, dagId: "dag-001", filePath: "/tmp/demo.pdf" });
await runDataflowWithRemoteUrl({
  baseUrl: BASE,
  accessToken: TOKEN,
  dagId: "dag-001",
  url: "https://example.com/demo.pdf",
  name: "demo.pdf",
});
```

Assert:

- file mode uses `POST /api/automation/v2/dataflow-doc/trigger/dag-001`
- remote mode sends JSON with `source_from: "remote"`
- both return `dag_instance_id`

- [ ] **Step 4: Run the run-mode tests to verify they fail**

Run: `npm test --workspace packages/typescript -- --test-name-pattern="runDataflowWith"`

Expected: FAIL because the new API functions do not exist yet.

- [ ] **Step 5: Write failing tests for runs and logs retrieval**

Add tests that expect:

- runs uses `GET /api/automation/v2/dag/{dagId}/results?page=0&limit=-1`
- logs uses the confirmed logs endpoint and requests `page=0&limit=10`

- [ ] **Step 6: Run the new API test subset**

Run: `npm test --workspace packages/typescript -- packages/typescript/test/dataflow.test.ts`

Expected: FAIL with missing imports or missing functions.

- [ ] **Step 7: Commit the failing API tests**

```bash
git add packages/typescript/test/dataflow.test.ts
git commit -m "test(dataflow): cover v2 API endpoints"
```

## Task 3: Implement `packages/typescript/src/api/dataflow2.ts`

**Files:**
- Create: `packages/typescript/src/api/dataflow2.ts`
- Reference: `packages/typescript/src/api/dataflow.ts`
- Reference: `packages/typescript/src/api/headers.ts`
- Test: `packages/typescript/test/dataflow.test.ts`

- [ ] **Step 1: Create the new module with typed response envelopes**

Start with minimal types:

```ts
export interface DataflowListItem { id: string; title: string; status: string; trigger: string; creator: string; updated_at: number; version_id: string; }
export interface DataflowRunItem { id: string; status: string; started_at: number; ended_at: number | null; reason: string | null; source?: Record<string, unknown>; }
export interface DataflowLogItem { id: string; operator: string; status: string; started_at: number; updated_at: number; inputs: unknown; outputs: unknown; taskId?: string; metadata?: { duration?: number }; }
```

- [ ] **Step 2: Implement `listDataflows`**

Use the existing header builder and `HttpError` pattern:

```ts
const url = `${base}/api/automation/v2/dags?type=data-flow&page=0&limit=-1`;
```

Return parsed JSON.

- [ ] **Step 3: Implement `runDataflowWithFile`**

Use `FormData`:

```ts
const form = new FormData();
form.set("file", new Blob([bytes]), fileName);
```

Return the parsed body including `dag_instance_id`.

- [ ] **Step 4: Implement `runDataflowWithRemoteUrl`**

Send:

```ts
{
  source_from: "remote",
  url,
  name,
}
```

- [ ] **Step 5: Implement `listDataflowRuns`**

Use:

```ts
const url = `${base}/api/automation/v2/dag/${encodeURIComponent(dagId)}/results?page=0&limit=-1`;
```

- [ ] **Step 6: Implement `getDataflowLogsPage`**

Use the confirmed logs endpoint and accept:

```ts
{ dagId: string; instanceId: string; page: number; limit?: number }
```

This helper should return one backend page at a time so the command layer can loop until all log rows are printed.

- [ ] **Step 7: Run the API test file**

Run: `npm test --workspace packages/typescript -- packages/typescript/test/dataflow.test.ts`

Expected: PASS for the new v2 API coverage.

- [ ] **Step 8: Commit the API implementation**

```bash
git add packages/typescript/src/api/dataflow2.ts packages/typescript/test/dataflow.test.ts
git commit -m "feat(dataflow): add v2 API client"
```

## Task 4: Add Failing Top-Level CLI Tests

**Files:**
- Modify: `packages/typescript/test/cli.test.ts`
- Modify later: `packages/typescript/src/cli.ts`

- [ ] **Step 1: Add a failing help-text test for `dataflow`**

Add or extend a test that captures `stdout` from `run(["--help"])` and expects the top-level help text to contain:

```ts
assert.match(output, /dataflow/);
```

- [ ] **Step 2: Add a failing routing test**

Mock `runDataflowCommand` and assert that:

```ts
const code = await run(["dataflow", "list"]);
assert.equal(code, 0);
assert.deepEqual(calls, [["list"]]);
```

- [ ] **Step 3: Run the CLI test subset to verify failure**

Run: `npm test --workspace packages/typescript -- --test-name-pattern="dataflow"`

Expected: FAIL because `cli.ts` does not wire `dataflow` yet.

- [ ] **Step 4: Commit the failing CLI tests**

```bash
git add packages/typescript/test/cli.test.ts
git commit -m "test(cli): add dataflow routing coverage"
```

## Task 5: Wire `dataflow` into the Top-Level CLI

**Files:**
- Modify: `packages/typescript/src/cli.ts`
- Test: `packages/typescript/test/cli.test.ts`

- [ ] **Step 1: Import `runDataflowCommand`**

Add:

```ts
import { runDataflowCommand } from "./commands/dataflow.js";
```

- [ ] **Step 2: Add help text**

Extend `printHelp()` with one new command group line and usage examples that mention `dataflow`.

- [ ] **Step 3: Add the top-level route**

Add:

```ts
if (command === "dataflow") {
  return runDataflowCommand(rest);
}
```

- [ ] **Step 4: Run the CLI test file**

Run: `npm test --workspace packages/typescript -- packages/typescript/test/cli.test.ts`

Expected: PASS for the new help and routing cases.

- [ ] **Step 5: Commit the CLI wiring**

```bash
git add packages/typescript/src/cli.ts packages/typescript/test/cli.test.ts
git commit -m "feat(cli): add dataflow command routing"
```

## Task 6: Add Failing Command-Layer Tests

**Files:**
- Create: `packages/typescript/test/dataflow-command.test.ts`
- Modify later: `packages/typescript/src/commands/dataflow.ts`

- [ ] **Step 1: Add a failing test for `dataflow list` output**

Mock the v2 API result and expect one rendered row containing:

```ts
"dag-001 Demo normal event Celia 1775616096 v-001"
```

The exact spacing can vary, but the selected fields must appear in the rendered line.

- [ ] **Step 2: Add a failing test for `run --file`**

Expect:

- file validation happens before upload
- the file API is called
- stdout is exactly the `dag_instance_id`

- [ ] **Step 3: Add a failing test for `run --url --name`**

Expect:

- the remote URL API is called
- stdout is exactly the `dag_instance_id`

- [ ] **Step 4: Add a failing test for invalid `run` arguments**

Cover:

- missing input mode
- both `--file` and `--url`
- `--url` without `--name`

- [ ] **Step 5: Add a failing test for `runs` output**

Expect one rendered row containing:

```ts
"run-001 success 1775616539 1775616845 Lewis_Hamilton.pdf application/pdf 5930061"
```

- [ ] **Step 6: Add a failing test for `logs` paged rendering**

Mock two backend pages and expect output blocks like:

```text
[0] success @trigger/dataflow-doc started_at=1775616541 updated_at=1775616541 duration=0 taskId=0
input: {}
output: {"_type":"file","name":"Lewis_Hamilton.pdf"}
```

and then a second block from page 1.

- [ ] **Step 7: Run the command test file to verify failure**

Run: `npm test --workspace packages/typescript -- packages/typescript/test/dataflow-command.test.ts`

Expected: FAIL because `runDataflowCommand` is not implemented.

- [ ] **Step 8: Commit the failing command tests**

```bash
git add packages/typescript/test/dataflow-command.test.ts
git commit -m "test(dataflow): add command behavior coverage"
```

## Task 7: Implement `packages/typescript/src/commands/dataflow.ts`

**Files:**
- Modify: `packages/typescript/src/commands/dataflow.ts`
- Reference: `packages/typescript/src/commands/dataview.ts`
- Reference: `packages/typescript/src/commands/vega.ts`
- Reference: `packages/typescript/src/commands/call.ts`
- Reference: `packages/typescript/src/config/store.ts`
- Reference: `packages/typescript/src/auth/oauth.ts`
- Test: `packages/typescript/test/dataflow-command.test.ts`

- [ ] **Step 1: Add command-scoped helpers**

Add focused helpers instead of putting everything inside the router:

```ts
function formatDataflowListRow(item: DataflowListItem): string
function formatDataflowRunRow(item: DataflowRunItem): string
function formatDataflowLogBlock(item: DataflowLogItem): string
```

- [ ] **Step 2: Add local `yargs` parser setup**

Define a parser that:

- shows `dataflow` help without requiring login
- registers `list`, `run`, `runs`, `logs`
- disables unrelated global parser behavior inside this command file

- [ ] **Step 3: Implement `list`**

Inside `with401RefreshRetry`:

- resolve business domain
- call `ensureValidToken()`
- call `listDataflows`
- print one concise line per `dags[]` item

- [ ] **Step 4: Implement `run`**

Use `yargs` option validation for:

- `--file` xor `--url`
- `--url` requires `--name`

Before upload:

- check file existence with `accessSync`
- fail with a direct local error if unreadable

On success:

- print only `dag_instance_id`

- [ ] **Step 5: Implement `runs`**

Call `listDataflowRuns` and print one concise line per run using the selected summary fields.

- [ ] **Step 6: Implement `logs`**

Loop over backend pages with fixed `limit = 10`:

```ts
for (let page = 0; ; page += 1) {
  const body = await getDataflowLogsPage({ ..., page, limit: 10 });
  if (body.results.length === 0) break;
}
```

Stop when:

- `results` is empty, or
- rendered count reaches `total`

Print each record as:

```text
[id] status operator started_at=<ts> updated_at=<ts> duration=<ms|-> taskId=<taskId>
input: <single-line-json>
output: <single-line-json>
```

- [ ] **Step 7: Run the command test file**

Run: `npm test --workspace packages/typescript -- packages/typescript/test/dataflow-command.test.ts`

Expected: PASS for list, run, runs, and logs behavior.

- [ ] **Step 8: Run the focused TypeScript unit tests**

Run:

```bash
npm test --workspace packages/typescript -- packages/typescript/test/dataflow.test.ts
npm test --workspace packages/typescript -- packages/typescript/test/dataflow-command.test.ts
npm test --workspace packages/typescript -- packages/typescript/test/cli.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit the command implementation**

```bash
git add \
  packages/typescript/src/commands/dataflow.ts \
  packages/typescript/src/api/dataflow2.ts \
  packages/typescript/test/dataflow-command.test.ts
git commit -m "feat(dataflow): add dataflow CLI commands"
```

## Task 8: Update User-Facing Documentation

**Files:**
- Modify: `packages/typescript/README.md`
- Modify: `packages/typescript/README.zh.md`
- Check if needed: `README.md`
- Check if needed: `README.zh.md`
- Check if needed: `skills/kweaver-core/references/`

- [ ] **Step 1: Find the CLI command reference sections**

Identify where TypeScript CLI commands are listed and where short examples belong.

- [ ] **Step 2: Add `dataflow` command examples**

Add examples for:

```bash
kweaver dataflow list
kweaver dataflow run <dagId> --file ./demo.pdf
kweaver dataflow run <dagId> --url https://example.com/demo.pdf --name demo.pdf
kweaver dataflow runs <dagId>
kweaver dataflow logs <dagId> <instanceId>
```

- [ ] **Step 3: Update any skill/reference docs if this repo exposes CLI references there**

Keep the change scoped to the documented command lists only.

- [ ] **Step 4: Run a quick docs sanity check**

Verify there are no broken command examples or inconsistent flag names.

- [ ] **Step 5: Commit the docs updates**

```bash
git add packages/typescript/README.md packages/typescript/README.zh.md
git commit -m "docs(cli): document dataflow commands"
```

## Task 9: Final Verification

**Files:**
- Verify: `packages/typescript/src/cli.ts`
- Verify: `packages/typescript/src/commands/dataflow.ts`
- Verify: `packages/typescript/src/api/dataflow2.ts`
- Verify: `packages/typescript/test/dataflow.test.ts`
- Verify: `packages/typescript/test/dataflow-command.test.ts`
- Verify: `packages/typescript/test/cli.test.ts`

- [ ] **Step 1: Run the full TypeScript unit test suite**

Run: `npm test --workspace packages/typescript`

Expected: PASS for the full TypeScript unit suite.

- [ ] **Step 2: Run TypeScript lint/typecheck**

Run: `npm run lint --workspace packages/typescript`

Expected: PASS with no new type errors.

- [ ] **Step 3: Run the package build**

Run: `npm run build --workspace packages/typescript`

Expected: PASS and emit updated `dist/` artifacts if the package workflow requires them.

- [ ] **Step 4: Inspect the final diff**

Run:

```bash
git status --short
git diff --stat
```

Expected: only dataflow-related CLI/API/test/doc changes.

- [ ] **Step 5: Commit final cleanup if needed**

```bash
git add packages/typescript
git commit -m "chore(dataflow): finalize CLI implementation"
```
