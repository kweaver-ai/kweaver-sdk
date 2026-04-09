# Dataflow Runs And Table Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refine the TypeScript `dataflow` CLI so `list` and `runs` render stable terminal tables with `columnify` plus `string-width`, `runs` supports a date-based `--since` filter with the new two-request retrieval strategy, and `logs` uses a git-log style display with optional detailed payload output.

**Architecture:** Keep HTTP parameter construction in [`packages/typescript/src/api/dataflow2.ts`](/home/zhang/kweaver/kweaver-sdk/packages/typescript/src/api/dataflow2.ts), and keep CLI-specific parsing, `since` date-window logic, two-request merge behavior, table rendering, and git-log style logs formatting in [`packages/typescript/src/commands/dataflow.ts`](/home/zhang/kweaver/kweaver-sdk/packages/typescript/src/commands/dataflow.ts).

**Tech Stack:** TypeScript, Node.js built-in test runner, `columnify`, `string-width`, existing KWeaver auth/config helpers

---

## File Map

- Modify: `packages/typescript/src/api/dataflow2.ts`
  - Expand runs query builder to accept page, limit, sort, and time-range parameters
- Modify: `packages/typescript/src/commands/dataflow.ts`
  - Add `--since`, day-range calculation, two-call retrieval logic, table rendering, and git-log style logs formatting
- Modify: `packages/typescript/test/dataflow.test.ts`
  - Add API-level tests for parameterized runs requests
- Modify: `packages/typescript/test/dataflow-command.test.ts`
  - Add command-layer tests for table rendering and `since`
- Modify: `packages/typescript/README.md`
  - Document `runs --since` and `logs --detail`
- Modify: `packages/typescript/README.zh.md`
  - Document `runs --since` and `logs --detail`

## Task 1: Add Failing API Tests For Parameterized Runs Queries

**Files:**
- Modify: `packages/typescript/test/dataflow.test.ts`
- Modify later: `packages/typescript/src/api/dataflow2.ts`

- [ ] **Step 1: Write a failing test for default recent-20 runs**

Add a test that expects:

```ts
await listDataflowRuns({ ...COMMON_OPTS, dagId: "dag-001", page: 0, limit: 20, sortBy: "started_at", order: "desc" });
```

Assert the request URL includes:

```text
page=0&limit=20&sortBy=started_at&order=desc
```

- [ ] **Step 2: Run the single test to verify it fails**

Run: `node --import tsx --test test/dataflow.test.ts`

Expected: FAIL because `listDataflowRuns` does not yet accept the expanded parameters.

- [ ] **Step 3: Write a failing test for date-window runs**

Add a test that expects:

```ts
await listDataflowRuns({
  ...COMMON_OPTS,
  dagId: "dag-001",
  page: 0,
  limit: 20,
  sortBy: "started_at",
  order: "desc",
  startTime: 1775059200,
  endTime: 1775750399,
});
```

Assert the URL includes both `start_time` and `end_time`.

- [ ] **Step 4: Run the API test file again**

Run: `node --import tsx --test test/dataflow.test.ts`

Expected: FAIL for the new parameterized runs coverage.

- [ ] **Step 5: Commit the failing API tests**

```bash
git add packages/typescript/test/dataflow.test.ts
git commit -m "test(dataflow): cover runs query parameters"
```

## Task 2: Implement Parameterized Runs Requests In `dataflow2.ts`

**Files:**
- Modify: `packages/typescript/src/api/dataflow2.ts`
- Test: `packages/typescript/test/dataflow.test.ts`

- [ ] **Step 1: Expand the runs options type**

Add optional query fields:

```ts
page?: number;
limit?: number;
sortBy?: string;
order?: string;
startTime?: number;
endTime?: number;
```

- [ ] **Step 2: Implement query-param based URL building**

Build the URL through `URL` and `searchParams` instead of string concatenation for the runs helper.

- [ ] **Step 3: Keep helper responsibility thin**

Do not add `since` parsing or multi-request logic here. Only translate options into the request query.

