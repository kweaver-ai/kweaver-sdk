import test from "node:test";
import assert from "node:assert/strict";
import {
  patchAgentMembers,
  type MemberSpec,
  type MemberFetchResult,
} from "../src/commands/agent-members.js";

interface MockAgentStore {
  agent: Record<string, unknown>;
  updateCalls: Record<string, unknown>[];
}

function makeDeps(store: MockAgentStore, members: Record<string, MemberFetchResult>) {
  return {
    getAgent: async (id: string) => {
      if (id !== "ag_1") throw new Error(`agent ${id} not found`);
      return JSON.stringify(store.agent);
    },
    updateAgent: async (id: string, body: Record<string, unknown>) => {
      store.updateCalls.push(body);
      return "ok";
    },
    fetchById: async (id: string): Promise<MemberFetchResult> => {
      if (!(id in members)) return { exists: false, published: false };
      return members[id]!;
    },
  };
}

function skillSpec(): MemberSpec {
  return {
    memberKind: "skill",
    configPath: ["skills", "skills"],
    idField: "skill_id",
  };
}

test("patchAgentMembers add happy path", async () => {
  const store: MockAgentStore = {
    agent: { id: "ag_1", name: "a", profile: "p", config: {} },
    updateCalls: [],
  };
  const deps = makeDeps(store, {
    sk_a: { exists: true, published: true, name: "alpha" },
  });

  const report = await patchAgentMembers({
    agentId: "ag_1",
    spec: skillSpec(),
    addIds: ["sk_a"],
    removeIds: [],
    strict: false,
    deps,
  });

  assert.equal(store.updateCalls.length, 1);
  const config = store.updateCalls[0]!.config as { skills: { skills: { skill_id: string }[] } };
  assert.deepEqual(config.skills.skills, [{ skill_id: "sk_a" }]);
  assert.deepEqual(report.added, ["sk_a"]);
  assert.deepEqual(report.warnings, []);
});

test("patchAgentMembers add aborts when any id does not exist", async () => {
  const store: MockAgentStore = {
    agent: { id: "ag_1", name: "a", profile: "p", config: {} },
    updateCalls: [],
  };
  const deps = makeDeps(store, {
    sk_a: { exists: true, published: true },
  });

  await assert.rejects(
    () =>
      patchAgentMembers({
        agentId: "ag_1",
        spec: skillSpec(),
        addIds: ["sk_a", "sk_missing"],
        removeIds: [],
        strict: false,
        deps,
      }),
    (err: Error) => /sk_missing.*not found/.test(err.message),
  );

  assert.equal(store.updateCalls.length, 0, "updateAgent must not be called when any id is missing");
});

test("patchAgentMembers add warns on draft in non-strict mode and still writes", async () => {
  const store: MockAgentStore = {
    agent: { id: "ag_1", name: "a", profile: "p", config: {} },
    updateCalls: [],
  };
  const deps = makeDeps(store, {
    sk_draft: { exists: true, published: false, name: "draft-one" },
  });

  const report = await patchAgentMembers({
    agentId: "ag_1",
    spec: skillSpec(),
    addIds: ["sk_draft"],
    removeIds: [],
    strict: false,
    deps,
  });

  assert.equal(store.updateCalls.length, 1);
  assert.deepEqual(report.added, ["sk_draft"]);
  assert.equal(report.warnings.length, 1);
  assert.match(report.warnings[0]!, /sk_draft.*draft/);
});

test("patchAgentMembers add errors on draft in strict mode and does not write", async () => {
  const store: MockAgentStore = {
    agent: { id: "ag_1", name: "a", profile: "p", config: {} },
    updateCalls: [],
  };
  const deps = makeDeps(store, {
    sk_draft: { exists: true, published: false },
  });

  await assert.rejects(
    () =>
      patchAgentMembers({
        agentId: "ag_1",
        spec: skillSpec(),
        addIds: ["sk_draft"],
        removeIds: [],
        strict: true,
        deps,
      }),
    (err: Error) => /sk_draft.*draft/.test(err.message),
  );

  assert.equal(store.updateCalls.length, 0);
});

test("patchAgentMembers remove does not call fetchById", async () => {
  const store: MockAgentStore = {
    agent: {
      id: "ag_1",
      name: "a",
      profile: "p",
      config: { skills: { skills: [{ skill_id: "sk_a" }, { skill_id: "sk_b" }] } },
    },
    updateCalls: [],
  };
  let fetchCalls = 0;
  const deps = {
    getAgent: async () => JSON.stringify(store.agent),
    updateAgent: async (_id: string, body: Record<string, unknown>) => {
      store.updateCalls.push(body);
      return "ok";
    },
    fetchById: async () => {
      fetchCalls += 1;
      return { exists: true, published: true };
    },
  };

  const report = await patchAgentMembers({
    agentId: "ag_1",
    spec: skillSpec(),
    addIds: [],
    removeIds: ["sk_a", "sk_missing"],
    strict: false,
    deps,
  });

  assert.equal(fetchCalls, 0, "fetchById must not be invoked for remove");
  assert.equal(store.updateCalls.length, 1);
  assert.deepEqual(report.removed, ["sk_a"]);
  assert.deepEqual(report.notAttached, ["sk_missing"]);
});

test("patchAgentMembers preserves sibling config fields", async () => {
  const store: MockAgentStore = {
    agent: {
      id: "ag_1",
      name: "a",
      profile: "p",
      config: {
        system_prompt: "keep me",
        llms: [{ is_default: true, llm_config: { id: "m1", name: "n", max_tokens: 1 } }],
        data_source: { knowledge_network: [{ knowledge_network_id: "kn_x", knowledge_network_name: "" }] },
      },
    },
    updateCalls: [],
  };
  const deps = makeDeps(store, { sk_a: { exists: true, published: true } });

  await patchAgentMembers({
    agentId: "ag_1",
    spec: skillSpec(),
    addIds: ["sk_a"],
    removeIds: [],
    strict: false,
    deps,
  });

  const written = store.updateCalls[0]!.config as Record<string, unknown>;
  assert.equal(written.system_prompt, "keep me");
  assert.ok(Array.isArray(written.llms));
  assert.ok((written.data_source as Record<string, unknown>).knowledge_network);
  assert.ok((written.skills as Record<string, unknown>).skills);
});
