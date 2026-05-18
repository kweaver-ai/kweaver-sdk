import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { MissionSchema, type Mission, type NextChange } from "../schemas.js";

export async function readMission(expDir: string): Promise<Mission> {
  const filePath = path.join(expDir, "mission.md");
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    throw new Error(`mission.md not found in ${expDir}`);
  }
  // Extract YAML frontmatter between --- delimiters
  const match = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!match) throw new Error(`mission.md in ${expDir} has no YAML frontmatter`);
  const parsed = yaml.load(match[1]);
  const result = MissionSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`mission.md schema invalid: ${issues}`);
  }
  return result.data;
}

export async function writeSuggestedChange(expDir: string, change: NextChange): Promise<void> {
  const filePath = path.join(expDir, "mission.md");
  const raw = await fs.readFile(filePath, "utf8");
  const match = raw.match(/^---\n([\s\S]*?)\n---(\n[\s\S]*)?$/);
  if (!match) throw new Error(`mission.md in ${expDir} has no YAML frontmatter`);

  const frontmatter = yaml.load(match[1]) as Record<string, unknown>;
  frontmatter["next_change"] = change;
  const body = match[2] ?? "";
  const newContent = `---\n${yaml.dump(frontmatter, { lineWidth: -1 })}---${body}`;
  await fs.writeFile(filePath, newContent, "utf8");
}
