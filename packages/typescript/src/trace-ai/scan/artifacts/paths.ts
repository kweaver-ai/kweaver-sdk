import path from "node:path";

export interface ResolveArtifactsBaseInput {
  /** 'batch' → `<out>/artifacts/`; 'single' → `<stem>.artifacts/` next to the report. */
  mode: "batch" | "single";
  /** Batch: directory path (`--out=<dir>`). Single: file path (`--out=<file.yaml>`). */
  out: string;
}

/**
 * Resolve the artifacts base directory given the caller's `--out` value and
 * mode. Strips known extensions in single-trace mode so `.yaml`, `.yml`, and
 * `.md` all yield the same artifacts dir name.
 */
export function resolveArtifactsBase(input: ResolveArtifactsBaseInput): string {
  if (input.mode === "batch") {
    // Trim trailing slash, then append `artifacts`.
    const trimmed = input.out.replace(/\/+$/, "");
    return path.join(trimmed, "artifacts");
  }
  // single-trace: <dirname>/<stem>.artifacts/
  const dir = path.dirname(input.out);
  const base = path.basename(input.out);
  const stem = base.replace(/\.(yaml|yml|md)$/i, "");
  return path.join(dir, `${stem}.artifacts`);
}
