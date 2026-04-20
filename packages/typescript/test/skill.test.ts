import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { KWeaverClient } from "../src/client.js";
import {
  parseSkillHistoryVersionArgs,
  parseSkillListArgs,
  parseSkillRegisterArgs,
  parseSkillUpdateMetadataArgs,
  parseSkillUpdatePackageArgs,
} from "../src/commands/skill.js";
import { downloadSkill, installSkillArchive } from "../src/api/skills.js";

const BASE = "https://mock.kweaver.test";
const TOKEN = "test-token-abc";

test("parseSkillListArgs uses list default page size 30", () => {
  const parsed = parseSkillListArgs(["--name", "demo"]);
  assert.equal(parsed.page, 1);
  assert.equal(parsed.pageSize, 30);
  assert.equal(parsed.name, "demo");
});

test("parseSkillListArgs accepts common flags after subcommand options", () => {
  const parsed = parseSkillListArgs(["--name", "demo", "-bd", "bd_demo", "--compact"]);
  assert.equal(parsed.name, "demo");
  assert.equal(parsed.businessDomain, "bd_demo");
  assert.equal(parsed.pretty, false);
});

test("parseSkillRegisterArgs requires exactly one source flag", () => {
  assert.throws(() => parseSkillRegisterArgs([]), /exactly one/);
  assert.throws(
    () => parseSkillRegisterArgs(["--content-file", "a.md", "--zip-file", "a.zip"]),
    /exactly one/
  );
});

test("parseSkillUpdateMetadataArgs parses required and optional fields", () => {
  const parsed = parseSkillUpdateMetadataArgs([
    "skill-1",
    "--name", "Demo",
    "--description", "Demo skill",
    "--category", "system",
    "--source", "internal",
    "--extend-info", '{"owner":"sdk"}',
    "-bd", "bd_demo",
    "--compact",
  ]);
  assert.equal(parsed.skillId, "skill-1");
  assert.equal(parsed.name, "Demo");
  assert.equal(parsed.description, "Demo skill");
  assert.equal(parsed.category, "system");
  assert.equal(parsed.source, "internal");
  assert.deepEqual(parsed.extendInfo, { owner: "sdk" });
  assert.equal(parsed.businessDomain, "bd_demo");
  assert.equal(parsed.pretty, false);
});

test("parseSkillUpdatePackageArgs requires exactly one package source", () => {
  assert.throws(() => parseSkillUpdatePackageArgs(["skill-1"]), /exactly one/);
  assert.throws(
    () => parseSkillUpdatePackageArgs(["skill-1", "--content-file", "a.md", "--zip-file", "a.zip"]),
    /exactly one/
  );

  const parsed = parseSkillUpdatePackageArgs(["skill-1", "--content-file", "a.md"]);
  assert.equal(parsed.skillId, "skill-1");
  assert.equal(parsed.contentFile, "a.md");
});

test("parseSkillHistoryVersionArgs requires version", () => {
  assert.throws(
    () => parseSkillHistoryVersionArgs(["skill-1"], "republish"),
    /Missing --version/
  );

  const parsed = parseSkillHistoryVersionArgs(["skill-1", "--version", "v1"], "republish");
  assert.equal(parsed.skillId, "skill-1");
  assert.equal(parsed.version, "v1");
});

test("client.skills.list unwraps envelope data", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        code: 0,
        data: { total_count: 1, page: 1, page_size: 30, data: [{ skill_id: "skill-1", name: "demo" }] },
      }),
      { status: 200 }
    );

  try {
    const client = new KWeaverClient({ baseUrl: BASE, accessToken: TOKEN });
    const result = await client.skills.list();
    assert.equal(result.data.length, 1);
    assert.equal(result.data[0]?.id, "skill-1");
  } finally {
    globalThis.fetch = orig;
  }
});

test("client.skills.fetchContent resolves index then fetches remote markdown", async () => {
  const orig = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (input) => {
    calls += 1;
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/content")) {
      return new Response(
        JSON.stringify({
          code: 0,
          data: {
            skill_id: "skill-1",
            url: "https://download.example/SKILL.md",
            files: [{ rel_path: "refs/guide.md" }],
          },
        }),
        { status: 200 }
      );
    }
    return new Response("# Demo skill\n", { status: 200 });
  };

  try {
    const client = new KWeaverClient({ baseUrl: BASE, accessToken: TOKEN });
    const content = await client.skills.fetchContent("skill-1");
    assert.equal(content, "# Demo skill\n");
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = orig;
  }
});

test("client.skills.getMarket uses market detail endpoint", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input.toString();
    assert.match(url, /\/skills\/market\/skill-1$/);
    return new Response(
      JSON.stringify({
        code: 0,
        data: { skill_id: "skill-1", name: "demo-market" },
      }),
      { status: 200 }
    );
  };

  try {
    const client = new KWeaverClient({ baseUrl: BASE, accessToken: TOKEN });
    const result = await client.skills.getMarket("skill-1");
    assert.equal(result.id, "skill-1");
    assert.equal(result.name, "demo-market");
  } finally {
    globalThis.fetch = orig;
  }
});

