import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  renderHelp,
  formatTwoColumn,
  wrap,
} from "../src/help/format.ts";

describe("help/format renderHelp", () => {
  it("renders tagline, USAGE, sections, FLAGS, EXAMPLES, LEARN MORE", () => {
    const out = renderHelp({
      tagline: "Demo CLI",
      usage: "demo <command> [flags]",
      sections: [
        {
          title: "CORE COMMANDS",
          items: [
            { name: "auth", desc: "Authenticate" },
            { name: "agent", desc: "Agent CRUD + chat" },
          ],
        },
      ],
      flags: [
        { name: "--verbose", desc: "Verbose output" },
        { name: "--help, -h", desc: "Show help" },
      ],
      examples: ["demo auth login", "$ demo agent chat <id>"],
      learnMore: ["Read https://example.com"],
    });

    assert.match(out, /^Demo CLI\n\nUSAGE\n {2}demo <command>/);
    assert.match(out, /\nCORE COMMANDS\n {2}auth +Authenticate/);
    assert.match(out, /\n {2}agent +Agent CRUD \+ chat/);
    assert.match(out, /\nFLAGS\n {2}--verbose +Verbose output/);
    assert.match(out, /\nEXAMPLES\n {2}\$ demo auth login/);
    assert.match(out, /\n {2}\$ demo agent chat <id>/);
    assert.match(out, /\nLEARN MORE\n {2}Read https:\/\/example\.com$/);
  });

  it("supports grouped FLAGS sub-blocks", () => {
    const out = renderHelp({
      usage: "demo login [flags]",
      flags: [
        {
          title: "Login options",
          flags: [{ name: "-u <user>", desc: "Username" }],
        },
        {
          title: "TLS options",
          flags: [{ name: "--insecure", desc: "Skip TLS verify" }],
        },
      ],
    });

    assert.match(out, /\nFLAGS\n {2}Login options\n {4}-u <user> +Username/);
    assert.match(out, /\n {2}TLS options\n {4}--insecure +Skip TLS verify/);
  });

  it("renders ENVIRONMENT block", () => {
    const out = renderHelp({
      usage: "demo",
      environment: [{ name: "DEMO_TOKEN", desc: "API token" }],
    });
    assert.match(out, /\nENVIRONMENT\n {2}DEMO_TOKEN +API token/);
  });

  it("accepts multi-line USAGE", () => {
    const out = renderHelp({
      usage: ["demo a", "demo b"],
    });
    assert.match(out, /^USAGE\n {2}demo a\n {2}demo b/);
  });

  it("trims trailing blank lines", () => {
    const out = renderHelp({ usage: "demo" });
    assert.equal(out.endsWith("\n"), false);
  });
});

describe("help/format formatTwoColumn", () => {
  it("pads names to align descriptions", () => {
    const lines = formatTwoColumn(
      [
        { name: "a", desc: "alpha" },
        { name: "bbb", desc: "bravo" },
      ],
      80,
    );
    assert.equal(lines.length, 2);
    const aDescPos = lines[0].indexOf("alpha");
    const bDescPos = lines[1].indexOf("bravo");
    assert.equal(aDescPos, bDescPos);
  });

  it("wraps long descriptions onto continuation lines aligned to desc column", () => {
    const lines = formatTwoColumn(
      [{ name: "x", desc: "one two three four five six seven eight nine ten" }],
      30,
    );
    assert.ok(lines.length >= 2);
    const firstDescPos = lines[0].indexOf("one");
    const contPrefix = lines[1].match(/^ +/)?.[0].length ?? 0;
    assert.equal(contPrefix, firstDescPos);
  });

  it("returns empty for empty input", () => {
    assert.deepEqual(formatTwoColumn([]), []);
  });
});

describe("help/format wrap", () => {
  it("wraps at width boundary on whitespace", () => {
    const lines = wrap("one two three four five", 10);
    for (const l of lines) assert.ok(l.length <= 10, `line too long: "${l}"`);
  });

  it("preserves explicit newlines", () => {
    const lines = wrap("line1\nline2", 80);
    assert.deepEqual(lines, ["line1", "line2"]);
  });

  it("returns empty array for empty string", () => {
    assert.deepEqual(wrap("", 80), []);
  });
});
