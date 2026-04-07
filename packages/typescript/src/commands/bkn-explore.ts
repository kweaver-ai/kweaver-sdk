import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";

import { ensureValidToken, formatHttpError } from "../auth/oauth.js";
import { HttpError } from "../utils/http.js";
import { resolveBusinessDomain } from "../config/store.js";
import {
  listKnowledgeNetworks,
  getKnowledgeNetwork,
  listObjectTypes,
  listRelationTypes,
  listActionTypes,
} from "../api/knowledge-networks.js";
import { objectTypeQuery, objectTypeProperties, subgraph } from "../api/ontology-query.js";
import { semanticSearch } from "../api/semantic-search.js";

// ── Interfaces ──────────────────────────────────────────────────────────────

export interface KnExploreOptions {
  knId: string;
  port: number;
  open: boolean;
  businessDomain: string;
}

export interface ExploreMeta {
  bkn: { id: string; name: string };
  statistics: { object_count: number; relation_count: number };
  objectTypes: Array<{
    id: string;
    name: string;
    displayKey: string;
    propertyCount: number;
    properties: Array<{ name: string; type?: string }>;
  }>;
  relationTypes: Array<{
    id: string;
    name: string;
    sourceOtId: string;
    targetOtId: string;
    sourceOtName: string;
    targetOtName: string;
  }>;
  actionTypes: Array<{ id: string; name: string }>;
}

const EXPLORE_BOOTSTRAP_RETRY_DELAY_MS = 300;
const EXPLORE_BOOTSTRAP_MAX_ATTEMPTS = 2;

// ── Part A: Arg parsing ─────────────────────────────────────────────────────

export function parseKnExploreArgs(args: string[]): KnExploreOptions {
  let knId = "";
  let port = 3721;
  let open = true;
  let businessDomain = process.env.KWEAVER_BUSINESS_DOMAIN ?? "";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--help" || arg === "-h") {
      throw new Error("help");
    } else if (arg === "--port") {
      port = Number(args[++i]);
    } else if (arg === "--no-open") {
      open = false;
    } else if (arg === "-bd" || arg === "--biz-domain") {
      businessDomain = args[++i]!;
    } else if (!arg.startsWith("-")) {
      if (!knId) knId = arg;
    }
  }

  if (!businessDomain) businessDomain = resolveBusinessDomain();
  return { knId, port, open, businessDomain };
}

// ── Part B: Interactive KN selection ────────────────────────────────────────