- [ ] **Step 4: Run the API test file**

Run: `node --import tsx --test test/dataflow.test.ts`

Expected: PASS for all `dataflow2.ts` API tests.

- [ ] **Step 5: Commit the API update**

```bash
git add packages/typescript/src/api/dataflow2.ts packages/typescript/test/dataflow.test.ts
git commit -m "feat(dataflow): support runs query parameters"
```

## Task 3: Add Failing Command Tests For Tables, `--since`, And Logs Detail Mode

**Files:**
- Modify: `packages/typescript/test/dataflow-command.test.ts`
- Modify later: `packages/typescript/src/commands/dataflow.ts`

- [ ] **Step 1: Write a failing test for `list` table headers**

Expect `dataflow list` output to include column headers such as:

```text
ID
Title
Status
```

and still include the row values for the mocked data.

- [ ] **Step 2: Run the command test file to verify failure**

Run: `node --import tsx --test test/dataflow-command.test.ts`

Expected: FAIL because `list` currently prints space-joined rows without headers.

- [ ] **Step 3: Write a failing test for default `runs` query behavior**

Mock fetch and assert that `dataflow runs dag-001` requests:

```text
page=0&limit=20&sortBy=started_at&order=desc
```

and renders table headers.

- [ ] **Step 4: Write a failing test for valid `--since`**

Use a deterministic input like:

```bash
dataflow runs dag-001 --since 2026-04-01
```

Assert:

- first request includes `page=0&limit=20`
- includes `start_time` and `end_time`
- if mocked `total > 20`, a second request is made

- [ ] **Step 5: Write a failing test for invalid `--since`**

Use a non-date string and assert the command falls back to the default recent-20 request shape.

- [ ] **Step 6: Write a failing test for row merging**

Mock page 0 and page 1 runs responses and assert rows from both pages appear in the final table output.

- [ ] **Step 7: Write a failing test for default logs summary mode**

Assert that:

- output starts with `commit <id>`
- metadata lines such as `Author:` and `Status:` are present
- `input:` and `output:` are not present by default

- [ ] **Step 8: Write a failing test for `logs --detail`**

Assert that:

- summary block still appears
- `input:` and `output:` headings are present
- JSON is pretty-printed with 4-space indentation
- the whole detail block is left-padded

- [ ] **Step 9: Run the command test file again**

Run: `node --import tsx --test test/dataflow-command.test.ts`

Expected: FAIL for the new table, `since`, and logs formatting cases.

- [ ] **Step 10: Commit the failing command tests**

```bash
git add packages/typescript/test/dataflow-command.test.ts
git commit -m "test(dataflow): cover runs since and logs detail output"
```

## Task 4: Implement Table Rendering, `--since`, And Logs Detail Output In `dataflow.ts`

**Files:**
- Modify: `packages/typescript/src/commands/dataflow.ts`
- Test: `packages/typescript/test/dataflow-command.test.ts`

- [ ] **Step 1: Replace manual row joining for `list` and `runs`**

Render arrays of row objects through:

```ts
columnify(rows, {
  stringLength: stringWidth,
  showHeaders: true,
})
```

- [ ] **Step 2: Add small focused helpers**

Add helpers such as:

```ts
function buildListTableRows(items: DataflowListItem[]): Array<Record<string, string>>
function buildRunTableRows(items: DataflowRunItem[]): Array<Record<string, string>>
function parseSinceToLocalDayRange(value: string): { startTime: number; endTime: number } | null
```

- [ ] **Step 3: Add `--since` to the `runs` command**

Register:

```ts
.option("since", { type: "string" })
```

- [ ] **Step 4: Implement default recent-20 runs retrieval**

When `since` is absent or invalid, call:

```ts
listDataflowRuns({
  ...base,
  dagId,
  page: 0,
  limit: 20,
  sortBy: "started_at",
  order: "desc",
})
```

- [ ] **Step 5: Implement valid `since` day-range logic**

