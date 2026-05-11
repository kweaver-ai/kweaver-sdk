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

export interface Rule {
  schemaVersion: 'diagnosis-rule/v1';
  id: string;
  severity: 'low' | 'medium' | 'high';
  symptom: string;
  taxonomy: RuleTaxonomy;
  suggestedFix: { target: string; changeTemplate: string };
  verifyWith: { assertionTemplates: string[] };
  predicateRef: string;              // e.g. 'builtin:tool_loop_no_state_change' (PR-A: predicate only; rubric in PR-B)
  params: Record<string, unknown>;
  sourcePath: string;                // for conflict reporting
}

export interface Hit {
  evidenceSpans: string[];
  excerpt: string;
  bindings: Record<string, unknown>; // template vars for changeTemplate / assertionTemplates
}

export type Predicate = (trace: TraceTree, params: Record<string, unknown>) => Hit[];

// Report types (output schema 'trace-diagnose-report/v1' — PR-A subset).
export interface Finding {
  ruleId: string;
  judgmentKind: 'symbolic';          // PR-A is symbolic-only; PR-B adds 'rubric'
  severity: 'low' | 'medium' | 'high';
  symptom: string;
  likelyCause: string;               // PR-A: copied from rule.symptom (no LLM); PR-B: agent-supplied
  evidence: { spans: string[]; excerpt: string };
  suggestedFix: { target: string; change: string };
  confidence: 'low';                 // symbolic always low
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
    mode: 'symbolic-only';           // PR-A only ships this mode; PR-B adds 'rubric-only' | 'hybrid'
    rulesApplied: string[];
    rulesSkipped: { ruleId: string; reason: string }[];
    synthesizerMode: 'template';     // PR-A only ships template; PR-B adds 'agent'
  };
  summary: Summary;
  findings: Finding[];
}

// Diagnose CLI options (consumed by index.ts entrypoint).
export interface DiagnoseOpts {
  out: string | null;                // null = stdout
  rulesDir: string | null;           // override <cwd>/diagnosis-rules/
  noBuiltin: boolean;
  noLlm: true;                       // PR-A: forced true (no LLM at all)
  agentProvider: string | null;
  timeoutMs: number;
  baseUrl: string;
  token: string;
  businessDomain: string;
}
