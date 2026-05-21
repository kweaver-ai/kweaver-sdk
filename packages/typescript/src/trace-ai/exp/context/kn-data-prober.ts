import type { KnSchemaSnapshot, QueryFailureAnalysis } from "../schemas.js";
import type { QueryResourceOptions, ResourceQueryResult } from "../../../api/resources.js";

type QueryResourceFn = (opts: Pick<QueryResourceOptions, "baseUrl" | "accessToken" | "id" | "needTotal" | "limit">) => Promise<ResourceQueryResult>;

export interface DataProbe {
  concept_name: string;
  data_view_id: string;
  total_records: number;
}

function extractConceptNames(failures: QueryFailureAnalysis[]): Set<string> {
  const names = new Set<string>();
  for (const f of failures) {
    for (const call of f.tool_call_summary) {
      const match = call.match(/kn_search\(([^)]+)\)/);
      if (match) names.add(match[1].trim());
    }
  }
  return names;
}

export async function probeObjectTypes(
  schema: KnSchemaSnapshot,
  failures: QueryFailureAnalysis[],
  queryResource: QueryResourceFn,
  opts: { baseUrl?: string; accessToken?: string } = {},
): Promise<DataProbe[]> {
  const mentionedConcepts = extractConceptNames(failures);
  const toProbe = schema.object_types.filter(
    ot => ot.data_view_id && mentionedConcepts.has(ot.concept_name)
  );

  const seen = new Set<string>();
  const unique = toProbe.filter(ot => {
    if (seen.has(ot.data_view_id!)) return false;
    seen.add(ot.data_view_id!);
    return true;
  });

  const results = await Promise.all(
    unique.map(async ot => {
      try {
        const result = await queryResource({
          baseUrl: opts.baseUrl ?? "",
          accessToken: opts.accessToken ?? "",
          id: ot.data_view_id!,
          needTotal: true,
          limit: 1,
        });
        return { concept_name: ot.concept_name, data_view_id: ot.data_view_id!, total_records: result.total_count ?? 0 };
      } catch {
        return null;
      }
    })
  );

  return results.filter((r): r is DataProbe => r !== null);
}
