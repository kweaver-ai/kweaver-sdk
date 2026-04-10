# KWeaver SDK Bug Tracker

> 2026-04-06 BKN Explorer 开发过程中发现的问题，按模块分类记录。

---

## 一、Ontology Query API (后端)

### BUG-001: subgraph API condition 格式与实例查询 API 不一致

- **优先级**: P1
- **症状**: 使用 `eq` + `value_from: "const"` 格式调用 subgraph `relation_path` 模式时，返回 400 `InvalidParameter.Condition`，错误详情 "not support condition's operation: eq"。
- **分析**: 实例查询 API (`/object-types/{otId}`) 使用 `{ operation: "eq", value_from: "const", value: ... }` 格式；subgraph API 的 `relation_path` 模式使用完全不同的 condition 引擎，要求 `{ operation: "==", value: ... }`，不需要 `value_from` 字段。
- **根因**: 后端两套查询引擎对 condition 的解析实现不同。实例查询走 context-loader 的 condition 规范，subgraph 走 `ontology-query/server/common/condition` 的独立实现。参考 `adp/bkn/ontology-query/server/common/condition/condition.go`。
- **建议**: 后端统一 condition DSL，至少让 `eq` 作为 `==` 的别名。短期 SDK 侧已通过 `buildInstanceCondition()` 函数对 subgraph 调用使用 `==` 格式做了适配。

### BUG-002: subgraph API 缺少 `query_type` 参数时报 "起点对象类为空"

- **优先级**: P1
- **症状**: 发送 `relation_type_paths` 格式的请求体到 subgraph 端点，返回 400 `NullParameter.SourceObjectTypeId`，提示 "起点对象类为空"。
- **分析**: subgraph 端点支持两种查询模式：(1) 源对象类模式（需要根字段 `source_object_type_id` + `direction` + `path_length`）；(2) 关系路径模式（需要 `relation_type_paths` 数组 + URL 参数 `query_type=relation_path`）。不带 `query_type` 参数时，后端默认按模式 1 解析，找不到 `source_object_type_id` 根字段就报错。
- **根因**: API 设计上没有自动推断请求模式，两种模式复用同一端点但需要显式声明。参考 `adp/bkn/ontology-query/server/driveradapters/knowledge_network_handler.go`。
- **建议**: 后端可根据请求体是否包含 `relation_type_paths` 字段自动推断模式，无需强制传 `query_type` 参数。SDK 侧已在代理层 (`bkn-explore.ts`) 自动检测并补充该参数。

### BUG-003: 部分 identity 字段不可作为 subgraph condition 查询字段

- **优先级**: P2
- **症状**: 对象类 `supplychain_hd0202_mps` 的 identity 字段为 `entry_id`，用该字段构建 subgraph condition 时部分场景失败（400/500），错误提示 condition field 不在 view original fields 中。
- **分析**: `_instance_identity` 中的字段名（如 `entry_id`）是对象类的主键标识，但不一定是该对象类已声明的可查询属性。subgraph condition 要求 field 必须存在于对象类的 view 定义中。
- **根因**: 数据建模时 identity 字段与可查询属性之间缺乏一致性约束。identity 字段应天然可查询，但后端未做此保证。
- **建议**: 后端应保证 identity 字段始终可作为 condition 查询字段。短期可在建模时确保 identity 字段同时声明为属性。SDK 侧可 fallback 到 display key + 其他属性组合定位实例，但不可靠。

---

## 二、BKN Explorer (前端)

### BUG-004: 实例列表无法区分同名条目

- **优先级**: P2 (已修复)
- **症状**: 对象类实例列表中，多个实例的 display key 值相同（如多条"锂电池模块"），用户无法区分。
- **分析**: 列表仅展示 `displayKey` 字段值，无其他辅助信息。
- **根因**: 初始设计未考虑 display key 不唯一的场景。
- **建议**: 已实现数据驱动的副标题机制——统计当前页实例中各字段的唯一值数量，自动选择区分度最高的 3 个字段作为副信息展示。支持用户自定义切换。

### BUG-005: 实例详情页关联查询可能失败

- **优先级**: P2 (部分修复)
- **症状**: 实例详情页的"关联"区域可能显示空或报错，取决于该对象类的 identity 字段是否可查询（见 BUG-003）。
- **分析**: `loadRelations` 使用 `buildInstanceCondition()` 构建 subgraph 查询条件，依赖 identity 字段可查询。
- **根因**: 同 BUG-003，identity 字段不保证可查询。
- **建议**: 已修复 condition 格式（`==` 替代 `eq`）和 `query_type` 参数。但 identity 字段不可查询的根本问题需后端解决。

### BUG-006: 关系类详情页批量查询产生大量 400/500 错误

- **优先级**: P3 (已缓解)
- **症状**: 打开关系类详情页时，Console 中出现大量 400 Bad Request 和 500 Internal Server Error。
- **分析**: 页面为每个源实例发送独立的 subgraph 查询（最多 30 个），部分查询因 BUG-003 或后端限流失败。
- **根因**: (1) 逐实例查询模式请求量大；(2) 部分 identity 字段不可查询。
- **建议**: 已将并发数降至 3，加入导航取消机制和结果缓存。理想方案是后端提供按关系类批量查询关联的 API，避免 N+1 查询。

---

## 三、构建与部署

### BUG-007: 模板修改后需手动 rebuild 才生效

- **优先级**: P3
- **症状**: 修改 `src/templates/bkn-explorer/` 下的文件后，运行中的 explore 服务仍使用 `dist/` 下的旧文件。
- **分析**: `bkn-explore.ts` 使用 `__dirname` 解析模板目录，指向编译后的 `dist/templates/bkn-explorer/`。`npm run build` 中的 `cp -r src/templates dist/` 负责复制。
- **根因**: 静态文件服务读取的是编译产物目录，不是源码目录。
- **建议**: 开发模式下可直接从 `src/templates/` 目录读取，或加入 watch 模式自动复制。当前需每次修改后手动 `npm run build` + 重启服务。
