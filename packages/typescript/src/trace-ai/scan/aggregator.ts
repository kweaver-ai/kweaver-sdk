import type { Report } from "../diagnose/types.js";

export interface RuleFrequencyItem {
  rule_id: string;
  count: number;
  severity_breakdown: { high: number; medium: number; low: number };
}

export interface AggregatesBlock {
  rule_frequency: RuleFrequencyItem[];
}

/**
 * Deterministic aggregation over a list of per-trace reports.
 * - rule_frequency: counts each rule_id across all findings; severity_breakdown
 *   gives high/medium/low counts. Sorted by count descending, then rule_id
 *   ascending for stable ordering.
 */
export function aggregate(reports: Report[]): AggregatesBlock {
  const byRule = new Map<string, RuleFrequencyItem>();
  for (const r of reports) {
    for (const f of r.findings) {
      let item = byRule.get(f.ruleId);
      if (!item) {
        item = { rule_id: f.ruleId, count: 0, severity_breakdown: { high: 0, medium: 0, low: 0 } };
        byRule.set(f.ruleId, item);
      }
      item.count += 1;
      item.severity_breakdown[f.severity] += 1;
    }
  }
  const rule_frequency = [...byRule.values()].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.rule_id.localeCompare(b.rule_id);
  });
  return { rule_frequency };
}
