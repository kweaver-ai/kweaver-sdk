import type { Finding, Hit, Report, Rule, Summary } from "./types.js";

function renderTemplate(tpl: string, bindings: Record<string, unknown>): string {
  return tpl.replace(/{{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*}}/g, (_, key) => {
    const v = bindings[key];
    return v === undefined ? `{{${key}}}` : String(v);
  });
}

export interface AssembleReportOpts {
  traceId: string;
  agentId: string | null;
  tenant: string | null;
  cliVersion: string;
  rules: Rule[];
  hits: Map<string, Hit[]>;        // rule_id → hits
  summary: Summary;
}

export function assembleReport(opts: AssembleReportOpts): Report {
  const findings: Finding[] = [];
  for (const rule of opts.rules) {
    const ruleHits = opts.hits.get(rule.id) ?? [];
    for (const hit of ruleHits) {
      findings.push({
        ruleId: rule.id,
        judgmentKind: "symbolic",
        severity: rule.severity,
        symptom: rule.symptom,
        likelyCause: rule.symptom,    // PR-A: no LLM, so we mirror symptom; PR-B agent overrides this
        evidence: { spans: hit.evidenceSpans, excerpt: hit.excerpt },
        suggestedFix: {
          target: rule.suggestedFix.target,
          change: renderTemplate(rule.suggestedFix.changeTemplate, hit.bindings),
        },
        confidence: "low",
        verifyWith: {
          suggestedEvalCase: {
            queryId: null,            // PR-A: no query extraction yet (deferred per spec)
            query: null,
            assertions: rule.verifyWith.assertionTemplates.map((t) => renderTemplate(t, hit.bindings)),
          },
        },
      });
    }
  }
  return {
    schemaVersion: "trace-diagnose-report/v1",
    trace: { traceId: opts.traceId, agentId: opts.agentId, tenant: opts.tenant },
    run: {
      diagnosedAt: new Date().toISOString(),
      cliVersion: opts.cliVersion,
      mode: "symbolic-only",
      rulesApplied: opts.rules.map((r) => r.id),
      rulesSkipped: [],
      synthesizerMode: "template",
    },
    summary: opts.summary,
    findings,
  };
}

// Convert internal camelCase Report to the snake_case shape used by ReportSchema (and by yaml output).
export function reportToYamlObject(r: Report): unknown {
  return {
    schema_version: r.schemaVersion,
    trace: { trace_id: r.trace.traceId, agent_id: r.trace.agentId, tenant: r.trace.tenant },
    run: {
      diagnosed_at: r.run.diagnosedAt,
      cli_version: r.run.cliVersion,
      mode: r.run.mode,
      rules_applied: r.run.rulesApplied,
      rules_skipped: r.run.rulesSkipped.map((s) => ({ rule_id: s.ruleId, reason: s.reason })),
      synthesizer_mode: r.run.synthesizerMode,
    },
    summary: {
      headline: r.summary.headline,
      primary_root_cause: r.summary.primaryRootCause === null ? null : {
        finding_ids: r.summary.primaryRootCause.findingIds,
        description: r.summary.primaryRootCause.description,
        target_for_fix: r.summary.primaryRootCause.targetForFix,
      },
      fix_priority: r.summary.fixPriority.map((p) => ({ finding_id: p.findingId, reason: p.reason })),
      cross_finding_links: r.summary.crossFindingLinks.map((l) => ({ finding_ids: l.findingIds, relation: l.relation })),
    },
    findings: r.findings.map((f) => ({
      rule_id: f.ruleId,
      judgment_kind: f.judgmentKind,
      severity: f.severity,
      symptom: f.symptom,
      likely_cause: f.likelyCause,
      evidence: { spans: f.evidence.spans, excerpt: f.evidence.excerpt },
      suggested_fix: { target: f.suggestedFix.target, change: f.suggestedFix.change },
      confidence: f.confidence,
      verify_with: {
        suggested_eval_case: {
          query_id: f.verifyWith.suggestedEvalCase.queryId,
          query: f.verifyWith.suggestedEvalCase.query,
          assertions: f.verifyWith.suggestedEvalCase.assertions,
        },
      },
    })),
  };
}
