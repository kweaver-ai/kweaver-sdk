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
  assert.throws(() => renderTemplate(template, manifest, args), /Missing required argument/);
});

test("generateSourceIdentifier creates unique identifiers", async () => {
  const { generateSourceIdentifier } = await import("../src/utils/template-loader.js");
  const id1 = generateSourceIdentifier("dataflow_document");
  const id2 = generateSourceIdentifier("dataflow_document");
  assert.ok(id1.startsWith("dataflow_document_"));
  assert.ok(id1 !== id2, "Generated IDs should be unique");
});

test("renderTemplate uses default for optional args", async () => {
  const { renderTemplate } = await import("../src/utils/template-loader.js");
  const template = { name: "{{name}}", source_identifier: "{{source_identifier}}" };
  const manifest = {
    name: "test",
    type: "dataset",
    description: "test",
    arguments: [
      { name: "name", required: true, description: "名称", type: "string" },
      { name: "source_identifier", required: false, default: "", description: "数据源标识符", type: "string" }
    ]
  };
  const args = { name: "my-dataset" };
  const result = renderTemplate(template, manifest, args);
  assert.equal(result.name, "my-dataset");
  assert.equal(result.source_identifier, "");
});

test("renderTemplate uses provided value over default", async () => {
  const { renderTemplate } = await import("../src/utils/template-loader.js");
  const template = { name: "{{name}}", source_identifier: "{{source_identifier}}" };
  const manifest = {
    name: "test",
    type: "dataset",
    description: "test",
    arguments: [
      { name: "name", required: true, description: "名称", type: "string" },
      { name: "source_identifier", required: false, default: "", description: "数据源标识符", type: "string" }
    ]
  };
  const args = { name: "my-dataset", source_identifier: "custom_id_123" };
  const result = renderTemplate(template, manifest, args);
  assert.equal(result.name, "my-dataset");
  assert.equal(result.source_identifier, "custom_id_123");
});
