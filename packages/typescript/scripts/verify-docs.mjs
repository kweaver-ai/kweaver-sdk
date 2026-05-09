#!/usr/bin/env node
/**
 * Debug-mode verification: builds docs (en + zh), inspects outputs and the
 * Python pdoc helper, and writes NDJSON evidence to the debug log file.
 *
 * Hypotheses being tested (matches PR review IDs):
 *   H5  entryPoints auto-expand picks up every src/resources/api/auth file
 *   H7  gitRevision honors TYPEDOC_GIT_REVISION env var
 *   H9  zh build cover page comes from README.zh.md (Chinese strings)
 *   H1  list_pdoc_modules.py exits non-zero when no modules; Makefile aborts
 *   H12 docs/reference/** is gitignored (boundary documented)
 */
import { readFileSync, readdirSync, existsSync, mkdirSync, appendFileSync } from "node:fs";
import { execSync, spawnSync } from "node:child_process";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "../../..");
const TS_PKG = resolve(REPO_ROOT, "packages/typescript");
const PY_PKG = resolve(REPO_ROOT, "packages/python");
const LOG_PATH = resolve(REPO_ROOT, ".cursor/debug-5c1791.log");
const SESSION = "5c1791";
const RUN_ID = process.env.RUN_ID || "post-fix";

mkdirSync(dirname(LOG_PATH), { recursive: true });

function emit(hypothesisId, message, data, location = "verify-docs.mjs") {
  const line = JSON.stringify({
    sessionId: SESSION,
    runId: RUN_ID,
    hypothesisId,
    location,
    message,
    data,
    timestamp: Date.now(),
  });
  appendFileSync(LOG_PATH, line + "\n");
  console.log(`[verify] ${hypothesisId} ${message}`);
}

function run(cmd, opts = {}) {
  return spawnSync(cmd, { shell: true, encoding: "utf8", ...opts });
}

// ───── H5 + H7 + H9: build EN docs with TYPEDOC_GIT_REVISION=verify-en ─────
const EN_REV = "verify-en-sha";
const enRes = run("node scripts/build-docs.mjs", {
  cwd: TS_PKG,
  env: { ...process.env, TYPEDOC_GIT_REVISION: EN_REV },
});
emit("H5", "build-docs en exit", {
  status: enRes.status,
  stderr_tail: (enRes.stderr || "").split("\n").slice(-5).join("\n"),
});

const EN_OUT = resolve(REPO_ROOT, "docs/reference/typescript-api-html");
const enFunctionsDir = join(EN_OUT, "functions");
const enResourcesDir = join(EN_OUT, "classes");
const enFiles = existsSync(EN_OUT) ? readdirSync(EN_OUT, { recursive: true }) : [];
const enModulePages = enFiles.filter((f) =>
  /^modules\//.test(String(f)) || /^functions\//.test(String(f)) || /^classes\//.test(String(f))
);
emit("H5", "en output module-ish file count", { count: enModulePages.length });

// Look for several auto-expanded api/* modules NOT in the old curated list.
const expectedAuto = [
  "agent-chat",
  "agent-list",
  "bkn-backend",
  "ontology-query",
  "semantic-search",
  "model-invocation",
];
const enHtml = enFiles.filter((f) => String(f).endsWith(".html")).map(String);
const autoCovered = expectedAuto.filter((mod) =>
  enHtml.some((p) => p.includes(mod))
);
emit("H5", "auto-expanded api modules present in en output", {
  expected: expectedAuto,
  covered: autoCovered,
  missing: expectedAuto.filter((m) => !autoCovered.includes(m)),
});

// H7: scan a generated HTML for the configured gitRevision
let enRevHits = 0;
for (const rel of enHtml.slice(0, 50)) {
  const txt = readFileSync(join(EN_OUT, rel), "utf8");
  if (txt.includes(`/blob/${EN_REV}/`)) enRevHits++;
}
emit("H7", "en gitRevision occurrences in first 50 html", {
  envValue: EN_REV,
  hitsFound: enRevHits,
});

// ───── zh build with a different revision to make sure env is read each call ─
const ZH_REV = "verify-zh-sha";
const zhRes = run("node scripts/build-docs.mjs --zh", {
  cwd: TS_PKG,
  env: { ...process.env, TYPEDOC_GIT_REVISION: ZH_REV },
});
emit("H9", "build-docs zh exit", {
  status: zhRes.status,
  stderr_tail: (zhRes.stderr || "").split("\n").slice(-5).join("\n"),
});

