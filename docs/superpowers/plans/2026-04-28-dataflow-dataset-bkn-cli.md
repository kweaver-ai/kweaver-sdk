# Dataflow Dataset-BKN CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 kweaver-sdk 中实现 dataflow 相关的 CLI 命令，支持通过 JSON 模板创建 dataset、bkn、dataflow 资源

**Architecture:** JSON 模板 + manifest.json 声明式配置，通过 CLI 参数替换占位符生成请求体，调用现有 API 函数创建资源

**Tech Stack:** TypeScript, Node.js, yargs

---

## 文件结构

| 文件路径 | 职责 |
|---------|------|
| `src/templates/dataset/document/template.json` | 文档元信息数据集模板 |
| `src/templates/dataset/document/manifest.json` | 文档元信息数据集参数定义 |
| `src/templates/dataset/document-content/template.json` | 文档切片及向量数据集模板 |
| `src/templates/dataset/document-content/manifest.json` | 文档切片及向量数据集参数定义 |
| `src/templates/dataset/document-element/template.json` | 文档元素数据集模板 |
| `src/templates/dataset/document-element/manifest.json` | 文档元素数据集参数定义 |
| `src/templates/bkn/document/template.json` | 文档知识网络模板 |
| `src/templates/bkn/document/manifest.json` | 文档知识网络参数定义 |
| `src/templates/dataflow/unstructured/template.json` | 非结构化文档处理流程模板 |
| `src/templates/dataflow/unstructured/manifest.json` | 非结构化文档处理流程参数定义 |
| `src/utils/template-loader.ts` | 模板加载与占位符替换工具函数 |
| `src/commands/dataflow.ts` | 扩展添加 templates/create-dataset/create-bkn 子命令 |
| `test/template-loader.test.ts` | 模板加载器单元测试 |
| `test/dataflow-command.test.ts` | CLI 命令测试（扩展现有文件） |

---

## Task 1: 创建模板加载工具函数

**Files:**
- Create: `src/utils/template-loader.ts`
- Create: `test/template-loader.test.ts`

- [ ] **Step 1: 编写模板加载器测试**

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

test("loadTemplate returns null for non-existent template", async () => {
  const { loadTemplate } = await import("../src/utils/template-loader.js");
  const result = await loadTemplate("nonexistent", "dataset", __dirname);
  assert.equal(result, null);
});

test("loadTemplate loads template.json and manifest.json", async () => {
  const { loadTemplate } = await import("../src/utils/template-loader.js");
  // This will be tested after we create the actual templates
  const result = await loadTemplate("document", "dataset", join(__dirname, "../src/templates"));
  assert.ok(result, "Template should load");
  assert.ok(result.template, "Template should have template.json content");
  assert.ok(result.manifest, "Template should have manifest.json content");
});

test("renderTemplate replaces placeholders", async () => {
  const { renderTemplate } = await import("../src/utils/template-loader.js");
  const template = { name: "{{name}}", catalog_id: "{{catalog_id}}" };
  const manifest = {
    name: "test",
    type: "dataset",
    description: "test",
    arguments: [
      { name: "name", required: true, description: "名称", type: "string" },
      { name: "catalog_id", required: false, default: "default_catalog", description: "目录", type: "string" }
    ]
  };
  const args = { name: "my-dataset" };
  const result = renderTemplate(template, manifest, args);
  assert.equal(result.name, "my-dataset");
  assert.equal(result.catalog_id, "default_catalog");
});

test("renderTemplate throws on missing required arguments", async () => {
  const { renderTemplate } = await import("../src/utils/template-loader.js");
  const template = { name: "{{name}}" };
  const manifest = {
    name: "test",
    type: "dataset",
    description: "test",
    arguments: [
      { name: "name", required: true, description: "名称", type: "string" }
    ]
  };
  const args = {};
  assert.throws(() => renderTemplate(template, manifest, args), /Missing required argument: name/);
});

