import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isStatelessTokenMode,
  assertNotStatelessForWrite,
} from "../src/config/stateless.js";
import { run } from "../src/cli.js";

test("isStatelessTokenMode: false when KWEAVER_TOKEN_SOURCE unset", () => {
  delete process.env.KWEAVER_TOKEN_SOURCE;
  assert.equal(isStatelessTokenMode(), false);
});

test("isStatelessTokenMode: true when KWEAVER_TOKEN_SOURCE=flag", () => {
  process.env.KWEAVER_TOKEN_SOURCE = "flag";
  try {
    assert.equal(isStatelessTokenMode(), true);
  } finally {
    delete process.env.KWEAVER_TOKEN_SOURCE;
  }
});

test("assertNotStatelessForWrite throws with helpful message", () => {
  process.env.KWEAVER_TOKEN_SOURCE = "flag";
  try {
    assert.throws(
      () => assertNotStatelessForWrite("auth login"),
      /auth login.*--token.*stateless/s,
    );
  } finally {
    delete process.env.KWEAVER_TOKEN_SOURCE;
  }
});

test("assertNotStatelessForWrite no-op when not stateless", () => {
  delete process.env.KWEAVER_TOKEN_SOURCE;
  assert.doesNotThrow(() => assertNotStatelessForWrite("auth login"));
});

test("--token sets KWEAVER_TOKEN env and KWEAVER_TOKEN_SOURCE=flag", async () => {
  const origTok = process.env.KWEAVER_TOKEN;
  const origSrc = process.env.KWEAVER_TOKEN_SOURCE;
  const origBase = process.env.KWEAVER_BASE_URL;
  delete process.env.KWEAVER_TOKEN;
  delete process.env.KWEAVER_TOKEN_SOURCE;
  process.env.KWEAVER_BASE_URL = "https://example.invalid";
  try {
    await run(["--token", "abc123", "version"]);
    assert.equal(process.env.KWEAVER_TOKEN, "abc123");
    assert.equal(process.env.KWEAVER_TOKEN_SOURCE, "flag");
  } finally {
    if (origTok !== undefined) process.env.KWEAVER_TOKEN = origTok;
    else delete process.env.KWEAVER_TOKEN;
    if (origSrc !== undefined) process.env.KWEAVER_TOKEN_SOURCE = origSrc;
    else delete process.env.KWEAVER_TOKEN_SOURCE;
    if (origBase !== undefined) process.env.KWEAVER_BASE_URL = origBase;
    else delete process.env.KWEAVER_BASE_URL;
  }
});

test("--base-url sets KWEAVER_BASE_URL env", async () => {
  const orig = process.env.KWEAVER_BASE_URL;
  delete process.env.KWEAVER_BASE_URL;
  try {
    await run(["--base-url", "https://x.example", "version"]);
    assert.equal(process.env.KWEAVER_BASE_URL, "https://x.example");
  } finally {
    if (orig !== undefined) process.env.KWEAVER_BASE_URL = orig;
    else delete process.env.KWEAVER_BASE_URL;
  }
});

