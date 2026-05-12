// Human-readable markdown view of a trace-diagnose report.
//
// The YAML report (see `report-assembler.reportToYamlObject`) is the source of
// truth; this file is a pure projection. Persisted alongside the yaml when
// `--format=both`. Markdown was chosen over a stdout pretty-print because
// reports are commonly pasted into tickets / PRs / wikis where ephemeral
// terminal output would be lost.
//
// Structure (inverted-pyramid: most actionable first):
//   1. Title + one-line meta
//   2. Summary  — headline (+ primary root cause if any)
//   3. Fix priority table   (omitted when empty)
//   4. Findings — one section per finding, excerpt as a blockquote
//   5. Cross-finding links  (omitted when empty)
//   6. Run    — mode / synthesizer / rules applied & skipped (reference)

import type { Finding, Report } from "./types.js";

export function renderReportMarkdown(r: Report): string {
  const lines: string[] = [];
  const shortId = r.trace.traceId.length > 16 ? `${r.trace.traceId.slice(0, 16)}…` : r.trace.traceId;
  lines.push(`# Trace Diagnose Report — \`${shortId}\``);
  lines.push("");
  lines.push(
    `> trace \`${r.trace.traceId}\` · agent \`${r.trace.agentId ?? "—"}\` · tenant \`${r.trace.tenant ?? "—"}\` · diagnosed ${r.run.diagnosedAt} · cli \`${r.run.cliVersion}\``,
  );
  lines.push("");

  // ── Summary ──────────────────────────────────────────────────────────────
  lines.push("## Summary");
  lines.push("");
  lines.push(`**${r.summary.headline}**`);
  lines.push("");
  if (r.summary.primaryRootCause !== null) {
    const rc = r.summary.primaryRootCause;
    const fids = rc.findingIds.map((i) => `#${i}`).join(", ");
    lines.push(`Primary root cause spans findings ${fids} — target for fix: \`${rc.targetForFix}\`.`);
    lines.push("");
    lines.push(`> ${escapeBlockquote(rc.description)}`);
    lines.push("");
  }

  // ── Fix priority ─────────────────────────────────────────────────────────
  if (r.summary.fixPriority.length > 0) {
    lines.push("## Fix priority");
    lines.push("");
    lines.push("| Order | Finding | Rule | Reason |");
    lines.push("|---|---|---|---|");
    r.summary.fixPriority.forEach((p, idx) => {
      const f = r.findings[p.findingId];
      const ruleCell = f ? `\`${f.ruleId}\` [${f.severity}/${f.judgmentKind}]` : `(unknown #${p.findingId})`;
      lines.push(`| ${idx + 1} | #${p.findingId} | ${ruleCell} | ${escapeTableCell(p.reason)} |`);
    });
    lines.push("");
  }

  // ── Findings ─────────────────────────────────────────────────────────────
  lines.push(`## Findings (${r.findings.length})`);
  lines.push("");
  if (r.findings.length === 0) {
    lines.push(`_No findings were emitted by any of the ${r.run.rulesApplied.length} applied rules._`);
    lines.push("");
  } else {
    r.findings.forEach((f, idx) => renderFinding(lines, f, idx));
  }

  // ── Cross-finding links ──────────────────────────────────────────────────
  if (r.summary.crossFindingLinks.length > 0) {
    lines.push("## Cross-finding links");
    lines.push("");
    for (const link of r.summary.crossFindingLinks) {
      const ids = link.findingIds.map((i) => `#${i}`).join(" ↔ ");
      lines.push(`- ${ids} — ${link.relation}`);
    }
    lines.push("");
  }

  // ── Run reference ────────────────────────────────────────────────────────
  lines.push("## Run");
  lines.push("");
  lines.push(
    `- **mode**: \`${r.run.mode}\` · **synthesizer**: \`${r.run.synthesizerMode}\` · **rules**: ${r.run.rulesApplied.length} applied, ${r.run.rulesSkipped.length} skipped`,
  );
  lines.push(`- **applied**: ${r.run.rulesApplied.map((id) => `\`${id}\``).join(", ")}`);
  if (r.run.rulesSkipped.length > 0) {
    lines.push("- **skipped**:");
    for (const s of r.run.rulesSkipped) {
      lines.push(`    - \`${s.ruleId}\` — ${s.reason}`);
    }
  }
  lines.push("");

  return lines.join("\n");
}

function renderFinding(lines: string[], f: Finding, idx: number): void {
  lines.push(`### #${idx} \`${f.ruleId}\` — [${f.severity}/${f.judgmentKind}]`);
  lines.push("");
  if (f.evidence.excerpt.trim().length > 0) {
    for (const ln of f.evidence.excerpt.trim().split(/\r?\n/)) {
      lines.push(`> ${ln}`);
    }
    lines.push("");
  }
  const meta: string[] = [];
  meta.push(`- **symptom**: ${f.symptom}`);
  meta.push(`- **likely cause**: ${f.likelyCause}`);
  meta.push(`- **confidence**: ${f.confidence}`);
  if (f.evidence.spans.length > 0) {
    meta.push(`- **evidence spans**: ${f.evidence.spans.map((s) => `\`${s}\``).join(", ")}`);
  }
  meta.push(`- **suggested fix** → \`${f.suggestedFix.target}\`: ${f.suggestedFix.change}`);
  if (f.verifyWith.suggestedEvalCase.assertions.length > 0) {
    meta.push(`- **verify with**:`);
    for (const a of f.verifyWith.suggestedEvalCase.assertions) {
      meta.push(`    - ${a}`);
    }
  }
  for (const m of meta) lines.push(m);
  lines.push("");
}

function escapeTableCell(s: string): string {
  // Pipes and newlines break GFM tables; collapse newlines and escape `|`.
  return s.replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
}

function escapeBlockquote(s: string): string {
  // Blockquote-safe; just collapse newlines so the whole description sits in one line.
  return s.replace(/\r?\n+/g, " ").trim();
}
