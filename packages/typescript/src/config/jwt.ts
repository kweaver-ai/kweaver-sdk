/**
 * Lightweight JWT payload decoding (no signature verification).
 * Used by the credential store and CLI to extract user identity from id_token / access_token.
 */

export function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  const parts = jwt.split(".");
  if (parts.length !== 3) return null;
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(base64, "base64").toString("utf8");
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function extractUserIdFromJwt(jwt: string): string | null {
  const payload = decodeJwtPayload(jwt);
  return typeof payload?.sub === "string" ? payload.sub : null;
}
