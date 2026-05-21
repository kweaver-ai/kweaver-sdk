// src/trace-ai/exp/index.ts
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { ExpStore } from "./exp-store/index.js";
import { ExperimentCoordinator } from "./coordinator.js";
import { ClaudeCodeTriageClient } from "./providers/triage-client.js";
import { runEval } from "./eval-runner.js";
import { defaultRegistry } from "../../agent-providers/registry.js";
import { ClaudeCodeSubprocessProvider } from "../../agent-providers/providers/claude-code-subprocess.js";
import { PromptTemplateRegistry } from "../../agent-providers/prompt-template.js";
import { createBuiltinSemanticMatchProvider } from "../eval-set/semantic-match-provider.js";
import type { SemanticMatchProvider } from "../eval-set/assertion-evaluator.js";
import { ensureValidToken } from "../../auth/oauth.js";
import { fetchAgentInfo, fetchAgentConfig as fetchAgentConfigApi, sendChatRequest } from "../../api/agent-chat.js";
import { getTracesByConversation } from "../../api/conversations.js";
import { upsertRegistry, listRegistry } from "./exp-store/exp-registry.js";
import { runInfo, runList, getHealthChecks } from "./info.js";
import { resolveClaudeBinary } from "./claude-binary.js";
import type { FailureAttribution } from "./schemas.js";
import { KweaverKnSchemaClient } from "./context/kn-schema-client.js";
import { ContextAssembler } from "./context/context-assembler.js";
import { probeObjectTypes } from "./context/kn-data-prober.js";
import { queryResource } from "../../api/resources.js";
import { KweaverVegaCatalogClient } from "./context/vega-catalog-client.js";
import { KweaverKnApiClient } from "./patch/kn-api-client.js";
import { KweaverSkillApiClient, type SkillApiClient } from "./patch/skill-api-client.js";

const MCP_PATH = "/api/agent-retrieval/v1/mcp";

const __expIndexDir = path.dirname(fileURLToPath(import.meta.url));

export function formatFailureAttribution(attribution: FailureAttribution[]): string {
  if (attribution.length === 0) return "";
  const lines = attribution.map((a) => {
    const queries = a.affected_queries.join(", ");
    const evidence = a.evidence.length > 55 ? a.evidence.slice(0, 52) + "..." : a.evidence;
    const layerTag = `[${a.layer}]`.padEnd(7);
    return `  ${layerTag} ${evidence.padEnd(55)}  → ${a.suggested_target}  (${queries})`;
  });
  return "Failure attribution:\n" + lines.join("\n");
}
const EVAL_SET_RUBRIC_DIR = path.join(__expIndexDir, "..", "eval-set", "rubric-templates");

function ensureProvider() {
  if (!defaultRegistry.has("claude-code")) {
    defaultRegistry.register(new ClaudeCodeSubprocessProvider({
      binary: resolveClaudeBinary(),
      defaultTimeoutMs: 120_000,
    }), { setAsDefault: true });
  }
}

export interface ParsedExpArgs {
  subcommand: "run" | "resume" | "show" | "status" | "abort" | "doctor" | "list" | "info";
  expDir: string;
  newRun?: boolean;
  json?: boolean;
}

export function parseExpArgs(argv: string[]): ParsedExpArgs {
  const [sub, dir, ...flags] = argv;
  const validSubs = ["run", "resume", "show", "status", "abort", "doctor", "list", "info"] as const;
  if (!validSubs.includes(sub as never)) {
    throw new Error(`Unknown exp subcommand: ${sub}. Use: ${validSubs.join(", ")}`);
  }
  const isDiscoveryCmd = sub === "list" || sub === "info";
  const expDir = isDiscoveryCmd
    ? (dir ? path.resolve(dir) : "")
    : path.resolve(dir ?? ".");
  return {
    subcommand: sub as ParsedExpArgs["subcommand"],
    expDir,
    newRun: flags.includes("--new-run"),
    json: flags.includes("--json"),
  };
}

