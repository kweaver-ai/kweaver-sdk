/**
 * RSA password encryption for the KWeaver data-connection API.
 * The KWeaver backend requires datasource passwords to be RSA-encrypted
 * (PKCS1v15) using a platform-wide public key before transmission.
 */

import { publicEncrypt, createPublicKey, constants } from "node:crypto";

const KWEAVER_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA22GOSQ1jeDhpdzxhJddS
f+U10F4Ivut7giYhchFAIJgRonMamDT86MSqQUc8DdTFdPGLm7M3GUKcsG1qbC3S
qk4XJ9NjmQXbs7IMWyWEWQrN7Iv7S2QjDYJI+ppvIN03I0Km3WKsmnrle2bLzT/V
G8e72YX69dfXAeiX6uDhht1va/JxZVFMIV3pHa6AQQ9gn5SAUTX2akEhRfe1bPJj
fVyoM+dfNtvgdfaraqV1rOhVDEqd0NlOWt2RHwETQwU8gIJib2baj2MtyIAY+fQw
KlKWxUs1GcFbECnhVPiVN6BEhXD7OhRt9QE/cuYl5v4a6ypugGaMBK6VKOqFHDvf
mwIDAQAB
-----END PUBLIC KEY-----`;

let cachedKey: ReturnType<typeof createPublicKey> | null = null;

function getPublicKey(): ReturnType<typeof createPublicKey> {
  if (!cachedKey) {
    cachedKey = createPublicKey(KWEAVER_PUBLIC_KEY_PEM);
  }
  return cachedKey;
}

/**
 * Encrypt a password with the KWeaver platform RSA public key.
 * Returns a base64-encoded ciphertext string.
 */
export function encryptPassword(plaintext: string): string {
  const key = getPublicKey();
  const ciphertext = publicEncrypt(
    { key, padding: constants.RSA_PKCS1_PADDING },
    Buffer.from(plaintext, "utf8")
  );
  return ciphertext.toString("base64");
}
