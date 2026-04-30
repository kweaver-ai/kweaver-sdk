import { promises as fs } from "node:fs";
import { ensureValidToken, formatHttpError, with401RefreshRetry } from "../auth/oauth.js";
import { resolveBusinessDomain } from "../config/store.js";
import {
  copyAgentTemplate,
  deleteAgentTemplate,
  getAgentTemplate,
  getAgentTemplateByKey,
  getAgentTemplatePublishInfo,
  publishAgentTemplate,
  unpublishAgentTemplate,
  updateAgentTemplate,
  updateAgentTemplatePublishInfo,
} from "../api/agent-tpl.js";
import { formatCallOutput } from "./call.js";

function parseCommon(args: string[]): {
  rest: string[];
  businessDomain: string;
  pretty: boolean;
} {
  let businessDomain = "";
  let pretty = true;
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if ((a === "-bd" || a === "--biz-domain") && args[i + 1]) {
      businessDomain = args[++i];
      continue;
    }
    if (a === "--pretty") {
      pretty = true;
      continue;
    }
    if (a === "--compact") {
      pretty = false;
      continue;
    }
    rest.push(a);
  }
  if (!businessDomain) businessDomain = resolveBusinessDomain();
  return { rest, businessDomain, pretty };
}

export async function runAgentTplCommand(args: string[]): Promise<number> {
  const [a0, a1, ...tail] = args;

  if (!a0 || a0 === "--help" || a0 === "-h") {
    console.log(`kweaver agent-tpl

Personal-space agent template APIs (agent-factory /agent-tpl).

Subcommands:
  get <template_id>                  Get template detail
  get-by-key <key>                   Get template by key
  update <id> --body-file <path>    Update template (JSON body)
  delete <id> [-y]                   Delete template
  copy <id>                          Duplicate template
  publish <id> [--body-file <path>] Publish template
  unpublish <id>                   Unpublish template
  publish-info get <id>             Get publish metadata
  publish-info put <id> --categories '<json-array>'
                                    Update publish info (category_ids)

Common options:
  -bd, --biz-domain <value>         x-business-domain (default from config)
  --pretty | --compact              JSON output style for read commands`);
    return 0;
  }

  try {
    return await with401RefreshRetry(async () => inner(args));
  } catch (error) {
    console.error(formatHttpError(error));
    return 1;
  }
}

async function inner(args: string[]): Promise<number> {
  const { rest, businessDomain, pretty } = parseCommon(args);
  const token = await ensureValidToken();
  const base = {
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    businessDomain,
  };

  if (rest[0] === "publish-info" && rest[1] === "get") {
    const id = rest[2];
    if (!id) {
      console.error("Usage: kweaver agent-tpl publish-info get <template_id>");
      return 1;
    }
    const raw = await getAgentTemplatePublishInfo({ ...base, templateId: id });
    console.log(formatCallOutput(JSON.parse(raw), pretty));
    return 0;
  }

  if (rest[0] === "publish-info" && rest[1] === "put") {
    let id = "";
    let categoriesJson = "";
    const piRest = rest.slice(2);
    for (let i = 0; i < piRest.length; i++) {
      if (piRest[i] === "--categories" && piRest[i + 1]) {
        categoriesJson = piRest[++i];
        continue;
      }
      if (!piRest[i].startsWith("-") && !id) {
        id = piRest[i];
        continue;
      }
    }
    if (!id || !categoriesJson) {
      console.error("Usage: kweaver agent-tpl publish-info put <id> --categories '[\"cat1\"]'");
      return 1;
    }
    let cats: unknown;
    try {
      cats = JSON.parse(categoriesJson);
    } catch {
      console.error("Invalid JSON for --categories");
      return 1;
    }
    const body = JSON.stringify({ category_ids: cats });
    const raw = await updateAgentTemplatePublishInfo({ ...base, templateId: id, body });
    console.log(formatCallOutput(JSON.parse(raw), pretty));
    return 0;
  }

  const sub = rest[0];
  const more = rest.slice(1);

  if (sub === "get") {
    const id = more[0];
    if (!id) {
      console.error("Usage: kweaver agent-tpl get <template_id>");
      return 1;
    }
    const raw = await getAgentTemplate({ ...base, templateId: id });
    console.log(formatCallOutput(JSON.parse(raw), pretty));
    return 0;
  }

  if (sub === "get-by-key") {
    const key = more[0];
    if (!key) {
      console.error("Usage: kweaver agent-tpl get-by-key <key>");
      return 1;
    }
    const raw = await getAgentTemplateByKey({ ...base, key });
    console.log(formatCallOutput(JSON.parse(raw), pretty));
    return 0;
  }

  if (sub === "update") {
    let id = "";
    let bodyFile = "";
    for (let i = 0; i < more.length; i++) {
      if (more[i] === "--body-file" && more[i + 1]) {
        bodyFile = more[++i];
        continue;
      }
      if (!more[i].startsWith("-") && !id) {
        id = more[i];
        continue;
      }
    }
    if (!id || !bodyFile) {
      console.error("Usage: kweaver agent-tpl update <id> --body-file <path>");
      return 1;
    }
    const body = await fs.readFile(bodyFile, "utf8");
    await updateAgentTemplate({ ...base, templateId: id, body });
    console.error(`Updated template ${id}.`);
    return 0;
  }

  if (sub === "delete") {
    let id = "";
    let yes = false;
    for (let i = 0; i < more.length; i++) {
      if (more[i] === "-y") {
        yes = true;
        continue;
      }
      if (!more[i].startsWith("-") && !id) {
        id = more[i];
        continue;
      }
    }
    if (!id) {
      console.error("Usage: kweaver agent-tpl delete <id> [-y]");
      return 1;
    }
    if (!yes) {
      console.error("Refusing to delete without -y (confirm).");
      return 1;
    }
    await deleteAgentTemplate({ ...base, templateId: id });
    console.error(`Deleted template ${id}.`);
    return 0;
  }

  if (sub === "copy") {
    const id = more[0];
    if (!id) {
      console.error("Usage: kweaver agent-tpl copy <template_id>");
      return 1;
    }
    const raw = await copyAgentTemplate({ ...base, templateId: id });
    console.log(formatCallOutput(JSON.parse(raw), pretty));
    return 0;
  }

  if (sub === "publish") {
    let id = "";
    let bodyFile = "";
    for (let i = 0; i < more.length; i++) {
      if (more[i] === "--body-file" && more[i + 1]) {
        bodyFile = more[++i];
        continue;
      }
      if (!more[i].startsWith("-") && !id) {
        id = more[i];
        continue;
      }
    }
    if (!id) {
      console.error("Usage: kweaver agent-tpl publish <id> [--body-file <path>]");
      return 1;
    }
    const raw = await publishAgentTemplate({
      ...base,
      templateId: id,
      body: bodyFile ? await fs.readFile(bodyFile, "utf8") : undefined,
    });
    console.log(formatCallOutput(JSON.parse(raw), pretty));
    return 0;
  }

  if (sub === "unpublish") {
    const id = more[0];
    if (!id) {
      console.error("Usage: kweaver agent-tpl unpublish <template_id>");
      return 1;
    }
    await unpublishAgentTemplate({ ...base, templateId: id });
    console.error(`Unpublished template ${id}.`);
    return 0;
  }

  console.error(`Unknown agent-tpl subcommand: ${sub}`);
  return 1;
}