test("generateSourceIdentifier creates unique identifiers", async () => {
  const { generateSourceIdentifier } = await import("../src/utils/template-loader.js");
  const id1 = generateSourceIdentifier("dataflow_document");
  const id2 = generateSourceIdentifier("dataflow_document");
  assert.ok(id1.startsWith("dataflow_document_"));
  assert.ok(id1 !== id2, "Generated IDs should be unique");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/typescript && node --import tsx --test test/template-loader.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: 实现模板加载器**

```typescript
// src/utils/template-loader.ts
import { readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { constants } from "node:fs";

export interface TemplateManifest {
  name: string;
  type: "dataset" | "bkn" | "dataflow";
  description: string;
  arguments: Array<{
    name: string;
    required: boolean;
    description: string;
    type: "string" | "integer" | "boolean" | "array";
    default?: unknown;
  }>;
}

export interface LoadedTemplate {
  template: Record<string, unknown>;
  manifest: TemplateManifest;
  templatePath: string;
}

/**
 * Generate a unique source identifier with prefix
 */
export function generateSourceIdentifier(prefix: string): string {
  const random = Math.random().toString(36).substring(2, 15);
  const timestamp = Date.now().toString(36);
  return `${prefix}_${timestamp}_${random}`;
}

/**
 * Replace {{placeholder}} with actual values in a string
 */
function replacePlaceholders(str: string, values: Record<string, unknown>): string {
  return str.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (values[key] !== undefined) {
      return String(values[key]);
    }
    return `{{${key}}}`;
  });
}

/**
 * Deep replace placeholders in an object
 */
function deepReplace(obj: unknown, values: Record<string, unknown>): unknown {
  if (typeof obj === "string") {
    return replacePlaceholders(obj, values);
  }
  if (Array.isArray(obj)) {
    return obj.map(item => deepReplace(item, values));
  }
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = deepReplace(value, values);
    }
    return result;
  }
  return obj;
}

/**
 * Render template with arguments, applying defaults and validation
 */
export function renderTemplate(
  template: Record<string, unknown>,
  manifest: TemplateManifest,
  args: Record<string, unknown>
): Record<string, unknown> {
  // Merge args with defaults
  const merged: Record<string, unknown> = {};
  const missing: string[] = [];

  for (const arg of manifest.arguments) {
    if (args[arg.name] !== undefined) {
      merged[arg.name] = args[arg.name];
    } else if (arg.default !== undefined) {
      merged[arg.name] = arg.default;
    } else if (arg.required) {
      missing.push(arg.name);
    }
  }

  if (missing.length > 0) {
    throw new Error(`Missing required argument(s): ${missing.join(", ")}`);
  }

  // Deep replace placeholders
  return deepReplace(template, merged) as Record<string, unknown>;
}

/**
 * Load template from directory
 */
export async function loadTemplate(
  templateName: string,
  templateType: "dataset" | "bkn" | "dataflow",
  templatesDir: string
): Promise<LoadedTemplate | null> {
  const templateDir = join(templatesDir, templateType, templateName);

  try {
    await access(templateDir, constants.R_OK);
  } catch {
    return null;
  }

  const templatePath = join(templateDir, "template.json");
  const manifestPath = join(templateDir, "manifest.json");

  try {
    const [templateContent, manifestContent] = await Promise.all([
      readFile(templatePath, "utf-8"),
      readFile(manifestPath, "utf-8"),
    ]);

    return {
      template: JSON.parse(templateContent),
      manifest: JSON.parse(manifestContent),
      templatePath: templateDir,
    };
  } catch {
    return null;
  }
}

/**
 * List all available templates of a given type
 */
export async function listTemplates(
  templateType: "dataset" | "bkn" | "dataflow",
  templatesDir: string
): Promise<Array<{ name: string; description: string }>> {
  const { readdir } = await import("node:fs/promises");
  const typeDir = join(templatesDir, templateType);

  try {
    const entries = await readdir(typeDir, { withFileTypes: true });
    const templates: Array<{ name: string; description: string }> = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const loaded = await loadTemplate(entry.name, templateType, templatesDir);
      if (loaded) {
        templates.push({
          name: loaded.manifest.name,
          description: loaded.manifest.description,
        });
      }
    }

    return templates;
  } catch {
    return [];
  }
}

/**
 * Get the templates directory path (relative to dist or src)
 */
export function getTemplatesDir(): string {
  // When running from dist, templates are copied to dist/templates
  // When running from src (tsx), templates are in src/templates
  const { url } = import.meta;
  const baseDir = join(new URL(url).pathname, "..", "..", "templates");
  return baseDir;
}
```

- [ ] **Step 4: 运行测试确认部分通过**

Run: `cd packages/typescript && node --import tsx --test test/template-loader.test.ts`
Expected: Some tests pass, template loading tests still fail (templates not created yet)

- [ ] **Step 5: Commit**

```bash
git add packages/typescript/src/utils/template-loader.ts \
        packages/typescript/test/template-loader.test.ts
git commit -m "feat: add template loader utility functions

- loadTemplate: load template.json and manifest.json
- renderTemplate: replace placeholders with args
- generateSourceIdentifier: create unique IDs
- listTemplates: list available templates by type

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 2: 创建 Dataset 模板文件

**Files:**
- Create: `src/templates/dataset/document/template.json`
- Create: `src/templates/dataset/document/manifest.json`
- Create: `src/templates/dataset/document-content/template.json`
- Create: `src/templates/dataset/document-content/manifest.json`
- Create: `src/templates/dataset/document-element/template.json`
- Create: `src/templates/dataset/document-element/manifest.json`

- [ ] **Step 1: 创建 document dataset 模板**

```json
// src/templates/dataset/document/template.json
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
    { "name": "doc_name", "type": "text", "features": [
      { "name": "doc_name_keyword", "feature_type": "keyword", "ref_property": "doc_name" },
      { "name": "doc_name_fulltext", "feature_type": "fulltext", "ref_property": "doc_name", "config": { "analyzer": "standard" } }
    ]},
    { "name": "doc_md5", "type": "keyword" },
    { "name": "pages", "type": "integer" },
    { "name": "file_type", "type": "keyword" },
    { "name": "creator_id", "type": "keyword" },
    { "name": "created_at", "type": "text" },
    { "name": "updated_at", "type": "text" },
    { "name": "@timestamp", "type": "long" }
  ]
}
```

```json
// src/templates/dataset/document/manifest.json
{
  "name": "document",
  "type": "dataset",
  "description": "文档元信息数据集",
  "arguments": [
    { "name": "name", "required": true, "description": "数据集名称", "type": "string" },
    { "name": "catalog_id", "required": false, "default": "adp_bkn_catalog", "description": "所属目录ID", "type": "string" }
  ]
}
```

- [ ] **Step 2: 创建 document-content dataset 模板**

```json
// src/templates/dataset/document-content/template.json
{
  "catalog_id": "{{catalog_id}}",
  "name": "{{name}}",
  "category": "dataset",
  "status": "active",
  "description": "文档切片及向量数据集",
  "source_identifier": "{{source_identifier}}",
  "schema_definition": [
    { "name": "id", "type": "keyword" },
    { "name": "document_id", "type": "keyword" },
    { "name": "slice_md5", "type": "keyword" },
    { "name": "deduplication_id", "type": "keyword" },
    { "name": "segment_id", "type": "integer" },
    { "name": "slice_type", "type": "integer" },
    { "name": "slice_content", "type": "text", "features": [
      { "name": "slice_content_fulltext", "feature_type": "fulltext", "ref_property": "slice_content", "config": { "analyzer": "standard" } }
    ]},
    { "name": "text_vector", "type": "vector", "features": [
      { "name": "text_vector", "feature_type": "vector", "ref_property": "text_vector", "config": { "dimension": 768, "method": { "name": "hnsw", "engine": "lucene", "parameters": { "ef_construction": 256 } } } }
    ]},
    { "name": "img_path", "type": "keyword" },
    { "name": "image_vector", "type": "vector", "features": [
      { "name": "image_vector", "feature_type": "vector", "ref_property": "image_vector", "config": { "dimension": 512, "method": { "name": "hnsw", "engine": "lucene", "parameters": { "ef_construction": 256 } } } }
    ]},
    { "name": "created_at", "type": "text" },
    { "name": "updated_at", "type": "text" },
    { "name": "@timestamp", "type": "long" }
  ]
}
```

```json
// src/templates/dataset/document-content/manifest.json
{
  "name": "document-content",
  "type": "dataset",
  "description": "文档切片及向量数据集",
  "arguments": [
    { "name": "name", "required": true, "description": "数据集名称", "type": "string" },
    { "name": "catalog_id", "required": false, "default": "adp_bkn_catalog", "description": "所属目录ID", "type": "string" }
  ]
}
```

- [ ] **Step 3: 创建 document-element dataset 模板**

```json
// src/templates/dataset/document-element/template.json
{
  "catalog_id": "{{catalog_id}}",
  "name": "{{name}}",
  "category": "dataset",
  "status": "active",
  "description": "文档结构化元素数据集",
  "source_identifier": "{{source_identifier}}",
  "schema_definition": [
    { "name": "id", "type": "keyword" },
    { "name": "element_id", "type": "keyword" },
    { "name": "document_id", "type": "keyword" },
    { "name": "element_type", "type": "keyword" },
    { "name": "parent_id", "type": "keyword" },
    { "name": "level", "type": "integer" },
    { "name": "content", "type": "text", "features": [
      { "name": "content_fulltext", "feature_type": "fulltext", "ref_property": "content", "config": { "analyzer": "standard" } }
    ]},
    { "name": "metadata", "type": "object" },
    { "name": "@timestamp", "type": "long" }
  ]
}
```

```json
// src/templates/dataset/document-element/manifest.json
{
  "name": "document-element",
  "type": "dataset",
  "description": "文档结构化元素数据集",
  "arguments": [
    { "name": "name", "required": true, "description": "数据集名称", "type": "string" },
    { "name": "catalog_id", "required": false, "default": "adp_bkn_catalog", "description": "所属目录ID", "type": "string" }
  ]
}
```

- [ ] **Step 4: 创建模板目录结构**

```bash
mkdir -p packages/typescript/src/templates/dataset/document
mkdir -p packages/typescript/src/templates/dataset/document-content
mkdir -p packages/typescript/src/templates/dataset/document-element
```

- [ ] **Step 5: 运行模板加载测试确认通过**

Run: `cd packages/typescript && node --import tsx --test test/template-loader.test.ts`
Expected: PASS for template loading tests

- [ ] **Step 6: Commit**

```bash
git add packages/typescript/src/templates/dataset/
git commit -m "feat: add dataset templates (document, document-content, document-element)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 3: 创建 BKN 模板文件

