import { createInterface } from "node:readline";
import { readFileSync, writeFileSync } from "node:fs";
import { ensureValidToken, formatHttpError, with401RefreshRetry } from "../auth/oauth.js";
import { resolveBusinessDomain } from "../config/store.js";
import { formatCallOutput } from "./call.js";
import {
  buildConfigFromPrompt,
  cleanupAgents,
  createAgents,
  fetchOrchestratorConfig,
  generateConfig,
  getTemplates,
  listSubAgentIds,
  validateComposerConfig,
  type ComposerConfig,
  type TokenProvider,
} from "./composer-engine.js";

const HELP = `kweaver composer

Create orchestrator agents from natural-language prompts, templates, or config files.
Composers are plain agents on the platform — run them with \`kweaver agent chat <orchestrator-id>\`.

Subcommands:
  create --prompt "<text>"                       Generate flow from natural language
         --template <id>                         Instantiate a built-in template
         --config <file.json>                    Create from a ComposerConfig JSON file
         [--save-to <file>]                      Also write the JSON result to <file>

  get <orchestrator-id>                          Fetch stored orchestrator config
  delete <orchestrator-id> [-y|--yes]            Delete orchestrator (only)
         [--cascade]                             Also delete sub-agents referenced in skills.agents

  template list                                  List built-in templates
  template get <template-id>                     Show a built-in template's ComposerConfig

Options:
  -bd, --biz-domain <s>   Business domain (default: resolved from config)
  --pretty                Pretty-print JSON (default)
  --compact               Single-line JSON (pipeline-friendly)

Keeping a composer:
  The orchestrator is persisted on the platform. "Saving" means keeping the
  orchestrator id. For day-to-day use:
    kweaver composer create --prompt "..." > pipeline.json
    ID=$(jq -r .orchestrator_id pipeline.json)
    kweaver agent chat $ID -m "..."
    kweaver agent update $ID --name "..."        # rename
    kweaver agent publish $ID                    # share with the team
    kweaver composer delete $ID --cascade -y     # retire
`;

export async function runComposerCommand(args: string[]): Promise<number> {
  const [subcommand, ...rest] = args;
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    console.log(HELP);
    return 0;
  }

  const dispatch = (): Promise<number> => {
    if (subcommand === "create") return runCreate(rest);
    if (subcommand === "get") return runGet(rest);
    if (subcommand === "delete") return runDelete(rest);
    if (subcommand === "template") return runTemplate(rest);
    return Promise.resolve(-1);
  };

  try {
    return await with401RefreshRetry(async () => {
      const code = await dispatch();
      if (code === -1) {
        console.error(`Unknown composer subcommand: ${subcommand}`);
        return 1;
      }
      return code;
    });
  } catch (error) {
    console.error(formatHttpError(error));
    return 1;
  }
}

// ── create ────────────────────────────────────────────────────────────────────

export type ComposerCreateSource =
  | { kind: "prompt"; prompt: string }
  | { kind: "template"; templateId: string }
  | { kind: "config"; configPath: string };

export interface ComposerCreateOptions {
  source: ComposerCreateSource;
  businessDomain: string;
  pretty: boolean;
  saveTo?: string;
}

export function parseComposerCreateArgs(args: string[]): ComposerCreateOptions {
  let prompt: string | undefined;
  let templateId: string | undefined;
  let configPath: string | undefined;
  let saveTo: string | undefined;
  let businessDomain = "";
  let pretty = true;

  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--prompt" && args[i + 1] !== undefined) { prompt = args[++i]; continue; }
    if (a === "--template" && args[i + 1] !== undefined) { templateId = args[++i]; continue; }
    if (a === "--config" && args[i + 1] !== undefined) { configPath = args[++i]; continue; }
    if (a === "--save-to" && args[i + 1] !== undefined) { saveTo = args[++i]; continue; }
    if ((a === "-bd" || a === "--biz-domain") && args[i + 1] !== undefined) { businessDomain = args[++i]; continue; }
    if (a === "--pretty") { pretty = true; continue; }
    if (a === "--compact") { pretty = false; continue; }
  }

  const provided = [prompt, templateId, configPath].filter((v) => v !== undefined).length;
  if (provided === 0) {
    throw new Error("Missing required flag: one of --prompt, --template, --config");
  }
  if (provided > 1) {
    throw new Error("--prompt, --template, --config are mutually exclusive");
  }

  let source: ComposerCreateSource;
  if (prompt !== undefined) source = { kind: "prompt", prompt };
  else if (templateId !== undefined) {
    const known = new Set(getTemplates().map((t) => t.id));
    if (!known.has(templateId)) {
      throw new Error(`Unknown template: "${templateId}". Run \`kweaver composer template list\` to see available templates.`);
    }
    source = { kind: "template", templateId };
  } else source = { kind: "config", configPath: configPath! };

  if (!businessDomain) businessDomain = resolveBusinessDomain();
  return { source, businessDomain, pretty, saveTo };
}

