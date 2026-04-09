# KWeaver CLI Dataflow Subcommands Design

Last updated: 2026-04-09

## Summary

Add a new `dataflow` command group to the TypeScript CLI.

This work is intentionally isolated:

- Add [`packages/typescript/src/commands/dataflow.ts`](/home/zhang/kweaver/kweaver-sdk/packages/typescript/src/commands/dataflow.ts) and export `runDataflowCommand`
- Wire the command group into [`packages/typescript/src/cli.ts`](/home/zhang/kweaver/kweaver-sdk/packages/typescript/src/cli.ts)
- Add a new API module [`packages/typescript/src/api/dataflow2.ts`](/home/zhang/kweaver/kweaver-sdk/packages/typescript/src/api/dataflow2.ts)
- Keep the existing [`packages/typescript/src/api/dataflow.ts`](/home/zhang/kweaver/kweaver-sdk/packages/typescript/src/api/dataflow.ts) unchanged
- Use `yargs` only inside the `dataflow` command module and do not change the rest of the CLI parsing model

The first version only supports four subcommands:

- `dataflow list`
- `dataflow run`
- `dataflow runs`
- `dataflow logs`

## Goals

- Expose the platform `automation/v2` dataflow document workflow in the TypeScript CLI
- Keep the new command group thin and self-contained
- Match existing CLI conventions for auth, business-domain resolution, and error formatting
- Avoid refactoring unrelated command groups

## Non-goals

- Do not replace or migrate the existing `api/dataflow.ts`
- Do not move the whole CLI to `yargs`
- Do not add pagination UX in the first version
- Do not add status polling or `--follow` for logs in the first version
- Do not add extra commands such as `get`, `cancel`, or `status`

## Command Surface

```shell
# List all dataflows
kweaver dataflow list

# Trigger a dataflow with a local file
kweaver dataflow run <dagId> --file <local-path>

# Trigger a dataflow with a remote file URL
kweaver dataflow run <dagId> --url <remote-url> --name <filename>

# List all runs for one dataflow
kweaver dataflow runs <dagId>

# Fetch all logs for one run
kweaver dataflow logs <dagId> <instanceId>
```

## Architecture

### CLI routing

[`packages/typescript/src/cli.ts`](/home/zhang/kweaver/kweaver-sdk/packages/typescript/src/cli.ts) will:

- import `runDataflowCommand`
- route top-level `dataflow` to `runDataflowCommand(rest)`
- update top-level help text

No other top-level command behavior changes.

### Command module

[`packages/typescript/src/commands/dataflow.ts`](/home/zhang/kweaver/kweaver-sdk/packages/typescript/src/commands/dataflow.ts) will:

- export `runDataflowCommand(args: string[]): Promise<number>`
- construct a local `yargs` parser for the `dataflow` command group only
- define four subcommands: `list`, `run`, `runs`, `logs`
- reuse existing command-layer patterns:
  - `with401RefreshRetry`
  - `ensureValidToken`
  - `formatHttpError`
  - `resolveBusinessDomain`

`yargs` is scoped to this file so the rest of the CLI remains unchanged.

### API module

[`packages/typescript/src/api/dataflow2.ts`](/home/zhang/kweaver/kweaver-sdk/packages/typescript/src/api/dataflow2.ts) will contain thin wrappers for the new `automation/v2` endpoints only.

This separation avoids mixing:

- old workflow-style `dataflow.ts`
- new document-triggered `dataflow2.ts`

## HTTP Endpoints

### List dataflows

```http
GET /api/automation/v2/dags?type=data-flow&page=0&limit=-1
```

### Trigger with local file

```http
POST /api/automation/v2/dataflow-doc/trigger/{dag_id}
Content-Type: multipart/form-data
```

Form field:

- `file`

### Trigger with remote URL

```http
POST /api/automation/v2/dataflow-doc/trigger/{dag_id}
Content-Type: application/json
```

Request body:

