/**
 * EACP RSA encryption helper (PEM file) used by eacpHydraAdminLogin.
 */
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { encryptPasswordWithRsaPemFile } from "../src/auth/oauth.js";

test("encryptPasswordWithRsaPemFile: PKCS#1 v1.5 encrypts password to base64", async () => {
  const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = publicKey.export({ type: "spki", format: "pem" }) as string;
  const dir = await mkdtemp(join(tmpdir(), "kweaver-eacp-"));
  try {
    const path = join(dir, "rsa_public.pem");
    await writeFile(path, pem, "utf8");
    const b64 = await encryptPasswordWithRsaPemFile("secret", path);
    assert.match(b64, /^[A-Za-z0-9+/]+=*$/);
    assert.ok(b64.length > 32);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
