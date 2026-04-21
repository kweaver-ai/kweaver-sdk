/**
 * E2E smoke test for `kweaver agent skill {add,remove,list}` against a live platform.
 *
 * Requires a KWeaver instance with OAuth credentials configured:
 *   kweaver auth login   # or equivalent to populate ~/.kweaver/
 *   export KWEAVER_E2E=1
 *
 * The test is gated on KWEAVER_E2E=1 — skipped by default so `npm test` stays hermetic.
 *
 * Run from `packages/typescript`:
 *   KWEAVER_E2E=1 npm run test:e2e -- --test-name-pattern "agent skill"
 */

import test from "node:test";
import assert from "node:assert/strict";

import { runAgentCommand } from "../../src/commands/agent.js";
import { ensureValidToken } from "../../src/auth/oauth.js";
import { createAgent, deleteAgent } from "../../src/api/agent-list.js";
import { listSkills } from "../../src/api/skills.js";

const e2eEnabled = process.env.KWEAVER_E2E === "1";

async function captureRun(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const originalLog = console.log;
  const originalErr = console.error;
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  console.log = (...a: unknown[]) => { stdout.push(a.map(String).join(" ") + "\n"); };
  console.error = (...a: unknown[]) => { stderr.push(a.map(String).join(" ") + "\n"); };
  (process.stderr as unknown as { write: (c: unknown) => boolean }).write = (c: unknown) => {
    stderr.push(String(c));
    return true;
  };
  try {
    const code = await runAgentCommand(args);
    return { code, stdout: stdout.join(""), stderr: stderr.join("") };
  } finally {
    console.log = originalLog;
    console.error = originalErr;
    (process.stderr as unknown as { write: typeof originalStderrWrite }).write = originalStderrWrite;
  }
}

test("agent skill add/list/remove round-trip (e2e)", { skip: !e2eEnabled }, async () => {
  const token = await ensureValidToken();
  const base = { baseUrl: token.baseUrl, accessToken: token.accessToken };

  // 1. Find at least one published skill to use as the attachment target.
  const skillsPage = await listSkills({ ...base, status: "published", pageSize: 1 });
  const skillRow = (skillsPage.data ?? [])[0];
  if (!skillRow?.id) {
    throw new Error("e2e pre-req failed: no published skill found on platform; register one first");
  }
  const skillId = skillRow.id;

  // 2. Create a fresh test agent.
  const ts = Date.now();
  const createBody = JSON.stringify({
    name: `e2e_skill_member_${ts}`,
    profile: "e2e test agent for skill membership",
    avatar_type: 1,
    avatar: "icon-dip-agent-default",
    product_key: "dip",
    product_name: "DIP",
    config: {
      input: { fields: [{ name: "user_input", type: "string", desc: "" }] },
      output: { default_format: "markdown" },
      system_prompt: "",
    },
  });
  const created = JSON.parse(await createAgent({ ...base, body: createBody })) as { id?: string; data?: { id?: string } };
  const agentId = created.id ?? created.data?.id;
  assert.ok(agentId, `create returned an id (got: ${JSON.stringify(created)})`);

  try {
    // 3. list — empty to start
    {
      const { code, stdout } = await captureRun(["skill", "list", agentId!, "--compact"]);
      assert.equal(code, 0, `list exit 0, got stdout=${stdout}`);
      const rows = JSON.parse(stdout.trim()) as unknown[];
      assert.deepEqual(rows, [], "freshly created agent has no skills");
    }

    // 4. add
    {
      const { code, stdout, stderr } = await captureRun(["skill", "add", agentId!, skillId]);
      assert.equal(code, 0, `add exit 0; stdout=${stdout} stderr=${stderr}`);
      assert.match(stdout, new RegExp(`✓ ${skillId}\\s+added`));
    }

    // 5. list — contains the skill
    {
      const { code, stdout } = await captureRun(["skill", "list", agentId!, "--compact"]);
      assert.equal(code, 0);
      const rows = JSON.parse(stdout.trim()) as Array<{ skill_id: string; name: string | null; status: string }>;
      assert.equal(rows.length, 1);
      assert.equal(rows[0]!.skill_id, skillId);
      assert.equal(rows[0]!.status, "published");
    }

    // 6. remove
    {
      const { code, stdout, stderr } = await captureRun(["skill", "remove", agentId!, skillId]);
      assert.equal(code, 0, `remove exit 0; stdout=${stdout} stderr=${stderr}`);
      assert.match(stdout, new RegExp(`✓ ${skillId}\\s+removed`));
    }

    // 7. list — empty again
    {
      const { code, stdout } = await captureRun(["skill", "list", agentId!, "--compact"]);
      assert.equal(code, 0);
      const rows = JSON.parse(stdout.trim()) as unknown[];
      assert.deepEqual(rows, [], "skill removed cleanly");
    }
  } finally {
    // 8. cleanup — runs even if inner steps throw
    await deleteAgent({ ...base, agentId: agentId! }).catch(() => undefined);
  }
});