async function selectKnInteractive(
  baseUrl: string,
  accessToken: string,
  businessDomain: string,
): Promise<string> {
  const raw = await listKnowledgeNetworks({ baseUrl, accessToken, businessDomain });
  const parsed = JSON.parse(raw) as {
    entries?: Array<Record<string, unknown>>;
  };
  const kns = (parsed.entries ?? []).map((e) => ({
    id: typeof e.id === "string" ? e.id : "",
    name: typeof e.name === "string" ? e.name : "",
  })).filter((e) => e.id);

  if (kns.length === 0) {
    throw new Error("No knowledge networks found.");
  }

  console.log("\nAvailable Knowledge Networks:");
  for (let i = 0; i < kns.length; i++) {
    console.log(`  ${i + 1}) ${kns[i]!.name} (${kns[i]!.id})`);
  }

  const answer = await new Promise<string>((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question("\nSelect KN number: ", (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });

  const idx = parseInt(answer, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= kns.length) {
    throw new Error(`Invalid selection: ${answer}`);
  }

  return kns[idx]!.id;
}

function getErrorMessage(error: unknown): string {
  const parts: string[] = [];

  if (error instanceof Error) {
    if (error.message) {
      parts.push(error.message);
    }
    const cause = "cause" in error && error.cause instanceof Error ? error.cause.message : "";
    if (cause) {
      parts.push(cause);
    }
  } else {
    parts.push(String(error));
  }

  return parts.join(" ").toLowerCase();
}

export function isRetryableExploreBootstrapError(error: unknown): boolean {
  if (error instanceof HttpError) {
    return false;
  }

  const message = getErrorMessage(error);
  if (!message) {
    return false;
  }

  return [
    "fetch failed",
    "client network socket disconnected",
    "socket hang up",
    "econnreset",
    "econnrefused",
    "etimedout",
    "tls",
    "secure tls connection",
  ].some((token) => message.includes(token));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function loadExploreMetaWithRetry(
  token: { baseUrl: string; accessToken: string },
  knId: string,
  businessDomain: string,
): Promise<ExploreMeta> {
  for (let attempt = 1; attempt <= EXPLORE_BOOTSTRAP_MAX_ATTEMPTS; attempt++) {
    try {
      const [knRaw, otRaw, rtRaw, atRaw] = await Promise.all([
        getKnowledgeNetwork({
          baseUrl: token.baseUrl,
          accessToken: token.accessToken,
          knId,
          businessDomain,
          include_statistics: true,
        }),
        listObjectTypes({
          baseUrl: token.baseUrl,
          accessToken: token.accessToken,
          knId,
          businessDomain,
        }),
        listRelationTypes({
          baseUrl: token.baseUrl,
          accessToken: token.accessToken,
          knId,
          businessDomain,
        }),
        listActionTypes({
          baseUrl: token.baseUrl,
          accessToken: token.accessToken,
          knId,
          businessDomain,
        }),
      ]);

      return buildMeta(knRaw, otRaw, rtRaw, atRaw);
    } catch (error) {
      if (attempt >= EXPLORE_BOOTSTRAP_MAX_ATTEMPTS || !isRetryableExploreBootstrapError(error)) {
        throw error;
      }
      await sleep(EXPLORE_BOOTSTRAP_RETRY_DELAY_MS);
    }
  }

  throw new Error("Failed to load explorer metadata.");
}

// ── Part C: Meta builder ────────────────────────────────────────────────────

export function buildMeta(
  knRaw: string,
  otRaw: string,
  rtRaw: string,
  atRaw: string,
): ExploreMeta {
  const kn = JSON.parse(knRaw) as {
    id: string;
    name: string;
    statistics?: { object_count?: number; relation_count?: number };
  };
  const otParsed = JSON.parse(otRaw) as Record<string, unknown>;
  const otItems = (
    Array.isArray(otParsed) ? otParsed
    : Array.isArray(otParsed.entries) ? otParsed.entries
    : Array.isArray(otParsed.object_types) ? otParsed.object_types
    : []
  ) as Array<{
    id: string;
    name: string;
    display_key?: string;
    properties?: Array<{ name: string; type?: string }>;
    data_properties?: Array<{ name: string; type?: string }>;
  }>;
  const rtParsed = JSON.parse(rtRaw) as Record<string, unknown>;
  const rtItems = (
    Array.isArray(rtParsed) ? rtParsed
    : Array.isArray(rtParsed.entries) ? rtParsed.entries
    : Array.isArray(rtParsed.relation_types) ? rtParsed.relation_types
    : []
  ) as Array<{
    id: string;
    name: string;
    source_object_type_id: string;
    target_object_type_id: string;
    source_object_type?: { name: string };
    target_object_type?: { name: string };
  }>;
  const atParsed = JSON.parse(atRaw) as Record<string, unknown>;
  const atItems = (
    Array.isArray(atParsed) ? atParsed
    : Array.isArray(atParsed.entries) ? atParsed.entries
    : Array.isArray(atParsed.action_types) ? atParsed.action_types
    : []
  ) as Array<{ id: string; name: string }>;

  return {
    bkn: { id: kn.id, name: kn.name },
    statistics: {
      object_count: kn.statistics?.object_count ?? 0,
      relation_count: kn.statistics?.relation_count ?? 0,
    },
    objectTypes: otItems.map((o) => {
      const props = o.properties ?? o.data_properties ?? [];
      return {
        id: o.id,
        name: o.name,
        displayKey: o.display_key ?? "",
        propertyCount: props.length,
        properties: props.map((p) => ({
          name: p.name,
          ...(p.type !== undefined ? { type: p.type } : {}),
        })),
      };
    }),
    relationTypes: rtItems.map((r) => ({
      id: r.id,
      name: r.name,
      sourceOtId: r.source_object_type_id,
      targetOtId: r.target_object_type_id,
      sourceOtName: r.source_object_type?.name ?? "",
      targetOtName: r.target_object_type?.name ?? "",
    })),
    actionTypes: atItems.map((a) => ({
      id: a.id,
      name: a.name,
    })),
  };
}

// ── HTTP helpers ────────────────────────────────────────────────────────────

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function jsonResponse(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

// ── HTTP server ─────────────────────────────────────────────────────────────

function startServer(
  meta: ExploreMeta,
  token: { baseUrl: string; accessToken: string },
  knId: string,
  businessDomain: string,
  port: number,
): Promise<ReturnType<typeof createServer>> {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const templateDir = join(__dirname, "..", "templates", "bkn-explorer");

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);
    const pathname = url.pathname;

    try {
      // ── API routes ──────────────────────────────────────────────────
      if (pathname === "/api/meta" && req.method === "GET") {
        jsonResponse(res, 200, meta);
        return;
      }

      if (pathname === "/api/instances" && req.method === "POST") {
        const bodyStr = await readBody(req);
        const body = JSON.parse(bodyStr) as {
          otId: string;
          limit?: number;
          search_after?: unknown[];
          condition?: unknown;
          _instance_identities?: unknown[];
        };
        const queryBody = JSON.stringify({
          limit: body.limit ?? 50,
          ...(body.search_after ? { search_after: body.search_after } : {}),
          ...(body.condition ? { condition: body.condition } : {}),
          ...(body._instance_identities ? { _instance_identities: body._instance_identities } : {}),
        });
        const result = await objectTypeQuery({
          baseUrl: token.baseUrl,
          accessToken: token.accessToken,
          knId,
          otId: body.otId,
          body: queryBody,
          businessDomain,
        });
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(result);
        return;
      }

      if (pathname === "/api/subgraph" && req.method === "POST") {
        const bodyStr = await readBody(req);
        console.error("[subgraph] request body:", bodyStr);
        try {
          const parsed = JSON.parse(bodyStr);
          const hasRelationPaths = Array.isArray(parsed.relation_type_paths);
          const result = await subgraph({
            baseUrl: token.baseUrl,
            accessToken: token.accessToken,
            knId,
            body: bodyStr,
            businessDomain,
            ...(hasRelationPaths ? { queryType: "relation_path" } : {}),
          });
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(result);
        } catch (err: unknown) {
          const e = err as { status?: number; body?: string; message?: string };
          console.error("[subgraph] error:", e.status, e.body ?? e.message);
          const status = e.status ?? 500;
          const errBody = e.body ?? e.message ?? "subgraph error";
          res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: typeof errBody === "string" ? errBody : JSON.stringify(errBody) }));
        }
        return;
      }

      if (pathname === "/api/search" && req.method === "POST") {
        const bodyStr = await readBody(req);
        const body = JSON.parse(bodyStr) as { query: string; maxConcepts?: number };
        const result = await semanticSearch({
          baseUrl: token.baseUrl,
          accessToken: token.accessToken,
          knId,
          query: body.query,
          businessDomain,
          maxConcepts: body.maxConcepts,
        });
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(result);
        return;
      }

      if (pathname === "/api/properties" && req.method === "POST") {
        const bodyStr = await readBody(req);
        const body = JSON.parse(bodyStr) as { otId: string; [key: string]: unknown };
        const { otId, ...rest } = body;
        const result = await objectTypeProperties({
          baseUrl: token.baseUrl,
          accessToken: token.accessToken,
          knId,
          otId,
          body: JSON.stringify(rest),
          businessDomain,
        });
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(result);
        return;
      }

      // ── Static file serving ───────────────────────────────────────
      if (req.method === "GET") {
        let filePath = join(templateDir, pathname === "/" ? "index.html" : pathname);
        let content: Buffer;
        try {
          content = readFileSync(filePath);
        } catch {
          // SPA fallback
          filePath = join(templateDir, "index.html");
          try {
            content = readFileSync(filePath);
          } catch {
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("Not Found");
            return;
          }
        }
        const ext = extname(filePath);
        const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
        res.writeHead(200, { "Content-Type": contentType });
        res.end(content);
        return;
      }

      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
    } catch (error) {
      if (error instanceof HttpError) {
        // Parse upstream error body for a human-readable description
        let detail = "";
        try {
          const parsed = JSON.parse(error.body) as Record<string, unknown>;
          detail = typeof parsed.description === "string" ? parsed.description : "";
        } catch { /* ignore */ }
        jsonResponse(res, error.status, {
          error: detail || error.message,
          upstream_status: error.status,
        });
      } else {
        const message = error instanceof Error ? error.message : String(error);
        jsonResponse(res, 500, { error: message });
      }
    }
  });

  return new Promise((resolve) => {
    server.listen(port, () => {
      resolve(server);
    });
  });
}

