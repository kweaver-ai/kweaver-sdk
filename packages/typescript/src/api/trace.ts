export interface GetTraceByIdOpts {
  baseUrl: string;
  token: string;
  businessDomain: string;
  traceId: string;
  pageSize?: number;
}

export interface RawSpan {
  spanId: string;
  parentSpanId: string | null;
  name?: string;
  startTimeUnixNano?: string;
  endTimeUnixNano?: string;
  status?: { code?: string };
  attributes?: Record<string, unknown>;
}

export async function getTraceById(opts: GetTraceByIdOpts): Promise<RawSpan[]> {
  const url = `${opts.baseUrl.replace(/\/$/, "")}/api/trace-ai/_search`;
  const body = {
    size: opts.pageSize ?? 1000,
    query: { term: { traceId: opts.traceId } },
  };
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.token}`,
      "X-Business-Domain": opts.businessDomain,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`getTraceById: HTTP ${res.status} from ${url}`);
  }
  const json = (await res.json()) as { hits?: { hits?: { _source?: RawSpan }[] } };
  const hits = json.hits?.hits ?? [];
  return hits.map((h) => h._source).filter((s): s is RawSpan => Boolean(s));
}
