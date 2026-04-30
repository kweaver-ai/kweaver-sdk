# Dataflow Dataset-BKN CLI 模板设计

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 kweaver-sdk 中实现 dataflow 相关的 CLI 命令，支持通过模板创建 dataset、bkn、dataflow 资源

**Architecture:** JSON 模板 + manifest.json 声明式配置，通过 CLI 参数替换占位符生成请求体

**Tech Stack:** TypeScript, Node.js

---

## 一、背景

kweaver-core 已实现 `DatasetWriteDocs` 节点（`@dataset/write-docs` 操作符），支持 dataflow 向指定 dataset 写入文档。现需要在 kweaver-sdk 中补充 CLI 命令，使用户能够快速创建 dataset、bkn、dataflow 三类资源并建立关联。

### 依赖关系

```
┌─────────────┐
│  Dataset x3 │ (document, document-content, document-element)
└──────┬──────┘
       │
       ├──────────────────────┐
       │                      │
       ▼                      ▼
┌─────────────┐      ┌─────────────┐
│     BKN     │      │  Dataflow   │
│ (关联Dataset)│      │ (关联Dataset)│
└─────────────┘      └─────────────┘
```

---

## 二、模板目录结构

```
src/templates/
├── dataset/
│   ├── document/
│   │   ├── template.json      # 文档元信息数据集
│   │   └── manifest.json      # 参数定义
│   ├── document-content/
│   │   ├── template.json      # 文档切片及向量数据集
│   │   └── manifest.json
│   └── document-element/
│       ├── template.json      # 文档元素数据集
│       └── manifest.json
├── bkn/
│   └── document/
│       ├── template.json      # 文档知识网络
│       └── manifest.json
└── dataflow/
    └── unstructured/
        ├── template.json      # 非结构化文档处理流程
        └── manifest.json
```

### 2.1 发布策略

模板文件放在 `src/templates/` 目录，通过现有 build 脚本 `cp -r src/templates dist/` 复制到 dist 目录，随 npm 包一起发布。

---

## 三、CLI 命令设计

### 3.1 命令概览

```bash
kweaver dataflow templates                    # 列出所有可用模板
kweaver dataflow create-dataset --template <name> --set "key=value" [--json]
kweaver dataflow create-bkn --template <name> --set "key=value" [--json]
kweaver dataflow create --template <name> --set "key=value" [--json]
```

### 3.2 templates 命令

```bash
kweaver dataflow templates [--json]
```

输出示例：
```
Dataset Templates:
  - document          文档元信息数据集
  - document-content  文档切片及向量数据集
  - document-element  文档元素数据集

BKN Templates:
  - document          文档知识网络

Dataflow Templates:
  - unstructured      非结构化文档处理流程
```

### 3.3 create-dataset 命令

```bash
kweaver dataflow create-dataset --template <template> --set "key=value" [--json]
```

| 参数 | 说明 |
|------|------|
| `--template` | 模板名称（内置）或文件路径 |
| `--set` | 设置参数值，可多次使用 |
| `--json` | JSON 格式输出 |

示例：
```bash
kweaver dataflow create-dataset --template document --set "name=my-docs"
```

### 3.4 create-bkn 命令

```bash
kweaver dataflow create-bkn --template <template> --set "key=value" [--json]
```

示例：
```bash
kweaver dataflow create-bkn --template document \
  --set "name=my-bkn" \
  --set "embedding_model_id=model-123" \
  --set "content_dataset_id=ds-content-002" \
  --set "document_dataset_id=ds-document-001" \
  --set "element_dataset_id=ds-element-003"
```

### 3.5 create 命令（dataflow）

```bash
kweaver dataflow create --template <template> --set "key=value" [--json]
```

示例：
```bash
kweaver dataflow create --template unstructured \
  --set "title=my-flow" \
  --set "content_dataset_id=ds-content-002" \
  --set "document_dataset_id=ds-document-001" \
  --set "element_dataset_id=ds-element-003"
```

### 3.6 --set 语法规则

- 格式：`--set "key=value"`
- 支持多次使用：`--set "key1=value1" --set "key2=value2"`
- 仅支持顶层参数，不支持嵌套路径
- 值始终作为字符串处理，类型转换由模板 manifest 定义

