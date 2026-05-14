import type { QueryResult, ThreeAxisScores } from "./schemas.js";

interface Guardrail { name: string; kind: "hard" | "soft"; rule: string }

export function computeScores(results: QueryResult[], guardrails: Guardrail[]): ThreeAxisScores {
  if (results.length === 0) {
    return { outcome: 0, trajectory: 0, guardrail: 1, guardrail_hard_fail: false };
  }

  // Outcome: fraction of assertions that passed
  let totalAssertions = 0;
  let passedAssertions = 0;
  for (const r of results) {
    for (const a of r.assertion_results) {
      if (a.verdict === "skip") continue;
      totalAssertions++;
      if (a.verdict === "pass") passedAssertions++;
    }
  }
  const outcome = totalAssertions === 0 ? 1 : passedAssertions / totalAssertions;

  // Trajectory: penalize retries and errors
  let trajectorySum = 0;
  for (const r of results) {
    const { retry_count, error_codes } = r.trajectory_summary;
    const retryPenalty = Math.min(retry_count * 0.15, 0.6);
    const errorPenalty = error_codes.length > 0 ? 0.3 : 0;
    trajectorySum += Math.max(0, 1 - retryPenalty - errorPenalty);
  }
  const trajectory = trajectorySum / results.length;

  // Guardrail: check hard gates (any error_codes in results triggers hard gate if guardrail with kind="hard")
  let guardrail_hard_fail = false;
  let guardrail = 1;
  for (const g of guardrails) {
    if (g.kind === "hard") {
      const violated = results.some(r => r.trajectory_summary.error_codes.length > 0);
      if (violated) {
        guardrail_hard_fail = true;
        guardrail = 0;
        break;
      }
    }
  }

  return { outcome, trajectory, guardrail, guardrail_hard_fail };
}
