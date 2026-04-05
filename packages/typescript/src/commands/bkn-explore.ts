import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";

import { ensureValidToken, formatHttpError } from "../auth/oauth.js";
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
  const ot = JSON.parse(otRaw) as {
    object_types?: Array<{
      id: string;
      name: string;
      display_key?: string;
      properties?: Array<{ name: string; type?: string }>;
    }>;
  };
  const rt = JSON.parse(rtRaw) as {
    relation_types?: Array<{
      id: string;
      name: string;
      source_object_type_id: string;
      target_object_type_id: string;
      source_object_type?: { name: string };
      target_object_type?: { name: string };
    }>;
  };
  const at = JSON.parse(atRaw) as {
    action_types?: Array<{ id: string; name: string }>;
  };

  return {
    bkn: { id: kn.id, name: kn.name },
    statistics: {
      object_count: kn.statistics?.object_count ?? 0,
      relation_count: kn.statistics?.relation_count ?? 0,
    },
    objectTypes: (ot.object_types ?? []).map((o) => ({
      id: o.id,
      name: o.name,
      displayKey: o.display_key ?? "",
      propertyCount: o.properties?.length ?? 0,
      properties: (o.properties ?? []).map((p) => ({
        name: p.name,
        ...(p.type !== undefined ? { type: p.type } : {}),
      })),
    })),
    relationTypes: (rt.relation_types ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      sourceOtId: r.source_object_type_id,
      targetOtId: r.target_object_type_id,
      sourceOtName: r.source_object_type?.name ?? "",
      targetOtName: r.target_object_type?.name ?? "",
    })),
    actionTypes: (at.action_types ?? []).map((a) => ({
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
        };
        const queryBody = JSON.stringify({
          limit: body.limit ?? 50,
          ...(body.search_after ? { search_after: body.search_after } : {}),
          ...(body.condition ? { condition: body.condition } : {}),
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
        const result = await subgraph({
          baseUrl: token.baseUrl,
          accessToken: token.accessToken,
          knId,
          body: bodyStr,
          businessDomain,
        });
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(result);
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
      const message = error instanceof Error ? error.message : String(error);
      jsonResponse(res, 500, { error: message });
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

    // Load schema in parallel
    const [knRaw, otRaw, rtRaw, atRaw] = await Promise.all([
      getKnowledgeNetwork({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        knId,
        businessDomain: options.businessDomain,
        include_statistics: true,
      }),
      listObjectTypes({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        knId,
        businessDomain: options.businessDomain,
      }),
      listRelationTypes({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        knId,
        businessDomain: options.businessDomain,
      }),
      listActionTypes({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        knId,
        businessDomain: options.businessDomain,
      }),
    ]);

    const meta = buildMeta(knRaw, otRaw, rtRaw, atRaw);

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