export async function runExpCommand(argv: string[]): Promise<number> {
  const args = parseExpArgs(argv);

  switch (args.subcommand) {
    case "list": {
      if (args.expDir) {
        await runList([{ path: args.expDir, last_active_ts: new Date().toISOString() }]);
      } else {
        const entries = await listRegistry();
        await runList(entries);
      }
      return 0;
    }

    case "info": {
      let expDir = args.expDir;
      if (!expDir) {
        const entries = await listRegistry();
        if (entries.length === 0) {
          process.stderr.write("Error: no experiments in registry. Run 'trace exp run <dir>' first, or provide a path: trace exp info <dir>\n");
          return 1;
        }
        expDir = entries[0].path;
        process.stderr.write(`Using most recent: ${expDir}\n`);
      }
      await runInfo(expDir, { json: args.json });
      return 0;
    }

    case "run": {
      ensureProvider();
      const store = new ExpStore(args.expDir);
      const replayed = await store.replayState();
      if (!replayed.isTerminal && replayed.currentRound > 0 && !replayed.lastFailure) {
        process.stderr.write(`Error: experiment in progress (state: ${replayed.currentState}). Use exp resume.\n`);
        return 2;
      }
      if (replayed.isTerminal && !args.newRun) {
        process.stderr.write(`Error: experiment already in terminal state ${replayed.currentState}. Use --new-run to start fresh.\n`);
        return 2;
      }
      if (replayed.isTerminal && args.newRun) {
        await store.archiveState();
      }
      await upsertRegistry(args.expDir, new Date().toISOString());
      const coord = await makeCoordinator(args.expDir);
      await coord.run();
      return 0;
    }

    case "resume": {
      ensureProvider();
      const store = new ExpStore(args.expDir);
      const replayed = await store.replayState();
      if (replayed.currentState !== "Deciding") {
        process.stderr.write(`Error: cannot resume — experiment is in state ${replayed.currentState}. Only Deciding state supports resume.\n`);
        return 2;
      }
      await upsertRegistry(args.expDir, new Date().toISOString());
      const coord = await makeCoordinator(args.expDir);
      await coord.resume();
      return 0;
    }

    case "show": {
      const store = new ExpStore(args.expDir);
      const replayed = await store.replayState();
      const rounds = await store.readAllRounds();
      const lineage = await store.readLineage();
      const mission = await store.readMission().catch(() => null);
      const events = await store.readAllEvents().catch(() => [] as Record<string, unknown>[]);
      process.stdout.write(`State: ${replayed.currentState}  Round: ${replayed.currentRound}\n`);
      if (mission?.next_change) {
        process.stdout.write(`Suggested next change:\n  target: ${mission.next_change.target}\n  hypothesis: ${mission.next_change.hypothesis}\n`);
      }
      if (rounds.length > 0) {
        const last = rounds[rounds.length - 1];
        process.stdout.write(`Last round scores: outcome=${last.scores?.outcome.toFixed(2) ?? "?"}, trajectory=${last.scores?.trajectory.toFixed(2) ?? "?"}\n`);
        if (last.triage_conclusion) {
          process.stdout.write(`Triage: ${last.triage_conclusion.diagnoses.join("; ")}\n`);
        }
      }
      // Read last TriageComplete event for failure_attribution
      const lastTriage = events.filter((e) => e["type"] === "TriageComplete").at(-1) as Record<string, unknown> | undefined;
      const attribution = Array.isArray(lastTriage?.["failure_attribution"])
        ? lastTriage["failure_attribution"] as FailureAttribution[]
        : [];
      const attrText = formatFailureAttribution(attribution);
      if (attrText) {
        process.stdout.write(`${attrText}\n`);
      }
      process.stdout.write(`Lineage: ${lineage.length} versions\n`);
      return 0;
    }

    case "status": {
      const store = new ExpStore(args.expDir);
      const replayed = await store.replayState();
      process.stdout.write(`${args.expDir}: ${replayed.currentState} (round ${replayed.currentRound})\n`);
      return 0;
    }

    case "abort": {
      const store = new ExpStore(args.expDir);
      await store.writeAbortSignal();
      process.stdout.write(`Abort signal written. Running process will stop at next checkpoint.\n`);
      return 0;
    }

    case "doctor": {
      const store = new ExpStore(args.expDir);
      return runDoctor(args.expDir, store);
    }
  }
}

async function runDoctor(expDir: string, store: ExpStore): Promise<number> {
  let ok = true;
  const check = (label: string, pass: boolean, msg: string) => {
    process.stdout.write(`${pass ? "✓" : "✗"} ${label}${pass ? "" : `: ${msg}`}\n`);
    if (!pass) ok = false;
  };

  try {
    const mission = await store.readMission();
    check("mission.md valid", true, "");
    for (const es of mission.eval_sets) {
      const esPath = path.join(expDir, es.path);
      try {
        await fs.access(esPath);
        check(`eval_set ${es.path}`, true, "");
      } catch {
        check(`eval_set ${es.path}`, false, `not found: ${esPath}`);
      }
    }
    const candPath = path.join(expDir, mission.current_candidate.path);
    try {
      await fs.access(candPath);
      check("current_candidate readable", true, "");
    } catch {
      check("current_candidate readable", false, `not found: ${candPath}`);
    }
  } catch (e) {
    check("mission.md valid", false, String(e));
  }

  const health = await getHealthChecks(expDir);
  check("claude-code provider available", health.provider_available, "run: npx @anthropic-ai/claude-code --version");
  check("no step_failed in events", health.no_step_failed, "step_failed found in events.jsonl");

  return ok ? 0 : 1;
}

