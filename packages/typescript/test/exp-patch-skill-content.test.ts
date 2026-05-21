// test/exp-patch-skill-content.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { SkillContentPatcher } from "../src/trace-ai/exp/patch/skill-content.js";
import type { SkillApiClient } from "../src/trace-ai/exp/patch/skill-api-client.js";

function mockSkillClient(overrides: Partial<SkillApiClient> = {}): SkillApiClient {
  return {
    getSkillContent: async () => "# SOP\n\n## Section 1\nexisting content.",
    publishSkillVersion: async (_, content) => ({ version: "v3", content }),
    ...overrides,
  };
}

test("SkillContentPatcher: appends section to existing content", async () => {
  let published = "";
  const client = mockSkillClient({ publishSkillVersion: async (_, c) => { published = c; return { version: "v2", content: c }; } });
  const result = await new SkillContentPatcher(client).apply({ skill_id: "sop-01", append_section: "## New\ncontent" });
  assert.equal(result.newVersion, "v2");
  assert.match(published, /SOP/);
  assert.match(published, /New/);
});

test("SkillContentPatcher: separates existing and new section with double newline", async () => {
  let published = "";
  const client = mockSkillClient({
    getSkillContent: async () => "# Existing",
    publishSkillVersion: async (_, c) => { published = c; return { version: "v2", content: c }; },
  });
  await new SkillContentPatcher(client).apply({ skill_id: "sop", append_section: "## New\ncontent" });
  assert.match(published, /Existing\n\n## New/);
});

test("SkillContentPatcher: returns newVersion from publishSkillVersion", async () => {
  const client = mockSkillClient({ publishSkillVersion: async () => ({ version: "v99", content: "" }) });
  const result = await new SkillContentPatcher(client).apply({ skill_id: "sop", append_section: "## X\ntext" });
  assert.equal(result.newVersion, "v99");
});

test("SkillContentPatcher: propagates publish error", async () => {
  const client = mockSkillClient({ publishSkillVersion: async () => { throw new Error("version conflict"); } });
  await assert.rejects(() => new SkillContentPatcher(client).apply({ skill_id: "sop", append_section: "## X" }), /version conflict/);
});