**Files:**
- Create: `src/templates/bkn/document/template.json`
- Create: `src/templates/bkn/document/manifest.json`

- [ ] **Step 1: 创建 bkn document 模板**

```json
// src/templates/bkn/document/template.json
{
  "name": "{{name}}",
  "tags": [],
  "comment": "",
  "icon": "icon-dip-graph",
  "color": "#0e5fc5",
  "detail": "---\ntype: knowledge_network\nname: {{name}}\ntags: []\nbranch: main\n---\n\n# {{name}}\n\n\n## Network Overview\n\n",
  "branch": "main",
  "business_domain": "bd_public",
  "object_types": [
    {
      "id": "d6sco6s2mlgikcusgpo0",
      "name": "文档特征对象",
      "data_source": {
        "type": "resource",
        "id": "{{content_dataset_id}}"
      },
      "data_properties": [
        { "name": "id", "display_name": "id", "type": "string", "mapped_field": { "name": "id", "type": "string", "display_name": "id" } },
        { "name": "document_id", "display_name": "document_id", "type": "string", "mapped_field": { "name": "document_id", "type": "string", "display_name": "document_id" } },
        { "name": "slice_content", "display_name": "slice_content", "type": "text", "mapped_field": { "name": "slice_content", "type": "text", "display_name": "slice_content" }, "index_config": { "keyword_config": { "enabled": true, "ignore_above_len": 1024 }, "fulltext_config": { "enabled": true, "analyzer": "ik_max_word" }, "vector_config": { "enabled": true, "model_id": "{{embedding_model_id}}" } } },
        { "name": "slice_md5", "display_name": "slice_md5", "type": "string", "mapped_field": { "name": "slice_md5", "type": "string", "display_name": "slice_md5" } },
        { "name": "text_vector", "display_name": "text_vector", "type": "vector", "mapped_field": { "name": "text_vector", "type": "vector", "display_name": "text_vector" } }
      ],
      "primary_keys": ["id"],
      "display_key": "id",
      "tags": [],
      "comment": "",
      "icon": "icon-tianshenpi",
      "color": "#0e5fc5"
    },
    {
      "id": "d6scpd42mlgikcusgpp0",
      "name": "文档对象",
      "data_source": {
        "type": "resource",
        "id": "{{document_dataset_id}}"
      },
      "data_properties": [
        { "name": "document_id", "display_name": "document_id", "type": "string", "mapped_field": { "name": "document_id", "type": "string", "display_name": "document_id" } },
        { "name": "doc_name", "display_name": "doc_name", "type": "text", "mapped_field": { "name": "doc_name", "type": "text", "display_name": "doc_name" }, "index_config": { "keyword_config": { "enabled": true, "ignore_above_len": 1024 }, "fulltext_config": { "enabled": true, "analyzer": "ik_max_word" }, "vector_config": { "enabled": true, "model_id": "{{embedding_model_id}}" } } }
      ],
      "primary_keys": ["document_id"],
      "display_key": "doc_name",
      "tags": [],
      "comment": "",
      "icon": "icon-tianshenpi",
      "color": "#0e5fc5"
    },
    {
      "id": "d6scrvk2mlgikcusgpq0",
      "name": "文档解析树对象",
      "data_source": {
        "type": "resource",
        "id": "{{element_dataset_id}}"
      },
      "data_properties": [
        { "name": "element_id", "display_name": "element_id", "type": "string", "mapped_field": { "name": "element_id", "type": "string", "display_name": "element_id" } },
        { "name": "document_id", "display_name": "document_id", "type": "string", "mapped_field": { "name": "document_id", "type": "string", "display_name": "document_id" } },
        { "name": "element_type", "display_name": "element_type", "type": "text", "mapped_field": { "name": "element_type", "type": "text", "display_name": "element_type" } },
        { "name": "level", "display_name": "level", "type": "integer", "mapped_field": { "name": "level", "type": "integer", "display_name": "level" } },
        { "name": "content", "display_name": "content", "type": "text", "mapped_field": { "name": "content", "type": "text", "display_name": "content" }, "index_config": { "keyword_config": { "enabled": false, "ignore_above_len": 1024 }, "fulltext_config": { "enabled": true, "analyzer": "ik_max_word" }, "vector_config": { "enabled": true, "model_id": "{{embedding_model_id}}" } } }
      ],
      "primary_keys": ["element_id"],
      "display_key": "element_id",
      "tags": [],
      "comment": "",
      "icon": "icon-tianshenpi",
      "color": "#0e5fc5"
    }
  ],
  "relation_types": [
    {
      "id": "d6se2d42mlgikcusgpr0",
      "name": "文档包含特征",
      "source_object_type_id": "d6scpd42mlgikcusgpp0",
      "target_object_type_id": "d6scrvk2mlgikcusgpq0",
      "type": "direct",
      "mapping_rules": [
        { "source_property": { "name": "document_id", "display_name": "document_id" }, "target_property": { "name": "document_id", "display_name": "document_id" } }
      ],
      "tags": [],
      "comment": "",
      "icon": "",
      "color": ""
    },
    {
      "id": "d6se2jc2mlgikcusgps0",
      "name": "特征关联元素",
      "source_object_type_id": "d6sco6s2mlgikcusgpo0",
      "target_object_type_id": "d6scrvk2mlgikcusgpq0",
      "type": "direct",
      "mapping_rules": [
        { "source_property": { "name": "document_id", "display_name": "document_id" }, "target_property": { "name": "document_id", "display_name": "document_id" } }
      ],
      "tags": [],
      "comment": "",
      "icon": "",
      "color": ""
    }
  ],
  "validate_dependency": false
}
```

