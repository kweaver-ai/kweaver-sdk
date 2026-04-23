/**
 * One-off: write Python parity fixtures under packages/python/tests/fixtures/.
 * Run from repo root: cd packages/typescript && npx tsx test/dump-signin-fixtures.ts
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildOauth2SigninPostBody,
  DEFAULT_SIGNIN_RSA_MODULUS_HEX,
  rsaModulusHexToSpkiPem,
} from "../src/auth/oauth.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");
const fixDir = join(repoRoot, "packages", "python", "tests", "fixtures");
mkdirSync(fixDir, { recursive: true });

const body = buildOauth2SigninPostBody({
  csrftoken: "CSRF_FIXTURE",
  challenge: "CHALLENGE_FIXTURE",
  account: "alice",
  passwordCipher: "CIPHER_FIXTURE",
  remember: false,
});
writeFileSync(join(fixDir, "signin_post_body_basic.json"), JSON.stringify(body, null, 2) + "\n");

writeFileSync(
  join(fixDir, "spki_default_modulus.pem"),
  rsaModulusHexToSpkiPem(DEFAULT_SIGNIN_RSA_MODULUS_HEX),
);

console.log("fixtures written to", fixDir);