const ZH_OUT = resolve(REPO_ROOT, "docs/reference/typescript-api-html-zh");
const zhIndex = join(ZH_OUT, "index.html");
const zhIndexText = existsSync(zhIndex) ? readFileSync(zhIndex, "utf8") : "";
emit("H9", "zh index.html cover-page indicators", {
  exists: existsSync(zhIndex),
  hasZhMarker_中文文档: zhIndexText.includes("中文文档"),
  hasZhMarker_API_参考: zhIndexText.includes("API 参考"),
  hasZhMarker_快速上手: zhIndexText.includes("快速上手"),
  hasEnglishMarker_QuickStart: zhIndexText.includes("Quick Start"),
});

let zhRevHits = 0;
const zhHtml = existsSync(ZH_OUT) ? readdirSync(ZH_OUT, { recursive: true }).map(String).filter((f) => f.endsWith(".html")) : [];
for (const rel of zhHtml.slice(0, 50)) {
  const txt = readFileSync(join(ZH_OUT, rel), "utf8");
  if (txt.includes(`/blob/${ZH_REV}/`)) zhRevHits++;
}
emit("H7", "zh gitRevision occurrences in first 50 html", {
  envValue: ZH_REV,
  hitsFound: zhRevHits,
});

// ───── H1: simulate empty pdoc module list ─────
const broken = run(
  "PYTHONPATH=src uv run python -c " +
    "'import sys, pathlib; sys.path.insert(0, \"scripts\"); " +
    "import importlib.util; spec = importlib.util.spec_from_file_location(\"m\", \"scripts/list_pdoc_modules.py\"); " +
    "mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod); " +
    "import builtins, os; os.environ; " +
    "print(\"normal exit:\", mod.main())'",
  { cwd: PY_PKG },
);
emit("H1", "list_pdoc_modules normal run exit code", {
  status: broken.status,
  stdout_tail: (broken.stdout || "").split("\n").slice(-5).join("\n"),
  stderr_tail: (broken.stderr || "").split("\n").slice(-5).join("\n"),
});

// Force the failure path: temporarily run script with PKG_ROOT pointing to a
// nonexistent dir by monkey-patching via a wrapper. Simulate by passing
// a Python that overrides the path before importing.
const failProbe = run(
  "PYTHONPATH=src uv run python -c \"" +
    "import importlib.util, sys, pathlib; " +
    "spec = importlib.util.spec_from_file_location('m','scripts/list_pdoc_modules.py'); " +
    "mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod); " +
    "import builtins; " +
    "orig = pathlib.Path.is_dir; " +
    "pathlib.Path.is_dir = lambda self: False; " +
    "rc = mod.main(); " +
    "pathlib.Path.is_dir = orig; " +
    "sys.exit(rc)\"",
  { cwd: PY_PKG },
);
emit("H1", "list_pdoc_modules forced-failure exit code", {
  status: failProbe.status,
  stderr_tail: (failProbe.stderr || "").split("\n").slice(-5).join("\n"),
});

// Simulate Makefile guard with empty MODS:
const makeGuard = run(
  "set -e; MODS=\"\"; if [ -z \"$MODS\" ]; then echo '[docs-python] empty' >&2; exit 1; fi; echo unreached",
  { cwd: PY_PKG },
);
emit("H1", "Makefile guard simulates empty MODS path", {
  status: makeGuard.status,
  stderr_tail: (makeGuard.stderr || "").split("\n").slice(-3).join("\n"),
});

// ───── H12: gitignore covers reference dirs ─────
const gi = readFileSync(resolve(REPO_ROOT, ".gitignore"), "utf8");
emit("H12", ".gitignore reference entries", {
  pythonIgnored: /docs\/reference\/python-api-html\//.test(gi),
  tsEnIgnored: /docs\/reference\/typescript-api-html\//.test(gi),
  tsZhIgnored: /docs\/reference\/typescript-api-html-zh\//.test(gi),
});

emit("summary", "verify-docs run complete", {
  enOutFiles: enHtml.length,
  zhOutFiles: zhHtml.length,
});
