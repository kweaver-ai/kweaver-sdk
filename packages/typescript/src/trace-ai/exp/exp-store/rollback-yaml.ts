import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";

export interface RollbackStep {
  op: "remove_object_type" | "remove_relation_type";
  kn_id: string;
  concept_name: string;
  applied_at: string;
}

interface RollbackFile {
  schema_version: "exp-rollback/v1";
  steps: RollbackStep[];
}

export class RollbackYaml {
  private filePath: string;

  constructor(workDir: string) {
    this.filePath = path.join(workDir, "rollback.yaml");
  }

  async appendStep(step: Omit<RollbackStep, "applied_at">): Promise<void> {
    const existing = await this.readSteps();
    const doc: RollbackFile = {
      schema_version: "exp-rollback/v1",
      steps: [...existing, { ...step, applied_at: new Date().toISOString() }],
    };
    await fs.writeFile(this.filePath, yaml.dump(doc), "utf-8");
  }

  async readSteps(): Promise<RollbackStep[]> {
    try {
      const content = await fs.readFile(this.filePath, "utf-8");
      const parsed = yaml.load(content) as RollbackFile | null;
      return parsed?.steps ?? [];
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  }
}
