/**
 * Tiny prompt template registry — load `.prompt.md` files from a directory,
 * resolve by `builtin:<name>` reference, render with a flat variables map.
 *
 * Why not a templating engine: the templates ship with the SDK, vars are
 * trusted internal data (rule yaml + trace metadata), and the substitution
 * is one-pass `{{key}}` → string. A 30-line implementation beats pulling in
 * Handlebars / Mustache and the security surface they bring.
 */

import fs from "node:fs/promises";
import path from "node:path";

export interface PromptTemplate {
  /** `builtin:rubric-judge-v1`, `builtin:within-trace-synthesizer-v1`, etc. */
  ref: string;
  /** Raw template body with `{{var}}` placeholders. */
  body: string;
  /** Absolute path to the source file, kept for debugging. */
  sourcePath: string;
}

export class PromptTemplateRegistry {
  private byRef = new Map<string, PromptTemplate>();

  has(ref: string): boolean {
    return this.byRef.has(ref);
  }

  get(ref: string): PromptTemplate {
    const tpl = this.byRef.get(ref);
    if (!tpl) {
      throw new Error(
        `prompt template not registered: '${ref}'; registered refs: [${[...this.byRef.keys()].join(", ") || "(none)"}]`,
      );
    }
    return tpl;
  }

  list(): string[] {
    return [...this.byRef.keys()];
  }

  /**
   * Register a prompt body directly (used by tests; production loads from disk).
   */
  registerInline(ref: string, body: string, sourcePath = "<inline>"): void {
    this.byRef.set(ref, { ref, body, sourcePath });
  }

  /**
   * Scan a directory for `*.prompt.md` files and register each as
   * `builtin:<basename-without-suffix>`. Skips non-files / non-matching
   * extensions silently — callers can `list()` to confirm what loaded.
   */
  async loadBuiltinDir(dir: string): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") return;
      throw err;
    }
    for (const e of entries) {
      if (!e.isFile()) continue;
      if (!e.name.endsWith(".prompt.md")) continue;
      const filePath = path.join(dir, e.name);
      const body = await fs.readFile(filePath, "utf8");
      const base = e.name.slice(0, -".prompt.md".length);
      this.byRef.set(`builtin:${base}`, { ref: `builtin:${base}`, body, sourcePath: filePath });
    }
  }
}

/**
 * Substitute `{{key}}` occurrences with `String(vars[key])`.
 *
 * Unknown keys throw — silent substitution masks template / data drift
 * (e.g. spec rename `tool_name` → `name` would otherwise leave `{{tool_name}}`
 * verbatim in the prompt and the agent would politely answer about its
 * literal value).
 *
 * `vars[key]` of type `object | array` is JSON-stringified with 2-space
 * indent — the common case is "interpolate a JSON evidence blob into a
 * markdown prompt block".
 */
export function render(template: PromptTemplate, vars: Record<string, unknown>): string {
  return template.body.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (_, key: string) => {
    if (!(key in vars)) {
      throw new Error(
        `prompt template '${template.ref}' references unknown variable '{{${key}}}'; provided vars: [${Object.keys(vars).join(", ")}]`,
      );
    }
    const v = vars[key];
    if (v === null || v === undefined) return "";
    if (typeof v === "string") return v;
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    return JSON.stringify(v, null, 2);
  });
}

export const defaultPromptRegistry = new PromptTemplateRegistry();
