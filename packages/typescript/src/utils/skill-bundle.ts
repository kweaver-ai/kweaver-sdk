import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";
import JSZip from "jszip";

const SKILL_MD = "SKILL.md";

export class SkillBundleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillBundleError";
  }
}

function walk(rootDir: string): string[] {
  const out: string[] = [];
  const stack: string[] = [rootDir];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(abs);
      } else if (entry.isFile()) {
        out.push(abs);
      }
    }
  }
  return out;
}

function toPosixRelPath(rootDir: string, abs: string): string {
  const rel = relative(rootDir, abs);
  return sep === posix.sep ? rel : rel.split(sep).join(posix.sep);
}

export async function bundleSkillDirectoryToZip(rootDir: string): Promise<Uint8Array> {
  const stat = statSync(rootDir);
  if (!stat.isDirectory()) {
    throw new SkillBundleError(`not a directory: ${rootDir}`);
  }
  const files = walk(rootDir);
  if (files.length === 0) {
    throw new SkillBundleError(`empty skill directory: ${rootDir}`);
  }
  const hasSkillMd = files.some(
    (f) => toPosixRelPath(rootDir, f).toLowerCase() === SKILL_MD.toLowerCase(),
  );
  if (!hasSkillMd) {
    throw new SkillBundleError(
      `${SKILL_MD} not found at the root of ${rootDir} (server requires it)`,
    );
  }
  const zip = new JSZip();
  for (const abs of files) {
    const relPath = toPosixRelPath(rootDir, abs);
    zip.file(relPath, readFileSync(abs));
  }
  const buf = await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  return buf;
}
