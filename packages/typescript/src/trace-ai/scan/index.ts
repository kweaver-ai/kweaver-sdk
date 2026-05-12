import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { fileURLToPath } from "node:url";

import { getSpansByConversationId, type RawSpan } from "../../api/trace.js";
import { assembleTraceTree } from "../diagnose/trace-shaper.js";
import { loadRules } from "../diagnose/rule-loader.js";
import "../diagnose/builtin-rules/register.js";  // side effect: registers all builtin predicates
import { runRules, rubricRules } from "../diagnose/signal-probe.js";
import { templateSynthesize } from "../diagnose/synthesizer-template.js";
import { assembleReport, reportToYamlObject, symbolicHitsToFindings } from "../diagnose/report-assembler.js";
import { renderReportMarkdown } from "../diagnose/report-markdown.js";
import { ReportSchema } from "../diagnose/schemas.js";
import type { Report } from "../diagnose/types.js";

import { defaultRegistry } from "../../agent-providers/registry.js";
import { defaultPromptRegistry, PromptTemplateRegistry } from "../../agent-providers/prompt-template.js";

import { resolveRubricInput, renderChangeTemplate } from "../diagnose/agent-binding.js";

import { validateSingleAgent } from "./single-agent-validator.js";
import { runPerTracePipeline } from "./runner.js";
import { runBatchedRubric, type BatchTraceItem, type BatchedRubricRule } from "./batched-rubric.js";
import { aggregate } from "./aggregator.js";
import { sample } from "./sampler.js";
import { runCrossTraceSynthesizer } from "./cross-trace-synthesizer.js";
import { renderScanSummaryMarkdown } from "./scan-summary-markdown.js";
import { ScanSummarySchema, type ScanSummary } from "./scan-summary-schema.js";
import { ArtifactWriter } from "./artifacts/writer.js";
import { resolveArtifactsBase } from "./artifacts/paths.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUILTIN_RULES_DIR = path.join(__dirname, "..", "diagnose", "builtin-rules");
const SHARED_PROMPT_DIR = path.join(__dirname, "..", "..", "agent-providers", "prompts");
const SCAN_PROMPT_DIR = path.join(__dirname, "prompts", "builtin");

export interface RunBatchOpts {
  traces: string[];                    // conversation_ids (already parsed)
  out: string;                         // directory
  rulesDir: string | null;
  noBuiltin: boolean;
  noArtifacts: boolean;
  lang?: "en" | "zh";
  /**
   * Output format. The YAML report is always written (it's the resume
   * ground truth via ReportSchema.safeParse). Markdown is written when
   * format ∈ {'markdown', 'both'}. Default: 'both'.
   */
  format?: "yaml" | "markdown" | "both";
  timeoutMs: number;
  maxParallel: number;
  baseUrl: string;
  token: string;
  businessDomain: string;
}

export interface RunBatchResult {
  scanSummaryPath: string;
  perTraceReportPaths: string[];
  tracesDiagnosed: number;
  tracesReused: number;
}

async function ensurePromptsLoaded(reg: PromptTemplateRegistry): Promise<void> {
  await reg.loadBuiltinDir(SHARED_PROMPT_DIR).catch(() => undefined);
  await reg.loadBuiltinDir(SCAN_PROMPT_DIR).catch(() => undefined);
}

async function readReportFromDisk(yamlPath: string): Promise<Report> {
  const text = await fs.readFile(yamlPath, "utf8");
  const obj = yaml.load(text);
  const parsed = ReportSchema.parse(obj);
  return {
    schemaVersion: "trace-diagnose-report/v1",
    trace: {
      traceId: parsed.trace.trace_id,
      agentId: parsed.trace.agent_id,
      tenant: parsed.trace.tenant,
    },
    run: {
      diagnosedAt: parsed.run.diagnosed_at,
      cliVersion: parsed.run.cli_version,
      mode: parsed.run.mode,
      rulesApplied: parsed.run.rules_applied,
      rulesSkipped: parsed.run.rules_skipped.map((s) => ({
        ruleId: s.rule_id,
        reason: s.reason,
      })),
      synthesizerMode: parsed.run.synthesizer_mode,
    },
    summary: {
      headline: parsed.summary.headline,
      primaryRootCause:
        parsed.summary.primary_root_cause === null
          ? null
          : {
              findingIds: parsed.summary.primary_root_cause.finding_ids,
              description: parsed.summary.primary_root_cause.description,
              targetForFix: parsed.summary.primary_root_cause.target_for_fix,
            },
      fixPriority: parsed.summary.fix_priority.map((p) => ({
        findingId: p.finding_id,
        reason: p.reason,
      })),
      crossFindingLinks: parsed.summary.cross_finding_links.map((l) => ({
        findingIds: l.finding_ids,
        relation: l.relation,
      })),
    },
    findings: parsed.findings.map((f) => ({
      ruleId: f.rule_id,
      judgmentKind: f.judgment_kind,
      severity: f.severity,
      symptom: f.symptom,
      likelyCause: f.likely_cause,
      evidence: { spans: f.evidence.spans, excerpt: f.evidence.excerpt },
      suggestedFix: { target: f.suggested_fix.target, change: f.suggested_fix.change },
      confidence: f.confidence,
      verifyWith: {
        suggestedEvalCase: {
          queryId: f.verify_with.suggested_eval_case.query_id,
          query: f.verify_with.suggested_eval_case.query,
          assertions: f.verify_with.suggested_eval_case.assertions,
        },
      },
    })),
  };
}

