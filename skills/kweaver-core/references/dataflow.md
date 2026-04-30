# Dataflow 命令参考（dataflow）

用于操作 KWeaver 的 Dataflow 文档流程，覆盖 DAG 列表、手动触发、运行记录和步骤日志。支持通过模板快速创建 Dataset、BKN、Dataflow 资源。

## 命令

```bash
kweaver dataflow templates [--json]
kweaver dataflow create-dataset --template <name> --set "key=value" [--json] [-bd value]
kweaver dataflow create-bkn --template <name> --set "key=value" [--json] [-bd value]
kweaver dataflow create (--template <name> --set "key=value" | <json>) [-bd value]
kweaver dataflow list [-bd value]
kweaver dataflow run <dagId> (--file <path> | --url <remote-url> --name <filename>) [-bd value]
kweaver dataflow runs <dagId> [--since <date-like>] [-bd value]
kweaver dataflow logs <dagId> <instanceId> [--detail] [-bd value]
```

## 子命令说明

### `templates`

- 列出所有可用的内置模板。
- 输出分三类：Dataset Templates、BKN Templates、Dataflow Templates。
- `--json` 以 JSON 格式输出，便于脚本解析。

```bash
kweaver dataflow templates
kweaver dataflow templates --json
```

输出示例：

```text
Dataset Templates:
  - document           文档元信息数据集
  - document-content   文档切片及向量数据集
  - document-element   文档结构化元素数据集

BKN Templates:
  - document           文档知识网络

Dataflow Templates:
  - unstructured       非结构化文档处理流程
```

### `create-dataset`

- 从模板创建 Dataset。
- `--template`：模板名称（内置）或文件路径。
- `--set`：设置参数，可多次使用。格式：`key=value`。
- `--json`：以 JSON 格式输出结果。

```bash
kweaver dataflow create-dataset --template document --set "name=my-docs"
kweaver dataflow create-dataset --template document-content --set "name=my-content" --json
```

**Dataset 模板参数：**

| 模板 | 参数 | 必填 | 说明 |
|------|------|------|------|
| document | name | 是 | 数据集名称 |
| document | catalog_id | 否 | 目录 ID，默认 `adp_bkn_catalog` |
| document | source_identifier | 否 | 数据源标识符，为空时自动生成 |
| document-content | name | 是 | 数据集名称 |
| document-content | catalog_id | 否 | 目录 ID |
| document-content | source_identifier | 否 | 数据源标识符 |
| document-element | name | 是 | 数据集名称 |
| document-element | catalog_id | 否 | 目录 ID |
| document-element | source_identifier | 否 | 数据源标识符 |

### `create-bkn`

- 从模板创建 BKN（知识网络）。
- 需要先创建好关联的 Dataset，再创建 BKN。

```bash
kweaver dataflow create-bkn --template document \
  --set "name=my-bkn" \
  --set "embedding_model_id=model-123" \
  --set "content_dataset_id=ds-content-001" \
  --set "document_dataset_id=ds-doc-001" \
  --set "element_dataset_id=ds-elem-001" \
  --json
```

**BKN 模板参数：**

| 参数 | 必填 | 说明 |
|------|------|------|
| name | 是 | BKN 名称 |
| embedding_model_id | 是 | 向量化模型 ID |
| content_dataset_id | 是 | 内容数据集 ID（document-content） |
| document_dataset_id | 是 | 文档数据集 ID（document） |
| element_dataset_id | 是 | 元素数据集 ID（document-element） |

### `create`

- 创建 Dataflow（DAG）。
- 支持两种方式：
  - `--template`：使用内置模板
  - `<json>`：直接传入 JSON 定义或 `@file-path` 读取文件

```bash
# 使用模板
kweaver dataflow create --template unstructured \
  --set "title=my-flow" \
  --set "content_dataset_id=ds-content-001" \
  --set "document_dataset_id=ds-doc-001" \
  --set "element_dataset_id=ds-elem-001"

# 使用 JSON
kweaver dataflow create '{"title":"my-flow","steps":[...],"trigger_config":{...}}'
kweaver dataflow create @./my-dataflow.json
```

**Dataflow 模板参数（unstructured）：**

| 参数 | 必填 | 说明 |
|------|------|------|
| title | 是 | 数据流标题 |
| content_dataset_id | 是 | 内容数据集 ID |
| document_dataset_id | 是 | 文档数据集 ID |
| element_dataset_id | 是 | 元素数据集 ID |

### 完整创建流程示例

