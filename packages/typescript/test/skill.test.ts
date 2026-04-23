import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { KWeaverClient } from "../src/client.js";
import { parseSkillListArgs, parseSkillRegisterArgs } from "../src/commands/skill.js";
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