```json
{
  "source_from": "remote",
  "url": "https://example.com/file.pdf",
  "name": "file.pdf"
}
```

### List runs

```http
GET /api/automation/v2/dag/{dag_id}/results?page=0&limit=-1
```

### Get run logs

The logs subcommand will call the run-log endpoint for a single `dagId` and `instanceId`, fetching logs page by page with a fixed backend page size of `10` until all results are consumed.

The exact path should be confirmed against the backend contract during implementation and documented in the command help and tests.

## Command Contracts

### `kweaver dataflow list`

Behavior:

- fetch all dataflows with `type=data-flow`
- fixed request parameters: `page=0`, `limit=-1`
- display a terminal-friendly list summary instead of raw JSON by default

Output fields per row:

- `id`
- `title`
- `status`
- `trigger`
- `creator`
- `updated_at`
- `version_id`

Source response example:

```json
{
  "dags": [
    {
      "id": "614185649708255523",
      "title": "新增文件版本时自动解析-lql",
      "description": "",
      "actions": [
        "@trigger/dataflow-doc",
        "@content/file_parse",
        "@opensearch/bulk-upsert"
      ],
      "created_at": 1775612774,
      "updated_at": 1775616096,
      "status": "normal",
      "userid": "4931501c-6f67-11f0-b0dc-36fa540cff80",
      "creator": "叶晓艳（Celia）",
      "trigger": "event",
      "type": "data-flow",
      "version_id": "614191223418177827"
    }
  ],
  "limit": 1,
  "page": 0,
  "total": 79
}
```

### `kweaver dataflow run <dagId>`

Behavior:

- require exactly one input source mode
- print only the returned `dag_instance_id` on success

Accepted forms:

```shell
kweaver dataflow run <dagId> --file <local-path>
kweaver dataflow run <dagId> --url <remote-url> --name <filename>
```

Validation rules:

- `--file` and `--url` are mutually exclusive
- `--url` requires `--name`
- local file path must exist and be readable before sending the request

Success output:

```text
614191966095198499
```

### `kweaver dataflow runs <dagId>`

Behavior:

- fetch all run records for the target dataflow
- fixed request parameters: `page=0`, `limit=-1`
- display a terminal-friendly list summary

Output fields per row:

- `id`
- `status`
- `started_at`
- `ended_at`
- `source.name`
- `source.content_type`
- `source.size`
- `reason`

Source response example:

```json
{
  "limit": 1,
  "page": 0,
  "results": [
    {
      "id": "614191966095198499",
      "status": "success",
      "started_at": 1775616539,
      "ended_at": 1775616845,
      "source": {
        "_type": "file",
        "content_type": "application/pdf",
        "doc_id": "dfs://614191954384701731",
        "docid": "dfs://614191954384701731",
        "id": "dfs://614191954384701731",
        "name": "Lewis_Hamilton.pdf",
        "operator_id": "49dcd428-6f67-11f0-b0dc-36fa540cff80",
        "operator_name": "李倩兰（Qianlan）",
        "operator_type": "user",
        "size": 5930061,
        "source_type": "doc",
        "status": "ready",
        "userid": "49dcd428-6f67-11f0-b0dc-36fa540cff80"
      },
      "reason": null
    }
  ],
  "total": 50
}
```

### `kweaver dataflow logs <dagId> <instanceId>`

Behavior:

- fetch all logs for one run
- do not expose pagination flags to the user
- fetch logs internally with fixed paging, `limit=10`
- increment `page` until all log entries are printed
- print each log entry as a compact three-line block instead of raw JSON

Output mode:

- print one summary line
- print one `input:` line
- print one `output:` line
- separate log entries with a blank line
- do not add `--follow` in the first version

Suggested display format:

```text
[0] success @trigger/dataflow-doc started_at=1775616541 updated_at=1775616541 duration=0 taskId=0
input: {}
output: {"_type":"file","content_type":"application/pdf","name":"Lewis_Hamilton.pdf","size":5930061,"status":"ready"}
```

Summary line fields:

- `id`
- `status`
- `operator`
- `started_at`
- `updated_at`
- `duration`, from `metadata.duration`, fallback to `-`
- `taskId`

Additional formatting rules:

- serialize `inputs` as single-line JSON after `input: `
- serialize `outputs` as single-line JSON after `output: `
- do not pretty-print nested JSON blocks for logs output
- preserve field values without reducing the `inputs` or `outputs` objects

Source response example:

```json
{
  "limit": 1,
  "page": 0,
  "results": [
    {
      "id": "0",
      "operator": "@trigger/dataflow-doc",
      "started_at": 1775616541,
      "updated_at": 1775616541,
      "status": "success",
      "inputs": {},
      "outputs": {
        "_type": "file",
        "content_type": "application/pdf",
        "doc_id": "dfs://614191954384701731",
        "docid": "dfs://614191954384701731",
        "id": "dfs://614191954384701731",
        "name": "Lewis_Hamilton.pdf",
        "operator_id": "49dcd428-6f67-11f0-b0dc-36fa540cff80",
        "operator_name": "李倩兰（Qianlan）",
        "operator_type": "user",
        "size": 5930061,
        "source_type": "doc",
        "status": "ready",
        "userid": "49dcd428-6f67-11f0-b0dc-36fa540cff80"
      },
      "taskId": "0",
      "last_modified_at": 1775616541,
      "metadata": {
        "attempts": 0,
        "started_at": 1775616541096,
        "duration": 0,
        "elapsed_time": 7
      }
    }
  ],
  "total": 5
}
```

## API Shapes

The new API module should stay intentionally small. Only model fields needed by command behavior or output.

Suggested functions:

- `listDataflows(options)`
- `runDataflowWithFile(options)`
- `runDataflowWithRemoteUrl(options)`
- `listDataflowRuns(options)`
- `getDataflowLogs(options)`

Suggested response typing scope:

- `DataflowListItem`
- `DataflowRunItem`
- `DataflowLogItem`
- response envelopes for `dags` and `results`

Avoid large shared abstractions or attempts to unify old and new dataflow protocols.

## Error Handling

### API layer

- reuse `HttpError`
- return parsed JSON for successful responses
- throw `HttpError` with response body for non-2xx responses

### Command layer

- wrap execution in `with401RefreshRetry`
- format failures with `formatHttpError`
- let `yargs` report usage errors for missing or conflicting arguments
- validate local file readability before HTTP upload

### Output rules

- `run` prints only `dag_instance_id` on success
- `list` and `runs` print concise list summaries
- `logs` prints compact three-line log blocks assembled from paged results

## Testing Plan

Unit tests should cover:

- top-level CLI routing for `dataflow`
- top-level help text includes `dataflow`
- `runDataflowCommand` help text and subcommand registration
- `run --file` path calls the file-upload API
- `run --url --name` path calls the remote-url API
- `run --url` without `--name` fails
- `run` rejects conflicting `--file` and `--url`
- `run` rejects unreadable local files
- `list` renders the selected list fields from `dags`
- `runs` renders the selected list fields from `results`
- `logs` renders summary, input, and output lines for each log record
- logs fetching loops over backend pages with fixed `limit=10`
- request builders use fixed `page=0&limit=-1` for list and runs

## Documentation Impact

This CLI change requires same-change updates to:

- [`packages/typescript/src/commands/dataflow.ts`](/home/zhang/kweaver/kweaver-sdk/packages/typescript/src/commands/dataflow.ts) help text
- [`packages/typescript/src/cli.ts`](/home/zhang/kweaver/kweaver-sdk/packages/typescript/src/cli.ts) top-level help
- TypeScript README files if command lists or examples include `dataflow`
- any skill reference files that document CLI commands if `dataflow` is surfaced there

## Open Implementation Note

The logs endpoint path is not present in the current draft inputs. Implementation should first confirm the exact backend route for fetching logs by `dagId` and `instanceId`. This is a backend-contract confirmation task, not a design blocker.