// ── Main command ────────────────────────────────────────────────────────────

const KN_EXPLORE_HELP = `kweaver bkn explore [kn-id] [--port <n>] [--no-open] [-bd value]

Launch a local web UI to explore a knowledge network.

Options:
  --port <n>           HTTP server port (default: 3721)
  --no-open            Don't open browser automatically
  -bd, --biz-domain    Override x-business-domain`;

export async function runKnExploreCommand(args: string[]): Promise<number> {
  let options: KnExploreOptions;
  try {
    options = parseKnExploreArgs(args);
  } catch (error) {
    if (error instanceof Error && error.message === "help") {
      console.log(KN_EXPLORE_HELP);
      return 0;
    }
    throw error;
  }

  try {
    const token = await ensureValidToken();

    let knId = options.knId;
    if (!knId) {
      knId = await selectKnInteractive(
        token.baseUrl,
        token.accessToken,
        options.businessDomain,
      );
    }

    const meta = await loadExploreMetaWithRetry(token, knId, options.businessDomain);

    const server = await startServer(meta, token, knId, options.businessDomain, options.port);

    const url = `http://localhost:${options.port}`;
    console.log(`\nBKN Explorer running at ${url}`);
    console.log(`Knowledge Network: ${meta.bkn.name} (${meta.bkn.id})`);
    console.log(`Press Ctrl+C to stop.\n`);

    if (options.open) {
      const cmd =
        process.platform === "darwin"
          ? "open"
          : process.platform === "win32"
            ? "start"
            : "xdg-open";
      try {
        execSync(`${cmd} ${url}`, { stdio: "ignore" });
      } catch {
        // Ignore if browser open fails
      }
    }

    // Wait for SIGINT
    await new Promise<void>(() => {
      process.on("SIGINT", () => {
        console.log("\nShutting down...");
        server.close();
        process.exit(0);
      });
    });

    return 0;
  } catch (error) {
    console.error(formatHttpError(error));
    return 1;
  }
}