test("client.skills.updateMetadata sends metadata payload", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    assert.match(url, /\/skills\/skill-1\/metadata$/);
    assert.equal(init?.method, "PUT");
    assert.deepEqual(JSON.parse(String(init?.body)), {
      name: "Demo",
      description: "Demo skill",
      category: "system",
      source: "internal",
      extend_info: { owner: "sdk" },
    });
    return new Response(
      JSON.stringify({
        code: 0,
        data: { skill_id: "skill-1", version: "v2", status: "editing" },
      }),
      { status: 200 }
    );
  };

  try {
    const client = new KWeaverClient({ baseUrl: BASE, accessToken: TOKEN });
    const result = await client.skills.updateMetadata("skill-1", {
      name: "Demo",
      description: "Demo skill",
      category: "system",
      source: "internal",
      extendInfo: { owner: "sdk" },
    });
    assert.equal(result.id, "skill-1");
    assert.equal(result.status, "editing");
  } finally {
    globalThis.fetch = orig;
  }
});

test("client.skills.history unwraps history entries", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input.toString();
    assert.match(url, /\/skills\/skill-1\/history$/);
    return new Response(
      JSON.stringify({
        code: 0,
        data: [{ skill_id: "skill-1", version: "v1", status: "published" }],
      }),
      { status: 200 }
    );
  };

  try {
    const client = new KWeaverClient({ baseUrl: BASE, accessToken: TOKEN });
    const result = await client.skills.history("skill-1");
    assert.equal(result[0]?.id, "skill-1");
    assert.equal(result[0]?.version, "v1");
  } finally {
    globalThis.fetch = orig;
  }
});

test("client.skills.updatePackageContent sends content payload", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    assert.match(url, /\/skills\/skill-1\/package$/);
    assert.equal(init?.method, "PUT");
    assert.deepEqual(JSON.parse(String(init?.body)), {
      file_type: "content",
      file: "# Demo skill\n",
    });
    return new Response(
      JSON.stringify({
        code: 0,
        data: { skill_id: "skill-1", version: "v3", status: "editing" },
      }),
      { status: 200 }
    );
  };

  try {
    const client = new KWeaverClient({ baseUrl: BASE, accessToken: TOKEN });
    const result = await client.skills.updatePackageContent("skill-1", "# Demo skill\n");
    assert.equal(result.id, "skill-1");
    assert.equal(result.version, "v3");
  } finally {
    globalThis.fetch = orig;
  }
});

test("client.skills.republishHistory and publishHistory send version payload", async () => {
  const orig = globalThis.fetch;
  const calls: Array<{ url: string; method?: string; body?: string }> = [];
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, method: init?.method, body: String(init?.body ?? "") });
    return new Response(
      JSON.stringify({
        code: 0,
        data: { skill_id: "skill-1", version: "v1", status: "published" },
      }),
      { status: 200 }
    );
  };

  try {
    const client = new KWeaverClient({ baseUrl: BASE, accessToken: TOKEN });
    const republished = await client.skills.republishHistory("skill-1", "v1");
    const published = await client.skills.publishHistory("skill-1", "v1");
    assert.equal(republished.id, "skill-1");
    assert.equal(published.status, "published");
    assert.match(calls[0]!.url, /\/skills\/skill-1\/history\/republish$/);
    assert.match(calls[1]!.url, /\/skills\/skill-1\/history\/publish$/);
    assert.equal(calls[0]!.method, "POST");
    assert.equal(calls[1]!.method, "POST");
    assert.deepEqual(JSON.parse(calls[0]!.body), { version: "v1" });
    assert.deepEqual(JSON.parse(calls[1]!.body), { version: "v1" });
  } finally {
    globalThis.fetch = orig;
  }
});

test("downloadSkill sanitizes server filename to basename", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(new Uint8Array([0x50, 0x4b]), {
      status: 200,
      headers: {
        "content-disposition": 'attachment; filename="../../unsafe/demo-skill.zip"',
      },
    });

  try {
    const result = await downloadSkill({ baseUrl: BASE, accessToken: TOKEN, skillId: "skill-1" });
    assert.equal(result.fileName, "demo-skill.zip");
    assert.deepEqual(Array.from(result.bytes), [0x50, 0x4b]);
  } finally {
    globalThis.fetch = orig;
  }
});

test("installSkillArchive preserves existing files when extraction fails", () => {
  const root = mkdtempSync(join(tmpdir(), "kweaver-skill-install-"));
  const targetDir = join(root, "demo-skill");
  const skillFile = join(targetDir, "SKILL.md");
  mkdirSync(targetDir, { recursive: true });
  writeFileSync(skillFile, "# Existing skill\n", "utf8");

  assert.throws(
    () => installSkillArchive({ bytes: new Uint8Array(Buffer.from("not-a-zip")), directory: targetDir, force: true }),
    /Skill install failed:/
  );
  assert.equal(existsSync(skillFile), true);
  assert.equal(readFileSync(skillFile, "utf8"), "# Existing skill\n");
});
