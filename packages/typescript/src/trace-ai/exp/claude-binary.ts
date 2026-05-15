import { execSync } from "node:child_process";
import os from "node:os";

/**
 * Resolves the path to the claude CLI binary.
 * Priority: CLAUDE_BIN env → `which claude` → known install locations → bare "claude".
 */
export function resolveClaudeBinary(): string {
  if (process.env["CLAUDE_BIN"]) return process.env["CLAUDE_BIN"];
  try {
    const resolved = execSync("which claude", { encoding: "utf8", timeout: 3000 }).trim();
    // Reject shell alias expansions like "claude: aliased to ..."
    if (resolved && !resolved.includes(" ")) return resolved;
  } catch { /* fall through */ }
  const home = os.homedir();
  for (const p of [
    `${home}/.local/bin/claude`,
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
  ]) {
    try { execSync(`test -x "${p}"`, { timeout: 1000 }); return p; } catch { /* try next */ }
  }
  return "claude";
}
