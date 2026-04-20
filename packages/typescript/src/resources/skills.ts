import type { ClientContext } from "../client.js";
import {
  deleteSkill,
  downloadSkill,
  fetchSkillContent,
  fetchSkillFile,
  getSkill,
  getSkillMarketDetail,
  getSkillContentIndex,
  installSkillArchive,
  listSkillMarket,
  listSkillHistory,
  listSkills,
  publishSkillHistory,
  readSkillFile,
  republishSkillHistory,
  registerSkillContent,
  registerSkillZip,
  updateSkillMetadata,
  updateSkillPackageContent,
  updateSkillPackageZip,
  updateSkillStatus,
  type SkillCategory,
  type SkillListResult,
  type SkillStatus,
} from "../api/skills.js";

export class SkillsResource {
  constructor(private readonly ctx: ClientContext) {}

  async list(opts: {
    page?: number;
    pageSize?: number;
    sortBy?: "create_time" | "update_time" | "name";
    sortOrder?: "asc" | "desc";
    all?: boolean;
    name?: string;
    status?: SkillStatus;
    source?: string;
    createUser?: string;
  } = {}): Promise<SkillListResult> {
    return listSkills({ ...this.ctx.base(), pageSize: 30, ...opts });
  }

  async market(opts: {
    page?: number;
    pageSize?: number;
    sortBy?: "create_time" | "update_time" | "name";
    sortOrder?: "asc" | "desc";
    all?: boolean;
    name?: string;
    source?: string;
  } = {}): Promise<SkillListResult> {
    return listSkillMarket({ ...this.ctx.base(), pageSize: 30, ...opts });
  }

  async get(skillId: string) {
    return getSkill({ ...this.ctx.base(), skillId });
  }

  async getMarket(skillId: string) {
    return getSkillMarketDetail({ ...this.ctx.base(), skillId });
  }

  async registerContent(content: string, opts: {
    source?: string;
    extendInfo?: Record<string, unknown>;
  } = {}) {
    return registerSkillContent({ ...this.ctx.base(), content, ...opts });
  }

  async registerZip(filename: string, bytes: Uint8Array, opts: {
    source?: string;
    extendInfo?: Record<string, unknown>;
  } = {}) {
    return registerSkillZip({ ...this.ctx.base(), filename, bytes, ...opts });
  }

  async delete(skillId: string) {
    return deleteSkill({ ...this.ctx.base(), skillId });
  }

  async updateStatus(skillId: string, status: SkillStatus) {
    return updateSkillStatus({ ...this.ctx.base(), skillId, status });
  }

  async updateMetadata(skillId: string, metadata: {
    name: string;
    description: string;
    category: SkillCategory;
    source?: string;
    extendInfo?: Record<string, unknown>;
  }) {
    return updateSkillMetadata({ ...this.ctx.base(), skillId, ...metadata });
  }

  async updatePackageContent(skillId: string, content: string) {
    return updateSkillPackageContent({ ...this.ctx.base(), skillId, content });
  }

  async updatePackageZip(skillId: string, filename: string, bytes: Uint8Array) {
    return updateSkillPackageZip({ ...this.ctx.base(), skillId, filename, bytes });
  }

  async history(skillId: string) {
    return listSkillHistory({ ...this.ctx.base(), skillId });
  }

  async republishHistory(skillId: string, version: string) {
    return republishSkillHistory({ ...this.ctx.base(), skillId, version });
  }

  async publishHistory(skillId: string, version: string) {
    return publishSkillHistory({ ...this.ctx.base(), skillId, version });
  }

  async content(skillId: string) {
    return getSkillContentIndex({ ...this.ctx.base(), skillId });
  }

  async fetchContent(skillId: string) {
    return fetchSkillContent({ ...this.ctx.base(), skillId });
  }

  async readFile(skillId: string, relPath: string) {
    return readSkillFile({ ...this.ctx.base(), skillId, relPath });
  }

  async fetchFile(skillId: string, relPath: string) {
    return fetchSkillFile({ ...this.ctx.base(), skillId, relPath });
  }

  async download(skillId: string) {
    return downloadSkill({ ...this.ctx.base(), skillId });
  }

  async install(skillId: string, directory: string, opts: { force?: boolean } = {}) {
    const archive = await this.download(skillId);
    return installSkillArchive({ bytes: archive.bytes, directory, force: opts.force });
  }
}
