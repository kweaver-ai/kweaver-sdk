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
//   6. How to verify — kweaver CLI commands the reader can paste to
//      independently re-confirm the report's claims against the live trace.
//      Sourced from Report fields + the caller-supplied conversation_id /
//      business_domain (which are not part of the yaml schema — yaml stays
//      CLI-agnostic, markdown is the CLI-aware view).
//   7. Run    — mode / synthesizer / rules applied & skipped (reference)

import type { Finding, Report } from "./types.js";

/**
 * Optional context the md renderer uses to build runnable verification
 * commands. None of these are in the yaml schema (which stays v1-locked and
 * CLI-agnostic) — they live only in the markdown view so users who paste the
 * md into a ticket / PR have copy-pasteable shell commands without needing to
 * remember the trace's conversation context.
 */
export interface MarkdownRenderOpts {
  /** The conversation_id passed to `kweaver trace diagnose`. Used to render
   *  the "re-run diagnosis" command. When undefined, that command is rendered
   *  with a `<conversation_id>` placeholder. */
  conversationId?: string;
  /** Business domain (`-bd` flag). When undefined, commands omit the flag and
   *  inherit kweaver's default (`bd_public`). */
  businessDomain?: string;
}

export function renderReportMarkdown(r: Report, opts: MarkdownRenderOpts = {}): string {
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

  // ── How to verify ────────────────────────────────────────────────────────
  renderVerificationSection(lines, r, opts);

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

/**
 * Render kweaver CLI verification commands so a reader can independently
 * re-confirm the diagnosis against the live trace. Sections:
 *   1. Re-fetch the raw spans (proves the trace data the report was built
 *      from still matches what observability returns)
 *   2. Re-diagnose with --no-llm (reproducibility check — same symbolic
 *      findings should fire deterministically; rules out claude-side flake)
 *   3. Inspect suspect spans per finding (only when findings.length > 0)
 *   4. Check recurrence across the agent's other conversations
 *
 * The commands intentionally omit auth flags (--token / --base-url) — the
 * reader is expected to have `kweaver auth` already configured or to be
 * working in the same shell session that produced this report.
 */
function renderVerificationSection(lines: string[], r: Report, opts: MarkdownRenderOpts): void {
  const bdFlag = opts.businessDomain ? ` -bd ${opts.businessDomain}` : "";
  const convId = opts.conversationId ?? "<conversation_id>";

  lines.push("## How to verify");
  lines.push("");
  lines.push("Paste these into a shell to independently re-confirm the report against the live trace.");
  lines.push("");

  // 1. Re-fetch raw spans for the trace.
  lines.push("### 1. Re-fetch the raw trace");
  lines.push("");
  lines.push("```bash");
  lines.push(`kweaver call -X POST '/api/agent-observability/v1/traces/_search' \\`);
  lines.push(`  -d '{"query":{"term":{"traceId":"${r.trace.traceId}"}}}'${bdFlag} \\`);
  lines.push(`  | jq '.hits.hits[]._source | {spanId, name, kind: .attributes."gen_ai.operation.name", status: .status.code}'`);
  lines.push("```");
  lines.push("");

  // 2. Re-run diagnosis deterministically.
  lines.push("### 2. Re-run diagnosis (reproducibility check)");
  lines.push("");
  lines.push("```bash");
  lines.push(`kweaver trace diagnose ${convId} --no-llm --out /tmp/verify.yaml${bdFlag}`);
  lines.push("# then diff against this report's yaml — symbolic findings should match exactly");
  lines.push("```");
  lines.push("");

  // 3. Inspect suspect spans per finding.
  if (r.findings.length > 0) {
    lines.push("### 3. Inspect the suspect spans");
    lines.push("");
    r.findings.forEach((f, idx) => {
      if (f.evidence.spans.length === 0) return;
      const spanList = f.evidence.spans.map((s) => `"${s}"`).join(", ");
      lines.push(`Finding #${idx} (\`${f.ruleId}\`):`);
      lines.push("");
      lines.push("```bash");
      lines.push(`kweaver call -X POST '/api/agent-observability/v1/traces/_search' \\`);
      lines.push(`  -d '{"query":{"terms":{"spanId":[${spanList}]}}}'${bdFlag} \\`);
      lines.push(`  | jq '.hits.hits[]._source.attributes'`);
      lines.push("```");
      lines.push("");
    });
  }

  // 4. Recurrence check.
  if (r.trace.agentId !== null) {
    const sectionNum = r.findings.length > 0 ? 4 : 3;
    lines.push(`### ${sectionNum}. Check whether this pattern recurs for the agent`);
    lines.push("");
    lines.push("```bash");
    lines.push(`kweaver agent sessions ${r.trace.agentId} --limit 20${bdFlag}`);
    lines.push("# sample a few conversation_ids from the list, re-diagnose each, count rule hits");
    lines.push("```");
    lines.push("");
  }
}

function escapeTableCell(s: string): string {
  // Pipes and newlines break GFM tables; collapse newlines and escape `|`.
  return s.replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
}

function escapeBlockquote(s: string): string {
  // Blockquote-safe; just collapse newlines so the whole description sits in one line.
  return s.replace(/\r?\n+/g, " ").trim();
}
