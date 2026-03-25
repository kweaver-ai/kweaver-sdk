import { getCurrentPlatform, loadTokenConfig } from "./store.js";

/**
 * When a platform was logged in with `--insecure`, the flag is stored on the token.
 * Apply Node TLS verification skip for this process so all `fetch` calls to that
 * platform succeed without per-request options.
 *
 * Also honors `KWEAVER_TLS_INSECURE=1` or `true` (development / scripting only).
 */
export function applyTlsEnvFromSavedTokens(): void {
  if (process.env.KWEAVER_TLS_INSECURE === "1" || process.env.KWEAVER_TLS_INSECURE === "true") {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    return;
  }

  const platform = getCurrentPlatform();
  if (!platform) {
    return;
  }
  const token = loadTokenConfig(platform);
  if (token?.tlsInsecure) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  }
}
