import test from "node:test";
import assert from "node:assert/strict";
import {
  parseComposerCreateArgs,
  parseComposerDeleteArgs,
  parseComposerGetArgs,
  parseComposerTemplateGetArgs,
} from "../src/commands/composer.js";

// ── create ────────────────────────────────────────────────────────────────────

test("parseComposerCreateArgs requires one of --prompt, --template, --config", () => {
  assert.throws(() => parseComposerCreateArgs([]), /one of --prompt, --template, --config/);
});

test("parseComposerCreateArgs rejects combining sources", () => {
  assert.throws(
    () => parseComposerCreateArgs(["--prompt", "p", "--template", "blank"]),
    /mutually exclusive/,
  );
  assert.throws(
    () => parseComposerCreateArgs(["--template", "blank", "--config", "f.json"]),
    /mutually exclusive/,
  );
});

test("parseComposerCreateArgs reads --prompt and pretty defaults on", () => {
  const opts = parseComposerCreateArgs(["--prompt", "design a pipeline"]);
  assert.equal(opts.source.kind, "prompt");
  if (opts.source.kind === "prompt") assert.equal(opts.source.prompt, "design a pipeline");
  assert.equal(opts.pretty, true);
});

test("parseComposerCreateArgs --compact flips pretty off", () => {
  const opts = parseComposerCreateArgs(["--prompt", "x", "--compact"]);
  assert.equal(opts.pretty, false);
});

test("parseComposerCreateArgs accepts known template id", () => {
  const opts = parseComposerCreateArgs(["--template", "code-development"]);
  assert.equal(opts.source.kind, "template");
  if (opts.source.kind === "template") assert.equal(opts.source.templateId, "code-development");
});

test("parseComposerCreateArgs rejects unknown template id", () => {
  assert.throws(
    () => parseComposerCreateArgs(["--template", "does-not-exist"]),
    /Unknown template/,
  );
});

test("parseComposerCreateArgs reads --config path verbatim", () => {
  const opts = parseComposerCreateArgs(["--config", "/tmp/my.json"]);
  assert.equal(opts.source.kind, "config");
  if (opts.source.kind === "config") assert.equal(opts.source.configPath, "/tmp/my.json");
});

test("parseComposerCreateArgs captures --save-to and -bd", () => {
  const opts = parseComposerCreateArgs([
    "--prompt", "hello",
    "--save-to", "./out.json",
    "-bd", "bd_xyz",
  ]);
  assert.equal(opts.saveTo, "./out.json");
  assert.equal(opts.businessDomain, "bd_xyz");
});

// ── get ───────────────────────────────────────────────────────────────────────

test("parseComposerGetArgs requires <orchestrator-id>", () => {
  assert.throws(() => parseComposerGetArgs([]), /orchestrator-id/);
  assert.throws(() => parseComposerGetArgs(["-bd", "bd_x"]), /orchestrator-id/);
});

test("parseComposerGetArgs extracts id when it appears after flags", () => {
  const opts = parseComposerGetArgs(["-bd", "bd_x", "01KPJ..."]);
  assert.equal(opts.orchestratorId, "01KPJ...");
  assert.equal(opts.businessDomain, "bd_x");
  assert.equal(opts.pretty, true);
});

test("parseComposerGetArgs --compact flips pretty", () => {
  const opts = parseComposerGetArgs(["orch-1", "--compact"]);
  assert.equal(opts.pretty, false);
});

// ── delete ────────────────────────────────────────────────────────────────────

test("parseComposerDeleteArgs requires id", () => {
  assert.throws(() => parseComposerDeleteArgs([]), /orchestrator-id/);
});

test("parseComposerDeleteArgs defaults cascade=false, yes=false", () => {
  const opts = parseComposerDeleteArgs(["orch-1"]);
  assert.equal(opts.cascade, false);
  assert.equal(opts.yes, false);
});

test("parseComposerDeleteArgs reads --cascade and -y in any order", () => {
  const opts = parseComposerDeleteArgs(["--cascade", "-y", "orch-1", "-bd", "bd_x"]);
  assert.equal(opts.cascade, true);
  assert.equal(opts.yes, true);
  assert.equal(opts.orchestratorId, "orch-1");
  assert.equal(opts.businessDomain, "bd_x");
});

test("parseComposerDeleteArgs accepts --yes alias", () => {
  const opts = parseComposerDeleteArgs(["--yes", "orch-1"]);
  assert.equal(opts.yes, true);
});

// ── template get ──────────────────────────────────────────────────────────────

test("parseComposerTemplateGetArgs requires template id", () => {
  assert.throws(() => parseComposerTemplateGetArgs([]), /template-id/);
});

test("parseComposerTemplateGetArgs captures id", () => {
  const opts = parseComposerTemplateGetArgs(["blank", "--compact"]);
  assert.equal(opts.templateId, "blank");
  assert.equal(opts.pretty, false);
});
