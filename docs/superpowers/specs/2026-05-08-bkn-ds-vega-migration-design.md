# BKN create-from-ds 链路向 vega-backend catalogs 的最小迁移

- 日期：2026-05-08
- 关联 issue：[kweaver-sdk#114](https://github.com/kweaver-ai/kweaver-sdk/issues/114)
- 上游遗留：[kweaver-sdk#57](https://github.com/kweaver-ai/kweaver-sdk/issues/57)（标 COMPLETED 但实际未做）

## 背景

`packages/typescript/src/api/datasources.ts` 与 `packages/python/src/kweaver/resources/datasources.py` 当前 100% 调用 `/api/data-connection/v1/...`。该 Java 服务计划下线，且不支持 no-auth 模式。

本次范围**不**做 ds 命令的整体迁移（A 方案）。原因：

1. data-connection 与 vega-backend 是两套独立存储 —— 同一物理库在两个服务上 ID 完全不同（已实测：`postgres_172_31_12_93` 在 data-connection 是 UUID `dfaf719c-…`，在 vega 是 `d7nicrcjto2s73d9g67g`）。整体迁移必然带来历史 datasource id 不可继续使用的兼容性破坏。
2. data-connection 服务下线时间未定，目前仍可用。
3. 真正阻塞下游的是 `bkn create-from-ds` 路径 —— kweaver-eval 当前用 `EVAL_DB_PK_MAP` 兜底也是因为这条链路在 no-auth/服务异常时 PK 拿不到。

因此本 spec 只迁移 `bkn create-from-ds` 实际依赖的两条 SDK 函数（`listTablesWithColumns`、`scanMetadata`），其余 ds 子命令保留在 data-connection 直到该服务真要下线。

## 范围

### 改动

- `packages/typescript/src/api/datasources.ts`
  - `listTablesWithColumns` —— 重写为基于 vega-backend catalogs 的实现
  - `scanMetadata` —— 重写为 `discoverVegaCatalog` 包装（`scanDatasourceMetadata` 是其薄包装，自动随之改）
- `packages/python/src/kweaver/resources/datasources.py`
  - 对应两个方法的 Python 等价改造
- `packages/typescript/src/commands/bkn-ops.ts`
  - 入参文案与帮助说明：`bkn create-from-ds` 现在期望 **vega catalog id**
  - UUID 风格输入的前置校验与提示文案

### 保持不变（继续走 data-connection）

- `testDatasource` / `createDatasource` / `listDatasources` / `getDatasource` / `deleteDatasource` / `listTables`
- `kweaver ds list/get/connect/delete` CLI 子命令
- `packages/typescript/src/utils/crypto.ts`、`packages/python/src/kweaver/_crypto.py`
- `_client.py` / `client.ts` 的 `DataSources*` 资源对外签名

### 不在范围

- `data-connection` 全量替换（即原 issue 描述的 ds list/get/connect 等迁移）—— 留待 data-connection 真要下线时一次性处理
- vega-backend `/api/vega-backend/in/v1/` no-auth 内部路由切换 —— SDK 现有 `isNoAuth` 头部省略机制配合 `/v1/` 端点已能在 no-auth 模式下工作；如实测仍有 401 再开 follow-up
- `_crypto` / `makeBinData` 删除 —— 仅在被迁移函数路径上变为死代码引用，本次不删除模块以避免影响其他调用方

## 设计

### 函数级改造

#### `listTablesWithColumns(id, …)`

- `id` 语义变更：现在是 **vega catalog id**（不再是 data-connection datasource UUID）
- 实现流程：
  1. `listVegaCatalogResources(id, category="table")` —— 拿表清单（vega 返回 `entries[]` 仅含 `{id, name, category, …}`，不含字段）
  2. 对每个 resource 并发 `getVegaResource(rid)` —— 从响应的 `source_metadata.columns[]` 抽字段
  3. 字段映射保留现有 `isColumnPrimaryKey` 判定（`is_primary_key=true` / `column_key="PRI"`）和 table-level `primary_keys[]` 合成逻辑
- 返回 shape **完全不变**：`Array<{ name, columns: [{name, type, comment?, isPrimaryKey?}], primaryKeys? }>`
- `autoScan=true` 且 `entries[]` 为空时，仍走 `scanMetadata` → 重新 listResources 的二次尝试逻辑（但底层换成 vega `discover`）

#### `scanMetadata(id, …)`

- `id` 语义变更：现在是 **vega catalog id**
- 实现：`discoverVegaCatalog(id, wait=true)` —— 异步轮询逻辑收敛到 vega 同步等待
- 入参 `dsType` 字段不再使用（vega catalog 自带 `connector_type`），但为减少签名变动保留并忽略

### 调用方契约：`bkn create-from-ds` 与 `ds tables`

- 入参语义：`--ds-id` / 位置参数 现期望 **vega catalog id**
- 帮助文案更新：明确说明传 vega catalog id（用 `kweaver vega catalog list --keyword <name>` 查得）
- 前置校验：若入参匹配 UUID v4 模式（含 4 段 dash 的 36 字符），输出明确错误并终止：

  > 检测到 legacy datasource UUID。`bkn create-from-ds` 现在使用 vega catalog id —— 请运行 `kweaver vega catalog list --keyword <name>` 找到对应 id 后再传入。
- 此校验仅用于把误用引导到正路上，不做"自动反查 / fallback 到 data-connection"（避免 data-connection 不可用时的链路撕裂）

`kweaver ds tables <vega-catalog-id>` 也走 vega catalogs（与 `bkn create-from-ds` 共享 `listTablesWithColumns` 实现）。`kweaver ds list/get` 仍读 data-connection，所以日常浏览旧数据源的入口仍在，但浏览到的 datasource UUID 不能直接传给 `ds tables` —— 用 `kweaver vega catalog list --keyword <name>` 反查 vega 端 id。

### 错误处理

- vega 返回 404 —— 透传 `HttpError`，在 `bkn-ops.ts` 调用层补一句 "请确认 id 是 vega catalog id" 的 hint
- `discoverVegaCatalog(wait=true)` 失败 —— 直接抛出 vega 返回的错误信息，不做翻译
- 并发 `getVegaResource` 任一失败 —— 收集所有失败后整体抛错；不静默吞错；信息至少包含失败的 resource id

### 数据流

```
bkn create-from-ds <catalog_id>
  └─ commands/bkn-ops.ts
       ├─ pre-check: catalog_id 不是 UUID
       ├─ listTablesWithColumns(catalog_id)
       │    ├─ vega.listVegaCatalogResources(catalog_id, category="table")
       │    └─ for each resource: vega.getVegaResource(rid) [并发]
       │         └─ source_metadata.columns[] → {name, type, isPrimaryKey?}
       └─ scanMetadata(catalog_id)            [仅当 listResources 为空且 autoScan]
            └─ vega.discoverVegaCatalog(catalog_id, wait=true)
```

## 测试

memory 已确认：SDK 必须用真实端点，e2e 是真正的质量门，单 mock 无意义。

### Unit（mock transport）

- `listTablesWithColumns`：
  - listResources 返回多表 + 每表 getResource 返回 `source_metadata.columns[]` → 断言输出 shape 与旧实现等价
  - 不同 PK 形状（`is_primary_key=true` / `column_key="PRI"` / 表级 `primary_keys[]`）的提取
  - getResource 单条失败 → 整体抛错
  - listResources 空 + `autoScan=true` → 触发 discover → 重新 list 的二次尝试
- `scanMetadata`：discover 调用与 wait 参数透传
- `bkn-ops.ts`：UUID 风格入参 → 前置错误抛出；短 id 入参 → 正常进流程

### E2E

在 `https://115.190.186.186` admin 平台上：

```bash
kweaver bkn create-from-ds --catalog-id d7nicrcjto2s73d9g67g <其他参数>
```

确认：
- 端到端无 data-connection 调用（可 wireshark / SDK debug 日志）
- 输出 BKN 与旧链路结果一致
- 至少覆盖 1 个 mysql、1 个 postgresql catalog

旧的 unit tests（如有）与 data-connection mock 一并按新实现重写。

## 实施顺序建议

1. TS 端 `listTablesWithColumns` + `scanMetadata` 改造与单测
2. Python 端 `DataSourcesResource` 对应方法改造与单测
3. `bkn-ops.ts` 入参校验与文案
4. E2E 跑通后再 commit/PR

实际拆分由 writing-plans 阶段决定。

## 风险与已知 trade-off

- `kweaver ds list` / `ds get` 走 data-connection（输出 UUID），`ds tables` / `bkn create-from-ds` 走 vega（要 catalog id）—— 命令面有 ID 风格的不一致，但更小的改动面下没有更好的折中。
- N+1 `getVegaResource` 比原 list-tables 单次调用慢 —— 用并发缓解；表数量极大（>1000）时可能成为瓶颈，作为已知约束
- data-connection 服务真下线时，`ds list/get/tables` 等仍会断 —— 留待届时整体迁移

## 验证清单

- [ ] TS 单测全过 + Python 单测全过
- [ ] E2E `bkn create-from-ds --catalog-id <vega-id>` 输出与旧实现 BKN 等价
- [ ] CLI 帮助文案显示新入参语义
- [ ] UUID 输入触发明确的引导错误
- [ ] 没有改动 ds list/get/connect/delete 任一子命令的行为（ds tables 已纳入迁移范围）
