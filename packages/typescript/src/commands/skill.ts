import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { ensureValidToken, formatHttpError, with401RefreshRetry } from "../auth/oauth.js";
import { resolveBusinessDomain } from "../config/store.js";
import {
  deleteSkill,
  downloadSkill,
  downloadSkillManagementArchive,
  fetchSkillContent,
  fetchSkillFile,
  getSkill,
  getSkillMarketDetail,
  getSkillContentIndex,
  getSkillManagementContent,
  installSkillArchive,
  listSkillMarket,
  listSkillHistory,
  listSkills,
  publishSkillHistory,
  readSkillFile,
  readSkillManagementFile,
  republishSkillHistory,
  registerSkillZip,
  updateSkillMetadata,
  updateSkillPackageContent,
  updateSkillPackageZip,
  updateSkillStatus,
  type SkillCategory,
  type SkillStatus,
} from "../api/skills.js";
import { bundleSkillDirectoryToZip, bundleSkillFileToZip } from "../utils/skill-bundle.js";
import { renderHelp } from "../help/format.js";

const SKILL_HELP = renderHelp({
  tagline: "Skill registry and market — register, market, content, lifecycle",
  usage: "kweaver skill <subcommand> [flags]",
  sections: [
    {
      title: "REGISTRY",
      items: [
        { name: "list", desc: "List skills (filter by --name / --status / --source / --create-user)" },
        { name: "get", desc: "Get a skill by id" },
        { name: "register", desc: "Register a skill (--content-file <SKILL.md|dir> | --zip-file <path>)" },
        { name: "set-status", desc: "Change status: unpublish | published | offline" },
        { name: "delete", desc: "Delete a skill" },
      ],
    },
    {
      title: "MARKET",
      items: [
        { name: "market", desc: "Browse the skill market" },
        { name: "market-get", desc: "Get a market skill by id" },
        { name: "download", desc: "Download a skill package archive" },
        { name: "install", desc: "Install a skill locally" },
      ],
    },
    {
      title: "CONTENT",
      items: [
        { name: "content", desc: "Read SKILL.md content" },
        { name: "read-file", desc: "Read a file inside a skill (progressive)" },
        { name: "management-content", desc: "Read SKILL.md via management endpoint" },
        { name: "management-read-file", desc: "Read file inside skill via management endpoint" },
        { name: "management-download", desc: "Download via management endpoint" },
      ],
    },
    {
      title: "LIFECYCLE",
      items: [
        { name: "update-metadata", desc: "Update metadata (name / description / category / source)" },
        { name: "update-package", desc: "Update package content or zip" },
        { name: "history", desc: "Show version history" },
        { name: "republish", desc: "Republish a specific historical version" },
        { name: "publish-history", desc: "Publish a historical version" },
      ],
    },
  ],
  flags: [
    { name: "-bd, --biz-domain <s>", desc: "Business domain (default: bd_public)" },
    { name: "--pretty / --compact", desc: "JSON output style (default: pretty)" },
  ],
  inheritedFlags: "--base-url, --token, --user, --help",
  examples: [
    "kweaver skill list --name kweaver",
    "kweaver skill register --zip-file ./demo-skill.zip --source upload_zip",
    "kweaver skill install skill-123 ./skills/demo-skill --force",
  ],
  learnMore: ["Use `kweaver skill <subcommand> --help` for flag details"],
});

interface BaseOptions {
  businessDomain: string;
  pretty: boolean;
}

interface ListOptions extends BaseOptions {
  page: number;
  pageSize: number;
  all: boolean;
  name?: string;
  source?: string;
  status?: SkillStatus;
  createUser?: string;
  sortBy?: "create_time" | "update_time" | "name";
  sortOrder?: "asc" | "desc";
}

interface RegisterOptions extends BaseOptions {
  contentFile?: string;
  zipFile?: string;
  source?: string;
  extendInfo?: Record<string, unknown>;
}

interface UpdateMetadataOptions extends BaseOptions {
  skillId: string;
  name: string;
  description: string;
  category: SkillCategory;
  source?: string;
  extendInfo?: Record<string, unknown>;
}

interface UpdatePackageOptions extends BaseOptions {
  skillId: string;
  contentFile?: string;
  zipFile?: string;
}

interface HistoryVersionOptions extends BaseOptions {
  skillId: string;
  version: string;
}

interface ContentOptions extends BaseOptions {
  skillId: string;
  fetchRaw: boolean;
  output?: string;
}

interface ReadFileOptions extends ContentOptions {
  relPath: string;
}

interface DownloadOptions extends BaseOptions {
  skillId: string;
  output?: string;
}

interface InstallOptions extends BaseOptions {
  skillId: string;
  directory: string;
  force: boolean;
}

interface ManagementContentOptions extends BaseOptions {
  skillId: string;
  responseMode?: "url" | "content";
  fetchRaw: boolean;
  output?: string;
}

interface ManagementReadFileOptions extends BaseOptions {
  skillId: string;
  relPath: string;
  responseMode?: "url" | "content";
  output?: string;
}

