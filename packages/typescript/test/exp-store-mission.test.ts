import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { readMission, writeSuggestedChange } from "../src/trace-ai/exp/exp-store/mission-md.js";

async function makeTmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "trace-exp-test-"));
}

test("readMission: parses valid mission.md", async () => {
  const dir = await makeTmpDir();
  await fs.writeFile(path.join(dir, "mission.md"), `---
schema_version: trace-mission/v1
goal: reduce retry rate
eval_sets:
  - path: eval-sets/v1
    role: seed
current_candidate:
  path: candidates/baseline.yaml
---
Some body text.
`);
  const mission = await readMission(dir);
  assert.equal(mission.goal, "reduce retry rate");
  assert.equal(mission.eval_sets[0].path, "eval-sets/v1");
});

test("readMission: throws if mission.md missing", async () => {
  const dir = await makeTmpDir();
  await assert.rejects(() => readMission(dir), /mission\.md/);
});

test("writeSuggestedChange: overwrites next_change in mission.md", async () => {
  const dir = await makeTmpDir();
  await fs.writeFile(path.join(dir, "mission.md"), `---
schema_version: trace-mission/v1
goal: reduce retry rate
eval_sets:
  - path: eval-sets/v1
    role: seed
current_candidate:
  path: candidates/baseline.yaml
---
`);
  await writeSuggestedChange(dir, {
    target: "agent.system_prompt",
    hypothesis: "add stop condition",
    patch: '{"agent":{"system_prompt":"new prompt"}}',
  });
  const mission = await readMission(dir);
  assert.equal(mission.next_change?.target, "agent.system_prompt");
  assert.equal(mission.next_change?.hypothesis, "add stop condition");
});
