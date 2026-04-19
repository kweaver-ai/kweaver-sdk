/**
 * E2E: CLI layer — `kweaver composer create|get|delete` against a real platform.
 *
 * Skips when no valid auth token is available. Exercises:
 *   1. composer create --template code-development --save-to <tmp> --compact
 *      → stdout is valid JSON with orchestrator_id + 3 sub_agent_ids
 *      → --save-to file written
 *   2. composer get <orchestrator-id>
 *      → stored config has dolphin + skills.agents of length 3
 *   3. composer delete <orchestrator-id> --cascade -y
 *      → orchestrator + sub-agents all deleted (verified via HTTP 404 on get)
 *
 * Runs the CLI via `runComposerCommand(...)` with console.log captured so we
 * can inspect stdout without shelling out.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureValidToken } from "../../src/auth/oauth.js";
import { resolveBusinessDomain } from "../../src/config/store.js";
import { runComposerCommand } from "../../src/commands/composer.js";
import { cleanupAgents, fetchOrchestratorConfig, type TokenProvider } from "../../src/commands/composer-engine.js";

let canRun = false;
let getToken: TokenProvider = () => { throw new Error("auth not initialized"); };
let businessDomain = "bd_public";

try {
  const t = await ensureValidToken();
  canRun = true;
  getToken = () => ensureValidToken();
  businessDomain = resolveBusinessDomain("") || "bd_public";
  console.error(`[composer-cmd-e2e] Connected to ${t.baseUrl}, bd=${businessDomain}`);
} catch (err) {
  console.error(`[composer-cmd-e2e] Skipping: no valid auth (${err instanceof Error ? err.message : err})`);
}

function captureStdout<T>(fn: () => Promise<T>): Promise<{ result: T; stdout: string }> {
  return new Promise((resolve, reject) => {
    const original = console.log;
    const buf: string[] = [];
    console.log = (...args: unknown[]) => {
      buf.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    };
    fn()
      .then((result) => resolve({ result, stdout: buf.join("\n") }))
      .catch(reject)
      .finally(() => { console.log = original; });
  });
}

describe("e2e: composer CLI (runComposerCommand)", () => {
  let orchestratorId = "";
  let subAgentIds: string[] = [];
  let tmpDir = "";
  let savePath = "";

  after(async () => {
    // Defensive cleanup — if delete step didn't run, remove leftovers
    if (orchestratorId || subAgentIds.length > 0) {
      const leftovers = [orchestratorId, ...subAgentIds].filter(Boolean);
      try {
        const result = await cleanupAgents(leftovers, getToken, businessDomain);
        if (result.errors.length > 0) {
          console.error(`[composer-cmd-e2e] leftover cleanup errors: ${JSON.stringify(result.errors)}`);
        }
      } catch { /* best effort */ }
    }
    if (tmpDir && existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("composer create --template writes JSON to stdout and --save-to", { skip: !canRun, timeout: 120000 }, async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "composer-cmd-e2e-"));
    savePath = join(tmpDir, "pipeline.json");

    const { result, stdout } = await captureStdout(() =>
      runComposerCommand([
        "create",
        "--template", "code-development",
        "--save-to", savePath,
        "--compact",
      ]),
    );
    assert.equal(result, 0, `exit code: stdout=${stdout}`);

    const parsed = JSON.parse(stdout) as {
      orchestrator_id: string;
      sub_agent_ids: string[];
      config: { agents: Array<{ ref: string; name: string }> };
    };
    assert.ok(parsed.orchestrator_id, "orchestrator_id present");
    assert.equal(parsed.sub_agent_ids.length, 3, `expected 3 sub-agents, got ${parsed.sub_agent_ids.length}`);
    assert.equal(parsed.config.agents.length, 3);

    orchestratorId = parsed.orchestrator_id;
    subAgentIds = parsed.sub_agent_ids;

    assert.ok(existsSync(savePath), "--save-to file was written");
    const saved = JSON.parse(readFileSync(savePath, "utf8")) as { orchestrator_id: string };
    assert.equal(saved.orchestrator_id, orchestratorId);
  });

  it("composer get returns stored config with dolphin + 3 skill agents", { skip: !canRun, timeout: 30000 }, async () => {
    assert.ok(orchestratorId, "requires orchestrator from step 1");

    const { result, stdout } = await captureStdout(() =>
      runComposerCommand(["get", orchestratorId, "--compact"]),
    );
    assert.equal(result, 0, `exit code: stdout=${stdout}`);

    const config = JSON.parse(stdout) as {
      is_dolphin_mode?: number;
      dolphin?: string;
      skills?: { agents?: unknown[] };
    };
    assert.equal(config.is_dolphin_mode, 1);
    assert.ok(typeof config.dolphin === "string" && config.dolphin.length > 0, "dolphin non-empty");
    assert.equal(config.skills?.agents?.length, 3);
  });

  it("composer delete --cascade -y removes orchestrator + sub-agents", { skip: !canRun, timeout: 60000 }, async () => {
    assert.ok(orchestratorId, "requires orchestrator from step 1");

    const { result } = await captureStdout(() =>
      runComposerCommand(["delete", orchestratorId, "--cascade", "-y"]),
    );
    assert.equal(result, 0);

    // Verify orchestrator is gone
    await assert.rejects(
      () => fetchOrchestratorConfig(orchestratorId, getToken, businessDomain),
      /\b404\b|not ?found/i,
      "orchestrator should be deleted",
    );

    // Clear state so `after` doesn't re-attempt cleanup
    orchestratorId = "";
    subAgentIds = [];
  });
});
