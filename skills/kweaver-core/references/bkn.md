# 知识网络管理

管理知识网络（KN）及其 Schema：对象类、关系类、行动类。TS CLI 通过 `bkn` 命令组实现。

## 命令总览

### 管理

| 命令 | 说明 |
|------|------|
| `kweaver bkn list [options]` | 列出知识网络 |
| `kweaver bkn get <kn-id> [options]` | 查看网络详情 |
| `kweaver bkn export <kn-id>` | 导出网络定义（alias: get --export） |
| `kweaver bkn stats <kn-id>` | 查看统计（alias: get --stats） |
| `kweaver bkn create [options]` | 创建网络 |
| `kweaver bkn update <kn-id> [options]` | 更新网络 |
| `kweaver bkn delete <kn-id>` | 删除网络 |

### 语义搜索

| 命令 | 说明 |
|------|------|
| `kweaver bkn search <kn-id> <query>` | 语义搜索（agent-retrieval API） |

### Schema 与查询

| 命令 | 说明 |
|------|------|
| `kweaver bkn object-type list <kn-id>` | 列出对象类 |
| `kweaver bkn object-type query <kn-id> <ot-id> ['<json>']` | 对象实例查询 |
| `kweaver bkn object-type properties <kn-id> <ot-id> '<json>'` | 对象属性查询 |
| `kweaver bkn relation-type list <kn-id>` | 列出关系类 |
| `kweaver bkn subgraph <kn-id> '<json>'` | 子图查询 |
| `kweaver bkn action-type list <kn-id>` | 列出行动类 |
| `kweaver bkn action-type query <kn-id> <at-id> '<json>'` | 行动信息查询 |
| `kweaver bkn action-type execute <kn-id> <at-id> '<json>'` | 执行行动（有副作用） |
| `kweaver bkn action-execution get <kn-id> <execution-id>` | 获取执行状态 |
| `kweaver bkn action-log list/get/cancel <kn-id> ...` | 执行日志 |

## 参数说明

### bkn list

| 参数 | 说明 |
|------|------|
| `--offset N` | 偏移，默认 0 |
| `--limit N` | 条数，默认 50 |
| `--sort` | 排序字段，默认 update_time |
| `--direction asc|desc` | 排序方向，默认 desc |
| `--name-pattern` | 按名称过滤 |
| `--tag` | 按标签过滤 |
| `--detail` | 包含 detail 字段 |
| `--verbose, -v` | 完整 JSON |
| `-bd` | 业务域 |

### bkn get

| 参数 | 说明 |
|------|------|
| `--stats` | 包含统计 |
| `--export` | 导出模式（含子类型） |
| `-bd` | 业务域 |

### bkn create

| 参数 | 说明 |
|------|------|
| `--name` | 名称（必填，除非用 --body-file） |
| `--comment` | 备注 |
| `--tags t1,t2` | 逗号分隔标签 |
| `--icon` | 图标 |
| `--color` | 颜色 |
| `--branch` | 分支，默认 main |
| `--base-branch` | 基础分支 |
| `--body-file <path>` | 从文件读取完整 JSON（不能与上述 flags 同用） |
| `--import-mode normal|ignore|overwrite` | 导入模式，默认 normal |
| `--validate-dependency true|false` | 校验依赖，默认 true |
| `-bd` | 业务域 |

### bkn delete

| 参数 | 说明 |
|------|------|
| `--yes, -y` | 跳过确认 |
| `-bd` | 业务域 |

## 用法示例

```bash
# 列出
kweaver bkn list
kweaver bkn list --name-pattern erp --limit 20

# 查看与导出
kweaver bkn get <kn-id>
kweaver bkn get <kn-id> --stats
kweaver bkn export <kn-id>

# 创建（元数据）
kweaver bkn create --name my_kn --comment "测试网络" --tags demo
kweaver bkn create --body-file kn-def.json

# 更新与删除
kweaver bkn update <kn-id> --name new_name
kweaver bkn delete <kn-id> --yes

# 语义搜索
kweaver bkn search <kn-id> "高库存的产品" --max-concepts 20 --pretty

# Schema 与查询
kweaver bkn object-type list <kn-id>
kweaver bkn relation-type list <kn-id>
kweaver bkn object-type query <kn-id> <ot-id> '{"limit":50,"condition":{"operation":"and","sub_conditions":[]}}'
kweaver bkn subgraph <kn-id> '{"relation_type_paths":[]}'
```

## 典型编排

1. **探索已有**：`bkn list` -> `bkn export <id>` -> `bkn search` / `bkn object-type query` / `bkn subgraph`
2. **创建与更新**：`bkn create --name ...` 或 `bkn create --body-file ...`，再 `bkn update` 调整
3. **直接查询**：已知 kn-id 时直接 `bkn search`、`bkn object-type query`、`bkn subgraph`

## 端到端：探索与查询

```
bkn list -> bkn export -> bkn search / bkn object-type query / bkn subgraph
```

1. **列出**：`kweaver bkn list` 或 `kweaver bkn list --name-pattern erp` → 获取 `kn-id`
2. **导出 Schema**：`kweaver bkn export <kn-id>` → 获取 `ot-id`、`rt-id`
3. **语义搜索**：`kweaver bkn search <kn-id> "高库存的产品"`
4. **对象实例**：`kweaver bkn object-type query <kn-id> <ot-id> '{"limit":50,"condition":{"operation":"and","sub_conditions":[]}}'`
5. **子图**：`kweaver bkn subgraph <kn-id> '<json>'`，JSON 见 [json-formats.md#subgraph](json-formats.md#subgraph)