test("--token without any base-url fails with guidance", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "kw-stateless-"));
  const origCfg = process.env.KWEAVERC_CONFIG_DIR;
  const origTok = process.env.KWEAVER_TOKEN;
  const origBase = process.env.KWEAVER_BASE_URL;
  process.env.KWEAVERC_CONFIG_DIR = tmp;
  delete process.env.KWEAVER_TOKEN;
  delete process.env.KWEAVER_BASE_URL;
  const errors: string[] = [];
  const origErr = console.error;
  console.error = (msg: unknown) => {
    errors.push(String(msg));
  };
  try {
    const code = await run(["--token", "tok", "bkn", "list"]);
    assert.equal(code, 1);
    assert.match(errors.join("\n"), /--token requires a base URL/);
  } finally {
    console.error = origErr;
    if (origCfg !== undefined) process.env.KWEAVERC_CONFIG_DIR = origCfg;
    else delete process.env.KWEAVERC_CONFIG_DIR;
    if (origTok !== undefined) process.env.KWEAVER_TOKEN = origTok;
    if (origBase !== undefined) process.env.KWEAVER_BASE_URL = origBase;
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("--token blocks `auth login`", async () => {
  const errors: string[] = [];
  const origErr = console.error;
  console.error = (msg: unknown) => {
    errors.push(String(msg));
  };
  process.env.KWEAVER_BASE_URL = "https://example.invalid";
  try {
    const code = await run(["--token", "tok", "auth", "login", "https://example.invalid"]);
    assert.equal(code, 1);
    assert.match(errors.join("\n"), /Cannot run.*auth login.*--token/s);
  } finally {
    console.error = origErr;
    delete process.env.KWEAVER_BASE_URL;
    delete process.env.KWEAVER_TOKEN;
    delete process.env.KWEAVER_TOKEN_SOURCE;
  }
});

test("--token blocks `config set-bd`", async () => {
  const errors: string[] = [];
  const origErr = console.error;
  console.error = (msg: unknown) => {
    errors.push(String(msg));
  };
  process.env.KWEAVER_BASE_URL = "https://example.invalid";
  try {
    const code = await run(["--token", "tok", "config", "set-bd", "bd_x"]);
    assert.equal(code, 1);
    assert.match(errors.join("\n"), /Cannot run.*config set-bd.*--token/s);
  } finally {
    console.error = origErr;
    delete process.env.KWEAVER_BASE_URL;
    delete process.env.KWEAVER_TOKEN;
    delete process.env.KWEAVER_TOKEN_SOURCE;
  }
});

test("--token blocks `context-loader config set`", async () => {
  const errors: string[] = [];
  const origErr = console.error;
  console.error = (msg: unknown) => {
    errors.push(String(msg));
  };
  process.env.KWEAVER_BASE_URL = "https://example.invalid";
  try {
    const code = await run([
      "--token",
      "tok",
      "context-loader",
      "config",
      "set",
      "--kn-id",
      "kn-x",
    ]);
    assert.equal(code, 1);
    assert.match(errors.join("\n"), /Cannot run.*context-loader config set.*--token/s);
  } finally {
    console.error = origErr;
    delete process.env.KWEAVER_BASE_URL;
    delete process.env.KWEAVER_TOKEN;
    delete process.env.KWEAVER_TOKEN_SOURCE;
  }
});

test("--token blocks read-only `context-loader config show` too", async () => {
  const errors: string[] = [];
  const origErr = console.error;
  console.error = (msg: unknown) => {
    errors.push(String(msg));
  };
  process.env.KWEAVER_BASE_URL = "https://example.invalid";
  try {
    const code = await run(["--token", "tok", "context-loader", "config", "show"]);
    assert.equal(code, 1);
    assert.match(errors.join("\n"), /Cannot run.*context-loader config show.*--token/s);
  } finally {
    console.error = origErr;
    delete process.env.KWEAVER_BASE_URL;
    delete process.env.KWEAVER_TOKEN;
    delete process.env.KWEAVER_TOKEN_SOURCE;
  }
});

test("`context-loader config show` prints deprecation warning (env mode)", async () => {
  const warnings: string[] = [];
  const origWarn = console.warn;
  const origLog = console.log;
  console.warn = (msg: unknown) => {
    warnings.push(String(msg));
  };
  console.log = () => {};
  const tmp = mkdtempSync(join(tmpdir(), "kw-cfg-deprec-"));
  const origCfg = process.env.KWEAVERC_CONFIG_DIR;
  process.env.KWEAVERC_CONFIG_DIR = tmp;
  process.env.KWEAVER_BASE_URL = "https://example.invalid";
  process.env.KWEAVER_TOKEN = "tok";
  delete process.env.KWEAVER_TOKEN_SOURCE;
  try {
    await run(["context-loader", "config", "show"]);
    assert.match(warnings.join("\n"), /deprecated.*context-loader config/i);
  } finally {
    console.warn = origWarn;
    console.log = origLog;
    if (origCfg !== undefined) process.env.KWEAVERC_CONFIG_DIR = origCfg;
    else delete process.env.KWEAVERC_CONFIG_DIR;
    delete process.env.KWEAVER_BASE_URL;
    delete process.env.KWEAVER_TOKEN;
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("whoami shows Source: CLI (flag: --token) when --token was used", async () => {
  const logs: string[] = [];
  const origLog = console.log;
  console.log = (msg: unknown) => {
    logs.push(String(msg));
  };
  process.env.KWEAVER_BASE_URL = "https://127.0.0.1:1";
  try {
    await run(["--token", "header.payload.sig", "auth", "whoami"]);
    assert.match(logs.join("\n"), /Source:\s+CLI \(flag: --token\)/);
  } finally {
    console.log = origLog;
    delete process.env.KWEAVER_BASE_URL;
    delete process.env.KWEAVER_TOKEN;
    delete process.env.KWEAVER_TOKEN_SOURCE;
  }
});

test("whoami still shows Source: env (KWEAVER_TOKEN) for env-only mode", async () => {
  const logs: string[] = [];
  const origLog = console.log;
  console.log = (msg: unknown) => {
    logs.push(String(msg));
  };
  process.env.KWEAVER_BASE_URL = "https://127.0.0.1:1";
  process.env.KWEAVER_TOKEN = "header.payload.sig";
  delete process.env.KWEAVER_TOKEN_SOURCE;
  try {
    await run(["auth", "whoami"]);
    assert.match(logs.join("\n"), /Source:\s+env \(KWEAVER_TOKEN\)/);
  } finally {
    console.log = origLog;
    delete process.env.KWEAVER_BASE_URL;
    delete process.env.KWEAVER_TOKEN;
  }
});
