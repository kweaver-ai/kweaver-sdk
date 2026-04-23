# Dataflow CLI Runs And Table Display Design

Last updated: 2026-04-09

## Summary

This design refines the shipped TypeScript `dataflow` CLI in two focused areas:

- improve `list` and `runs` terminal rendering with `columnify` and `string-width`
- refine `runs` retrieval to support `--since` and align with backend limits that do not accept `limit=-1`
- redesign `logs` rendering to use a git-log style summary with optional detailed payload output

## Scope

### In scope

- `kweaver dataflow list` output formatting
- `kweaver dataflow runs <dagId>` request strategy
- `kweaver dataflow runs <dagId> --since <date-like>` behavior
- `kweaver dataflow logs <dagId> <instanceId> [--detail]` rendering
- tests and docs for the refined `runs` contract

### Out of scope

- changing `dataflow run`
- changing the old `api/dataflow.ts`
- introducing generic table helpers for unrelated command groups

## Goals

- make `list` and `runs` easier to scan in terminals with mixed Chinese and English text
- stop relying on `limit=-1` for the runs endpoint
- provide a simple date-based filter through `--since`
- make `logs` easier to scan by default while preserving access to full payload details
- keep API and command responsibilities clearly separated

## Architecture

[`packages/typescript/src/api/dataflow2.ts`](/home/zhang/kweaver/kweaver-sdk/packages/typescript/src/api/dataflow2.ts) should stay as a thin request builder.

[`packages/typescript/src/commands/dataflow.ts`](/home/zhang/kweaver/kweaver-sdk/packages/typescript/src/commands/dataflow.ts) should own:

- parsing `--since`
- deciding whether to do one or two requests
- building table rows for `columnify`
- formatting logs in summary or detail mode
- rendering final terminal output

This keeps CLI-specific behavior out of the API layer.

## `runs` Command Contract

### Command form

```bash
kweaver dataflow runs <dagId> [--since <date-like>] [-bd value]
```

### Default behavior

When `--since` is not provided, the command fetches the most recent 20 runs only.

Fixed request parameters:

```text
page=0
limit=20
sortBy=started_at
order=desc
```

### `--since` behavior

The `since` option accepts any string that `new Date(value)` can parse.

If parsing fails:

- treat `since` as absent
- fall back to the default behavior

If parsing succeeds:

- convert the parsed value to the local natural day
- compute:
  - `start_time` as `00:00:00`
  - `end_time` as `23:59:59`
- use both query parameters in the runs endpoint

Example:

```bash
kweaver dataflow runs dag-001 --since 2026-04-01
```

Should query one local-day range covering:

- `start_time=<2026-04-01 00:00:00 local time>`
- `end_time=<2026-04-01 23:59:59 local time>`

### Two-request retrieval strategy

Because the runs endpoint does not support `limit=-1`, the CLI should fetch data in at most two calls when `since` is valid.

First request:

```text
page=0
limit=20
sortBy=started_at
order=desc
start_time=<dayStart>
end_time=<dayEnd>
```

Then:

- if `total <= 20`, use that response only
- if `total > 20`, issue one second request for the remaining rows

Second request:

```text
page=1
limit=<total - 20>
sortBy=started_at
order=desc
start_time=<dayStart>
end_time=<dayEnd>
```

Then merge first-page and second-page `results`.

## Table Display Design

### Rendering library choice

Use:

- `columnify` for terminal table layout
- `string-width` as the width calculator

This is specifically to improve alignment for mixed-width text such as Chinese names and titles.

### `list` columns

`kweaver dataflow list` should render these columns:

- `ID`
- `Title`
- `Status`
- `Trigger`
- `Creator`
- `Updated At`
- `Version ID`

### `runs` columns

`kweaver dataflow runs` should render these columns:

- `ID`
- `Status`
- `Started At`
- `Ended At`
- `Source Name`
- `Content Type`
- `Size`
- `Reason`

### Formatting rules

- pass `string-width` to `columnify` through `stringLength`
- keep timestamps as unix seconds in this iteration
- keep empty values as blank cells
- do not add color, ANSI styling, or custom box drawing

## `logs` Command Design

### Command form

```bash
kweaver dataflow logs <dagId> <instanceId> [--detail] [-bd value]
```

### Retrieval behavior

- do not expose pagination flags
- continue fetching all logs internally
- keep using the `automation/v2` logs endpoint already present in the codebase

### Default output

Without `--detail`, print a git-log style summary block for each log item.

Suggested format:

```text
commit 0
Author: @trigger/dataflow-doc
Status: success
Started At: 1775616541
Updated At: 1775616541
Duration: 0
Task ID: 0
```

Formatting rules:

- each log item starts with `commit <id>`
- each metadata line is printed on its own line
- add one blank line between log items
- do not print `input` or `output` in default mode

### `--detail` output

When `--detail` is present, append indented detailed payload sections after the summary block:

```text
commit 0
Author: @trigger/dataflow-doc
Status: success
Started At: 1775616541
Updated At: 1775616541
Duration: 0
Task ID: 0

    input:
        {
            "foo": "bar"
        }

    output:
        {
            "_type": "file",
            "name": "demo.pdf"
        }
```

Detail formatting rules:

- `input:` and `output:` headings are left-padded
- payload JSON uses `JSON.stringify(value, null, 4)`
- JSON lines receive additional left padding so the whole detail block is visually nested
- keep line breaks; do not collapse detail JSON into a single line

## API Changes

The runs API helper should be expanded from a fixed request to a parameterized request.

Suggested helper shape:

```ts
listDataflowRuns({
  baseUrl,
  accessToken,
  businessDomain,
  dagId,
  page,
  limit,
  sortBy,
  order,
  startTime,
  endTime,
})
```

The helper should only translate options into query parameters and parse the response.

## Error Handling

- invalid `since` parsing is not an error
- invalid `since` should silently fall back to default recent-20 behavior
- API failures still use the existing `HttpError` path
- table rendering should tolerate missing fields without throwing
- logs detail rendering should tolerate missing `inputs`, `outputs`, or `metadata.duration`

## Testing

Add or update tests for:

- `list` rendering uses table headers and aligned rows
- `runs` rendering uses table headers and aligned rows
- `runs` without `since` requests `limit=20`, `sortBy=started_at`, `order=desc`
- `runs` with a parseable `since` sends `start_time` and `end_time`
- `runs` with invalid `since` falls back to default recent-20 behavior
- `runs` with `total <= 20` makes one request
- `runs` with `total > 20` makes two requests and merges rows
- `logs` default mode prints only git-log style summary blocks
- `logs --detail` prints indented pretty JSON for `input` and `output`
- `logs` still fetches the full log set internally

## Documentation Impact

Update:

- [`packages/typescript/src/commands/dataflow.ts`](/home/zhang/kweaver/kweaver-sdk/packages/typescript/src/commands/dataflow.ts) help text
- [`packages/typescript/src/cli.ts`](/home/zhang/kweaver/kweaver-sdk/packages/typescript/src/cli.ts) top-level help if examples mention `runs`
- [`packages/typescript/README.md`](/home/zhang/kweaver/kweaver-sdk/packages/typescript/README.md)
- [`packages/typescript/README.zh.md`](/home/zhang/kweaver/kweaver-sdk/packages/typescript/README.zh.md)