```json
// src/templates/bkn/document/manifest.json
{
  "name": "document",
  "type": "bkn",
  "description": "文档知识网络",
  "arguments": [
    { "name": "name", "required": true, "description": "BKN 名称", "type": "string" },
    { "name": "embedding_model_id", "required": true, "description": "向量化模型 ID", "type": "string" },
    { "name": "content_dataset_id", "required": true, "description": "内容数据集 ID", "type": "string" },
    { "name": "document_dataset_id", "required": true, "description": "文档数据集 ID", "type": "string" },
    { "name": "element_dataset_id", "required": true, "description": "元素数据集 ID", "type": "string" }
  ]
}
```

- [ ] **Step 2: 创建模板目录**

```bash
mkdir -p packages/typescript/src/templates/bkn/document
```

- [ ] **Step 3: Commit**

```bash
git add packages/typescript/src/templates/bkn/
git commit -m "feat: add BKN document template

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 4: 创建 Dataflow 模板文件

**Files:**
- Create: `src/templates/dataflow/unstructured/template.json`
- Create: `src/templates/dataflow/unstructured/manifest.json`

- [ ] **Step 1: 创建 dataflow unstructured 模板**

```json
// src/templates/dataflow/unstructured/template.json
{
  "title": "{{title}}",
  "steps": [
    {
      "id": "0",
      "title": "",
      "operator": "@trigger/dataflow-doc"
    },
    {
      "id": "1",
      "title": "",
      "operator": "@content/file_parse",
      "parameters": {
        "docid": "{{__0.id}}",
        "model": "embedding",
        "slice_vector": "slice_vector",
        "source_type": "docid",
        "version": "{{__0.rev}}"
      }
    },
    {
      "id": "1001",
      "title": "写入向量",
      "operator": "@dataset/write-docs",
      "parameters": {
        "dataset_id": "{{content_dataset_id}}",
        "documents": "{{__1.chunks}}"
      }
    },
    {
      "id": "1002",
      "title": "写入元素",
      "operator": "@dataset/write-docs",
      "parameters": {
        "dataset_id": "{{element_dataset_id}}",
        "documents": "{{__1.content_list}}"
      }
    },
    {
      "id": "1003",
      "title": "写入文件元信息",
      "operator": "@dataset/write-docs",
      "parameters": {
        "dataset_id": "{{document_dataset_id}}",
        "documents": [
          {
            "document_id": "{{__0.id}}",
            "name": "{{__0.name}}"
          }
        ]
      }
    }
  ],
  "trigger_config": {
    "operator": "@trigger/manual",
    "dataSource": {
      "operator": "",
      "parameters": {
        "accessorid": "00000000-0000-0000-0000-000000000000"
      }
    }
  }
}
```

```json
// src/templates/dataflow/unstructured/manifest.json
{
  "name": "unstructured",
  "type": "dataflow",
  "description": "非结构化文档处理流程",
  "arguments": [
    { "name": "title", "required": true, "description": "数据流标题", "type": "string" },
    { "name": "content_dataset_id", "required": true, "description": "内容数据集 ID", "type": "string" },
    { "name": "document_dataset_id", "required": true, "description": "文档数据集 ID", "type": "string" },
    { "name": "element_dataset_id", "required": true, "description": "元素数据集 ID", "type": "string" }
  ]
}
```

- [ ] **Step 2: 创建模板目录**

```bash
mkdir -p packages/typescript/src/templates/dataflow/unstructured
```

- [ ] **Step 3: Commit**

```bash
git add packages/typescript/src/templates/dataflow/
git commit -m "feat: add dataflow unstructured template

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 5: 扩展 dataflow CLI 命令 - templates 子命令

