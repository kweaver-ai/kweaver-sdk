import test from "node:test";
import assert from "node:assert/strict";
import { parseToolboxCreateArgs } from "../src/commands/toolbox.js";

test("parseToolboxCreateArgs requires --name and --service-url", () => {
  assert.throws(() => parseToolboxCreateArgs([]), /--name/);
  assert.throws(() => parseToolboxCreateArgs(["--name", "a"]), /--service-url/);
});

test("parseToolboxCreateArgs reads all flags", () => {
  const opts = parseToolboxCreateArgs([
    "--name", "demo",
    "--service-url", "http://svc:1234",
    "--description", "d",
    "-bd", "bd_x",
    "--pretty",
  ]);
  assert.equal(opts.name, "demo");
  assert.equal(opts.serviceUrl, "http://svc:1234");
  assert.equal(opts.description, "d");
  assert.equal(opts.businessDomain, "bd_x");
  assert.equal(opts.pretty, true);
});

test("parseToolboxCreateArgs defaults description to empty string", () => {
  const opts = parseToolboxCreateArgs(["--name", "a", "--service-url", "u"]);
  assert.equal(opts.description, "");
});