async function makeCoordinator(expDir: string): Promise<ExperimentCoordinator> {
  let baseUrl = process.env["KWEAVER_BASE_URL"] ?? "";
  let token = process.env["KWEAVER_TOKEN"] ?? "";
  const bd = process.env["KWEAVER_BUSINESS_DOMAIN"] ?? "bd_public";
  if (!baseUrl || !token) {
    const t = await ensureValidToken();
    if (!baseUrl) baseUrl = t.baseUrl;
    if (!token) token = t.accessToken;
  }

  let semanticMatchProvider: SemanticMatchProvider | undefined;
  try {
    const provider = defaultRegistry.resolve({ requiredCapabilities: ["structured_output"] });
    if (provider && (await provider.isAvailable())) {
      const promptRegistry = new PromptTemplateRegistry();
      await promptRegistry.loadBuiltinDir(EVAL_SET_RUBRIC_DIR);
      semanticMatchProvider = createBuiltinSemanticMatchProvider({ provider, promptRegistry, lang: "zh" });
    }
  } catch {
    process.stderr.write("warn: could not create semantic-match provider — semantic_match assertions will be skipped\n");
  }

  // Read mission upfront so KN/Skill clients are only constructed when the
  // experiment actually enables those layers. Avoids exposing stub clients
  // (KweaverKnApiClient, KweaverSkillApiClient — both throw "not yet implemented")
  // to missions that don't need them.
  const mission = await new ExpStore(expDir).readMission();
  const enabled = new Set(mission.enabled_targets);
  const needsKn = enabled.has("kn.object_type") || enabled.has("kn.relation_type");
  const needsSkill = enabled.has("skill.content");

  const mcpUrl = baseUrl.replace(/\/+$/, "") + MCP_PATH;
  const knSchemaClient = new KweaverKnSchemaClient(mcpUrl, token);
  const vegaCatalogClient = new KweaverVegaCatalogClient(baseUrl, token);

  // Wire probeObjectTypes with auth + businessDomain
  const boundProbe = (
    schema: Parameters<typeof probeObjectTypes>[0],
    failures: Parameters<typeof probeObjectTypes>[1],
  ) => probeObjectTypes(schema, failures, queryResource, { baseUrl, accessToken: token });

  // No-op SkillApiClient lets ContextAssembler pre-fetch bound_skill stubs even when
  // skill.content isn't enabled (the bound list is informational for the planner).
  const noopSkillContextClient: SkillApiClient = {
    async getSkillContent(_id: string) { return ""; },
    async publishSkillVersion(_id: string, _content: string) { return { version: "noop", content: "" }; },
  };

  const contextAssembler = new ContextAssembler(
    knSchemaClient,
    vegaCatalogClient,
    noopSkillContextClient,
    boundProbe,
  );

  return new ExperimentCoordinator({
    expDir,
    triage: new ClaudeCodeTriageClient(),
    contextAssembler,
    fetchAgentConfig: (agentId, version) =>
      fetchAgentConfigApi({ baseUrl, accessToken: token, agentId, version, businessDomain: bd }),
    knClient: needsKn ? new KweaverKnApiClient(baseUrl, token) : undefined,
    skillClient: needsSkill ? new KweaverSkillApiClient(baseUrl, token) : undefined,
    fetchTrace: async (conversationId) => {
      const r = await getTracesByConversation({ baseUrl, accessToken: token, conversationId, businessDomain: bd });
      return { spans: r.spans };
    },
    runEval: ({ evalSetPaths, candidatePath, round }) => runEval({
      evalSetPaths,
      candidatePath,
      expDir,
      round,
      maxParallel: 2,
      deps: {
        fetchAgent: async (agentId) =>
          fetchAgentInfo({ baseUrl, accessToken: token, agentId, version: "latest", businessDomain: bd }),
        sendChat: async ({ agentInfo, query }) => {
          const result = await sendChatRequest({
            baseUrl,
            accessToken: token,
            agentId: agentInfo.id,
            agentKey: agentInfo.key,
            agentVersion: agentInfo.version,
            query,
            stream: true,
            businessDomain: bd,
          });
          return { text: result.text, conversationId: result.conversationId };
        },
        fetchTrace: async (conversationId) => {
          const r = await getTracesByConversation({ baseUrl, accessToken: token, conversationId, businessDomain: bd });
          return { spans: r.spans };
        },
        semanticMatchProvider,
      },
    }),
  });
}
