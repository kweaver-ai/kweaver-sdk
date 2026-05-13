import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  BUILTIN_RULES,
  loadRules,
  applyRules,
  RedactorError,
} from "../src/trace-ai/eval-set/redactor.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("BUILTIN_RULES match common PII patterns (5 builtin types)", () => {
  const testCases: Array<[string, string]> = [
    ["请回拨 13812345678 联系客户", "phone"],
    ["邮件发到 zhangsan@example.com", "email"],
    ["身份证号 110101199001011234", "id_card"],
    ["卡号 6228480012345678", "bank_card"],
    ["来源 IP 192.168.1.100", "ip"],
  ];
  for (const [text, ruleName] of testCases) {
    const rule = BUILTIN_RULES.find((r) => r.name === ruleName);
    assert.ok(rule, `builtin rule '${ruleName}' must exist`);
    assert.ok(rule.pattern.test(text), `rule '${ruleName}' must match: ${text}`);
  }
});

test("applyRules replaces matched PII with placeholder", () => {
  const out = applyRules("电话是 13812345678 不要外传", BUILTIN_RULES);
  assert.ok(out.includes("<phone:"), `expected <phone:hash6> placeholder, got: ${out}`);
  assert.equal(out.includes("13812345678"), false, "raw phone number must be replaced");
});

test("applyRules handles multiple matches in one string", () => {
  const out = applyRules("电话 13812345678 邮箱 zhangsan@example.com", BUILTIN_RULES);
  assert.ok(out.includes("<phone:"));
  assert.ok(out.includes("<email:"));
});

test("loadRules picks --redaction-rules CLI flag first (highest priority)", async () => {
  const fs = await import("node:fs/promises");
  const tmp = path.join(__dirname, "fixtures", "eval-set", "custom-rules.yaml");
  await fs.writeFile(
    tmp,
    "rules:\n  - name: custom_token\n    pattern: 'tok_[a-z0-9]+'\n    replace: '<token:{hash6}>'\n",
    "utf8",
  );
  try {
    const result = await loadRules({ cliFlag: tmp, repoDir: undefined });
    assert.equal(result.source, "cli-flag");
    assert.equal(result.rules.length, 1);
    assert.equal(result.rules[0].name, "custom_token");
  } finally {
    await fs.unlink(tmp);
  }
});

test("loadRules picks <repo>/redaction-rules/ when no CLI flag", async () => {
  const fs = await import("node:fs/promises");
  const repoDir = path.join(__dirname, "fixtures", "eval-set", "repo-rules-dir");
  await fs.mkdir(repoDir, { recursive: true });
  await fs.writeFile(
    path.join(repoDir, "rules.yaml"),
    "rules:\n  - name: org_id\n    pattern: 'ORG-[0-9]+'\n    replace: '<org:{hash6}>'\n",
    "utf8",
  );
  try {
    const result = await loadRules({ cliFlag: undefined, repoDir });
    assert.equal(result.source, "repo");
    assert.equal(result.rules[0].name, "org_id");
  } finally {
    await fs.rm(repoDir, { recursive: true, force: true });
  }
});

test("loadRules falls back to builtin when neither CLI nor repo dir", async () => {
  const result = await loadRules({ cliFlag: undefined, repoDir: undefined });
  assert.equal(result.source, "builtin");
  assert.equal(result.rules.length, BUILTIN_RULES.length);
});

test("loadRules fail-fast on malformed regex in user rule", async () => {
  const fs = await import("node:fs/promises");
  const tmp = path.join(__dirname, "fixtures", "eval-set", "bad-regex.yaml");
  await fs.writeFile(
    tmp,
    "rules:\n  - name: bad\n    pattern: '[unclosed'\n    replace: '<x>'\n",
    "utf8",
  );
  try {
    await assert.rejects(
      loadRules({ cliFlag: tmp, repoDir: undefined }),
      (e) => e instanceof RedactorError && /invalid regex/i.test(e.message),
    );
  } finally {
    await fs.unlink(tmp);
  }
});