Use `new Date(value)` and, when valid, normalize to the local natural day:

```ts
const start = new Date(y, m, d, 0, 0, 0);
const end = new Date(y, m, d, 23, 59, 59);
```

Convert both to unix seconds.

- [ ] **Step 6: Implement the two-request merge strategy**

First call:

```ts
page: 0,
limit: 20,
sortBy: "started_at",
order: "desc",
startTime,
endTime,
```

If `total > 20`, second call:

```ts
page: 1,
limit: total - 20,
sortBy: "started_at",
order: "desc",
startTime,
endTime,
```

Merge `results` from both responses in order.

- [ ] **Step 7: Keep `logs` unchanged**
- [ ] **Step 7: Replace current logs block formatting with git-log style summaries**

Add helpers such as:

```ts
function formatDataflowLogSummary(item: DataflowLogItem): string
function formatIndentedJsonBlock(label: string, value: unknown): string
```

Default logs output should not include `input` or `output`.

- [ ] **Step 8: Add `--detail` to the `logs` command**

When present:

- append `input:` and `output:` sections
- use `JSON.stringify(value, null, 4)`
- left-pad the headings and all JSON lines

- [ ] **Step 9: Run the command test file**

Run: `node --import tsx --test test/dataflow-command.test.ts`

Expected: PASS for list table rendering, runs table rendering, `since`, and logs detail mode.

- [ ] **Step 10: Run the focused dataflow test set**

Run:

```bash
node --import tsx --test test/dataflow.test.ts
node --import tsx --test test/dataflow-command.test.ts
node --import tsx --test test/cli.test.ts
```

Expected: PASS.

- [ ] **Step 11: Commit the command implementation**

```bash
git add packages/typescript/src/commands/dataflow.ts packages/typescript/test/dataflow-command.test.ts
git commit -m "feat(dataflow): refine runs and logs display"
```

## Task 5: Update User-Facing Documentation

**Files:**
- Modify: `packages/typescript/README.md`
- Modify: `packages/typescript/README.zh.md`

- [ ] **Step 1: Add `runs --since` and `logs --detail` examples**

Add examples like:

```bash
kweaver dataflow runs <dagId>
kweaver dataflow runs <dagId> --since 2026-04-01
kweaver dataflow logs <dagId> <instanceId>
kweaver dataflow logs <dagId> <instanceId> --detail
```

- [ ] **Step 2: Clarify `since` behavior briefly**

Document that:

- parseable `since` filters one natural day
- invalid `since` falls back to recent 20 runs
- `logs` defaults to summary mode
- `logs --detail` shows indented `input` and `output` payloads

- [ ] **Step 3: Run a docs sanity check**

Verify command names and flags match the implemented CLI.

- [ ] **Step 4: Commit the docs changes**

```bash
git add packages/typescript/README.md packages/typescript/README.zh.md
git commit -m "docs(cli): document runs since filter"
```

## Task 6: Final Verification

**Files:**
- Verify: `packages/typescript/src/api/dataflow2.ts`
- Verify: `packages/typescript/src/commands/dataflow.ts`
- Verify: `packages/typescript/test/dataflow.test.ts`
- Verify: `packages/typescript/test/dataflow-command.test.ts`
- Verify: `packages/typescript/README.md`
- Verify: `packages/typescript/README.zh.md`

- [ ] **Step 1: Run the focused dataflow verification commands**

Run:

```bash
node --import tsx --test test/dataflow.test.ts
node --import tsx --test test/dataflow-command.test.ts
node --import tsx --test test/cli.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run package lint**

Run: `npm run lint`

Expected: PASS.

- [ ] **Step 3: Run package build**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 4: Inspect final diff**

Run:

```bash
git status --short
git diff --stat
```

Expected: only the intended dataflow command, API, test, and docs changes, plus any unrelated pre-existing user edits.

- [ ] **Step 5: Commit final cleanup if needed**

```bash
git add packages/typescript
git commit -m "chore(dataflow): finalize runs display refinement"
```