**Files:**
- Modify: `src/commands/dataflow.ts`

- [ ] **Step 1: 在 dataflow.ts 添加 templates 子命令**

在现有的 `runDataflowCommand` 函数中添加新的子命令。找到 `.command(` 定义区域，在现有命令后添加：

```typescript
// 在 import 区域添加
import { loadTemplate, listTemplates, renderTemplate, generateSourceIdentifier, getTemplatesDir } from "../utils/template-loader.js";

// 在 parser.command 链中添加（在 .command("logs ...") 之后）
.command(
  "templates",
  "List all available templates",
  (command: any) =>
    command
      .option("json", { type: "boolean", default: false, describe: "Output as JSON" }),
  async (argv: any) => {
    exitCode = await with401RefreshRetry(async () => {
      const templatesDir = getTemplatesDir();

      const [datasetTemplates, bknTemplates, dataflowTemplates] = await Promise.all([
        listTemplates("dataset", templatesDir),
        listTemplates("bkn", templatesDir),
        listTemplates("dataflow", templatesDir),
      ]);

      if (argv.json) {
        console.log(JSON.stringify({
          dataset: datasetTemplates,
          bkn: bknTemplates,
          dataflow: dataflowTemplates,
        }, null, 2));
      } else {
        console.log("Dataset Templates:");
        for (const t of datasetTemplates) {
          console.log(`  - ${t.name.padEnd(18)} ${t.description}`);
        }
        console.log("");
        console.log("BKN Templates:");
        for (const t of bknTemplates) {
          console.log(`  - ${t.name.padEnd(18)} ${t.description}`);
        }
        console.log("");
        console.log("Dataflow Templates:");
        for (const t of dataflowTemplates) {
          console.log(`  - ${t.name.padEnd(18)} ${t.description}`);
        }
      }
      return 0;
    });
  },
)
```

