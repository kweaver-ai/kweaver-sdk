import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { ensureValidToken, formatHttpError, with401RefreshRetry } from "../auth/oauth.js";
import { resolveBusinessDomain } from "../config/store.js";
import {
  deleteSkill,
  downloadSkill,
  fetchSkillContent,
  fetchSkillFile,
  getSkill,
  getSkillContentIndex,
  installSkillArchive,
  listSkillMarket,
  listSkills,
  readSkillFile,
  registerSkillContent,
  registerSkillZip,
  updateSkillStatus,
  type SkillStatus,
} from "../api/skills.js";
import { bundleSkillDirectoryToZip } from "../utils/skill-bundle.js";

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

function printSkillHelp(subcommand?: string): void {
  if (subcommand === "list") {
    console.log(`kweaver skill list [--name kw] [--source src] [--status status] [--create-user user]
                   [--page N] [--page-size N|--limit N] [--all] [-bd value] [--pretty|--compact]`);
    return;
  }
  if (subcommand === "market") {
    console.log(`kweaver skill market [--name kw] [--source src] [--page N] [--page-size N|--limit N]
                     [--all] [-bd value] [--pretty|--compact]`);
    return;
  }
  if (subcommand === "get") {
    console.log("kweaver skill get <skill-id> [-bd value] [--pretty|--compact]");
    return;
  }
  if (subcommand === "register") {
    console.log(`kweaver skill register (--content-file <path> | --zip-file <path>)
                       [--source src] [--extend-info json] [-bd value] [--pretty|--compact]

  --content-file accepts either:
    - a single SKILL.md file (registered as bare content, no assets)
    - a skill directory containing SKILL.md (bundled into a zip and uploaded)
  --zip-file accepts a pre-built .zip with SKILL.md at the archive root.`);
    return;
  }
  if (subcommand === "set-status" || subcommand === "status") {
    console.log("kweaver skill set-status <skill-id> <unpublish|published|offline> [-bd value] [--pretty|--compact]");
    return;
  }
  if (subcommand === "delete") {
    console.log("kweaver skill delete <skill-id> [-y|--yes] [-bd value] [--pretty|--compact]");
    return;
  }
  if (subcommand === "content") {
    console.log("kweaver skill content <skill-id> [--raw] [--output file] [-bd value] [--pretty|--compact]");
    return;
  }
  if (subcommand === "read-file") {
    console.log("kweaver skill read-file <skill-id> <rel-path> [--raw] [--output file] [-bd value] [--pretty|--compact]");
    return;
  }
  if (subcommand === "download") {
    console.log("kweaver skill download <skill-id> [--output file] [-bd value] [--pretty|--compact]");
    return;
  }
  if (subcommand === "install") {
    console.log("kweaver skill install <skill-id> [directory] [--force] [-bd value] [--pretty|--compact]");
    return;
  }
  console.log(`kweaver skill

Subcommands:
  list [--name kw] [--status status] [--page N] [--page-size N] [-bd value]
  market [--name kw] [--source src] [--page N] [--page-size N] [-bd value]
  get <skill-id> [-bd value]
  register --content-file <path> | --zip-file <path> [--source src] [--extend-info json]
           (--content-file accepts SKILL.md or a directory; directory is auto-bundled)
  set-status <skill-id> <unpublish|published|offline> [-bd value]
  delete <skill-id> [-y] [-bd value]
  content <skill-id> [--raw] [--output file] [-bd value]
  read-file <skill-id> <rel-path> [--raw] [--output file] [-bd value]
  download <skill-id> [--output file] [-bd value]
  install <skill-id> [directory] [--force] [-bd value]

Examples:
  kweaver skill list --name kweaver
  kweaver skill register --zip-file ./demo-skill.zip --source upload_zip
  kweaver skill content skill-123 --raw
  kweaver skill read-file skill-123 references/guide.md --output ./guide.md
  kweaver skill install skill-123 ./skills/demo-skill --force`);
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
      if (subcommand === "register") {
        const opts = parseSkillRegisterArgs(rest);
        if (opts.contentFile) {
          const abs = resolve(opts.contentFile);
          const stat = statSync(abs);
          if (stat.isDirectory()) {
            // Server requires SKILL.md plus optional assets in a single zip.
            // Bundle in memory so users don't need a system `zip` binary.
            const bytes = await bundleSkillDirectoryToZip(abs);
            const result = await registerSkillZip({
              ...token,
              businessDomain: opts.businessDomain,
              source: opts.source,
              extendInfo: opts.extendInfo,
              filename: `${basename(abs)}.zip`,
              bytes,
            });
            console.log(format(result, opts.pretty));
            return 0;
          }
          const content = readFileSync(abs, "utf8");
          const result = await registerSkillContent({
            ...token,
            businessDomain: opts.businessDomain,
            content,
            source: opts.source,
            extendInfo: opts.extendInfo,
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

      console.error(`Unknown skill subcommand: ${subcommand}`);
      return 1;
    });
  } catch (error) {
    console.error(formatHttpError(error));
    return 1;
  }
}