/**
 * Orchestrator: walks N conv_ids through the batch pipeline.
 * Single-agent enforced; --no-llm rejected by CLI (not here).
 */
export async function runBatch(opts: RunBatchOpts): Promise<RunBatchResult> {
  const t_start = Date.now();
  const registry = defaultRegistry;
  const promptRegistry = defaultPromptRegistry;
  await ensurePromptsLoaded(promptRegistry);
  const writeFormats = opts.format ?? "both";

  // 1. Single-agent validation (also caches first batch of getSpansByConversationId results)
  const cachedSpans = new Map<string, RawSpan[]>();
  const validation = await validateSingleAgent(opts.traces, async (convId) => {
    const fetched = await getSpansByConversationId({
      baseUrl: opts.baseUrl,
      token: opts.token,
      businessDomain: opts.businessDomain,
      conversationId: convId,
    });
    cachedSpans.set(convId, fetched.spans);
    return {
      spans: fetched.spans.map((s) => ({ attributes: (s.attributes ?? {}) as Record<string, unknown> })),
      conversation_id: convId,
    };
  });
  const agentId = validation.agentId;

  // 2. Artifacts writer
  const artifactsBase = resolveArtifactsBase({ mode: "batch", out: opts.out });
  const artifacts = new ArtifactWriter({ base: artifactsBase, enabled: !opts.noArtifacts });

  // 3. Load rules (gates_on metadata available after this)
  const rules = await loadRules({
    builtinDir: opts.noBuiltin ? null : BUILTIN_RULES_DIR,
    cwdRulesDir: opts.rulesDir,
    extraRulesDir: null,
    noBuiltin: opts.noBuiltin,
  });

  // 4. Per-trace Stage-1 + Stage-3-template + initial yaml write (parallel-bounded)
  type PerTraceResult = { convId: string; report: Report; reused: boolean };
  const allRubricWork: { rule: (typeof rules)[0]; trace: BatchTraceItem }[] = [];

  const t_stage1 = Date.now();
  const perTrace: PerTraceResult[] = [];
  let cursor = 0;
  while (cursor < opts.traces.length) {
    const chunk = opts.traces.slice(cursor, cursor + opts.maxParallel);
    const results = await Promise.all(
      chunk.map(async (convId) => {
        const r = await runPerTracePipeline({
          convId,
          outDir: opts.out,
          runDiagnose: async (id, partial) => {
            const rawSpans =
              cachedSpans.get(id) ??
              (
                await getSpansByConversationId({
                  baseUrl: opts.baseUrl,
                  token: opts.token,
                  businessDomain: opts.businessDomain,
                  conversationId: id,
                })
              ).spans;
            const firstTraceId = rawSpans.find((s) => s.traceId)?.traceId ?? id;
            const tree = assembleTraceTree(firstTraceId, rawSpans);
            const hitsMap = await runRules(rules, tree);
            const symbolicFindings = symbolicHitsToFindings(rules, hitsMap);

            // Determine which symbolic rules fired (for paired-gate rubric filtering)
            const firedRuleIds = new Set(symbolicFindings.map((f) => f.ruleId));
            for (const rule of rubricRules(rules)) {
              const gates = rule.rubric?.gatesOn;
              if (gates && gates.length > 0 && !gates.some((g) => firedRuleIds.has(g))) continue;
              const resolvedInputs: Record<string, unknown> = {};
              for (const inp of rule.rubric!.inputs) {
                resolvedInputs[inp.kind] = resolveRubricInput(inp, tree);
              }
              allRubricWork.push({
                rule,
                trace: {
                  traceId: tree.traceId,
                  spans: tree.spans.map((s) => s.spanId),
                  inputs: resolvedInputs,
                },
              });
            }

            const summary = templateSynthesize(symbolicFindings);
            const report = assembleReport({
              traceId: tree.traceId,
              agentId,
              tenant: null,
              cliVersion: "0.7.4",
              rules,
              hits: hitsMap,
              extraFindings: [],
              summary,
              mode: "hybrid",
              synthesizerMode: "template",
            });
            await fs.writeFile(partial, yaml.dump(reportToYamlObject(report)), "utf8");
            if (writeFormats !== "yaml") {
              await fs.writeFile(
                path.join(path.dirname(partial), `${id}.md`),
                renderReportMarkdown(report, { conversationId: id, businessDomain: opts.businessDomain }),
                "utf8",
              );
            }
            return { traceId: tree.traceId, agentId };
          },
        });

        // Re-read the (possibly just-written, possibly reused) report from disk
        const report = await readReportFromDisk(path.join(opts.out, `${convId}.yaml`));
        return { convId, report, reused: r.reused };
      }),
    );
    perTrace.push(...results);
    cursor += opts.maxParallel;
  }
  const t_stage1_end = Date.now();

  // 5. Stage-2 batched rubric (per rule, chunks of 10)
  const t_stage2_start = Date.now();
  let stage2Chunks = 0;

  // Group rubric work by rule_id
  const workByRule = new Map<string, typeof allRubricWork>();
  for (const w of allRubricWork) {
    const arr = workByRule.get(w.rule.id) ?? [];
    arr.push(w);
    workByRule.set(w.rule.id, arr);
  }

  for (const [ruleId, items] of workByRule.entries()) {
    const rule = items[0].rule;
    const traces = items.map((i) => i.trace);
    stage2Chunks += Math.ceil(traces.length / 10);

    let provider;
    try {
      provider = registry.resolve({ preferred: rule.rubric!.agentBinding.provider });
    } catch {
      // Provider not registered — skip this rule
      continue;
    }
    if (!provider) continue;

    const batchedRule: BatchedRubricRule = {
      ruleId,
      judgeQuestion: rule.rubric!.judgeQuestion,
      outputSchema: rule.rubric!.outputZodSchema,
      outputSchemaRaw: rule.rubric!.outputSchemaRaw,
      promptTemplateRef: "builtin:rubric-judge-batch-v1",
    };
    const result = await runBatchedRubric({
      rule: batchedRule,
      traces,
      agentId,
      provider,
      promptRegistry,
      chunkSize: 10,
      lang: opts.lang,
      artifacts,
      timeoutMs: opts.timeoutMs,
    });

    // Fold verdicts back into per-trace report objects
    for (const v of result.verdicts) {
      const pt = perTrace.find((p) => p.report.trace.traceId === v.traceId);
      if (!pt) continue;
      // Build bindings for change_template / assertion_templates rendering.
      // Bindings shape matches what PR-B single-trace agent-binding.ts passes:
      // the rubric verdict's `out` object (category, severity, reasoning, first_violating_step_id, evidence_span_ids).
      const bindings: Record<string, unknown> = {
        category: v.category,
        reasoning: v.reasoning,
        severity: v.severity,
        first_violating_step_id: v.firstViolatingStepId,
        evidence_span_ids: v.evidenceSpanIds,
      };
      pt.report.findings.push({
        ruleId,
        judgmentKind: "rubric",
        severity: v.severity,
        symptom: rule.symptom,
        likelyCause: v.category,
        evidence: { spans: v.evidenceSpanIds, excerpt: v.reasoning },
        suggestedFix: {
          target: rule.suggestedFix.target,
          change: renderChangeTemplate(rule.suggestedFix.changeTemplate, bindings),
        },
        confidence: "medium",
        verifyWith: {
          suggestedEvalCase: {
            queryId: null,
            query: null,
            assertions: rule.verifyWith.assertionTemplates.map((t) => renderChangeTemplate(t, bindings)),
          },
        },
      });
      // Re-write yaml + md with updated findings
      await fs.writeFile(
        path.join(opts.out, `${pt.convId}.yaml`),
        yaml.dump(reportToYamlObject(pt.report)),
        "utf8",
      );
      if (writeFormats !== "yaml") {
        await fs.writeFile(
          path.join(opts.out, `${pt.convId}.md`),
          renderReportMarkdown(pt.report, { conversationId: pt.convId, businessDomain: opts.businessDomain }),
          "utf8",
        );
      }
    }
    for (const s of result.skipped) {
      const pt = perTrace.find((p) => p.report.trace.traceId === s.traceId);
      if (!pt) continue;
      pt.report.run.rulesSkipped.push({ ruleId, reason: s.reason });
      await fs.writeFile(
        path.join(opts.out, `${pt.convId}.yaml`),
        yaml.dump(reportToYamlObject(pt.report)),
        "utf8",
      );
    }
  }
  const t_stage2_end = Date.now();

  // 6. Aggregator + sampler
  const allReports = perTrace.map((p) => p.report);
  const aggregates = aggregate(allReports);
  const samplerOutput = sample(allReports);

  // 7. Stage-4: cross-trace synth
  const t_stage4_start = Date.now();
  let synthProvider;
  try {
    synthProvider = registry.resolve({});
  } catch {
    synthProvider = null;
  }
  let synthSummary: ScanSummary["summary"] = null;
  if (synthProvider) {
    const result = await runCrossTraceSynthesizer({
      agentId,
      aggregates,
      samples: samplerOutput,
      nTotal: allReports.length,
      provider: synthProvider,
      promptRegistry,
      lang: opts.lang,
      artifacts,
      timeoutMs: opts.timeoutMs,
    });
    synthSummary = result.summary;
  }
  const t_stage4_end = Date.now();

  // 8. Assemble + write scan-summary
  const tracesReused = perTrace.filter((p) => p.reused).length;
  const scanSummary: ScanSummary = {
    schema_version: "scan-summary/v1",
    scan: {
      agent_id: agentId,
      trace_count: allReports.length,
      traces_with_findings: allReports.filter((r) => r.findings.length > 0).length,
      traces_reused: tracesReused,
      traces_freshly_diagnosed: allReports.length - tracesReused,
      resumed_from_partial: tracesReused > 0,
      diagnosed_at: new Date().toISOString(),
      cli_version: "0.7.4",
      synthesizer_mode: "agent",
    },
    summary: synthSummary,
    aggregates,
    per_trace_index: perTrace.map((p) => ({
      trace_id: p.report.trace.traceId,
      conversation_id: p.convId,
      report_path: `${p.convId}.yaml`,
      finding_count: p.report.findings.length,
    })),
  };
  const scanSummaryYamlPath = path.join(opts.out, "scan-summary.yaml");
  const scanSummaryMdPath = path.join(opts.out, "scan-summary.md");
  await fs.writeFile(scanSummaryYamlPath, yaml.dump(scanSummary), "utf8");
  if (writeFormats !== "yaml") {
    await fs.writeFile(scanSummaryMdPath, renderScanSummaryMarkdown(scanSummary), "utf8");
  }

  // 9. Run metadata artifact
  const t_total = Date.now() - t_start;
  await artifacts.writeRunMetadata({
    cli_args: { traces: opts.traces, out: opts.out, lang: opts.lang ?? "en" },
    agent_id: agentId,
    rule_load_summary: {
      rules_applied: rules.map((r) => r.id),
      rules_skipped_at_load: [],
      rules_dir: opts.rulesDir ?? "builtin",
    },
    single_agent_validation: {
      checked_conv_ids: validation.checkedConvIds,
      agent_id_resolved: agentId,
    },
    timing: {
      stage_1_ms: t_stage1_end - t_stage1,
      stage_2_ms: t_stage2_end - t_stage2_start,
      stage_3_ms: 0,
      stage_4_ms: t_stage4_end - t_stage4_start,
      total_ms: t_total,
    },
    llm_calls: {
      stage_2_chunks: stage2Chunks,
      stage_3: 0,
      stage_4: synthSummary ? 1 : 0,
      total: stage2Chunks + (synthSummary ? 1 : 0),
    },
    cost_estimate_usd: {
      stage_2: stage2Chunks * 0.005,
      stage_4: (synthSummary ? 1 : 0) * 0.05,
      total: stage2Chunks * 0.005 + (synthSummary ? 1 : 0) * 0.05,
      model_price_table_version: "2026-05",
    },
  });

  return {
    scanSummaryPath: scanSummaryYamlPath,
    perTraceReportPaths: perTrace.map((p) => path.join(opts.out, `${p.convId}.yaml`)),
    tracesDiagnosed: allReports.length,
    tracesReused,
  };
}
