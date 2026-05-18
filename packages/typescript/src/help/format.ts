/**
 * Help text formatter for the kweaver CLI.
 *
 * All `--help` output must go through `renderHelp()` to keep a consistent
 * gh-style layout. See `docs/cli_conventions.md` §8 for the spec.
 */

const DEFAULT_WIDTH = 80;
const INDENT = "  ";

export interface HelpItem {
  name: string;
  desc: string;
}

export interface HelpSection {
  title: string;
  items: HelpItem[];
}

export interface HelpFlag {
  name: string;
  desc: string;
}

export interface HelpFlagGroup {
  title: string;
  flags: HelpFlag[];
}

export interface RenderHelpOptions {
  /** Optional one-line tagline shown at the very top. */
  tagline?: string;
  /** One or more USAGE lines (without the "USAGE" header). */
  usage: string | string[];
  /**
   * Command / subcommand groupings (rendered as separate sections with
   * two-column name:desc layout).
   */
  sections?: HelpSection[];
  /**
   * Flags. Either a flat list (rendered under "FLAGS") or grouped sub-blocks
   * (each rendered under its own title, e.g. "Login options").
   */
  flags?: HelpFlag[] | HelpFlagGroup[];
  /** One-line "INHERITED FLAGS" summary. Omitted if undefined. */
  inheritedFlags?: string;
  /** Environment variable docs. */
  environment?: HelpFlag[];
  /** Example invocations (prefix `$ ` added automatically if missing). */
  examples?: string[];
  /** Free-form "LEARN MORE" trailing lines. */
  learnMore?: string[];
  /** Override the wrap width (default 80). */
  width?: number;
}

/**
 * Render full help text per the §8 spec.
 */
export function renderHelp(opts: RenderHelpOptions): string {
  const width = opts.width ?? DEFAULT_WIDTH;
  const out: string[] = [];

  if (opts.tagline) {
    out.push(opts.tagline);
    out.push("");
  }

  const usageLines = Array.isArray(opts.usage) ? opts.usage : [opts.usage];
  out.push("USAGE");
  for (const line of usageLines) {
    out.push(INDENT + line);
  }
  out.push("");

  if (opts.sections && opts.sections.length > 0) {
    for (const section of opts.sections) {
      out.push(section.title.toUpperCase());
      out.push(...formatTwoColumn(section.items, width));
      out.push("");
    }
  }

  if (opts.flags) {
    if (isFlagGroupArray(opts.flags)) {
      out.push("FLAGS");
      for (const group of opts.flags) {
        out.push(INDENT + group.title);
        out.push(
          ...formatTwoColumn(
            group.flags.map((f) => ({ name: f.name, desc: f.desc })),
            width,
            INDENT.repeat(2),
          ),
        );
        out.push("");
      }
    } else {
      out.push("FLAGS");
      out.push(
        ...formatTwoColumn(
          opts.flags.map((f) => ({ name: f.name, desc: f.desc })),
          width,
        ),
      );
      out.push("");
    }
  }

  if (opts.inheritedFlags) {
    out.push("INHERITED FLAGS");
    out.push(INDENT + opts.inheritedFlags);
    out.push("");
  }

  if (opts.environment && opts.environment.length > 0) {
    out.push("ENVIRONMENT");
    out.push(
      ...formatTwoColumn(
        opts.environment.map((e) => ({ name: e.name, desc: e.desc })),
        width,
      ),
    );
    out.push("");
  }

  if (opts.examples && opts.examples.length > 0) {
    out.push("EXAMPLES");
    for (const ex of opts.examples) {
      const trimmed = ex.trimStart();
      const line = trimmed.startsWith("$") ? trimmed : `$ ${trimmed}`;
      out.push(INDENT + line);
    }
    out.push("");
  }

  if (opts.learnMore && opts.learnMore.length > 0) {
    out.push("LEARN MORE");
    for (const line of opts.learnMore) {
      out.push(INDENT + line);
    }
    out.push("");
  }

  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out.join("\n");
}

/**
 * Render a two-column name:desc list.
 *
 * Width policy: left column = max(name length) + 2 (capped at half the wrap
 * width). Description wraps onto continuation lines aligned to the right
 * column. `indent` controls the leading whitespace (default: 2 spaces).
 */
export function formatTwoColumn(
  items: HelpItem[],
  width = DEFAULT_WIDTH,
  indent = INDENT,
): string[] {
  if (items.length === 0) return [];

  const maxName = items.reduce((m, i) => Math.max(m, i.name.length), 0);
  const halfWidth = Math.floor(width / 2);
  const colGap = Math.min(maxName + 2, halfWidth);
  const descCol = indent.length + colGap;
  const descWidth = Math.max(20, width - descCol);

  const out: string[] = [];
  for (const item of items) {
    const namePadded = item.name.padEnd(colGap, " ");
    const descLines = wrap(item.desc, descWidth);
    if (descLines.length === 0) {
      out.push(indent + item.name);
      continue;
    }
    out.push(indent + namePadded + descLines[0]);
    for (let i = 1; i < descLines.length; i++) {
      out.push(" ".repeat(descCol) + descLines[i]);
    }
  }
  return out;
}

/**
 * Word-wrap a string at the given column. Preserves single newlines as
 * explicit line breaks.
 */
export function wrap(text: string, width: number): string[] {
  if (!text) return [];
  const result: string[] = [];
  for (const para of text.split("\n")) {
    if (para.length <= width) {
      result.push(para);
      continue;
    }
    const words = para.split(/\s+/);
    let line = "";
    for (const word of words) {
      if (line.length === 0) {
        line = word;
      } else if (line.length + 1 + word.length <= width) {
        line += " " + word;
      } else {
        result.push(line);
        line = word;
      }
    }
    if (line.length > 0) result.push(line);
  }
  return result;
}

function isFlagGroupArray(
  v: HelpFlag[] | HelpFlagGroup[],
): v is HelpFlagGroup[] {
  return v.length > 0 && "flags" in (v[0] as object);
}
