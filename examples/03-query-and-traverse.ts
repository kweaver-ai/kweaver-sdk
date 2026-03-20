/**
 * Example 03: Query & Traverse — instance queries, subgraph traversal, Context Loader (MCP)
 *
 * Demonstrates: Conditional filtering, property reads, subgraph traversal, MCP Layer 1+2.
 *
 * Run: npx tsx examples/03-query-and-traverse.ts
 */
import { createClient, findKnWithData, pp } from "./setup.js";

async function main() {
  const client = createClient();
  const { knId, knName } = await findKnWithData(client);
  console.log(`Using BKN: ${knName} (${knId})\n`);

  // --- Part 1: Direct Client API queries ---

  // 1. Find the first object type to query
  const objectTypes = await client.knowledgeNetworks.listObjectTypes(knId);
  const ots = objectTypes as Array<{ id?: string; name?: string }>;
  if (ots.length === 0) {
    console.log("No object types found.");
    return;
  }
  const ot = ots[0];
  console.log(`=== Querying instances of "${ot.name}" ===`);

  // 2. Query instances (no filter, just limit)
  const instances = await client.bkn.queryInstances(knId, ot.id!, {
    page: 1,
    size: 5,
  });
  console.log("\nInstances (first 5):");
  pp(instances);

  // 3. Query properties
  const properties = await client.bkn.queryProperties(knId, ot.id!, {});
  console.log("\nProperties:");
  pp(properties);

  // 4. Subgraph traversal (if relation types exist)
  const relationTypes = await client.knowledgeNetworks.listRelationTypes(knId);
  const rts = relationTypes as Array<{
    id?: string; name?: string;
    source_object_type?: { id?: string };
    target_object_type?: { id?: string };
  }>;

  if (rts.length > 0) {
    const rt = rts[0];
    console.log(`\n=== Subgraph via "${rt.name}" ===`);
    const subgraph = await client.bkn.querySubgraph(knId, {
      relation_type_paths: [{
        relation_types: [{
          relation_type_id: rt.id,
          source_object_type_id: rt.source_object_type?.id,
          target_object_type_id: rt.target_object_type?.id,
        }],
      }],
      limit: 5,
    });
    console.log("Subgraph result:");
    pp(subgraph);
  }

  // --- Part 2: Context Loader (MCP protocol) ---
  // The Context Loader provides the same query capabilities via MCP,
  // allowing external AI agents to access knowledge graph data.

  console.log("\n=== Context Loader (MCP) ===");

  // Initialize Context Loader — requires the MCP endpoint URL
  const baseUrl = (client as unknown as { baseUrl: string }).baseUrl;
  const mcpUrl = `${baseUrl}/api/agent-retrieval/v1/mcp`;
  const cl = client.contextLoader(mcpUrl, knId);

  // Layer 1: Schema search — discover types by natural language
  console.log("Layer 1 — Schema search:");
  const schemaResults = await cl.schemaSearch({ query: "数据", max_concepts: 5 });
  pp(schemaResults);

  // Layer 2: Instance query via MCP (if we found an object type)
  if (ot.id) {
    console.log(`\nLayer 2 — Instance query for "${ot.name}" via MCP:`);
    const mpcInstances = await cl.queryInstances({
      ot_id: ot.id,
      condition: { operation: "and", sub_conditions: [] },
      limit: 5,
    });
    pp(mpcInstances);
  }
}

main().catch(console.error);
