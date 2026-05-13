import type { TraceTree } from "./types.js";

/**
 * Extract the most recent user-role message from a trace's input.messages.
 *
 * Scans spans for the first one with `gen_ai.input.messages` (a JSON-stringified
 * array of {role, content}); returns the last `role === "user"` message's content.
 * Returns null if no such span or no user message is found.
 */
export function extractUserQueryFromTrace(tree: TraceTree): string | null {
  for (const span of tree.spans) {
    const raw = span.attributes?.["gen_ai.input.messages"];
    if (typeof raw !== "string") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!Array.isArray(parsed)) continue;
    // Find the LAST user message
    for (let i = parsed.length - 1; i >= 0; i--) {
      const m = parsed[i] as { role?: unknown; content?: unknown };
      if (m?.role === "user" && typeof m.content === "string" && m.content.length > 0) {
        return m.content;
      }
    }
  }
  return null;
}
