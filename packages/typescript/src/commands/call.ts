import { ensureValidToken, formatHttpError } from "../auth/oauth.js";
import { HttpError } from "../utils/http.js";
import { resolveBusinessDomain } from "../config/store.js";

export interface CallInvocation {
  url: string;
  method: string;
  headers: Headers;
  body?: string;
  pretty: boolean;
  verbose: boolean;
  businessDomain: string;
}

export function parseCallArgs(args: string[]): CallInvocation {
  const headers = new Headers();
  let method = "GET";
  let body: string | undefined;
  let url: string | undefined;
  let pretty = true;
  let verbose = false;
  let businessDomain = "";

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "-X" || arg === "--request") {
      method = (args[index + 1] ?? "").toUpperCase();
      index += 1;
      continue;
    }

    if (arg === "-H" || arg === "--header") {
      const header = args[index + 1];
      if (!header) {
        throw new Error("Missing value for header flag");
      }
      const separatorIndex = header.indexOf(":");
      if (separatorIndex === -1) {
        throw new Error(`Invalid header format: ${header}`);
      }
      const name = header.slice(0, separatorIndex).trim();
      const value = header.slice(separatorIndex + 1).trim();
      headers.set(name, value);
      index += 1;
      continue;
    }

    if (arg === "-d" || arg === "--data" || arg === "--data-raw") {
      body = args[index + 1] ?? "";
      if (method === "GET") {
        method = "POST";
      }
      index += 1;
      continue;
    }

    if (arg === "--pretty") {
      pretty = true;
      continue;
    }

    if (arg === "-v" || arg === "--verbose") {
      verbose = true;
      continue;
    }

    if (arg === "-bd" || arg === "--biz-domain") {
      businessDomain = args[index + 1] ?? "";
      if (!businessDomain || businessDomain.startsWith("-")) {
        throw new Error("Missing value for biz-domain flag");
      }
      index += 1;
      continue;
    }

    if (arg === "--url") {
      url = args[index + 1];
      index += 1;
      continue;
    }

    if (!arg.startsWith("-") && !url) {
      url = arg;
      continue;
    }

    throw new Error(`Unsupported call argument: ${arg}`);
  }

  if (!url) {
    throw new Error("Missing request URL");
  }

  if (!businessDomain) businessDomain = resolveBusinessDomain();
  return { url, method, headers, body, pretty, verbose, businessDomain };
}

function injectAuthHeaders(headers: Headers, accessToken: string, businessDomain: string): void {
  if (!headers.has("authorization")) {
    headers.set("authorization", `Bearer ${accessToken}`);
  }

  if (!headers.has("token")) {
    headers.set("token", accessToken);
  }

  if (!headers.has("x-business-domain")) {
    headers.set("x-business-domain", businessDomain);
  }
}

export function formatCallOutput(text: string, pretty: boolean): string {
  if (!pretty || !text) {
    return text;
  }

  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

export function stripSseDoneMarker(text: string, contentType?: string | null): string {
  if (!text || !contentType?.includes("text/event-stream")) {
    return text;
  }

  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "data: [DONE]");
  return lines.join("\n").trimEnd();
}

export function formatVerboseRequest(invocation: CallInvocation): string[] {
  const lines = [
    `Method: ${invocation.method}`,
    `URL: ${invocation.url}`,
    "Headers:",
  ];

  const entries = Array.from(invocation.headers.entries()).sort(([a], [b]) => a.localeCompare(b));
  for (const [name, value] of entries) {
    lines.push(`  ${name}: ${value}`);
  }

  lines.push(`Body: ${invocation.body ? "present" : "empty"}`);
  return lines;
}

export async function runCallCommand(args: string[]): Promise<number> {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    console.log(`kweaver call <url> [-X METHOD] [-H "Name: value"] [-d BODY] [--pretty] [--verbose] [-bd value]

Call an API with curl-style flags and auto-injected token headers.

Options:
  <url>              API path (e.g. /api/ontology-manager/v1/knowledge-networks)
  -X, --request      HTTP method (default: GET)
  -H, --header       Extra header (repeatable)
  -d, --data         JSON request body
  -bd, --biz-domain  Override x-business-domain (default: bd_public)
  -v, --verbose      Print request info to stderr
  --pretty           Pretty-print JSON output (default)`);
    return 0;
  }

  let invocation: CallInvocation;
  try {
    invocation = parseCallArgs(args);
  } catch (error) {
    console.error(formatHttpError(error));
    return 1;
  }

  try {
    const token = await ensureValidToken();

    // Prepend baseUrl when the URL is a relative path (no scheme)
    if (invocation.url.startsWith("/")) {
      invocation.url = token.baseUrl.replace(/\/+$/, "") + invocation.url;
    }

    injectAuthHeaders(invocation.headers, token.accessToken, invocation.businessDomain);

    if (invocation.verbose) {
      for (const line of formatVerboseRequest(invocation)) {
        console.error(line);
      }
    }

    const response = await fetch(invocation.url, {
      method: invocation.method,
      headers: invocation.headers,
      body: invocation.body,
    });

    const rawText = await response.text();
    const text = stripSseDoneMarker(rawText, response.headers.get("content-type"));
    if (!response.ok) {
      throw new HttpError(response.status, response.statusText, text);
    }

    if (text) {
      console.log(formatCallOutput(text, invocation.pretty));
    }
    return 0;
  } catch (error) {
    console.error(formatHttpError(error));
    return 1;
  }
}
