import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { ensureValidToken, with401RefreshRetry } from "../auth/oauth.js";
import { resolveBusinessDomain } from "../config/store.js";
import { registerBknRoutes, loadExploreMetaWithRetry, type ExploreMeta } from "./explore-bkn.js";
import { listKnowledgeNetworks } from "../api/knowledge-networks.js";
import { listAgents } from "../api/agent-list.js";
import { listVegaCatalogs } from "../api/vega.js";

export interface ExploreOptions {
  knId: string;
  agentId: string;
  port: number;
  open: boolean;
  businessDomain: string;
}

export function parseExploreArgs(args: string[]): ExploreOptions {
  const opts: ExploreOptions = {
    knId: "",
    agentId: "",
    port: 3721,
    open: true,
    businessDomain: "",
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--help" || a === "-h") throw new Error("help");
    if (a === "--port" && args[i + 1]) { opts.port = Number(args[++i]); continue; }
    if (a === "--no-open") { opts.open = false; continue; }
    if (a === "--kn" && args[i + 1]) { opts.knId = args[++i]; continue; }
    if (a === "--agent" && args[i + 1]) { opts.agentId = args[++i]; continue; }
    if ((a === "-bd" || a === "--biz-domain") && args[i + 1]) { opts.businessDomain = args[++i]; continue; }
  }
  return opts;
}

function printExploreHelp(): void {
  console.log(`kweaver explore

Launch an interactive web UI for exploring KWeaver resources.

Usage:
  kweaver explore [options]

Options:
  --kn <id>          Open directly to BKN tab with specified KN
  --agent <id>       Open directly to Chat tab with specified Agent
  --port <n>         HTTP server port (default: 3721)
  --no-open          Don't auto-open browser
  -bd <value>        Business domain override
  -h, --help         Show this help
`);
}

// MIME map for static files
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

async function startServer(
  opts: ExploreOptions,
  token: { baseUrl: string; accessToken: string },
  businessDomain: string,
): Promise<void> {
  // 1. Load BKN meta if --kn provided
  let bknMeta: ExploreMeta | null = null;
  if (opts.knId) {
    console.error(`Loading schema for KN ${opts.knId}...`);
    bknMeta = await loadExploreMetaWithRetry(token, opts.knId, businessDomain);
    console.error(`Loaded: ${bknMeta.objectTypes.length} OTs, ${bknMeta.relationTypes.length} RTs`);
  }

  // 2. Collect route handlers
  const routes = new Map<string, (req: IncomingMessage, res: ServerResponse) => void>();

  // Dashboard route: aggregate KN, Agents, Vega Catalogs in parallel
  routes.set("GET /api/dashboard", async (_req, res) => {
    try {
      const bd = businessDomain;
      const [knRaw, agentsRaw, catalogsRaw] = await Promise.allSettled([
        with401RefreshRetry(() =>
          listKnowledgeNetworks({ baseUrl: token.baseUrl, accessToken: token.accessToken, businessDomain: bd })),
        with401RefreshRetry(() =>
          listAgents({ baseUrl: token.baseUrl, accessToken: token.accessToken, businessDomain: bd })),
        with401RefreshRetry(() =>
          listVegaCatalogs({ baseUrl: token.baseUrl, accessToken: token.accessToken, businessDomain: bd })),
      ]);

      const parseSettled = (r: PromiseSettledResult<string>) =>
        r.status === "fulfilled" ? JSON.parse(r.value) : { error: String(r.reason) };

      const payload = {
        kn: parseSettled(knRaw),
        agents: parseSettled(agentsRaw),
        catalogs: parseSettled(catalogsRaw),
      };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
    } catch (err: any) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(err) }));
    }
  });

  // BKN routes
  if (bknMeta) {
    const bknRoutes = registerBknRoutes(bknMeta, token, businessDomain);
    for (const [key, handler] of bknRoutes) routes.set(key, handler);
  }

  // 3. Resolve template directory
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = join(__filename, "..");
  const templateDir = join(__dirname, "..", "templates", "explorer");

  // 4. Create HTTP server
  const server = createServer((req, res) => {
    const url = new URL(req.url || "/", `http://localhost:${opts.port}`);
    const method = req.method || "GET";
    const pathname = url.pathname;

    // API route matching
    const routeKey = `${method} ${pathname}`;
    const handler = routes.get(routeKey);
    if (handler) {
      handler(req, res);
      return;
    }

    // Static file serving
    let filePath = pathname === "/" ? "/index.html" : pathname;
    const fullPath = join(templateDir, filePath);

    // Security: prevent directory traversal
    if (!fullPath.startsWith(templateDir)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    if (existsSync(fullPath)) {
      const ext = extname(fullPath);
      const contentType = MIME[ext] || "application/octet-stream";
      const content = readFileSync(fullPath);
      res.writeHead(200, { "Content-Type": contentType });
      res.end(content);
    } else {
      // SPA fallback: serve index.html for unknown routes
      const indexPath = join(templateDir, "index.html");
      if (existsSync(indexPath)) {
        const content = readFileSync(indexPath);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(content);
      } else {
        res.writeHead(404);
        res.end("Not Found");
      }
    }
  });

  // 5. Start listening
  server.listen(opts.port, () => {
    const initialHash = opts.knId ? `#/bkn/${opts.knId}` :
                       opts.agentId ? `#/chat/${opts.agentId}` : "";
    const url = `http://localhost:${opts.port}/${initialHash}`;
    console.error(`\nKWeaver Explorer running at ${url}\n`);
    console.error("Press Ctrl+C to stop.\n");

    // 6. Open browser
    if (opts.open) {
      try {
        const platform = process.platform;
        if (platform === "darwin") execSync(`open "${url}"`);
        else if (platform === "win32") execSync(`start "" "${url}"`);
        else execSync(`xdg-open "${url}"`);
      } catch { /* ignore browser open failures */ }
    }
  });

  // 7. Ctrl+C handling
  await new Promise<void>((resolve) => {
    process.on("SIGINT", () => {
      console.error("\nShutting down...");
      server.close(() => resolve());
    });
  });
}

export async function runExploreCommand(args: string[]): Promise<number> {
  let opts: ExploreOptions;
  try {
    opts = parseExploreArgs(args);
  } catch (err: any) {
    if (err?.message === "help") { printExploreHelp(); return 0; }
    throw err;
  }

  // Acquire token
  const token = await ensureValidToken();
  const businessDomain = opts.businessDomain || resolveBusinessDomain();

  // Start the server
  await startServer(opts, token, businessDomain);
  return 0;
}
