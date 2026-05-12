import type { Report, Finding } from "../diagnose/types.js";

export interface Sample {
  trace_id: string;
  conversation_id: string | null;
  headline: string;
  rule_ids: string[];
  selected_as: string;     // human-readable reason ("top-1 high-severity for tool_loop_no_state_change", "outlier (rubric self-labeled FP)")
}

export interface SamplerOutput {
  samples: Sample[];
}

const SEVERITY_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };
const K_MAX = 5;

function dominantThreshold(N: number): number {
  return Math.max(3, Math.ceil(0.05 * N));
}

function pickTopBySeverityForRule(reports: Report[], ruleId: string): Report | null {
  let best: { report: Report; rank: number } | null = null;
  for (const r of reports) {
    for (const f of r.findings) {
      if (f.ruleId !== ruleId) continue;
      const rank = SEVERITY_RANK[f.severity] ?? 0;
      if (!best || rank > best.rank || (rank === best.rank && r.trace.traceId < best.report.trace.traceId)) {
        best = { report: r, rank };
      }
    }
  }
  return best?.report ?? null;
}

function isOutlierFinding(f: Finding): boolean {
  return f.judgmentKind === "rubric" && (f.likelyCause === "other" || f.severity === "low");
}

function toSample(r: Report, selectedAs: string): Sample {
  const rule_ids = [...new Set(r.findings.map((f) => f.ruleId))].sort();
  return {
    trace_id: r.trace.traceId,
    conversation_id: null,
    headline: r.summary.headline,
    rule_ids,
    selected_as: selectedAs,
  };
}

/**
 * Deterministic K=5 sampler: top-1 by severity per dominant rule (count ≥
 * max(3, 5% of N)) + up to one outlier (rubric self-labeled FP, e.g.
 * likely_cause='other' or severity='low'). Sorted by selected_as / trace_id
 * for stability.
 */
export function sample(reports: Report[]): SamplerOutput {
  const N = reports.length;
  if (N === 0) return { samples: [] };

  // Count rule frequency, identify dominant.
  const counts = new Map<string, number>();
  for (const r of reports) {
    for (const f of r.findings) {
      counts.set(f.ruleId, (counts.get(f.ruleId) ?? 0) + 1);
    }
  }
  const threshold = dominantThreshold(N);
  const dominantRules = [...counts.entries()]
    .filter(([, c]) => c >= threshold)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([id]) => id);

  const picked: Sample[] = [];
  const usedTraceIds = new Set<string>();

  // Top-1 by severity per dominant rule.
  for (const ruleId of dominantRules) {
    if (picked.length >= K_MAX) break;
    const r = pickTopBySeverityForRule(reports, ruleId);
    if (r && !usedTraceIds.has(r.trace.traceId)) {
      picked.push(toSample(r, `top-1 high-severity for ${ruleId}`));
      usedTraceIds.add(r.trace.traceId);
    }
  }

  // One outlier (rubric self-labeled FP) if there's slack.
  if (picked.length < K_MAX) {
    for (const r of reports) {
      if (usedTraceIds.has(r.trace.traceId)) continue;
      const fpFinding = r.findings.find(isOutlierFinding);
      if (fpFinding) {
        picked.push(toSample(r, `outlier (rubric self-labeled FP for ${fpFinding.ruleId})`));
        usedTraceIds.add(r.trace.traceId);
        break;
      }
    }
  }

  return { samples: picked.slice(0, K_MAX) };
}
