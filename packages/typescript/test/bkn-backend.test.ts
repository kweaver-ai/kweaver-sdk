import test from "node:test";
import assert from "node:assert/strict";

import {
  listConceptGroups,
  getConceptGroup,
  createConceptGroup,
  updateConceptGroup,
  deleteConceptGroup,
  addConceptGroupMembers,
  removeConceptGroupMembers,
  listActionSchedules,
  getActionSchedule,
  createActionSchedule,
  updateActionSchedule,
  setActionScheduleStatus,
  deleteActionSchedules,
  listJobs,
  getJob,
  getJobTasks,
  deleteJobs,
  queryRelationTypePaths,
  listBknResources,
} from "../src/api/bkn-backend.js";

const originalFetch = globalThis.fetch;

// --- Concept Groups ---

test("listConceptGroups sends GET to /concept-groups", async () => {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    assert.equal(init?.method, "GET");
    assert.ok(url.endsWith("/api/bkn-backend/v1/knowledge-networks/kn-1/concept-groups"));
    return new Response("[]", { status: 200 });
  };
  try {
    await listConceptGroups({ baseUrl: "https://host", accessToken: "t", knId: "kn-1" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("getConceptGroup sends GET to /concept-groups/:cgId", async () => {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    assert.equal(init?.method, "GET");
    assert.ok(url.endsWith("/api/bkn-backend/v1/knowledge-networks/kn-1/concept-groups/cg-42"));
    return new Response("{}", { status: 200 });
  };
  try {
    await getConceptGroup({ baseUrl: "https://host", accessToken: "t", knId: "kn-1", cgId: "cg-42" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("createConceptGroup sends POST to /concept-groups with body", async () => {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    assert.equal(init?.method, "POST");
    assert.ok(url.endsWith("/api/bkn-backend/v1/knowledge-networks/kn-1/concept-groups"));
    assert.equal(init?.body, "{\"name\":\"my-group\"}");
    return new Response("{}", { status: 200 });
  };
  try {
    await createConceptGroup({ baseUrl: "https://host", accessToken: "t", knId: "kn-1", body: "{\"name\":\"my-group\"}" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("updateConceptGroup sends PUT to /concept-groups/:cgId with body", async () => {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    assert.equal(init?.method, "PUT");
    assert.ok(url.endsWith("/api/bkn-backend/v1/knowledge-networks/kn-1/concept-groups/cg-42"));
    assert.equal(init?.body, "{\"name\":\"updated\"}");
    return new Response("{}", { status: 200 });
  };
  try {
    await updateConceptGroup({ baseUrl: "https://host", accessToken: "t", knId: "kn-1", cgId: "cg-42", body: "{\"name\":\"updated\"}" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("deleteConceptGroup sends DELETE to /concept-groups/:cgId", async () => {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    assert.equal(init?.method, "DELETE");
    assert.ok(url.endsWith("/api/bkn-backend/v1/knowledge-networks/kn-1/concept-groups/cg-42"));
    return new Response("", { status: 200 });
  };
  try {
    await deleteConceptGroup({ baseUrl: "https://host", accessToken: "t", knId: "kn-1", cgId: "cg-42" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("addConceptGroupMembers sends POST to /concept-groups/:cgId/object-types with body", async () => {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    assert.equal(init?.method, "POST");
    assert.ok(url.endsWith("/api/bkn-backend/v1/knowledge-networks/kn-1/concept-groups/cg-42/object-types"));
    assert.equal(init?.body, "{\"object_type_ids\":[\"ot-1\"]}");
    return new Response("{}", { status: 200 });
  };
  try {
    await addConceptGroupMembers({ baseUrl: "https://host", accessToken: "t", knId: "kn-1", cgId: "cg-42", body: "{\"object_type_ids\":[\"ot-1\"]}" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("removeConceptGroupMembers sends DELETE to /concept-groups/:cgId/object-types/:otIds", async () => {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    assert.equal(init?.method, "DELETE");
    assert.ok(url.endsWith("/api/bkn-backend/v1/knowledge-networks/kn-1/concept-groups/cg-42/object-types/ot-1,ot-2"));
    return new Response("", { status: 200 });
  };
  try {
    await removeConceptGroupMembers({ baseUrl: "https://host", accessToken: "t", knId: "kn-1", cgId: "cg-42", otIds: "ot-1,ot-2" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// --- Action Schedules ---

test("listActionSchedules sends GET to /action-schedules", async () => {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    assert.equal(init?.method, "GET");
    assert.ok(url.endsWith("/api/bkn-backend/v1/knowledge-networks/kn-1/action-schedules"));
    return new Response("[]", { status: 200 });
  };
  try {
    await listActionSchedules({ baseUrl: "https://host", accessToken: "t", knId: "kn-1" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("getActionSchedule sends GET to /action-schedules/:scheduleId", async () => {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    assert.equal(init?.method, "GET");
    assert.ok(url.endsWith("/api/bkn-backend/v1/knowledge-networks/kn-1/action-schedules/sched-7"));
    return new Response("{}", { status: 200 });
  };
  try {
    await getActionSchedule({ baseUrl: "https://host", accessToken: "t", knId: "kn-1", scheduleId: "sched-7" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("createActionSchedule sends POST to /action-schedules with body", async () => {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    assert.equal(init?.method, "POST");
    assert.ok(url.endsWith("/api/bkn-backend/v1/knowledge-networks/kn-1/action-schedules"));
    assert.equal(init?.body, "{\"cron\":\"0 * * * *\"}");
    return new Response("{}", { status: 200 });
  };
  try {
    await createActionSchedule({ baseUrl: "https://host", accessToken: "t", knId: "kn-1", body: "{\"cron\":\"0 * * * *\"}" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("updateActionSchedule sends PUT to /action-schedules/:scheduleId with body", async () => {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    assert.equal(init?.method, "PUT");
    assert.ok(url.endsWith("/api/bkn-backend/v1/knowledge-networks/kn-1/action-schedules/sched-7"));
    assert.equal(init?.body, "{\"cron\":\"0 2 * * *\"}");
    return new Response("{}", { status: 200 });
  };
  try {
    await updateActionSchedule({ baseUrl: "https://host", accessToken: "t", knId: "kn-1", scheduleId: "sched-7", body: "{\"cron\":\"0 2 * * *\"}" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("setActionScheduleStatus sends PUT to /action-schedules/:scheduleId/status with body", async () => {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    assert.equal(init?.method, "PUT");
    assert.ok(url.endsWith("/api/bkn-backend/v1/knowledge-networks/kn-1/action-schedules/sched-7/status"));
    assert.equal(init?.body, "{\"status\":\"disabled\"}");
    return new Response("{}", { status: 200 });
  };
  try {
    await setActionScheduleStatus({ baseUrl: "https://host", accessToken: "t", knId: "kn-1", scheduleId: "sched-7", body: "{\"status\":\"disabled\"}" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("deleteActionSchedules sends DELETE to /action-schedules/:scheduleIds", async () => {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    assert.equal(init?.method, "DELETE");
    assert.ok(url.endsWith("/api/bkn-backend/v1/knowledge-networks/kn-1/action-schedules/sched-1,sched-2"));
    return new Response("", { status: 200 });
  };
  try {
    await deleteActionSchedules({ baseUrl: "https://host", accessToken: "t", knId: "kn-1", scheduleIds: "sched-1,sched-2" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// --- Jobs ---

test("listJobs sends GET to /jobs", async () => {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    assert.equal(init?.method, "GET");
    assert.ok(url.endsWith("/api/bkn-backend/v1/knowledge-networks/kn-1/jobs"));
    return new Response("[]", { status: 200 });
  };
  try {
    await listJobs({ baseUrl: "https://host", accessToken: "t", knId: "kn-1" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("getJob sends GET to /jobs/:jobId", async () => {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    assert.equal(init?.method, "GET");
    assert.ok(url.endsWith("/api/bkn-backend/v1/knowledge-networks/kn-1/jobs/job-99"));
    return new Response("{}", { status: 200 });
  };
  try {
    await getJob({ baseUrl: "https://host", accessToken: "t", knId: "kn-1", jobId: "job-99" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("getJobTasks sends GET to /jobs/:jobId/tasks", async () => {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    assert.equal(init?.method, "GET");
    assert.ok(url.endsWith("/api/bkn-backend/v1/knowledge-networks/kn-1/jobs/job-99/tasks"));
    return new Response("[]", { status: 200 });
  };
  try {
    await getJobTasks({ baseUrl: "https://host", accessToken: "t", knId: "kn-1", jobId: "job-99" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("deleteJobs sends DELETE to /jobs/:jobIds", async () => {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    assert.equal(init?.method, "DELETE");
    assert.ok(url.endsWith("/api/bkn-backend/v1/knowledge-networks/kn-1/jobs/job-1,job-2"));
    return new Response("", { status: 200 });
  };
  try {
    await deleteJobs({ baseUrl: "https://host", accessToken: "t", knId: "kn-1", jobIds: "job-1,job-2" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// --- Relation Type Paths & Resources ---

test("queryRelationTypePaths sends POST to /relation-type-paths with body", async () => {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    assert.equal(init?.method, "POST");
    assert.ok(url.endsWith("/api/bkn-backend/v1/knowledge-networks/kn-1/relation-type-paths"));
    assert.equal(init?.body, "{\"source_ot_id\":\"ot-a\",\"target_ot_id\":\"ot-b\"}");
    return new Response("[]", { status: 200 });
  };
  try {
    await queryRelationTypePaths({ baseUrl: "https://host", accessToken: "t", knId: "kn-1", body: "{\"source_ot_id\":\"ot-a\",\"target_ot_id\":\"ot-b\"}" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("listBknResources sends GET to /resources", async () => {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    assert.equal(init?.method, "GET");
    assert.ok(url.endsWith("/api/bkn-backend/v1/resources"));
    return new Response("[]", { status: 200 });
  };
  try {
    await listBknResources({ baseUrl: "https://host", accessToken: "t" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
