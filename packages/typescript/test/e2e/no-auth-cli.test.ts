/**
 * E2E smoke tests for no-auth platforms using the packaged CLI (`bin/kweaver.js` → `dist/cli.js`).
 *
 * Requires a running KWeaver instance for live tests:
 *   export KWEAVER_BASE_URL=https://your-host
 *   export KWEAVER_NO_AUTH=1   (optional; tests set it for subprocesses)
 *
 * Optional: KWEAVER_TLS_INSECURE=1 for self-signed HTTPS.
 *
 * Run from `packages/typescript`:
 *   npm run build && npm run test:e2e
 *
 * Full live smoke (default URL + TLS insecure for self-signed HTTPS):
 *   npm run build && npm run test:e2e:live
 * Override base URL: `KWEAVER_BASE_URL=https://other.host npm run test:e2e:live`
 */

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const kweaverBin = join(__dirname, "../../bin/kweaver.js");

function runKweaver(
  args: string[],
  extraEnv: Record<string, string | undefined>,
): { status: number | null; stdout: string; stderr: string } {
  const env = { ...process.env, ...extraEnv };
  delete env.KWEAVER_TOKEN;
  const r = spawnSync(process.execPath, [kweaverBin, ...args], {
    encoding: "utf8",
    env,
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function hasLiveBaseUrl(): boolean {
  return Boolean(process.env.KWEAVER_BASE_URL?.trim());
}

test("e2e no-auth: bin/kweaver.js --version exits 0", () => {
  const r = runKweaver(["--version"], {});
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.match(r.stdout + r.stderr, /\d+\.\d+\.\d+/, "expected semver in output");
});

test("e2e no-auth: bin/kweaver.js -V matches --version", () => {
  const a = runKweaver(["--version"], {});
  const b = runKweaver(["-V"], {});
  assert.equal(a.status, 0);
  assert.equal(b.status, 0);
  assert.equal(a.stdout.trim(), b.stdout.trim());
});

test(
  "e2e no-auth: call GET knowledge-networks (live)",
  { skip: !hasLiveBaseUrl() },
  () => {
    const base = process.env.KWEAVER_BASE_URL!.replace(/\/+$/, "");
    const r = runKweaver(
      ["call", `${base}/api/ontology-manager/v1/knowledge-networks?limit=1`, "-X", "GET"],
      {
        KWEAVER_NO_AUTH: "1",
        KWEAVER_BASE_URL: base,
      },
    );
    assert.equal(
      r.status,
      0,
      `call failed (status ${r.status}). stderr:\n${r.stderr}\nstdout:\n${r.stdout}`,
    );
  },
);

test(
  "e2e no-auth: ds list --limit 1 (live)",
  { skip: !hasLiveBaseUrl() },
  () => {
    const base = process.env.KWEAVER_BASE_URL!.replace(/\/+$/, "");
    const r = runKweaver(["ds", "list", "--limit", "1"], {
      KWEAVER_NO_AUTH: "1",
      KWEAVER_BASE_URL: base,
    });
    assert.equal(
      r.status,
      0,
      `ds list failed (status ${r.status}). stderr:\n${r.stderr}\nstdout:\n${r.stdout}`,
    );
  },
);
