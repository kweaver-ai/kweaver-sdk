import test from "node:test";
import assert from "node:assert/strict";
import {
  loadBundledModelTemplateManifest,
  readBundledModelTemplateFile,
} from "../src/bundled-model-templates.js";

test("bundled model manifest lists llm and small ids", async () => {
  const m = await loadBundledModelTemplateManifest();
  assert.ok(Array.isArray(m.llm));
  assert.ok(Array.isArray(m.small));
  assert.equal(m.llm.length, 1);
  assert.equal(m.llm[0]?.id, "basic");
  assert.equal(m.small.length, 1);
  assert.equal(m.small[0]?.id, "basic");
});

test("readBundledModelTemplateFile returns JSON text with api_url", async () => {
  const t = await readBundledModelTemplateFile("small", "basic");
  assert.ok(t.includes("api_url"));
  assert.ok(t.includes("__template_note"));
});

test("llm basic template nests model_config and core fields", async () => {
  const t = await readBundledModelTemplateFile("llm", "basic");
  assert.ok(t.includes("\"model_config\""));
  assert.ok(t.includes("max_model_len"));
  assert.ok(t.includes("model_series"));
});