interface ManagementDownloadOptions extends BaseOptions {
  skillId: string;
  responseMode?: "url" | "content";
  output?: string;
}

function printSkillHelp(subcommand?: string): void {
  if (subcommand === "list") {
    console.log(renderHelp({
      tagline: "List installed skills.",
      usage: "kweaver skill list [--name kw] [--source src] [--status status] [--create-user user] [--page N] [--page-size N|--limit N] [--all] [-bd value] [--pretty|--compact]",
      flags: [
        { name: "--name kw", desc: "Filter by name keyword." },
        { name: "--source src", desc: "Filter by source." },
        { name: "--status status", desc: "Filter by status." },
        { name: "--create-user user", desc: "Filter by creator." },
        { name: "--page N", desc: "Page number." },
        { name: "--page-size N", desc: "Page size (alias: --limit)." },
        { name: "--all", desc: "Fetch all pages." },
        { name: "-bd value", desc: "Override base URL." },
        { name: "--pretty|--compact", desc: "Toggle pretty JSON output." },
      ],
      inheritedFlags: "--base-url, --token, --user, --help",
    }));
    return;
  }
  if (subcommand === "market") {
    console.log(renderHelp({
      tagline: "Browse the skill marketplace.",
      usage: "kweaver skill market [--name kw] [--source src] [--page N] [--page-size N|--limit N] [--all] [-bd value] [--pretty|--compact]",
      flags: [
        { name: "--name kw", desc: "Filter by name keyword." },
        { name: "--source src", desc: "Filter by source." },
        { name: "--page N", desc: "Page number." },
        { name: "--page-size N", desc: "Page size (alias: --limit)." },
        { name: "--all", desc: "Fetch all pages." },
        { name: "-bd value", desc: "Override base URL." },
        { name: "--pretty|--compact", desc: "Toggle pretty JSON output." },
      ],
      inheritedFlags: "--base-url, --token, --user, --help",
    }));
    return;
  }
  if (subcommand === "get") {
    console.log(renderHelp({
      tagline: "Show installed skill details.",
      usage: "kweaver skill get <skill-id> [-bd value] [--pretty|--compact]",
      inheritedFlags: "--base-url, --token, --user, --help",
    }));
    return;
  }
  if (subcommand === "market-get") {
    console.log(renderHelp({
      tagline: "Show marketplace skill details.",
      usage: "kweaver skill market-get <skill-id> [-bd value] [--pretty|--compact]",
      inheritedFlags: "--base-url, --token, --user, --help",
    }));
    return;
  }
  if (subcommand === "register") {
    console.log(renderHelp({
      tagline: "Register a new skill (multipart zip upload).",
      usage: "kweaver skill register (--content-file <path> | --zip-file <path>) [--source src] [--extend-info json] [-bd value] [--pretty|--compact]",
      flags: [
        { name: "--content-file <path>", desc: "SKILL.md file or skill directory containing SKILL.md (auto-bundled into a zip)." },
        { name: "--zip-file <path>", desc: "Pre-built .zip with SKILL.md at the archive root." },
        { name: "--source src", desc: "Source tag." },
        { name: "--extend-info json", desc: "Extra metadata as JSON object." },
        { name: "-bd value", desc: "Override base URL." },
        { name: "--pretty|--compact", desc: "Toggle pretty JSON output." },
      ],
      inheritedFlags: "--base-url, --token, --user, --help",
      learnMore: [
        "Both --content-file and --zip-file upload as multipart zip; the backend's",
        "file_type=content registration is unreliable (publish-then-read returns 404)",
        "so the CLI always goes through zip.",
      ],
    }));
    return;
  }
  if (subcommand === "set-status" || subcommand === "status") {
    console.log(renderHelp({
      tagline: "Set skill publish status.",
      usage: "kweaver skill set-status <skill-id> <unpublish|published|offline> [-bd value] [--pretty|--compact]",
      inheritedFlags: "--base-url, --token, --user, --help",
    }));
    return;
  }
  if (subcommand === "delete") {
    console.log(renderHelp({
      tagline: "Delete a skill.",
      usage: "kweaver skill delete <skill-id> [-y|--yes] [-bd value] [--pretty|--compact]",
      inheritedFlags: "--base-url, --token, --user, --help",
    }));
    return;
  }
  if (subcommand === "update-metadata") {
    console.log(renderHelp({
      tagline: "Update skill metadata fields.",
      usage: "kweaver skill update-metadata <skill-id> --name <name> --description <text> --category <other_category|system> [--source <custom|internal>] [--extend-info json] [-bd value] [--pretty|--compact]",
      flags: [
        { name: "--name <name>", desc: "Skill name." },
        { name: "--description <text>", desc: "Skill description." },
        { name: "--category <other_category|system>", desc: "Skill category." },
        { name: "--source <custom|internal>", desc: "Source tag." },
        { name: "--extend-info json", desc: "Extra metadata as JSON object." },
        { name: "-bd value", desc: "Override base URL." },
        { name: "--pretty|--compact", desc: "Toggle pretty JSON output." },
      ],
      inheritedFlags: "--base-url, --token, --user, --help",
    }));
    return;
  }
  if (subcommand === "update-package") {
    console.log(renderHelp({
      tagline: "Replace skill package contents.",
      usage: "kweaver skill update-package <skill-id> (--content-file <path> | --zip-file <path>) [-bd value] [--pretty|--compact]",
      flags: [
        { name: "--content-file <path>", desc: "SKILL.md file or skill directory (auto-bundled into a zip)." },
        { name: "--zip-file <path>", desc: "Pre-built .zip with SKILL.md at the archive root." },
        { name: "-bd value", desc: "Override base URL." },
        { name: "--pretty|--compact", desc: "Toggle pretty JSON output." },
      ],
      inheritedFlags: "--base-url, --token, --user, --help",
    }));
    return;
  }
  if (subcommand === "history") {
    console.log(renderHelp({
      tagline: "Show skill edit history.",
      usage: "kweaver skill history <skill-id> [-bd value] [--pretty|--compact]",
      inheritedFlags: "--base-url, --token, --user, --help",
    }));
    return;
  }
  if (subcommand === "republish") {
    console.log(renderHelp({
      tagline: "Republish a previous skill version.",
      usage: "kweaver skill republish <skill-id> --version <version> [-bd value] [--pretty|--compact]",
      inheritedFlags: "--base-url, --token, --user, --help",
    }));
    return;
  }
  if (subcommand === "publish-history") {
    console.log(renderHelp({
      tagline: "Show publish history for a version.",
      usage: "kweaver skill publish-history <skill-id> --version <version> [-bd value] [--pretty|--compact]",
      inheritedFlags: "--base-url, --token, --user, --help",
    }));
    return;
  }
  if (subcommand === "content") {
    console.log(renderHelp({
      tagline: "Fetch installed skill SKILL.md content.",
      usage: "kweaver skill content <skill-id> [--raw] [--output file] [-bd value] [--pretty|--compact]",
      inheritedFlags: "--base-url, --token, --user, --help",
    }));
    return;
  }
  if (subcommand === "read-file") {
    console.log(renderHelp({
      tagline: "Read a file from an installed skill.",
      usage: "kweaver skill read-file <skill-id> <rel-path> [--raw] [--output file] [-bd value] [--pretty|--compact]",
      inheritedFlags: "--base-url, --token, --user, --help",
    }));
    return;
  }
  if (subcommand === "download") {
    console.log(renderHelp({
      tagline: "Download an installed skill package.",
      usage: "kweaver skill download <skill-id> [--output file] [-bd value] [--pretty|--compact]",
      inheritedFlags: "--base-url, --token, --user, --help",
    }));
    return;
  }
  if (subcommand === "install") {
    console.log(renderHelp({
      tagline: "Install a skill locally.",
      usage: "kweaver skill install <skill-id> [directory] [--force] [-bd value] [--pretty|--compact]",
      inheritedFlags: "--base-url, --token, --user, --help",
    }));
    return;
  }
  if (subcommand === "management-content") {
    console.log(renderHelp({
      tagline: "Fetch management-side skill SKILL.md content.",
      usage: "kweaver skill management-content <skill-id> [--raw] [--response-mode url|content] [--output file] [-bd value] [--pretty|--compact]",
      inheritedFlags: "--base-url, --token, --user, --help",
    }));
    return;
  }
  if (subcommand === "management-read-file") {
    console.log(renderHelp({
      tagline: "Read a file via management API.",
      usage: "kweaver skill management-read-file <skill-id> <rel-path> [--response-mode url|content] [--output file] [-bd value] [--pretty|--compact]",
      inheritedFlags: "--base-url, --token, --user, --help",
    }));
    return;
  }
  if (subcommand === "management-download") {
    console.log(renderHelp({
      tagline: "Download a skill via management API.",
      usage: "kweaver skill management-download <skill-id> [--response-mode url|content] [--output file] [-bd value] [--pretty|--compact]",
      inheritedFlags: "--base-url, --token, --user, --help",
    }));
    return;
  }
  console.log(SKILL_HELP);
}

