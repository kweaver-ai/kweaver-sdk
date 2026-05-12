import fs from "node:fs/promises";

export type TracesListErrorCode = "empty" | "file-not-found";

export class TracesListError extends Error {
  constructor(public readonly code: TracesListErrorCode, message: string) {
    super(message);
    this.name = "TracesListError";
  }
}

/**
 * Parse the `--traces` argument value into an array of conversation_ids.
 * Two forms:
 *   - comma-separated:  "conv1,conv2,conv3"
 *   - @file path:       "@/path/to/ids.txt" (one id per line; # comments and blanks ignored)
 *
 * Throws TracesListError with code='empty' for empty result, 'file-not-found'
 * when @file path does not exist.
 */
export async function parseTracesList(arg: string): Promise<string[]> {
  if (arg.startsWith("@")) {
    const filePath = arg.slice(1);
    let raw: string;
    try {
      raw = await fs.readFile(filePath, "utf8");
    } catch {
      throw new TracesListError("file-not-found", `--traces file not found: ${filePath}`);
    }
    const ids = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));
    if (ids.length === 0) {
      throw new TracesListError("empty", `no conversation_ids found in ${filePath}`);
    }
    return ids;
  }
  const ids = arg
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (ids.length === 0) {
    throw new TracesListError("empty", "empty --traces value");
  }
  return ids;
}
