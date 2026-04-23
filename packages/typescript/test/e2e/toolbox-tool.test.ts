/**
 * E2E smoke test for the toolbox + tool full lifecycle.
 *
 * Requires a running KWeaver instance with OAuth credentials configured:
 *   export KWEAVER_BASE_URL=https://your-host
 *   export KWEAVER_E2E=1
 *
 * Credentials are loaded via `ensureValidToken()` which reads the current
 * platform's saved token from ~/.kweaver/ (same as the CLI).
 *
 * Run from `packages/typescript`:
 *   npm run build && KWEAVER_E2E=1 npm run test:e2e -- --test-name-pattern "toolbox"
 */

import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createToolbox,
  deleteToolbox,
  listToolboxes,
  listTools,
  setToolboxStatus,
  setToolStatuses,
  uploadTool,
} from "../../src/api/toolboxes.js";
import { ensureValidToken } from "../../src/auth/oauth.js";

const e2eEnabled = process.env.KWEAVER_E2E === "1";

test("toolbox + tool full lifecycle (e2e)", { skip: !e2eEnabled }, async () => {
  const token = await ensureValidToken();
  const base = { baseUrl: token.baseUrl, accessToken: token.accessToken };

  // 1. Create a toolbox
  const ts = Date.now();
  const created = JSON.parse(
    await createToolbox({
      ...base,
      name: `e2e_toolbox_${ts}`,
      description: "e2e test",
      serviceUrl: "http://example.invalid:1",
    }),
  );
  const boxId = created.box_id as string;
  assert.ok(boxId, "create returned box_id");

  try {
    // 2. List should include the newly created toolbox
    const list = JSON.parse(
      await listToolboxes({ ...base, keyword: `e2e_toolbox_${ts}` }),
    );
    const entries = (list.entries ?? list) as Array<{
      box_id?: string;
      id?: string;
    }>;
    assert.ok(
      entries.some((e) => (e.box_id ?? e.id) === boxId),
      "new toolbox appears in list",
    );

    // 3. Upload a minimal OpenAPI spec as a tool
    const dir = mkdtempSync(join(tmpdir(), "e2e-tool-"));
    const specPath = join(dir, "openapi.json");
    writeFileSync(
      specPath,
      JSON.stringify({
        openapi: "3.0.0",
        info: { title: "e2e", version: "1" },
        paths: {
          "/health": {
            get: { responses: { "200": { description: "ok" } } },
          },
        },
      }),
    );
    const uploaded = JSON.parse(await uploadTool({ ...base, boxId, filePath: specPath }));
    const toolId = (uploaded.success_ids?.[0]) as string;
    assert.ok(toolId, "upload returned a tool id");

    // 4. Publish the toolbox and enable the tool
    await setToolboxStatus({ ...base, boxId, status: "published" });
    await setToolStatuses({
      ...base,
      boxId,
      updates: [{ toolId, status: "enabled" }],
    });

    // 5. List tools should show the uploaded tool
    const tools = JSON.parse(await listTools({ ...base, boxId }));
    const toolEntries = (tools.entries ?? tools) as Array<{
      tool_id?: string;
      id?: string;
      status?: string;
    }>;
    const me = toolEntries.find((t) => (t.tool_id ?? t.id) === toolId);
    assert.ok(me, "uploaded tool present in list");
  } finally {
    // 6. Cleanup — runs even if inner steps throw
    await deleteToolbox({ ...base, boxId });
  }
});