function format(value: unknown, pretty: boolean): string {
  return JSON.stringify(value, null, pretty ? 2 : 0);
}

function parseJsonFlag(value: string | undefined, flag: string): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`${flag} must be a JSON object`);
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      error instanceof Error && error.message.includes("must be a JSON object")
        ? error.message
        : `Invalid JSON for ${flag}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function ensureDirectoryForFile(path: string): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
}

function parseBaseArgs(args: string[], start = 0): { opts: BaseOptions; args: string[] } {
  let businessDomain = "";
  let pretty = true;
  const normalized = args.slice(0, start);

  for (let i = start; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "-bd" || arg === "--biz-domain") {
      businessDomain = args[i + 1] ?? "";
      if (!businessDomain || businessDomain.startsWith("-")) {
        throw new Error("Missing value for biz-domain flag");
      }
      i += 1;
      continue;
    }
    if (arg === "--pretty") continue;
    if (arg === "--compact") {
      pretty = false;
      continue;
    }
    normalized.push(arg);
  }

  return {
    opts: { businessDomain: businessDomain || resolveBusinessDomain(), pretty },
    args: normalized,
  };
}

export function parseSkillListArgs(args: string[]): ListOptions {
  let page = 1;
  let pageSize = 30;
  let all = false;
  let name: string | undefined;
  let source: string | undefined;
  let status: SkillStatus | undefined;
  let createUser: string | undefined;
  let sortBy: "create_time" | "update_time" | "name" | undefined;
  let sortOrder: "asc" | "desc" | undefined;

  const base = parseBaseArgs(args);
  for (let i = 0; i < base.args.length; i += 1) {
    const arg = base.args[i];
    if (arg === "--help" || arg === "-h") throw new Error("help");
    if (arg === "--page") {
      page = parseInt(base.args[i + 1] ?? "1", 10) || 1;
      i += 1;
      continue;
    }
    if (arg === "--page-size" || arg === "--limit") {
      pageSize = parseInt(base.args[i + 1] ?? "30", 10) || 30;
      i += 1;
      continue;
    }
    if (arg === "--all") {
      all = true;
      continue;
    }
    if (arg === "--name") {
      name = base.args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--source") {
      source = base.args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--status") {
      const value = base.args[i + 1] as SkillStatus | undefined;
      if (value !== "unpublish" && value !== "published" && value !== "offline") {
        throw new Error("Invalid --status. Expected unpublish|published|offline");
      }
      status = value;
      i += 1;
      continue;
    }
    if (arg === "--create-user") {
      createUser = base.args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--sort-by") {
      const value = base.args[i + 1];
      if (value !== "create_time" && value !== "update_time" && value !== "name") {
        throw new Error("Invalid --sort-by. Expected create_time|update_time|name");
      }
      sortBy = value;
      i += 1;
      continue;
    }
    if (arg === "--sort-order") {
      const value = (base.args[i + 1] ?? "").toLowerCase();
      if (value !== "asc" && value !== "desc") {
        throw new Error("Invalid --sort-order. Expected asc|desc");
      }
      sortOrder = value;
      i += 1;
      continue;
    }
    throw new Error(`Unsupported skill list argument: ${arg}`);
  }

  return { ...base.opts, page, pageSize, all, name, source, status, createUser, sortBy, sortOrder };
}

export function parseSkillRegisterArgs(args: string[]): RegisterOptions {
  let contentFile: string | undefined;
  let zipFile: string | undefined;
  let source: string | undefined;
  let extendInfo: Record<string, unknown> | undefined;

  const base = parseBaseArgs(args);
  for (let i = 0; i < base.args.length; i += 1) {
    const arg = base.args[i];
    if (arg === "--help" || arg === "-h") throw new Error("help");
    if (arg === "--content-file") {
      contentFile = base.args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--zip-file") {
      zipFile = base.args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--source") {
      source = base.args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--extend-info") {
      extendInfo = parseJsonFlag(base.args[i + 1], "--extend-info");
      i += 1;
      continue;
    }
    throw new Error(`Unsupported skill register argument: ${arg}`);
  }
  if ((contentFile ? 1 : 0) + (zipFile ? 1 : 0) !== 1) {
    throw new Error("Use exactly one of --content-file or --zip-file");
  }
  return { ...base.opts, contentFile, zipFile, source, extendInfo };
}

function parseSkillContentArgs(args: string[]): ContentOptions {
  const skillId = args[0];
  if (!skillId || skillId.startsWith("-")) {
    throw new Error("Missing skill-id");
  }
  let fetchRaw = false;
  let output: string | undefined;
  const base = parseBaseArgs(args, 1);
  for (let i = 1; i < base.args.length; i += 1) {
    const arg = base.args[i];
    if (arg === "--help" || arg === "-h") throw new Error("help");
    if (arg === "--raw") {
      fetchRaw = true;
      continue;
    }
    if (arg === "--output" || arg === "-o") {
      output = base.args[i + 1];
      i += 1;
      continue;
    }
    throw new Error(`Unsupported skill content argument: ${arg}`);
  }
  return { ...base.opts, skillId, fetchRaw, output };
}

function parseSkillGetArgs(args: string[]): BaseOptions & { skillId: string } {
  const skillId = args[0];
  if (!skillId || skillId.startsWith("-")) {
    throw new Error("Missing skill-id");
  }
  const base = parseBaseArgs(args, 1);
  if (base.args.length !== 1) {
    throw new Error(`Unsupported skill get argument: ${base.args[1]}`);
  }
  return { ...base.opts, skillId };
}

export function parseSkillUpdateMetadataArgs(args: string[]): UpdateMetadataOptions {
  const skillId = args[0];
  if (!skillId || skillId.startsWith("-")) throw new Error("Missing skill-id");
  let name: string | undefined;
  let description: string | undefined;
  let category: SkillCategory | undefined;
  let source: string | undefined;
  let extendInfo: Record<string, unknown> | undefined;
  const base = parseBaseArgs(args, 1);
  for (let i = 1; i < base.args.length; i += 1) {
    const arg = base.args[i];
    if (arg === "--help" || arg === "-h") throw new Error("help");
    if (arg === "--name") {
      name = base.args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--description") {
      description = base.args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--category") {
      const value = base.args[i + 1];
      if (value !== "other_category" && value !== "system") {
        throw new Error("Invalid --category. Expected other_category|system");
      }
      category = value;
      i += 1;
      continue;
    }
    if (arg === "--source") {
      source = base.args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--extend-info") {
      extendInfo = parseJsonFlag(base.args[i + 1], "--extend-info");
      i += 1;
      continue;
    }
    throw new Error(`Unsupported skill update-metadata argument: ${arg}`);
  }
  if (!name) throw new Error("Missing --name");
  if (!description) throw new Error("Missing --description");
  if (!category) throw new Error("Missing --category");
  return { ...base.opts, skillId, name, description, category, source, extendInfo };
}

export function parseSkillUpdatePackageArgs(args: string[]): UpdatePackageOptions {
  const skillId = args[0];
  if (!skillId || skillId.startsWith("-")) throw new Error("Missing skill-id");
  let contentFile: string | undefined;
  let zipFile: string | undefined;
  const base = parseBaseArgs(args, 1);
  for (let i = 1; i < base.args.length; i += 1) {
    const arg = base.args[i];
    if (arg === "--help" || arg === "-h") throw new Error("help");
    if (arg === "--content-file") {
      contentFile = base.args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--zip-file") {
      zipFile = base.args[i + 1];
      i += 1;
      continue;
    }
    throw new Error(`Unsupported skill update-package argument: ${arg}`);
  }
  if ((contentFile ? 1 : 0) + (zipFile ? 1 : 0) !== 1) {
    throw new Error("Use exactly one of --content-file or --zip-file");
  }
  return { ...base.opts, skillId, contentFile, zipFile };
}

export function parseSkillHistoryVersionArgs(args: string[], commandName: string): HistoryVersionOptions {
  const skillId = args[0];
  if (!skillId || skillId.startsWith("-")) throw new Error("Missing skill-id");
  let version: string | undefined;
  const base = parseBaseArgs(args, 1);
  for (let i = 1; i < base.args.length; i += 1) {
    const arg = base.args[i];
    if (arg === "--help" || arg === "-h") throw new Error("help");
    if (arg === "--version") {
      version = base.args[i + 1];
      i += 1;
      continue;
    }
    throw new Error(`Unsupported skill ${commandName} argument: ${arg}`);
  }
  if (!version) throw new Error("Missing --version");
  return { ...base.opts, skillId, version };
}

function parseSkillReadFileArgs(args: string[]): ReadFileOptions {
  const skillId = args[0];
  const relPath = args[1];
  if (!skillId || skillId.startsWith("-")) throw new Error("Missing skill-id");
  if (!relPath || relPath.startsWith("-")) throw new Error("Missing rel-path");
  const parsed = parseSkillContentArgs([skillId, ...args.slice(2)]);
  return { ...parsed, relPath };
}

function parseSkillDownloadArgs(args: string[]): DownloadOptions {
  const skillId = args[0];
  if (!skillId || skillId.startsWith("-")) throw new Error("Missing skill-id");
  let output: string | undefined;
  const base = parseBaseArgs(args, 1);
  for (let i = 1; i < base.args.length; i += 1) {
    const arg = base.args[i];
    if (arg === "--help" || arg === "-h") throw new Error("help");
    if (arg === "--output" || arg === "-o") {
      output = base.args[i + 1];
      i += 1;
      continue;
    }
    throw new Error(`Unsupported skill download argument: ${arg}`);
  }
  return { ...base.opts, skillId, output };
}

function parseSkillInstallArgs(args: string[]): InstallOptions {
  const skillId = args[0];
  const directory = args[1] && !args[1].startsWith("-") ? args[1] : skillId;
  if (!skillId || skillId.startsWith("-")) throw new Error("Missing skill-id");
  let force = false;
  const start = directory === skillId ? 1 : 2;
  const base = parseBaseArgs(args, start);
  for (let i = start; i < base.args.length; i += 1) {
    const arg = base.args[i];
    if (arg === "--help" || arg === "-h") throw new Error("help");
    if (arg === "--force") {
      force = true;
      continue;
    }
    throw new Error(`Unsupported skill install argument: ${arg}`);
  }
  return { ...base.opts, skillId, directory, force };
}

function parseManagementContentArgs(args: string[]): ManagementContentOptions {
  const skillId = args[0];
  if (!skillId || skillId.startsWith("-")) throw new Error("Missing skill-id");
  let responseMode: "url" | "content" | undefined;
  let fetchRaw = false;
  let output: string | undefined;
  const base = parseBaseArgs(args, 1);
  for (let i = 1; i < base.args.length; i += 1) {
    const arg = base.args[i];
    if (arg === "--help" || arg === "-h") throw new Error("help");
    if (arg === "--raw") {
      fetchRaw = true;
      continue;
    }
    if (arg === "--response-mode") {
      const value = base.args[i + 1];
      if (value !== "url" && value !== "content") {
        throw new Error("Invalid --response-mode. Expected url|content");
      }
      responseMode = value;
      i += 1;
      continue;
    }
    if (arg === "--output" || arg === "-o") {
      output = base.args[i + 1];
      i += 1;
      continue;
    }
    throw new Error(`Unsupported skill management-content argument: ${arg}`);
  }
  return { ...base.opts, skillId, responseMode, fetchRaw, output };
}

function parseManagementReadFileArgs(args: string[]): ManagementReadFileOptions {
  const skillId = args[0];
  const relPath = args[1];
  if (!skillId || skillId.startsWith("-")) throw new Error("Missing skill-id");
  if (!relPath || relPath.startsWith("-")) throw new Error("Missing rel-path");
  let responseMode: "url" | "content" | undefined;
  let output: string | undefined;
  const base = parseBaseArgs(args, 2);
  for (let i = 2; i < base.args.length; i += 1) {
    const arg = base.args[i];
    if (arg === "--help" || arg === "-h") throw new Error("help");
    if (arg === "--response-mode") {
      const value = base.args[i + 1];
      if (value !== "url" && value !== "content") {
        throw new Error("Invalid --response-mode. Expected url|content");
      }
      responseMode = value;
      i += 1;
      continue;
    }
    if (arg === "--output" || arg === "-o") {
      output = base.args[i + 1];
      i += 1;
      continue;
    }
    throw new Error(`Unsupported skill management-read-file argument: ${arg}`);
  }
  return { ...base.opts, skillId, relPath, responseMode, output };
}

function parseManagementDownloadArgs(args: string[]): ManagementDownloadOptions {
  const skillId = args[0];
  if (!skillId || skillId.startsWith("-")) throw new Error("Missing skill-id");
  let responseMode: "url" | "content" | undefined;
  let output: string | undefined;
  const base = parseBaseArgs(args, 1);
  for (let i = 1; i < base.args.length; i += 1) {
    const arg = base.args[i];
    if (arg === "--help" || arg === "-h") throw new Error("help");
    if (arg === "--response-mode") {
      const value = base.args[i + 1];
      if (value !== "url" && value !== "content") {
        throw new Error("Invalid --response-mode. Expected url|content");
      }
      responseMode = value;
      i += 1;
      continue;
    }
    if (arg === "--output" || arg === "-o") {
      output = base.args[i + 1];
      i += 1;
      continue;
    }
    throw new Error(`Unsupported skill management-download argument: ${arg}`);
  }
  return { ...base.opts, skillId, responseMode, output };
}

function parseStatusArgs(args: string[]): { skillId: string; status: SkillStatus } & BaseOptions {
  const skillId = args[0];
  const status = args[1] as SkillStatus | undefined;
  if (!skillId || skillId.startsWith("-")) throw new Error("Missing skill-id");
  if (status !== "unpublish" && status !== "published" && status !== "offline") {
    throw new Error("Missing or invalid status. Use unpublish|published|offline");
  }
  const base = parseBaseArgs(args, 2);
  if (base.args.length !== 2) {
    throw new Error(`Unsupported skill status argument: ${base.args[2]}`);
  }
  return { ...base.opts, skillId, status };
}

async function confirmDelete(skillId: string): Promise<boolean> {
  process.stdout.write(`Delete skill ${skillId}? [y/N] `);
  return new Promise((resolveConfirm) => {
    process.stdin.once("data", (chunk) => {
      const answer = chunk.toString().trim().toLowerCase();
      resolveConfirm(answer === "y" || answer === "yes");
    });
  });
}

export async function runSkillCommand(args: string[]): Promise<number> {
  const [subcommand, ...rest] = args;

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    printSkillHelp();
    return 0;
  }

  if (rest.includes("--help") || rest.includes("-h")) {
    printSkillHelp(subcommand);
    return 0;
  }

  try {
    return await with401RefreshRetry(async () => {
      const token = await ensureValidToken();
      if (subcommand === "list") {
        const opts = parseSkillListArgs(rest);
        const result = await listSkills({
          ...token,
          businessDomain: opts.businessDomain,
          page: opts.page,
          pageSize: opts.pageSize,
          all: opts.all,
          name: opts.name,
          source: opts.source,
          status: opts.status,
          createUser: opts.createUser,
          sortBy: opts.sortBy,
          sortOrder: opts.sortOrder,
        });
        console.log(format(result, opts.pretty));
        return 0;
      }
      if (subcommand === "market") {
        const opts = parseSkillListArgs(rest);
        const result = await listSkillMarket({
          ...token,
          businessDomain: opts.businessDomain,
          page: opts.page,
          pageSize: opts.pageSize,
          all: opts.all,
          name: opts.name,
          source: opts.source,
          sortBy: opts.sortBy,
          sortOrder: opts.sortOrder,
        });
        console.log(format(result, opts.pretty));
        return 0;
      }
      if (subcommand === "get") {
        const opts = parseSkillGetArgs(rest);
        const result = await getSkill({ ...token, businessDomain: opts.businessDomain, skillId: opts.skillId });
        console.log(format(result, opts.pretty));
        return 0;
      }
      if (subcommand === "market-get") {
        const opts = parseSkillGetArgs(rest);
        const result = await getSkillMarketDetail({
          ...token,
          businessDomain: opts.businessDomain,
          skillId: opts.skillId,
        });
        console.log(format(result, opts.pretty));
        return 0;
      }
      if (subcommand === "register") {
        const opts = parseSkillRegisterArgs(rest);
        if (opts.contentFile) {
          // Always bundle into zip — the backend's file_type=content path
          // doesn't write skill_file_index, so SKILL.md is unreachable
          // after publish via /skills/:id/content. Going through zip
          // (single SKILL.md or full directory) is the only path that
          // produces a readable skill end-to-end.
          const abs = resolve(opts.contentFile);
          const stat = statSync(abs);
          const bytes = stat.isDirectory()
            ? await bundleSkillDirectoryToZip(abs)
            : await bundleSkillFileToZip(abs);
          const result = await registerSkillZip({
            ...token,
            businessDomain: opts.businessDomain,
            source: opts.source,
            extendInfo: opts.extendInfo,
            filename: `${basename(abs).replace(/\.zip$/i, "")}.zip`,
            bytes,
          });
          console.log(format(result, opts.pretty));
          return 0;
        }
        if (opts.zipFile) {
          const bytes = new Uint8Array(readFileSync(resolve(opts.zipFile)));
          const result = await registerSkillZip({
            ...token,
            businessDomain: opts.businessDomain,
            source: opts.source,
            extendInfo: opts.extendInfo,
            filename: basename(resolve(opts.zipFile)),
            bytes,
          });
          console.log(format(result, opts.pretty));
          return 0;
        }
      }
      if (subcommand === "set-status" || subcommand === "status") {
        const opts = parseStatusArgs(rest);
        const result = await updateSkillStatus({ ...token, ...opts });
        console.log(format(result, opts.pretty));
        return 0;
      }
      if (subcommand === "delete") {
        const skillId = rest[0];
        if (!skillId || skillId.startsWith("-")) throw new Error("Missing skill-id");
        const yes = rest.includes("-y") || rest.includes("--yes");
        const filtered = [skillId, ...rest.slice(1).filter((arg) => arg !== "-y" && arg !== "--yes")];
        const opts = parseSkillGetArgs(filtered);
        if (!yes) {
          const confirmed = await confirmDelete(skillId);
          if (!confirmed) {
            console.error("Delete aborted.");
            return 1;
          }
        }
        const result = await deleteSkill({ ...token, businessDomain: opts.businessDomain, skillId });
        console.log(format(result, opts.pretty));
        return 0;
      }
      if (subcommand === "update-metadata") {
        const opts = parseSkillUpdateMetadataArgs(rest);
        const result = await updateSkillMetadata({
          ...token,
          businessDomain: opts.businessDomain,
          skillId: opts.skillId,
          name: opts.name,
          description: opts.description,
          category: opts.category,
          source: opts.source,
          extendInfo: opts.extendInfo,
        });
        console.log(format(result, opts.pretty));
        return 0;
      }
      if (subcommand === "update-package") {
        const opts = parseSkillUpdatePackageArgs(rest);
        if (opts.contentFile) {
          const content = readFileSync(resolve(opts.contentFile), "utf8");
          const result = await updateSkillPackageContent({
            ...token,
            businessDomain: opts.businessDomain,
            skillId: opts.skillId,
            content,
          });
          console.log(format(result, opts.pretty));
          return 0;
        }
        if (opts.zipFile) {
          const bytes = new Uint8Array(readFileSync(resolve(opts.zipFile)));
          const result = await updateSkillPackageZip({
            ...token,
            businessDomain: opts.businessDomain,
            skillId: opts.skillId,
            filename: basename(resolve(opts.zipFile)),
            bytes,
          });
          console.log(format(result, opts.pretty));
          return 0;
        }
      }
      if (subcommand === "history") {
        const opts = parseSkillGetArgs(rest);
        const result = await listSkillHistory({
          ...token,
          businessDomain: opts.businessDomain,
          skillId: opts.skillId,
        });
        console.log(format(result, opts.pretty));
        return 0;
      }
      if (subcommand === "republish") {
        const opts = parseSkillHistoryVersionArgs(rest, "republish");
        const result = await republishSkillHistory({
          ...token,
          businessDomain: opts.businessDomain,
          skillId: opts.skillId,
          version: opts.version,
        });
        console.log(format(result, opts.pretty));
        return 0;
      }
      if (subcommand === "publish-history") {
        const opts = parseSkillHistoryVersionArgs(rest, "publish-history");
        const result = await publishSkillHistory({
          ...token,
          businessDomain: opts.businessDomain,
          skillId: opts.skillId,
          version: opts.version,
        });
        console.log(format(result, opts.pretty));
        return 0;
      }
      if (subcommand === "content") {
        const opts = parseSkillContentArgs(rest);
        if (opts.fetchRaw || opts.output) {
          const content = await fetchSkillContent({
            ...token,
            businessDomain: opts.businessDomain,
            skillId: opts.skillId,
          });
          if (opts.output) {
            ensureDirectoryForFile(resolve(opts.output));
            writeFileSync(resolve(opts.output), content, "utf8");
            console.log(`Saved ${opts.skillId} content to ${resolve(opts.output)}`);
          } else {
            process.stdout.write(content);
            if (!content.endsWith("\n")) process.stdout.write("\n");
          }
          return 0;
        }
        const result = await getSkillContentIndex({
          ...token,
          businessDomain: opts.businessDomain,
          skillId: opts.skillId,
        });
        console.log(format(result, opts.pretty));
        return 0;
      }
      if (subcommand === "read-file") {
        const opts = parseSkillReadFileArgs(rest);
        if (opts.fetchRaw || opts.output) {
          const bytes = await fetchSkillFile({ ...token, skillId: opts.skillId, relPath: opts.relPath, businessDomain: opts.businessDomain });
          if (opts.output) {
            ensureDirectoryForFile(resolve(opts.output));
            writeFileSync(resolve(opts.output), bytes);
            console.log(`Saved ${opts.relPath} to ${resolve(opts.output)}`);
          } else {
            process.stdout.write(Buffer.from(bytes));
          }
          return 0;
        }
        const result = await readSkillFile({ ...token, skillId: opts.skillId, relPath: opts.relPath, businessDomain: opts.businessDomain });
        console.log(format(result, opts.pretty));
        return 0;
      }
      if (subcommand === "download") {
        const opts = parseSkillDownloadArgs(rest);
        const result = await downloadSkill({
          ...token,
          businessDomain: opts.businessDomain,
          skillId: opts.skillId,
        });
        const output = resolve(opts.output ?? result.fileName);
        ensureDirectoryForFile(output);
        writeFileSync(output, result.bytes);
        console.log(`Saved ${opts.skillId} archive to ${output}`);
        return 0;
      }
      if (subcommand === "install") {
        const opts = parseSkillInstallArgs(rest);
        const archive = await downloadSkill({
          ...token,
          businessDomain: opts.businessDomain,
          skillId: opts.skillId,
        });
        const result = installSkillArchive({ bytes: archive.bytes, directory: opts.directory, force: opts.force });
        console.log(`Installed ${opts.skillId} to ${result.directory}`);
        return 0;
      }
      if (subcommand === "management-content") {
        const opts = parseManagementContentArgs(rest);
        if (opts.fetchRaw || opts.responseMode === "content" || opts.output) {
          const result = await getSkillManagementContent({
            ...token,
            businessDomain: opts.businessDomain,
            skillId: opts.skillId,
            responseMode: opts.responseMode,
          });
          if (opts.output && result.content) {
            ensureDirectoryForFile(resolve(opts.output));
            writeFileSync(resolve(opts.output), result.content, "utf8");
            console.log(`Saved ${opts.skillId} management content to ${resolve(opts.output)}`);
          } else if (opts.fetchRaw && result.content) {
            process.stdout.write(result.content);
            if (!result.content.endsWith("\n")) process.stdout.write("\n");
          } else {
            console.log(format(result, opts.pretty));
          }
          return 0;
        }
        const result = await getSkillManagementContent({
          ...token,
          businessDomain: opts.businessDomain,
          skillId: opts.skillId,
          responseMode: opts.responseMode,
        });
        console.log(format(result, opts.pretty));
        return 0;
      }
      if (subcommand === "management-read-file") {
        const opts = parseManagementReadFileArgs(rest);
        const result = await readSkillManagementFile({
          ...token,
          businessDomain: opts.businessDomain,
          skillId: opts.skillId,
          relPath: opts.relPath,
        });
        console.log(format(result, opts.pretty));
        return 0;
      }
      if (subcommand === "management-download") {
        const opts = parseManagementDownloadArgs(rest);
        const result = await downloadSkillManagementArchive({
          ...token,
          businessDomain: opts.businessDomain,
          skillId: opts.skillId,
          responseMode: opts.responseMode,
        });
        const output = resolve(opts.output ?? result.fileName);
        ensureDirectoryForFile(output);
        writeFileSync(output, result.bytes);
        console.log(`Saved ${opts.skillId} management archive to ${output}`);
        return 0;
      }

      console.error(`Unknown skill subcommand: ${subcommand}`);
      return 1;
    });
  } catch (error) {
    console.error(formatHttpError(error));
    return 1;
  }
}