```bash
# Step 1: 创建 3 个 Dataset
kweaver dataflow create-dataset --template document --set "name=my-document" --json
# 输出: {"success":true,"id":"ds-doc-001",...}

kweaver dataflow create-dataset --template document-content --set "name=my-content" --json
# 输出: {"success":true,"id":"ds-content-001",...}

kweaver dataflow create-dataset --template document-element --set "name=my-element" --json
# 输出: {"success":true,"id":"ds-elem-001",...}

# Step 2: 创建 BKN（关联 Dataset）
kweaver dataflow create-bkn --template document \
  --set "name=my-bkn" \
  --set "embedding_model_id=your-model-id" \
  --set "content_dataset_id=ds-content-001" \
  --set "document_dataset_id=ds-doc-001" \
  --set "element_dataset_id=ds-elem-001" \
  --json

# Step 3: 创建 Dataflow（关联 Dataset）
kweaver dataflow create --template unstructured \
  --set "title=my-flow" \
  --set "content_dataset_id=ds-content-001" \
  --set "document_dataset_id=ds-doc-001" \
  --set "element_dataset_id=ds-elem-001" \
  --json
```

### `list`

- 列出所有 dataflow DAG。
- CLI 以表格展示 `ID`、`Title`、`Status`、`Trigger`、`Creator`、`Updated At`、`Version ID`。
- 当前实现固定请求全部 DAG，不暴露分页参数。

```bash
kweaver dataflow list
```

### `run`

- 触发一次 dataflow 运行。
- 输入源二选一：
  - `--file <path>`：上传本地文件
  - `--url <remote-url> --name <filename>`：使用远程文件 URL
- `--file` 与 `--url` 互斥；`--url` 必须同时带 `--name`。
- 成功时只打印 `dag_instance_id`。

```bash
kweaver dataflow run 614185649708255523 --file ./demo.pdf
kweaver dataflow run 614185649708255523 --url https://example.com/demo.pdf --name demo.pdf
```

### `runs`

- 查看指定 DAG 的运行记录。
- 默认行为：
  - 请求最近 20 条
  - 排序参数固定为 `sortBy=started_at&order=desc`
- `--since <date-like>`：
  - 只要能被 `new Date(...)` 解析，就按**本地自然日**生成 `start_time` 和 `end_time`
  - 第一次先取 20 条
  - 若返回 `total > 20`，CLI 会自动补第二次请求取剩余结果
  - 若解析失败，视为未传，回退到最近 20 条
- CLI 以表格展示 `ID`、`Status`、`Started At`、`Ended At`、`Source Name`、`Content Type`、`Size`、`Reason`。

```bash
kweaver dataflow runs 614185649708255523
kweaver dataflow runs 614185649708255523 --since 2026-04-01
kweaver dataflow runs 614185649708255523 --since "2026-04-01T10:30:00+08:00"
```

### `logs`

- 查看一次运行的步骤日志。
- 默认输出摘要块，便于快速扫读执行过程。
- `--detail` 会额外打印缩进后的 `input` 和 `output` pretty JSON。
- CLI 内部按页循环拉取日志，直到取完全部结果；当前页大小固定为 `100`。

```bash
kweaver dataflow logs 614185649708255523 614191966095198499
kweaver dataflow logs 614185649708255523 614191966095198499 --detail
```

默认摘要输出示例：

```text
[0] 0 @trigger/dataflow-doc
Status: success
Started At: 1775616541
Updated At: 1775616541
Duration: 0
```

`--detail` 会在摘要后追加：

```text
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

## 参数说明

| 选项 | 含义 |
|------|------|
| `--template` | 仅 `create-dataset`/`create-bkn`/`create`：模板名称或文件路径 |
| `--set` | 仅 `create-dataset`/`create-bkn`/`create`：设置参数 `key=value`，可多次使用 |
| `--json` | 仅 `templates`/`create-dataset`/`create-bkn`/`create`：以 JSON 格式输出 |
| `--file` | 仅 `run`：上传本地文件 |
| `--url` | 仅 `run`：远程文件地址 |
| `--name` | 仅 `run`：远程文件展示名；与 `--url` 配合必填 |
| `--since` | 仅 `runs`：按本地自然日过滤运行记录；支持任何 `new Date(...)` 可解析的格式 |
| `--detail` | 仅 `logs`：打印缩进后的 `input` / `output` JSON |
| `-bd` / `--biz-domain` | 业务域；默认来自 `kweaver config show` |

## 排障

- `create-dataset`/`create-bkn` 报错 "Missing required argument"：检查是否通过 `--set` 提供了所有必填参数。
- `create --template` 找不到模板：先用 `kweaver dataflow templates` 确认模板名称是否正确。
- `run --file` 失败：先确认本地文件存在且可读。
- `runs --since` 结果不符合预期：确认传入值能被 `new Date(...)` 正确解析；否则 CLI 会退回最近 20 条。
- `logs` 看不到详细载荷：补 `--detail`。
- 结果为空：先用 `kweaver config show` 检查 business domain；必要时切到正确域后重试。
