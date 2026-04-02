# BKN CLI 重构与缺失命令补全

## 目标

1. 将 `commands/bkn.ts`（3,396 行）按能力域拆分为 4 个文件
2. 新增 5 个命令组：concept-group、action-schedule、job、relation-type-paths、resources
3. 扩展 `api/bkn-backend.ts`，新增对应 HTTP 函数

## 文件结构

```
commands/
  bkn.ts            — KN 自身 CRUD + 路由分发 + 共享工具
  bkn-schema.ts     — Schema 管理（object-type, relation-type, action-type, concept-group）
  bkn-query.ts      — 查询与执行（subgraph, action-execution, action-log, search, relation-type-paths, resources）
  bkn-ops.ts        — 运维操作（build, validate, push, pull, export, stats, create-from-ds, create-from-csv, action-schedule, job）
api/
  bkn-backend.ts    — 扩展，新增 concept-group/action-schedule/job/relation-type-paths/resources HTTP 函数
```

## bkn.ts（路由入口）

保留内容：
- KN 自身 CRUD：`list`, `get`, `create`, `update`, `delete`
- `KN_HELP` 帮助文本（更新，包含所有命令组）
- `runKnCommand()` — 路由分发到各文件的导出函数
- 共享工具函数：`parseOntologyQueryFlags`, `confirmYes`, `pollWithBackoff`, `formatSimpleKnList`, `formatCallOutput` re-export 等

导出供子文件使用的工具函数。子文件从 `bkn.ts` import 共享工具。

## bkn-schema.ts — Schema 管理

### 迁入现有命令

| 命令 | handler 函数 |
|------|-------------|
| object-type (list/get/create/update/delete/query/properties) | `runKnObjectTypeCommand` |
| relation-type (list/get/create/update/delete) | `runKnRelationTypeCommand` |
| action-type (list/get/create/update/delete/query/execute) | `runKnActionTypeCommand` |

连带迁入的 parse 函数：
- `parseObjectTypeCreateArgs`, `parseObjectTypeUpdateArgs`, `parseObjectTypeDeleteArgs`
- `parseRelationTypeCreateArgs`, `parseRelationTypeUpdateArgs`
- `parseKnActionTypeExecuteArgs`
- 相关类型定义和常量（如 `TERMINAL_STATUSES`）

### 新增：concept-group

导出 `runKnConceptGroupCommand`。

| CLI 命令 | HTTP | 端点 |
|----------|------|------|
| `concept-group list <kn-id>` | GET | `/concept-groups` |
| `concept-group get <kn-id> <cg-id>` | GET | `/concept-groups/:cg_id` |
| `concept-group create <kn-id> '<json>'` | POST | `/concept-groups` |
| `concept-group update <kn-id> <cg-id> '<json>'` | PUT | `/concept-groups/:cg_id` |
| `concept-group delete <kn-id> <cg-id> [-y]` | DELETE | `/concept-groups/:cg_id` |
| `concept-group add-members <kn-id> <cg-id> <ot-ids>` | POST | `/concept-groups/:cg_id/object-types` |
| `concept-group remove-members <kn-id> <cg-id> <ot-ids> [-y]` | DELETE | `/concept-groups/:cg_id/object-types/:ot_ids` |

参数约定：
- create/update 接受 JSON body 作为位置参数
- add-members 的 `<ot-ids>` 为逗号分隔的 ID 列表
- remove-members 同上，支持 `-y` 跳过确认
- 所有命令支持 `--pretty` 和 `-bd` 标准标志

## bkn-query.ts — 查询与执行

### 迁入现有命令

| 命令 | handler 函数 |
|------|-------------|
| subgraph | `runKnSubgraphCommand` |
| action-execution | `runKnActionExecutionCommand` |
| action-log | `runKnActionLogCommand` |
| search | `runKnSearchCommand` |

### 新增：relation-type-paths

导出 `runKnRelationTypePathsCommand`。

| CLI 命令 | HTTP | 端点 |
|----------|------|------|
| `relation-type-paths <kn-id> '<json>'` | POST | `/relation-type-paths` |

单命令，无子动作。接受 JSON body 描述查询条件。

### 新增：resources

导出 `runKnResourcesCommand`。

| CLI 命令 | HTTP | 端点 |
|----------|------|------|
| `resources` | GET | `/resources` |

单命令，无子动作，无需 kn-id。

## bkn-ops.ts — 运维操作

### 迁入现有命令

| 命令 | handler 函数 |
|------|-------------|
| build | `runKnBuildCommand` |
| validate | `runKnValidateCommand` |
| push | `runKnPushCommand` |
| pull | `runKnPullCommand` |
| export | `runKnExportCommand` |
| stats | `runKnStatsCommand` |
| create-from-ds | `runKnCreateFromDsCommand` |
| create-from-csv | `runKnCreateFromCsvCommand` |

