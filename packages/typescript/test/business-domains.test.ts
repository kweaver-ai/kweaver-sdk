import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { listBusinessDomains } from "../src/api/business-domains.js";
import {
  autoSelectBusinessDomain,
  loadPlatformBusinessDomain,
} from "../src/config/store.js";

describe("listBusinessDomains", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("GETs /api/business-system/v1/business-domain and parses array", async () => {
    const payload = [
      { id: "54308785-4438-43df-9490-a7fd11df5765", name: "kweaver", description: "desc" },
    ];
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      assert.ok(url.endsWith("/api/business-system/v1/business-domain"));
      return new Response(JSON.stringify(payload), { status: 200 });
    };
    const rows = await listBusinessDomains({
      baseUrl: "https://dip.example.com/",
      accessToken: "atoken",
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, "54308785-4438-43df-9490-a7fd11df5765");
    assert.equal(rows[0].name, "kweaver");
  });

  it("throws HttpError on non-OK response", async () => {
    globalThis.fetch = async () => new Response("no", { status: 500, statusText: "Err" });
    await assert.rejects(
      () =>
        listBusinessDomains({
          baseUrl: "https://dip.example.com",
          accessToken: "atoken",
        }),
      /HTTP 500/,
    );
  });
});

describe("autoSelectBusinessDomain", () => {
  const originalFetch = globalThis.fetch;
  let origDir: string | undefined;
  let tempDir: string;

  beforeEach(() => {
    origDir = process.env.KWEAVERC_CONFIG_DIR;
    tempDir = mkdtempSync(join(tmpdir(), "kw-bd-"));
    process.env.KWEAVERC_CONFIG_DIR = tempDir;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (origDir === undefined) delete process.env.KWEAVERC_CONFIG_DIR;
    else process.env.KWEAVERC_CONFIG_DIR = origDir;
    rmSync(tempDir, { recursive: true, force: true });
    delete process.env.KWEAVER_BUSINESS_DOMAIN;
  });

  it("prefers bd_public when present in list", async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify([
          { id: "other-uuid", name: "o" },
          { id: "bd_public", name: "public" },
        ]),
        { status: 200 },
      );
    const picked = await autoSelectBusinessDomain("https://dip.example.com", "tok");
    assert.equal(picked, "bd_public");
    assert.equal(loadPlatformBusinessDomain("https://dip.example.com"), "bd_public");
  });

  it("uses first id when bd_public not in list", async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify([{ id: "first-id", name: "a" }]), { status: 200 });
    const picked = await autoSelectBusinessDomain("https://dip.example.com", "tok");
    assert.equal(picked, "first-id");
    assert.equal(loadPlatformBusinessDomain("https://dip.example.com"), "first-id");
  });

  it("skips API when KWEAVER_BUSINESS_DOMAIN is set", async () => {
    process.env.KWEAVER_BUSINESS_DOMAIN = "from-env";
    let called = false;
    globalThis.fetch = async () => {
      called = true;
      return new Response("[]", { status: 200 });
    };
    const picked = await autoSelectBusinessDomain("https://dip.example.com", "tok");
    assert.equal(picked, "from-env");
    assert.equal(called, false);
  });
});