- [ ] **Step 2: 运行测试确认命令可用**

Run: `cd packages/typescript && node --import tsx --test test/dataflow-command.test.ts`
Expected: Existing tests still pass

- [ ] **Step 3: Commit**

```bash
git add packages/typescript/src/commands/dataflow.ts
git commit -m "feat: add 'dataflow templates' command

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 6: 扩展 dataflow CLI 命令 - create-dataset 子命令

**Files:**
- Modify: `src/commands/dataflow.ts`

- [ ] **Step 1: 在 dataflow.ts 添加 create-dataset 子命令**

在 templates 命令后添加：

```typescript
.command(
  "create-dataset",
  "Create a dataset from a template",
  (command: any) =>
    command
      .option("template", { type: "string", demandOption: true, describe: "Template name or file path" })
      .option("set", { type: "array", string: true, describe: "Set parameter (key=value), can be used multiple times" })
      .option("json", { type: "boolean", default: false, describe: "Output as JSON" })
      .option("biz-domain", { alias: "bd", type: "string" }),
  async (argv: any) => {
    exitCode = await with401RefreshRetry(async () => {
      const base = await requireTokenAndBusinessDomain(argv.bizDomain);
      const templatesDir = getTemplatesDir();

      // Parse --set arguments
      const args: Record<string, string> = {};
      if (argv.set) {
        for (const item of argv.set as string[]) {
          const eqIdx = item.indexOf("=");
          if (eqIdx > 0) {
            const key = item.slice(0, eqIdx);
            const value = item.slice(eqIdx + 1);
            args[key] = value;
          }
        }
      }

      // Load template
      const loaded = await loadTemplate(argv.template, "dataset", templatesDir);
      if (!loaded) {
        console.error(`Template not found: ${argv.template}`);
        return 1;
      }

      // Generate source_identifier based on template name
      const prefixMap: Record<string, string> = {
        "document": "dataflow_document",
        "document-content": "dataflow_content",
        "document-element": "dataflow_element",
      };
      const prefix = prefixMap[loaded.manifest.name] || "dataflow";
      args["source_identifier"] = generateSourceIdentifier(prefix);

      // Render template
      const rendered = renderTemplate(loaded.template, loaded.manifest, args);

      // Create dataset via API
      const response = await createVegaResource({
        ...base,
        body: JSON.stringify(rendered),
      });

      const result = JSON.parse(response);
      if (argv.json) {
        console.log(JSON.stringify({ success: true, id: result.id, name: args.name }, null, 2));
      } else {
        console.log(`dataset created: id=${result.id}`);
      }
      return 0;
    });
  },
)
```

- [ ] **Step 2: 添加 createVegaResource import（如果尚未导入）**

在文件顶部 import 区域确认已导入：

```typescript
import { createVegaResource } from "../api/vega.js";
```

- [ ] **Step 3: 运行测试确认命令可用**

Run: `cd packages/typescript && node --import tsx --test test/dataflow-command.test.ts`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add packages/typescript/src/commands/dataflow.ts
git commit -m "feat: add 'dataflow create-dataset' command

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 7: 扩展 dataflow CLI 命令 - create-bkn 子命令

**Files:**
- Modify: `src/commands/dataflow.ts`

- [ ] **Step 1: 在 dataflow.ts 添加 create-bkn 子命令**

在 create-dataset 命令后添加：

```typescript
.command(
  "create-bkn",
  "Create a BKN (knowledge network) from a template",
  (command: any) =>
    command
      .option("template", { type: "string", demandOption: true, describe: "Template name or file path" })
      .option("set", { type: "array", string: true, describe: "Set parameter (key=value), can be used multiple times" })
      .option("json", { type: "boolean", default: false, describe: "Output as JSON" })
      .option("biz-domain", { alias: "bd", type: "string" }),
  async (argv: any) => {
    exitCode = await with401RefreshRetry(async () => {
      const base = await requireTokenAndBusinessDomain(argv.bizDomain);
      const templatesDir = getTemplatesDir();

      // Parse --set arguments
      const args: Record<string, string> = {};
      if (argv.set) {
        for (const item of argv.set as string[]) {
          const eqIdx = item.indexOf("=");
          if (eqIdx > 0) {
            const key = item.slice(0, eqIdx);
            const value = item.slice(eqIdx + 1);
            args[key] = value;
          }
        }
      }

      // Load template
      const loaded = await loadTemplate(argv.template, "bkn", templatesDir);
      if (!loaded) {
        console.error(`Template not found: ${argv.template}`);
        return 1;
      }

      // Render template
      const rendered = renderTemplate(loaded.template, loaded.manifest, args);

      // Create BKN via API
      const response = await createKnowledgeNetwork({
        ...base,
        body: JSON.stringify(rendered),
        validate_dependency: false,
      });

      const result = JSON.parse(response);
      if (argv.json) {
        console.log(JSON.stringify({ success: true, id: result.id, name: args.name }, null, 2));
      } else {
        console.log(`bkn created: id=${result.id}`);
      }
      return 0;
    });
  },
)
```

- [ ] **Step 2: 添加 createKnowledgeNetwork import**

在文件顶部 import 区域添加：

```typescript
import { createKnowledgeNetwork } from "../api/knowledge-networks.js";
```

- [ ] **Step 3: Commit**

```bash
git add packages/typescript/src/commands/dataflow.ts
git commit -m "feat: add 'dataflow create-bkn' command

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 8: 扩展 dataflow CLI 命令 - create 子命令（dataflow）

