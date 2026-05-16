import type { KnObjectTypeDef, KnRelationTypeDef } from "../schemas.js";

export interface KnApiClient {
  validateObjectType(knId: string, spec: KnObjectTypeDef): Promise<{ valid: boolean; error?: string }>;
  addObjectType(knId: string, spec: KnObjectTypeDef): Promise<{ concept_id: string }>;
  validateRelationType(knId: string, spec: KnRelationTypeDef): Promise<{ valid: boolean; error?: string }>;
  addRelationType(knId: string, spec: KnRelationTypeDef): Promise<{ relation_id: string }>;
  objectTypeExists(knId: string, conceptName: string): Promise<boolean>;
  relationTypeExists(knId: string, conceptName: string): Promise<boolean>;
}

export class KweaverKnApiClient implements KnApiClient {
  constructor(private baseUrl: string, private token: string) {}
  async validateObjectType(_knId: string, _spec: KnObjectTypeDef) { throw new Error("KweaverKnApiClient not yet implemented"); }
  async addObjectType(_knId: string, _spec: KnObjectTypeDef): Promise<{ concept_id: string }> { throw new Error("KweaverKnApiClient not yet implemented"); }
  async validateRelationType(_knId: string, _spec: KnRelationTypeDef) { throw new Error("KweaverKnApiClient not yet implemented"); }
  async addRelationType(_knId: string, _spec: KnRelationTypeDef): Promise<{ relation_id: string }> { throw new Error("KweaverKnApiClient not yet implemented"); }
  async objectTypeExists(_knId: string, _name: string): Promise<boolean> { throw new Error("KweaverKnApiClient not yet implemented"); }
  async relationTypeExists(_knId: string, _name: string): Promise<boolean> { throw new Error("KweaverKnApiClient not yet implemented"); }
}
