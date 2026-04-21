import test from "node:test";
import assert from "node:assert/strict";
import { mutateConfigMembers } from "../src/commands/agent-members.js";

test("mutateConfigMembers adds ids to existing array", () => {
  const config = { skills: { skills: [{ skill_id: "sk_a" }] } };
  const { newConfig, report } = mutateConfigMembers({
    config,
    path: ["skills", "skills"],
    idField: "skill_id",
    addIds: ["sk_b", "sk_c"],
    removeIds: [],
  });
  assert.deepEqual(
    (newConfig as { skills: { skills: { skill_id: string }[] } }).skills.skills.map((x) => x.skill_id),
    ["sk_a", "sk_b", "sk_c"],
  );
  assert.deepEqual(report.added, ["sk_b", "sk_c"]);
  assert.deepEqual(report.alreadyAttached, []);
});

test("mutateConfigMembers dedupes already-attached ids", () => {
  const config = { skills: { skills: [{ skill_id: "sk_a" }] } };
  const { newConfig, report } = mutateConfigMembers({
    config,
    path: ["skills", "skills"],
    idField: "skill_id",
    addIds: ["sk_a", "sk_b"],
    removeIds: [],
  });
  assert.deepEqual(
    (newConfig as { skills: { skills: { skill_id: string }[] } }).skills.skills.map((x) => x.skill_id),
    ["sk_a", "sk_b"],
  );
  assert.deepEqual(report.added, ["sk_b"]);
  assert.deepEqual(report.alreadyAttached, ["sk_a"]);
});

test("mutateConfigMembers creates missing path nodes", () => {
  const config: Record<string, unknown> = {};
  const { newConfig, report } = mutateConfigMembers({
    config,
    path: ["skills", "skills"],
    idField: "skill_id",
    addIds: ["sk_a"],
    removeIds: [],
  });
  assert.deepEqual(
    (newConfig as { skills: { skills: { skill_id: string }[] } }).skills.skills,
    [{ skill_id: "sk_a" }],
  );
  assert.deepEqual(report.added, ["sk_a"]);
});

test("mutateConfigMembers removes ids and preserves order", () => {
  const config = {
    skills: { skills: [{ skill_id: "sk_a" }, { skill_id: "sk_b" }, { skill_id: "sk_c" }] },
  };
  const { newConfig, report } = mutateConfigMembers({
    config,
    path: ["skills", "skills"],
    idField: "skill_id",
    addIds: [],
    removeIds: ["sk_b"],
  });
  assert.deepEqual(
    (newConfig as { skills: { skills: { skill_id: string }[] } }).skills.skills.map((x) => x.skill_id),
    ["sk_a", "sk_c"],
  );
  assert.deepEqual(report.removed, ["sk_b"]);
  assert.deepEqual(report.notAttached, []);
});

test("mutateConfigMembers reports not-attached on remove miss", () => {
  const config = { skills: { skills: [{ skill_id: "sk_a" }] } };
  const { newConfig, report } = mutateConfigMembers({
    config,
    path: ["skills", "skills"],
    idField: "skill_id",
    addIds: [],
    removeIds: ["sk_a", "sk_missing"],
  });
  assert.deepEqual(
    (newConfig as { skills: { skills: { skill_id: string }[] } }).skills.skills,
    [],
  );
  assert.deepEqual(report.removed, ["sk_a"]);
  assert.deepEqual(report.notAttached, ["sk_missing"]);
});

test("mutateConfigMembers does not mutate input config", () => {
  const config = { skills: { skills: [{ skill_id: "sk_a" }] } };
  const original = JSON.parse(JSON.stringify(config));
  mutateConfigMembers({
    config,
    path: ["skills", "skills"],
    idField: "skill_id",
    addIds: ["sk_b"],
    removeIds: [],
  });
  assert.deepEqual(config, original);
});

test("mutateConfigMembers lists current ids", () => {
  const config = { skills: { skills: [{ skill_id: "sk_a" }, { skill_id: "sk_b" }] } };
  const { currentIds } = mutateConfigMembers({
    config,
    path: ["skills", "skills"],
    idField: "skill_id",
    addIds: [],
    removeIds: [],
  });
  assert.deepEqual(currentIds, ["sk_a", "sk_b"]);
});
