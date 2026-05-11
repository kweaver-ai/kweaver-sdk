import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { fileURLToPath } from "node:url";

import { getTraceById } from "../../api/trace.js";
import { assembleTraceTree } from "./trace-shaper.js";
import { loadRules, RuleLoadError } from "./rule-loader.js";
import { runRules, RuleProbeError } from "./signal-probe.js";
import { templateSynthesize } from "./synthesizer-template.js";
import { assembleReport, reportToYamlObject } from "./report-assembler.js";
import type { DiagnoseOpts, Report } from "./types.js";

import "./builtin-rules/register.js";  // side effect: registers all builtin predicates

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUILTIN_DIR = path.join(__dirname, "builtin-rules");

export class TraceNotFoundError extends Error {
  constructor(traceId: string) {
    super(`trace not found: ${traceId}`);
    this.name = "TraceNotFoundError";
  }
}

export async function diagnose(traceId: string, opts: DiagnoseOpts): Promise<Report> {
  const cwdRulesDir = opts.rulesDir ?? path.join(process.cwd(), "diagnosis-rules");

  const rawSpans = await getTraceById({
    baseUrl: opts.baseUrl,
    token: opts.token,
    businessDomain: opts.businessDomain,
    traceId,
  });
  if (rawSpans.length === 0) throw new TraceNotFoundError(traceId);

  const tree = assembleTraceTree(traceId, rawSpans);

  const rules = await loadRules({
    builtinDir: BUILTIN_DIR,
    cwdRulesDir,
    extraRulesDir: null,
    noBuiltin: opts.noBuiltin,
  });

  const hits = await runRules(rules, tree);

  const version = await cliVersion();

  // Build provisional findings list to feed the synthesizer.
  const provisionalReport = assembleReport({
    traceId,
    agentId: extractAgentId(tree),
    tenant: extractTenant(tree),
    cliVersion: version,
    rules,
    hits,
    summary: { headline: "", primaryRootCause: null, fixPriority: [], crossFindingLinks: [] },
  });

  const summary = templateSynthesize(provisionalReport.findings);
  const report: Report = { ...provisionalReport, summary };

  if (opts.out !== null) {
    const outPath = opts.out === "default"
      ? path.join(process.cwd(), "diagnosis", `${traceId}.yaml`)
      : opts.out;
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, yaml.dump(reportToYamlObject(report)), "utf8");
  } else {
    process.stdout.write(yaml.dump(reportToYamlObject(report)));
  }

  if (report.findings.length === 0) {
    process.stderr.write("no findings\n");
  }

  return report;
}

function extractAgentId(tree: ReturnType<typeof assembleTraceTree>): string | null {
  for (const s of tree.spans) {
    const v = s.attributes["gen_ai.agent.id"];
    if (typeof v === "string") return v;
  }
  return null;
}

function extractTenant(tree: ReturnType<typeof assembleTraceTree>): string | null {
  for (const s of tree.spans) {
    const v = s.attributes["tenant"];
    if (typeof v === "string") return v;
  }
  return null;
}

async function cliVersion(): Promise<string> {
  try {
    const pkgPath = path.join(__dirname, "..", "..", "..", "package.json");
    const txt = await fs.readFile(pkgPath, "utf8");
    return JSON.parse(txt).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export { TraceNotFoundError as DiagnoseTraceNotFound, RuleLoadError, RuleProbeError };