**Files:**
- Modify: `src/commands/dataflow.ts`

- [ ] **Step 1: 注意现有 create 命令冲突**

现有的 `create` 命令接受 `<json>` 参数，需要修改以支持模板方式。我们将添加一个新的命令 `create-from-template` 或修改现有命令以同时支持两种方式。

查看现有 create 命令定义，决定是否需要创建新命令。为了保持向后兼容，我们添加一个新选项 `--template`：

修改现有的 create 命令定义，添加对模板的支持：

```typescript
// 修改现有 create 命令，添加 --template 选项
.command(
  "create [json]",
  "Create a new dataflow (DAG) from a JSON definition or template",
  (command: any) =>
    command
      .positional("json", {
        type: "string",
        describe: "JSON body string or @file-path to read from file",
      })
      .option("template", { type: "string", describe: "Template name (use instead of json)" })
      .option("set", { type: "array", string: true, describe: "Set parameter (key=value), can be used multiple times" })
      .option("biz-domain", { alias: "bd", type: "string" })
      .check((argv: any) => {
        const hasJson = typeof argv.json === "string";
        const hasTemplate = typeof argv.template === "string";
        if (hasJson && hasTemplate) {
          throw new Error("Cannot use both json and --template");
        }
        if (!hasJson && !hasTemplate) {
          throw new Error("Either json or --template is required");
        }
        return true;
      }),
  async (argv: any) => {
    exitCode = await with401RefreshRetry(async () => {
      const base = await requireTokenAndBusinessDomain(argv.bizDomain);

      let body: DataflowCreateBody;

      if (argv.template) {
        // Use template
        const templatesDir = getTemplatesDir();

        // Parse --set arguments
        const args: Record<string, string> = {};
        if (argv.set) {
          for (const item of argv.set as string[]) {
            const eqIdx = item.indexOf("=");
            if (eqIdx > 0) {
              const key = item.slice(0, eqIdx);
              const value = item.slice(eqIdx + 1);
              args[key] = value;
            }
          }
        }

        const loaded = await loadTemplate(argv.template, "dataflow", templatesDir);
        if (!loaded) {
          console.error(`Template not found: ${argv.template}`);
          return 1;
        }

        body = renderTemplate(loaded.template, loaded.manifest, args) as DataflowCreateBody;
      } else {
        // Use JSON
        let raw: string = argv.json;
        if (raw.startsWith("@")) {
          const filePath = raw.slice(1);
          await access(filePath, constants.R_OK);
          raw = (await readFile(filePath, "utf8")).toString();
        }
        body = JSON.parse(raw) as DataflowCreateBody;
      }

      const dagId = await createDataflow({ ...base, body });
      console.log(JSON.stringify({ id: dagId }, null, 2));
      return 0;
    });
  },
)
```

- [ ] **Step 2: 运行测试确认命令可用**

Run: `cd packages/typescript && node --import tsx --test test/dataflow-command.test.ts`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add packages/typescript/src/commands/dataflow.ts
git commit -m "feat: add --template option to 'dataflow create' command

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 9: 添加 CLI 命令测试

**Files:**
- Modify: `test/dataflow-command.test.ts`

- [ ] **Step 1: 添加 templates 命令测试**

```typescript
test("dataflow templates lists all templates", async () => {
  const configDir = createConfigDir();
  await setupToken(configDir);

  const result = await runCommand(["templates"]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /Dataset Templates:/);
  assert.match(result.stdout, /document/);
  assert.match(result.stdout, /document-content/);
  assert.match(result.stdout, /document-element/);
  assert.match(result.stdout, /BKN Templates:/);
  assert.match(result.stdout, /Dataflow Templates:/);
  assert.match(result.stdout, /unstructured/);
});

test("dataflow templates --json outputs JSON", async () => {
  const configDir = createConfigDir();
  await setupToken(configDir);

  const result = await runCommand(["templates", "--json"]);
  assert.equal(result.code, 0);
  const parsed = JSON.parse(result.stdout);
  assert.ok(Array.isArray(parsed.dataset));
  assert.ok(Array.isArray(parsed.bkn));
  assert.ok(Array.isArray(parsed.dataflow));
});
```

- [ ] **Step 2: 添加 create-dataset 命令测试**

```typescript
test("dataflow create-dataset creates a dataset from template", async () => {
  const configDir = createConfigDir();
  await setupToken(configDir);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ id: "ds-001", name: "my-dataset" }), { status: 200 });

  try {
    const result = await runCommand([
      "create-dataset",
      "--template", "document",
      "--set", "name=my-dataset",
    ]);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /ds-001/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("dataflow create-dataset validates required arguments", async () => {
  const configDir = createConfigDir();
  await setupToken(configDir);

  const result = await runCommand(["create-dataset", "--template", "document"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Missing required argument/);
});
```