### 新增：action-schedule

导出 `runKnActionScheduleCommand`。

| CLI 命令 | HTTP | 端点 |
|----------|------|------|
| `action-schedule list <kn-id>` | GET | `/action-schedules` |
| `action-schedule get <kn-id> <schedule-id>` | GET | `/action-schedules/:schedule_id` |
| `action-schedule create <kn-id> '<json>'` | POST | `/action-schedules` |
| `action-schedule update <kn-id> <schedule-id> '<json>'` | PUT | `/action-schedules/:schedule_id` |
| `action-schedule set-status <kn-id> <schedule-id> <status>` | PUT | `/action-schedules/:schedule_id/status` |
| `action-schedule delete <kn-id> <schedule-ids> [-y]` | DELETE | `/action-schedules/:schedule_ids` |

参数约定：
- create/update 接受 JSON body
- set-status 的 `<status>` 为位置参数（如 `enabled`/`disabled`）
- delete 的 `<schedule-ids>` 支持逗号分隔，支持 `-y`

### 新增：job

导出 `runKnJobCommand`。

| CLI 命令 | HTTP | 端点 |
|----------|------|------|
| `job list <kn-id>` | GET | `/jobs` |
| `job get <kn-id> <job-id>` | GET | `/jobs/:job_id` |
| `job tasks <kn-id> <job-id>` | GET | `/jobs/:job_id/tasks` |
| `job delete <kn-id> <job-ids> [-y]` | DELETE | `/jobs/:job_ids` |

## API 层：api/bkn-backend.ts 扩展

现有内容（tar upload/download）保留不变。

新增 HTTP 函数，统一基路径：`/api/bkn-backend/v1/knowledge-networks/:kn_id/`

### concept-group（7 个函数）
- `listConceptGroups(knId)` — GET `/concept-groups`
- `getConceptGroup(knId, cgId)` — GET `/concept-groups/:cg_id`
- `createConceptGroup(knId, body)` — POST `/concept-groups`
- `updateConceptGroup(knId, cgId, body)` — PUT `/concept-groups/:cg_id`
- `deleteConceptGroup(knId, cgId)` — DELETE `/concept-groups/:cg_id`
- `addConceptGroupMembers(knId, cgId, body)` — POST `/concept-groups/:cg_id/object-types`
- `removeConceptGroupMembers(knId, cgId, otIds)` — DELETE `/concept-groups/:cg_id/object-types/:ot_ids`

### action-schedule（6 个函数）
- `listActionSchedules(knId)` — GET `/action-schedules`
- `getActionSchedule(knId, scheduleId)` — GET `/action-schedules/:schedule_id`
- `createActionSchedule(knId, body)` — POST `/action-schedules`
- `updateActionSchedule(knId, scheduleId, body)` — PUT `/action-schedules/:schedule_id`
- `setActionScheduleStatus(knId, scheduleId, body)` — PUT `/action-schedules/:schedule_id/status`
- `deleteActionSchedules(knId, scheduleIds)` — DELETE `/action-schedules/:schedule_ids`

### job（4 个函数）
- `listJobs(knId)` — GET `/jobs`
- `getJob(knId, jobId)` — GET `/jobs/:job_id`
- `getJobTasks(knId, jobId)` — GET `/jobs/:job_id/tasks`
- `deleteJobs(knId, jobIds)` — DELETE `/jobs/:job_ids`

### 其他（2 个函数）
- `queryRelationTypePaths(knId, body)` — POST `/relation-type-paths`
- `listResources()` — GET `/resources`（不需要 knId）

所有函数遵循现有模式：
- Options 接口继承 `BknBackendBaseOptions`（含 baseUrl, accessToken, businessDomain）
- 返回 `Promise<string>`（原始 response body）
- 错误时 throw `HttpError`

## 测试策略

### 单元测试（cli.test.ts）

每个新命令组：
1. `--help` 输出测试 — 验证帮助文本包含关键词
2. `parseXxxArgs` 测试 — 验证参数解析、默认值、错误处理

### API 测试（新增 bkn-backend.test.ts）

每个新 HTTP 函数：
- 验证 URL 路径构造
- 验证 HTTP method
- 验证 request body 传递

### 不做

- 不做 e2e 测试（后端接口可用性未确认）
- 不迁移现有测试到新文件（测试仍在 cli.test.ts 中，通过导出函数访问）

## 迁移策略

纯代码移动 + re-export，不改变任何现有行为：

1. 从 bkn.ts 中剪切 handler 函数和对应 parse 函数到新文件
2. 新文件 import 共享工具从 bkn.ts
3. bkn.ts import 新文件的导出函数用于路由分发
4. 现有测试中 import 的 parse 函数，从 bkn.ts re-export 保持兼容
5. 全部测试通过后再添加新命令
