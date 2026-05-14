import type { TraceTree } from "./types.js";

/**
 * Extract the most recent user-role message from a trace's input.messages.
 *
 * Scans spans for `gen_ai.input.messages` (a JSON-stringified array of
 * {role, content}), checking two locations in order:
 *   1. span.events[*].attributes  — emitted by dolphin otel_listener as the
 *      "gen_ai.client.inference.operation.details" event (primary path)
 *   2. span.attributes             — fallback for runtimes that promote the
 *      field directly onto the span
 *
 * Returns the last `role === "user"` message content, or null if not found.
 */
export function extractUserQueryFromTrace(tree: TraceTree): string | null {
  for (const span of tree.spans) {
    const candidates: unknown[] = [];

    // Primary: event attributes (dolphin otel_listener path)
    for (const ev of span.events ?? []) {
      const v = ev.attributes?.["gen_ai.input.messages"];
      if (typeof v === "string") candidates.push(v);
    }

    // Fallback: span attributes
    const spanAttr = span.attributes?.["gen_ai.input.messages"];
    if (typeof spanAttr === "string") candidates.push(spanAttr);

    for (const raw of candidates) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw as string);
      } catch {
        continue;
      }
      if (!Array.isArray(parsed)) continue;
      for (let i = parsed.length - 1; i >= 0; i--) {
        const m = parsed[i] as { role?: unknown; content?: unknown };
        if (m?.role === "user" && typeof m.content === "string" && m.content.length > 0) {
          return m.content;
        }
      }
    }
  }
  return null;
}
