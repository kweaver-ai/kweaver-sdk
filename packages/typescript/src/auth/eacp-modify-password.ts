import {
  constants as cryptoConstants,
  createPrivateKey,
  createPublicKey,
  privateDecrypt,
  publicEncrypt,
  type KeyObject,
} from "node:crypto";
import { normalizeBaseUrl, runWithTlsInsecure } from "./oauth.js";

/**
 * 1024-bit RSA private key embedded in ShareServer
 * (`isf/ShareServer/src/eachttpserver/ncEACHttpServerUtil.cpp`, function
 * `ncEACHttpServerUtil::RSADecrypt`). It is the keypair used by the EACP
 * `auth1/modifypassword` endpoint to decrypt `oldpwd` / `newpwd`.
 *
 * Note: this key is intentionally hard-coded in the C++ binary and shipped to
 * every customer; it is not a secret. We embed it here so the CLI can perform
 * the matching `RSA_PKCS1` encryption without contacting the server.
 */
const EACP_MODIFYPWD_PRIVATE_KEY_PEM = `-----BEGIN RSA PRIVATE KEY-----
MIICXgIBAAKBgQDB2fhLla9rMx+6LWTXajnK11Kdp520s1Q+TfPfIXI/7G9+L2YC
4RA3M5rgRi32s5+UFQ/CVqUFqMqVuzaZ4lw/uEdk1qHcP0g6LB3E9wkl2FclFR0M
+/HrWmxPoON+0y/tFQxxfNgsUodFzbdh0XY1rIVUIbPLvufUBbLKXHDPpwIDAQAB
AoGBALCM/H6ajXFs1nCR903aCVicUzoS9qckzI0SIhIOPCfMBp8+PAJTSJl9/ohU
YnhVj/kmVXwBvboxyJAmOcxdRPWL7iTk5nA1oiVXMer3Wby+tRg/ls91xQbJLVv3
oGSt7q0CXxJpRH2oYkVVlMMlZUwKz3ovHiLKAnhw+jEsdL2BAkEA9hA97yyeA2eq
f9dMu/ici99R3WJRRtk4NEI4WShtWPyziDg48d3SOzYmhEJjPuOo3g1ze01os70P
ApE7d0qcyQJBAMmt+FR8h5MwxPQPAzjh/fTuTttvUfBeMiUDrIycK1I/L96lH+fU
i4Nu+7TPOzExnPeGO5UJbZxrpIEUB7Zs8O8CQQCLzTCTGiNwxc5eMgH77kVrRudp
Q7nv6ex/7Hu9VDXEUFbkdyULbj9KuvppPJrMmWZROw04qgNp02mayM8jeLXZAkEA
o+PM/pMn9TPXiWE9xBbaMhUKXgXLd2KEq1GeAbHS/oY8l1hmYhV1vjwNLbSNrH9d
yEP73TQJL+jFiONHFTbYXwJAU03Xgum5mLIkX/02LpOrz2QCdfX1IMJk2iKi9osV
KqfbvHsF0+GvFGg18/FXStG9Kr4TjqLsygQJT76/MnMluw==
-----END RSA PRIVATE KEY-----`;

let cachedPubKey: KeyObject | undefined;

function getModifyPwdPublicKey(): KeyObject {
  if (!cachedPubKey) {
    cachedPubKey = createPublicKey(createPrivateKey(EACP_MODIFYPWD_PRIVATE_KEY_PEM));
  }
  return cachedPubKey;
}

/** Encrypt a password with EACP modifypassword's RSA public key, base64-encoded. */
export function encryptModifyPwd(plain: string, publicKeyPem?: string): string {
  const key = publicKeyPem ? createPublicKey(publicKeyPem) : getModifyPwdPublicKey();
  const buf = publicEncrypt(
    { key, padding: cryptoConstants.RSA_PKCS1_PADDING },
    Buffer.from(plain, "utf8"),
  );
  return buf.toString("base64");
}

/** @internal For unit tests: decrypt ciphertext produced by encryptModifyPwd with the embedded key. */
export function decryptModifyPwdForTest(cipherB64: string): string {
  const key = createPrivateKey(EACP_MODIFYPWD_PRIVATE_KEY_PEM);
  const buf = privateDecrypt(
    { key, padding: cryptoConstants.RSA_PKCS1_PADDING },
    Buffer.from(cipherB64, "base64"),
  );
  return buf.toString("utf8");
}

export interface EacpModifyPasswordOptions {
  account: string;
  oldPassword: string;
  newPassword: string;
  /** Override the embedded RSA public key (PEM). */
  publicKeyPem?: string;
  tlsInsecure?: boolean;
}

export interface EacpModifyPasswordResult {
  status: number;
  ok: boolean;
  body: string;
  json?: unknown;
}

/**
 * Call EACP `POST /api/eacp/v1/auth1/modifypassword` to change a user's password
 * when the old password is known (`isforgetpwd: false`).
 *
 * No bearer token / cookie is required — the endpoint authenticates by old password.
 */
export async function eacpModifyPassword(
  baseUrl: string,
  options: EacpModifyPasswordOptions,
): Promise<EacpModifyPasswordResult> {
  return runWithTlsInsecure(options.tlsInsecure, async () => {
    const body: Record<string, unknown> = {
      account: options.account,
      oldpwd: encryptModifyPwd(options.oldPassword, options.publicKeyPem),
      newpwd: encryptModifyPwd(options.newPassword, options.publicKeyPem),
      vcodeinfo: {
        uuid: "",
        vcode: "",
      },
      isforgetpwd: false,
    };

    const url = `${normalizeBaseUrl(baseUrl)}/api/eacp/v1/auth1/modifypassword`;
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/plain, */*",
      },
      body: JSON.stringify(body),
    });
    const text = await resp.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      /* not JSON */
    }
    return { status: resp.status, ok: resp.ok, body: text, json };
  });
}