async function runCreate(args: string[]): Promise<number> {
  let opts: ComposerCreateOptions;
  try { opts = parseComposerCreateArgs(args); }
  catch (e) { console.error(e instanceof Error ? e.message : String(e)); return 1; }

  const getToken: TokenProvider = () => ensureValidToken();

  // Resolve ComposerConfig based on source
  let config: ComposerConfig;
  if (opts.source.kind === "prompt") {
    config = await generateConfig(opts.source.prompt, getToken, opts.businessDomain);
  } else if (opts.source.kind === "template") {
    const templateId = opts.source.templateId;
    const template = getTemplates().find((t) => t.id === templateId);
    // (defensive — parse already validated)
    if (!template) { console.error(`Template not found: ${templateId}`); return 1; }
    config = JSON.parse(JSON.stringify(template.config)) as ComposerConfig;
  } else {
    let raw: string;
    try { raw = readFileSync(opts.source.configPath, "utf8"); }
    catch (e) { console.error(`Cannot read config file: ${e instanceof Error ? e.message : e}`); return 1; }
    let parsed: unknown;
    try { parsed = JSON.parse(raw); }
    catch (e) { console.error(`Config file is not valid JSON: ${e instanceof Error ? e.message : e}`); return 1; }
    if (!validateComposerConfig(parsed)) {
      console.error("Config file is not a valid ComposerConfig (see kweaver composer template get <id> for the schema).");
      return 1;
    }
    config = parsed;
  }

  // Create agents + orchestrator on the platform
  const result = await createAgents(config, getToken, opts.businessDomain);

  const subAgentIds = Object.values(result.agentIds);
  const output = {
    orchestrator_id: result.orchestratorId,
    sub_agent_ids: subAgentIds,
    config: {
      name: config.name,
      description: config.description,
      agents: config.agents.map((a) => ({ ref: a.ref, name: a.name })),
    },
  };
  const rendered = formatCallOutput(JSON.stringify(output), opts.pretty);

  if (opts.saveTo) {
    try { writeFileSync(opts.saveTo, rendered + (rendered.endsWith("\n") ? "" : "\n"), "utf8"); }
    catch (e) { console.error(`Failed to write --save-to: ${e instanceof Error ? e.message : e}`); return 1; }
  }

  console.log(rendered);
  return 0;
}

// ── get ──────────────────────────────────────────────────────────────────────

export interface ComposerGetOptions {
  orchestratorId: string;
  businessDomain: string;
  pretty: boolean;
}

export function parseComposerGetArgs(args: string[]): ComposerGetOptions {
  let orchestratorId = "";
  let businessDomain = "";
  let pretty = true;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if ((a === "-bd" || a === "--biz-domain") && args[i + 1] !== undefined) { businessDomain = args[++i]; continue; }
    if (a === "--pretty") { pretty = true; continue; }
    if (a === "--compact") { pretty = false; continue; }
    if (!a.startsWith("-")) orchestratorId = a;
  }
  if (!orchestratorId) throw new Error("Missing required argument: <orchestrator-id>");
  if (!businessDomain) businessDomain = resolveBusinessDomain();
  return { orchestratorId, businessDomain, pretty };
}

async function runGet(args: string[]): Promise<number> {
  let opts: ComposerGetOptions;
  try { opts = parseComposerGetArgs(args); }
  catch (e) { console.error(e instanceof Error ? e.message : String(e)); return 1; }

  const getToken: TokenProvider = () => ensureValidToken();
  const config = await fetchOrchestratorConfig(opts.orchestratorId, getToken, opts.businessDomain);
  console.log(formatCallOutput(JSON.stringify(config), opts.pretty));
  return 0;
}

