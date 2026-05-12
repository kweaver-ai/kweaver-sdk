// packages/typescript/src/trace-ai/scan/scan-summary-markdown.ts
import type { ScanSummary } from "./scan-summary-schema.js";

function rel(p: string): string { return p; }

export function renderScanSummaryMarkdown(s: ScanSummary): string {
  const lines: string[] = [];
  const scan = s.scan;
  lines.push(`# Trace Diagnose Batch Summary — agent \`${scan.agent_id}\``);
  lines.push("");
  const resumeBanner = scan.resumed_from_partial
    ? ` · resumed — ${scan.traces_reused} reused, ${scan.traces_freshly_diagnosed} freshly diagnosed`
    : "";
  lines.push(`> ${scan.trace_count} traces · ${scan.traces_with_findings} with findings · diagnosed ${scan.diagnosed_at} · cli \`${scan.cli_version}\`${resumeBanner}`);
  lines.push("");

  // ── Summary ────────────────────────────────────────────────────────────
  lines.push("## Summary");
  lines.push("");
  if (s.summary === null) {
    lines.push("_Stage-4 synthesizer did not complete; aggregates and per-trace reports are still emitted below._");
    lines.push("");
  } else {
    lines.push(`**${s.summary.headline}**`);
    lines.push("");
    if (s.summary.primary_root_cause) {
      const rc = s.summary.primary_root_cause;
      lines.push(`Primary root cause — rules ${rc.rule_ids.map((id) => `\`${id}\``).join(", ")}; target for fix: \`${rc.target_for_fix}\`.`);
      lines.push("");
      lines.push(`> ${rc.description.replace(/\r?\n+/g, " ")}`);
      lines.push("");
    }
  }

  // ── Fix priority ───────────────────────────────────────────────────────
  if (s.summary && s.summary.fix_priority.length > 0) {
    lines.push("## Fix priority");
    lines.push("");
    lines.push("| Order | Rule | Affected | Reason |");
    lines.push("|---|---|---|---|");
    s.summary.fix_priority.forEach((p, idx) => {
      lines.push(`| ${idx + 1} | \`${p.rule_id}\` | ${p.affected_trace_count} | ${p.reason.replace(/\|/g, "\\|").replace(/\r?\n/g, " ")} |`);
    });
    lines.push("");
  }

  // ── Cross-rule links ───────────────────────────────────────────────────
  if (s.summary && s.summary.cross_rule_links.length > 0) {
    lines.push("## Cross-rule links");
    lines.push("");
    for (const link of s.summary.cross_rule_links) {
      const ids = link.rule_ids.map((r) => `\`${r}\``).join(" ↔ ");
      lines.push(`- ${ids} — ${link.relation}`);
    }
    lines.push("");
  }

  // ── Aggregates ─────────────────────────────────────────────────────────
  lines.push("## Aggregates");
  lines.push("");
  lines.push("| Rule | Count | high | medium | low |");
  lines.push("|---|---|---|---|---|");
  for (const item of s.aggregates.rule_frequency) {
    lines.push(`| \`${item.rule_id}\` | ${item.count} | ${item.severity_breakdown.high} | ${item.severity_breakdown.medium} | ${item.severity_breakdown.low} |`);
  }
  lines.push("");

  // ── Per-trace index ────────────────────────────────────────────────────
  lines.push("## Per-Trace Reports");
  lines.push("");
  lines.push("| conv_id | trace_id | findings | report |");
  lines.push("|---|---|---|---|");
  for (const item of s.per_trace_index) {
    const mdPath = item.report_path.replace(/\.yaml$/, ".md");
    lines.push(`| \`${item.conversation_id}\` | \`${item.trace_id.slice(0, 16)}…\` | ${item.finding_count} | [yaml](${item.report_path}) / [md](${mdPath}) |`);
  }
  lines.push("");

  return lines.join("\n");
}