---

## 四、模板参数定义

### 4.1 Dataset 模板参数

**document / document-content / document-element 通用参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `name` | string | 是 | 数据集名称 |
| `catalog_id` | string | 否 | 目录 ID，默认使用环境变量或内置默认值 |

**source_identifier 生成规则：**
- document: `dataflow_document_<random>`
- document-content: `dataflow_content_<random>`
- document-element: `dataflow_element_<random>`

### 4.2 BKN 模板参数

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `name` | string | 是 | BKN 名称 |
| `embedding_model_id` | string | 是 | 向量化模型 ID |
| `content_dataset_id` | string | 是 | 内容数据集 ID |
| `document_dataset_id` | string | 是 | 文档数据集 ID |
| `element_dataset_id` | string | 是 | 元素数据集 ID |

**ID 生成：** BKN 及其 object_types、relation_types 的 ID 使用模板中的固定值，服务端会生成新 ID。

### 4.3 Dataflow 模板参数

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `title` | string | 是 | 数据流标题 |
| `content_dataset_id` | string | 是 | 内容数据集 ID |
| `document_dataset_id` | string | 是 | 文档数据集 ID |
| `element_dataset_id` | string | 是 | 元素数据集 ID |

---

## 五、模板文件格式

### 5.1 template.json 示例

```json
{
  "catalog_id": "{{catalog_id}}",
  "name": "{{name}}",
  "category": "dataset",
  "status": "active",
  "description": "文档元信息数据集",
  "source_identifier": "{{source_identifier}}",
  "schema_definition": [
    { "name": "id", "type": "keyword" },
    { "name": "document_id", "type": "keyword" },
    { "name": "doc_name", "type": "text" }
  ]
}
```

### 5.2 manifest.json 示例

```json
{
  "name": "document",
  "type": "dataset",
  "description": "文档元信息数据集",
  "arguments": [
    {
      "name": "name",
      "required": true,
      "description": "数据集名称",
      "type": "string"
    },
    {
      "name": "catalog_id",
      "required": false,
      "default": "adp_bkn_catalog",
      "description": "所属目录ID",
      "type": "string"
    }
  ]
}
```

### 5.3 arguments 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 是 | 参数名称，对应 --set 的 key |
| `required` | boolean | 是 | 是否必填 |
| `description` | string | 是 | 参数描述 |
| `type` | string | 是 | 参数类型：string, integer, boolean, array |
| `default` | any | 否 | 默认值（仅 required=false 时有效） |

---

## 六、实现文件结构

```
src/
├── api/
│   ├── vega.ts              # 已有 createVegaResource
│   ├── bkn-backend.ts       # 需确认/新增 createKnowledgeNetwork 函数
│   └── dataflow.ts          # 已有 createDataflow
├── commands/
│   └── dataflow.ts          # 扩展添加 templates/create-dataset/create-bkn 子命令
└── templates/
    ├── dataset/
    │   ├── document/
    │   ├── document-content/
    │   └── document-element/
    ├── bkn/
    │   └── document/
    └── dataflow/
        └── unstructured/
```

---

## 七、执行流程

```
┌────────────────────────────────────────────────────────────────────────┐
│                          CLI 执行流程                                   │
└────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
                    ┌───────────────────────────────┐
                    │   1. 解析 --template 参数      │
                    │   - 内置模板 or 文件路径        │
                    └───────────────┬───────────────┘
                                    │
                                    ▼
                    ┌───────────────────────────────┐
                    │   2. 加载模板文件              │
                    │   - template.json             │
                    │   - manifest.json (可选)       │
                    └───────────────┬───────────────┘
                                    │
                                    ▼
                    ┌───────────────────────────────┐
                    │   3. 解析 arguments           │
                    │   - 用户参数 (--set)          │
                    │   - 默认值 (manifest)         │
                    └───────────────┬───────────────┘
                                    │
                                    ▼
                    ┌───────────────────────────────┐
                    │   4. 校验必填参数              │
                    │   缺失 → 报错退出              │
                    └───────────────┬───────────────┘
                                    │
                                    ▼
                    ┌───────────────────────────────┐
                    │   5. 占位符替换                │
                    │   {{key}} → 实际值             │
                    └───────────────┬───────────────┘
                                    │
                                    ▼
                    ┌───────────────────────────────┐
                    │   6. 调用后端 API              │
                    │   - create-dataset → vega     │
                    │   - create-bkn → ontology     │
                    │   - create → dataflow         │
                    └───────────────┬───────────────┘
                                    │
                                    ▼
                    ┌───────────────────────────────┐
                    │   7. 输出结果                  │
                    │   - 默认: 打印 id              │
                    │   - --json: 完整 JSON          │
                    └───────────────────────────────┘
```

