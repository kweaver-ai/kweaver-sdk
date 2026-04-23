/**
 * Example 03: Query & Traverse — instance queries, subgraph traversal, Context Loader (MCP)
 *
 * Demonstrates: Conditional filtering, property reads, subgraph traversal, MCP Layer 1+2.
 *
 * Run: npx tsx examples/sdk/03-query-and-traverse.ts
 */
import { createClient, findKnWithData, pp } from "./setup.js";

async function main() {
  const client = await createClient();
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
    limit: 5,
  });
  console.log("\nInstances (first 5):");
  pp(instances);

  // 3. Query properties for the first instance (if any)
  const datas = (instances as { datas?: Array<{ _instance_identity?: Record<string, unknown> }> }).datas;
  if (datas && datas.length > 0 && datas[0]._instance_identity) {
    const identity = datas[0]._instance_identity;
    try {
      console.log("\nProperties of first instance:");
      const properties = await client.bkn.queryProperties(knId, ot.id!, { identity });
      pp(properties);
    } catch (e) {
      console.log(`  (skipped — instance has no queryable identity: ${(e as Error).message})`);
    }
  } else {
    console.log("\nNo instances found — skipping property query.");
  }

  // 4. Subgraph traversal (if relation types exist)
  const relationTypes = await client.knowledgeNetworks.listRelationTypes(knId);
  const rts = relationTypes as Array<{
    id?: string; name?: string;
    source_object_type?: { id?: string };
    target_object_type?: { id?: string };
  }>;

  // Find a relation type with both source and target object types defined
  const rt = rts.find(r => r.source_object_type?.id && r.target_object_type?.id);
  if (rt) {
    console.log(`\n=== Subgraph via "${rt.name}" ===`);
    try {
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
    } catch (e) {
      console.log(`  (subgraph query failed — this BKN may lack linked data: ${(e as Error).message})`);
    }
  } else if (rts.length > 0) {
    console.log("\nRelation types found but none have complete source/target — skipping subgraph.");
  }

  // --- Part 2: Context Loader (MCP protocol) ---
  // The Context Loader provides the same query capabilities via MCP,
  // allowing external AI agents to access knowledge graph data.

  console.log("\n=== Context Loader (MCP) ===");

  // Initialize Context Loader — requires the MCP endpoint URL.
  // You can also get this URL by running: npx tsx packages/typescript/src/cli.ts context-loader config show
  const { baseUrl } = client.base();
  const mcpUrl = `${baseUrl}/api/agent-retrieval/v1/mcp`;
  const cl = client.contextLoader(mcpUrl, knId);

  // Layer 1: Schema search — discover types by natural language
  console.log("Layer 1 — Schema search:");
  // "数据" means "data" in Chinese — change this to match your BKN's language
  const schemaResults = await cl.schemaSearch({ query: "数据", max_concepts: 5 });
  pp(schemaResults);

  // Layer 2: Instance query via MCP (if we found an object type)
  if (ot.id) {
    console.log(`\nLayer 2 — Instance query for "${ot.name}" via MCP:`);
    try {
      const mcpInstances = await cl.queryInstances({
        ot_id: ot.id,
        limit: 5,
      });
      pp(mcpInstances);
    } catch (e) {
      console.log(`  (MCP instance query failed: ${(e as Error).message})`);
    }
  }
}

main().catch(console.error);