// ── delete ───────────────────────────────────────────────────────────────────

export interface ComposerDeleteOptions {
  orchestratorId: string;
  cascade: boolean;
  yes: boolean;
  businessDomain: string;
}

export function parseComposerDeleteArgs(args: string[]): ComposerDeleteOptions {
  let orchestratorId = "";
  let cascade = false;
  let yes = false;
  let businessDomain = "";
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--cascade") { cascade = true; continue; }
    if (a === "-y" || a === "--yes") { yes = true; continue; }
    if ((a === "-bd" || a === "--biz-domain") && args[i + 1] !== undefined) { businessDomain = args[++i]; continue; }
    if (!a.startsWith("-")) orchestratorId = a;
  }
  if (!orchestratorId) throw new Error("Missing required argument: <orchestrator-id>");
  if (!businessDomain) businessDomain = resolveBusinessDomain();
  return { orchestratorId, cascade, yes, businessDomain };
}

function confirmYes(prompt: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${prompt} [y/N] `, (answer) => {
      rl.close();
      const t = answer.trim().toLowerCase();
      resolve(t === "y" || t === "yes");
    });
  });
}

async function runDelete(args: string[]): Promise<number> {
  let opts: ComposerDeleteOptions;
  try { opts = parseComposerDeleteArgs(args); }
  catch (e) { console.error(e instanceof Error ? e.message : String(e)); return 1; }

  const getToken: TokenProvider = () => ensureValidToken();

  let idsToDelete = [opts.orchestratorId];
  if (opts.cascade) {
    const subIds = await listSubAgentIds(opts.orchestratorId, getToken, opts.businessDomain);
    // Delete sub-agents AFTER orchestrator — orchestrator holds references
    // that may block sub-agent deletion while it still exists.
    idsToDelete = [opts.orchestratorId, ...subIds];
  }

  if (!opts.yes) {
    const label = opts.cascade
      ? `Delete orchestrator ${opts.orchestratorId} and ${idsToDelete.length - 1} sub-agent(s)?`
      : `Delete orchestrator ${opts.orchestratorId}?`;
    const ok = await confirmYes(label);
    if (!ok) { console.error("Aborted."); return 1; }
  }

  const result = await cleanupAgents(idsToDelete, getToken, opts.businessDomain);
  console.error(`Deleted ${result.deleted.length}/${idsToDelete.length} agent(s)`);
  for (const e of result.errors) {
    console.error(`  ! ${e.agentId}: ${e.error}`);
  }
  return result.errors.length > 0 ? 1 : 0;
}

// ── template ─────────────────────────────────────────────────────────────────

export interface ComposerTemplateGetOptions {
  templateId: string;
  pretty: boolean;
}

export function parseComposerTemplateGetArgs(args: string[]): ComposerTemplateGetOptions {
  let templateId = "";
  let pretty = true;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--pretty") { pretty = true; continue; }
    if (a === "--compact") { pretty = false; continue; }
    if (!a.startsWith("-")) templateId = a;
  }
  if (!templateId) throw new Error("Missing required argument: <template-id>");
  return { templateId, pretty };
}

async function runTemplate(args: string[]): Promise<number> {
  const [sub, ...rest] = args;
  if (!sub || sub === "--help" || sub === "-h") {
    console.log("kweaver composer template {list,get <id>}");
    return 0;
  }

  if (sub === "list") {
    let pretty = true;
    for (const a of rest) {
      if (a === "--pretty") pretty = true;
      else if (a === "--compact") pretty = false;
    }
    const summary = getTemplates().map((t) => ({ id: t.id, name: t.name, description: t.description }));
    console.log(formatCallOutput(JSON.stringify(summary), pretty));
    return 0;
  }

  if (sub === "get") {
    let opts: ComposerTemplateGetOptions;
    try { opts = parseComposerTemplateGetArgs(rest); }
    catch (e) { console.error(e instanceof Error ? e.message : String(e)); return 1; }
    const t = getTemplates().find((x) => x.id === opts.templateId);
    if (!t) {
      console.error(`Unknown template: ${opts.templateId}`);
      return 1;
    }
    console.log(formatCallOutput(JSON.stringify(t), opts.pretty));
    return 0;
  }

  console.error(`Unknown composer template subcommand: ${sub}`);
  return 1;
}
