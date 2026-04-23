/** Sentinel access token for platforms with no OAuth / no API authentication. */
export const NO_AUTH_TOKEN = "__NO_AUTH__";

export function isNoAuth(accessToken: string): boolean {
  return accessToken === NO_AUTH_TOKEN;
}