---

## 八、完整使用流程示例

```bash
# Step 1: 创建 3 个 Dataset
kweaver dataflow create-dataset --template document --set "name=my-document" --json
# 输出: {"success": true, "id": "ds-document-001"}

kweaver dataflow create-dataset --template document-content --set "name=my-document-content" --json
# 输出: {"success": true, "id": "ds-content-002"}

kweaver dataflow create-dataset --template document-element --set "name=my-document-element" --json
# 输出: {"success": true, "id": "ds-element-003"}

# Step 2: 创建 BKN（关联 Dataset）
kweaver dataflow create-bkn --template document \
  --set "name=my-bkn" \
  --set "embedding_model_id=model-123" \
  --set "content_dataset_id=ds-content-002" \
  --set "document_dataset_id=ds-document-001" \
  --set "element_dataset_id=ds-element-003" \
  --json
# 输出: {"success": true, "id": "bkn-001"}

# Step 3: 创建 Dataflow（关联 Dataset）
kweaver dataflow create --template unstructured \
  --set "title=my-flow" \
  --set "content_dataset_id=ds-content-002" \
  --set "document_dataset_id=ds-document-001" \
  --set "element_dataset_id=ds-element-003" \
  --json
# 输出: {"success": true, "id": "flow-001"}
```

---

## 九、错误处理

| 场景 | 错误码 | 处理方式 |
|------|--------|----------|
| 模板不存在 | `TEMPLATE_NOT_FOUND` | 报错退出，提示模板路径 |
| manifest.json 缺失 | - | 视为无参数模板，直接使用 template.json |
| 必填参数缺失 | `MISSING_ARGUMENT` | 报错退出，列出缺失参数 |
| 参数类型不匹配 | `INVALID_ARGUMENT_TYPE` | 报错退出，提示期望类型 |
| API 调用失败 | `API_ERROR` | 输出错误信息，退出码非零 |

### 错误输出格式

**普通模式：**
```
Error: Missing required argument: name
Usage: kweaver dataflow create-dataset --template document --set "name=xxx"
```

**--json 模式：**
```json
{
  "success": false,
  "error": {
    "code": "MISSING_ARGUMENT",
    "message": "Missing required argument: name",
    "details": {
      "missing": ["name"]
    }
  }
}
```

---

## 十、验收清单

- [ ] `kweaver dataflow templates` 能列出所有内置模板
- [ ] `kweaver dataflow create-dataset --template document --set "name=xxx"` 能创建 dataset
- [ ] `kweaver dataflow create-dataset --template document-content --set "name=xxx"` 能创建 dataset
- [ ] `kweaver dataflow create-dataset --template document-element --set "name=xxx"` 能创建 dataset
- [ ] `kweaver dataflow create-bkn --template document --set ...` 能创建 BKN
- [ ] `kweaver dataflow create --template unstructured --set ...` 能创建 dataflow
- [ ] 缺失必填参数时返回清晰错误信息
- [ ] `--json` 模式输出正确的 JSON 格式
- [ ] 模板文件随 npm 包正确发布

---

## 十一、API 端点汇总

| 操作 | 端点 | 方法 |
|------|------|------|
| 创建 Dataset | `/api/vega-backend/v1/resources` | POST |
| 创建 BKN | `/api/ontology-manager/v1/knowledge-networks?validate_dependency=false` | POST |
| 创建 Dataflow | `/api/automation/v1/data-flow/flow` | POST |
