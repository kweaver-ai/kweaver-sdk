export interface SkillApiClient {
  getSkillContent(skillId: string): Promise<string>;
  publishSkillVersion(skillId: string, content: string): Promise<{ version: string; content: string }>;
}

export class KweaverSkillApiClient implements SkillApiClient {
  constructor(private baseUrl: string, private token: string) {}
  async getSkillContent(_skillId: string): Promise<string> {
    throw new Error("KweaverSkillApiClient not yet implemented — use mock in tests");
  }
  async publishSkillVersion(_skillId: string, _content: string): Promise<{ version: string; content: string }> {
    throw new Error("KweaverSkillApiClient not yet implemented");
  }
}
