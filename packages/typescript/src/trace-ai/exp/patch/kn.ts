import type { KnPatch } from "../schemas.js";
import type { KnApiClient } from "./kn-api-client.js";
import { RollbackYaml } from "../exp-store/rollback-yaml.js";

export class KnPatcher {
  private rollback: RollbackYaml;

  constructor(private client: KnApiClient, workDir: string) {
    this.rollback = new RollbackYaml(workDir);
  }

  async apply(patch: KnPatch): Promise<void> {
    // Phase 1: dry-run all
    for (const spec of patch.add_object_types) {
      const r = await this.client.validateObjectType(patch.kn_id, spec);
      if (!r.valid) throw new Error(`KN dry-run failed for '${spec.concept_name}': ${r.error ?? "unknown"}`);
    }
    for (const spec of patch.add_relation_types) {
      const r = await this.client.validateRelationType(patch.kn_id, spec);
      if (!r.valid) throw new Error(`KN dry-run failed for relation '${spec.concept_name}': ${r.error ?? "unknown"}`);
    }

    // Phase 2: apply object types (write rollback BEFORE each KN call)
    for (const spec of patch.add_object_types) {
      if (await this.client.objectTypeExists(patch.kn_id, spec.concept_name)) continue;
      await this.rollback.appendStep({ op: "remove_object_type", kn_id: patch.kn_id, concept_name: spec.concept_name });
      await this.client.addObjectType(patch.kn_id, spec);
    }

    // Phase 3: apply relation types
    for (const spec of patch.add_relation_types) {
      if (await this.client.relationTypeExists(patch.kn_id, spec.concept_name)) continue;
      await this.rollback.appendStep({ op: "remove_relation_type", kn_id: patch.kn_id, concept_name: spec.concept_name });
      await this.client.addRelationType(patch.kn_id, spec);
    }
  }
}
