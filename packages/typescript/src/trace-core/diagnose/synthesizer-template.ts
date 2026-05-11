import type { Finding, Summary, SummaryFixPriority, SummaryCrossLink } from "./types.js";

const SEVERITY_RANK: Record<Finding["severity"], number> = { high: 3, medium: 2, low: 1 };

function overlapRatio(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const intersect = b.filter((x) => setA.has(x)).length;
  const smaller = Math.min(a.length, b.length);
  return intersect / smaller;
}

export function templateSynthesize(findings: Finding[]): Summary {
  if (findings.length === 0) {
    return {
      headline: "No findings",
      primaryRootCause: null,
      fixPriority: [],
      crossFindingLinks: [],
    };
  }

  // Sort indices by severity desc, stable on original index (so same input → same output).
  const indices = findings.map((_, i) => i);
  indices.sort((i, j) => {
    const r = SEVERITY_RANK[findings[j].severity] - SEVERITY_RANK[findings[i].severity];
    return r !== 0 ? r : i - j;
  });

  const topIdx = indices[0];
  const top = findings[topIdx];
  const headline = `see findings[${topIdx}]: ${top.symptom}`;

  const primaryRootCause = {
    findingIds: [topIdx],
    description: `Top-severity finding from rule '${top.ruleId}': ${top.symptom}`,
    targetForFix: top.suggestedFix.target,
  };

  const fixPriority: SummaryFixPriority[] = indices.map((i) => ({
    findingId: i,
    reason: `severity=${findings[i].severity}`,
  }));

  const crossFindingLinks: SummaryCrossLink[] = [];
  for (let i = 0; i < findings.length; i++) {
    for (let j = i + 1; j < findings.length; j++) {
      if (overlapRatio(findings[i].evidence.spans, findings[j].evidence.spans) >= 0.5) {
        crossFindingLinks.push({
          findingIds: [i, j],
          relation: "overlapping_evidence_spans",
        });
      }
    }
  }

  return { headline, primaryRootCause, fixPriority, crossFindingLinks };
}
