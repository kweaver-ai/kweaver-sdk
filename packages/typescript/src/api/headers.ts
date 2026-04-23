import { isNoAuth } from "../config/no-auth.js";

/**
 * Shared HTTP header builder for all KWeaver API calls.
 *
 * Supports optional x-account-id / x-account-type headers read from
 * environment variables KWEAVER_ACCOUNT_ID and KWEAVER_ACCOUNT_TYPE.
 * These are required by older platform versions (e.g. dip-poc.aishu.cn)
 * that do not infer account info from the token automatically.
 *
 * When accessToken is the no-auth sentinel, `authorization` and `token` are omitted.
 */
export function buildHeaders(accessToken: string, businessDomain: string): Record<string, string> {
  const headers: Record<string, string> = {
    accept: "application/json, text/plain, */*",
    "accept-language": "zh-cn",
    "x-business-domain": businessDomain,
    "x-language": "zh-cn",
  };
  if (!isNoAuth(accessToken)) {
    headers.authorization = `Bearer ${accessToken}`;
    headers.token = accessToken;
  }

  const accountId = process.env.KWEAVER_ACCOUNT_ID;
  const accountType = process.env.KWEAVER_ACCOUNT_TYPE;
  if (accountId) headers["x-account-id"] = accountId;
  if (accountType) headers["x-account-type"] = accountType;

  return headers;
}
