// Trace-shape types (built from the OpenSearch _search response).
export interface SpanAttributes {
  [key: string]: unknown;
}

export interface Span {
  spanId: string;
  parentSpanId: string | null;
  name: string;
  kind: SpanKind;                    // derived from agent.trace.type or attributes
  startTimeUnixNano: string;         // string per OTel spec
  endTimeUnixNano: string;
  durationMs: number;                // computed from start/end
  status: 'ok' | 'error' | 'unset';
  attributes: SpanAttributes;
}

export type SpanKind = 'tool' | 'llm' | 'retrieval' | 'reasoning' | 'unknown';

export interface TraceTree {
  traceId: string;
  spans: Span[];
  byId: Map<string, Span>;
  parentToChildren: Map<string | null, Span[]>;  // null key = roots
  byKind: Map<SpanKind, Span[]>;
  root: Span | null;
}

// Rule + predicate types (rules loaded from yaml; predicates from TS modules).
export interface RuleTaxonomy {
  signalsAxis: 'interaction' | 'execution' | 'environment';
  msClass:
    | 'retry_loop'
    | 'tool_misuse'
    | 'context_loss'
    | 'goal_drift'
    | 'cascading_error'
    | 'silent_quality_degradation';
}

export interface RubricInputSpec {
  kind: string;
  source: string;                    // 'extract_from_root_attr:<path>' | 'filter_by_kind:[k1,k2]' | 'literal:<json>'
}

export interface RubricSpec {
  judgeQuestion: string;
  inputs: RubricInputSpec[];
  /** Original JSON-Schema-ish blob (kept for YAML round-trips / debug). */
  outputSchemaRaw: Record<string, unknown>;
  /** Compiled zod schema (built once at load time via output-schema-converter). */
  outputZodSchema: import("zod").ZodTypeAny;
  agentBinding: { provider: string; promptTemplateRef: string };
  /** Optional gating; see RuleSchema.rubric.gates_on. */
  gatesOn?: string[];
}

export interface Rule {
  schemaVersion: 'diagnosis-rule/v1';
  id: string;
  severity: 'low' | 'medium' | 'high';
  symptom: string;
  taxonomy: RuleTaxonomy;
  suggestedFix: { target: string; changeTemplate: string };
  verifyWith: { assertionTemplates: string[] };
  /** Exactly one of `predicateRef` or `rubric` is non-null (XOR enforced at load). */
  predicateRef: string | null;       // e.g. 'builtin:tool_loop_no_state_change'
  rubric: RubricSpec | null;
  params: Record<string, unknown>;
  sourcePath: string;                // for conflict reporting
}

export type JudgmentKind = 'symbolic' | 'rubric';

export interface Hit {
  evidenceSpans: string[];
  excerpt: string;
  bindings: Record<string, unknown>; // template vars for changeTemplate / assertionTemplates
}

export type Predicate = (trace: TraceTree, params: Record<string, unknown>) => Hit[];

// Report types (output schema 'trace-diagnose-report/v1').
export interface Finding {
  ruleId: string;
  judgmentKind: JudgmentKind;
  severity: 'low' | 'medium' | 'high';
  symptom: string;
  likelyCause: string;               // symbolic: copied from rule.symptom; rubric: agent-supplied
  evidence: { spans: string[]; excerpt: string };
  suggestedFix: { target: string; change: string };
  /** Symbolic always 'low' (no semantic basis); rubric carries agent confidence. */
  confidence: 'low' | 'medium' | 'high';
  verifyWith: {
    suggestedEvalCase: {
      queryId: string | null;
      query: string | null;
      assertions: string[];
    };
  };
}

export interface SummaryRootCause {
  findingIds: number[];
  description: string;
  targetForFix: string;
}

export interface SummaryFixPriority { findingId: number; reason: string; }
export interface SummaryCrossLink { findingIds: number[]; relation: string; }

export interface Summary {
  headline: string;
  primaryRootCause: SummaryRootCause | null;
  fixPriority: SummaryFixPriority[];
  crossFindingLinks: SummaryCrossLink[];
}

export interface Report {
  schemaVersion: 'trace-diagnose-report/v1';
  trace: { traceId: string; agentId: string | null; tenant: string | null };
  run: {
    diagnosedAt: string;             // ISO8601
    cliVersion: string;
    mode: 'symbolic-only' | 'rubric-only' | 'hybrid';
    rulesApplied: string[];
    rulesSkipped: { ruleId: string; reason: string }[];
    synthesizerMode: 'template' | 'agent';
  };
  summary: Summary;
  findings: Finding[];
}

// Diagnose CLI options (consumed by index.ts entrypoint).
export interface DiagnoseOpts {
  out: string | null;                // null = stdout
  rulesDir: string | null;           // override <cwd>/diagnosis-rules/
  noBuiltin: boolean;
  /** PR-B: when true, skip rubric rules (warn + record in rules_skipped) AND
   *  fall the synthesizer back from agent → template. Default is now false
   *  (both pillars on). */
  noLlm: boolean;
  /** Skip artifact persistence. Default false (artifacts ARE written). */
  noArtifacts?: boolean;
  /** Override default provider used by the agent synthesizer (rubric rules
   *  pick their own provider via `agent_binding.provider`). null = registry default. */
  agentProvider: string | null;
  timeoutMs: number;
  baseUrl: string;
  token: string;
  businessDomain: string;
  /**
   * Output format(s). yaml is the source of truth (always re-derivable into
   * markdown). When `--out` is a file path, `both` writes <stem>.yaml +
   * <stem>.md side by side; `yaml` or `markdown` writes a single file at the
   * given path. When `--out` is null (stdout), `both` collapses to yaml only —
   * piping markdown to a downstream YAML consumer would silently corrupt it.
   * Default: 'both' when out is a file, 'yaml' when stdout.
   */
  format?: 'yaml' | 'markdown' | 'both';
  /**
   * Output locale for agent-judged natural-language fields (rubric reasoning,
   * synthesizer headline / description / fix_priority reason). Default 'en'.
   * Affects only prose; JSON keys / enum values / span IDs always stay English.
   */
  lang?: 'en' | 'zh';
}