- [ ] **Step 3: 添加 create-bkn 命令测试**

```typescript
test("dataflow create-bkn creates a BKN from template", async () => {
  const configDir = createConfigDir();
  await setupToken(configDir);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ id: "bkn-001", name: "my-bkn" }), { status: 200 });

  try {
    const result = await runCommand([
      "create-bkn",
      "--template", "document",
      "--set", "name=my-bkn",
      "--set", "embedding_model_id=model-123",
      "--set", "content_dataset_id=ds-001",
      "--set", "document_dataset_id=ds-002",
      "--set", "element_dataset_id=ds-003",
    ]);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /bkn-001/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
```

- [ ] **Step 4: 添加 create --template 命令测试**

```typescript
test("dataflow create --template creates a dataflow from template", async () => {
  const configDir = createConfigDir();
  await setupToken(configDir);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ id: "dag-001" }), { status: 200 });

  try {
    const result = await runCommand([
      "create",
      "--template", "unstructured",
      "--set", "title=my-flow",
      "--set", "content_dataset_id=ds-001",
      "--set", "document_dataset_id=ds-002",
      "--set", "element_dataset_id=ds-003",
    ]);
    assert.equal(result.code, 0);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.id, "dag-001");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
```

- [ ] **Step 5: 运行所有测试**

Run: `cd packages/typescript && node --import tsx --test test/dataflow-command.test.ts`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add packages/typescript/test/dataflow-command.test.ts
git commit -m "test: add tests for dataflow template commands

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 10: 更新 CLI 帮助文档

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: 更新 printHelp 函数中的 dataflow 命令说明**

找到 `dataflow` 相关的帮助文本，更新为：

```typescript
console.log(`  kweaver dataflow templates [--json]
  kweaver dataflow create-dataset --template <name> --set "key=value" [--json] [-bd value]
  kweaver dataflow create-bkn --template <name> --set "key=value" [--json] [-bd value]
  kweaver dataflow create (--template <name> --set "key=value" | <json>) [-bd value]
  kweaver dataflow list [-bd value]
  kweaver dataflow run <dagId> (--file <path> | --url <remote-url> --name <filename>) [-bd value]
  kweaver dataflow runs <dagId> [--since <date-like>] [-bd value]
  kweaver dataflow logs <dagId> <instanceId> [--detail] [-bd value]`);
```

- [ ] **Step 2: Commit**

```bash
git add packages/typescript/src/cli.ts
git commit -m "docs: update CLI help for dataflow template commands

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 11: 集成测试与最终验证

**Files:**
- 无新文件

- [ ] **Step 1: 运行所有测试**

Run: `cd packages/typescript && node --import tsx --test test/*.test.ts`
Expected: All tests pass

- [ ] **Step 2: 运行 lint 检查**

Run: `cd packages/typescript && npm run lint`
Expected: No errors

- [ ] **Step 3: 运行 build**

Run: `cd packages/typescript && npm run build`
Expected: Build succeeds, templates copied to dist/

- [ ] **Step 4: 验证模板文件已复制**

Run: `ls packages/typescript/dist/templates/`
Expected: dataset/, bkn/, dataflow/ directories present

- [ ] **Step 5: 最终 Commit**

```bash
git add -A
git commit -m "feat: complete dataflow dataset-bkn CLI implementation

- Add template loader utility functions
- Add dataset templates (document, document-content, document-element)
- Add BKN document template
- Add dataflow unstructured template
- Add CLI commands: templates, create-dataset, create-bkn
- Extend create command with --template option
- Add comprehensive tests
- Update CLI help documentation

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## 验收清单

- [ ] `kweaver dataflow templates` 能列出所有内置模板
- [ ] `kweaver dataflow templates --json` 输出正确的 JSON 格式
- [ ] `kweaver dataflow create-dataset --template document --set "name=xxx"` 能创建 dataset
- [ ] `kweaver dataflow create-dataset --template document-content --set "name=xxx"` 能创建 dataset
- [ ] `kweaver dataflow create-dataset --template document-element --set "name=xxx"` 能创建 dataset
- [ ] `kweaver dataflow create-bkn --template document --set ...` 能创建 BKN
- [ ] `kweaver dataflow create --template unstructured --set ...` 能创建 dataflow
- [ ] 缺失必填参数时返回清晰错误信息
- [ ] `--json` 模式输出正确的 JSON 格式
- [ ] 模板文件随 npm 包正确发布（在 dist/templates/ 目录）
- [ ] 所有测试通过
- [ ] lint 检查通过
- [ ] build 成功

---

## API 端点汇总

| 操作 | 端点 | 方法 | 调用函数 |
|------|------|------|----------|
| 创建 Dataset | `/api/vega-backend/v1/resources` | POST | `createVegaResource` |
| 创建 BKN | `/api/ontology-manager/v1/knowledge-networks?validate_dependency=false` | POST | `createKnowledgeNetwork` |
| 创建 Dataflow | `/api/automation/v1/data-flow/flow` | POST | `createDataflow` |
