/**
 * Example 02: Explore Schema — discover object types, relations, and actions
 *
 * Demonstrates: KWeaverClient, BKN statistics, schema trifecta (OT/RT/AT).
 *
 * Run: npx tsx examples/sdk/02-explore-schema.ts
 */
import { createClient, findKnWithData, pp } from "./setup.js";

async function main() {
  const client = await createClient();
  const { knId, knName } = await findKnWithData(client);
  console.log(`Using BKN: ${knName} (${knId})\n`);

  // 1. Get BKN details with statistics
  const detail = await client.knowledgeNetworks.get(knId, { include_statistics: true });
  console.log("=== BKN Statistics ===");
  pp(detail);

  // 2. List object types
  const objectTypes = await client.knowledgeNetworks.listObjectTypes(knId);
  console.log(`\n=== Object Types (${(objectTypes as unknown[]).length}) ===`);
  for (const ot of objectTypes as Array<{ id?: string; name?: string; properties?: unknown[] }>) {
    console.log(`  ${ot.name} (${ot.id}) — ${ot.properties?.length ?? 0} properties`);
  }

  // 3. List relation types
  const relationTypes = await client.knowledgeNetworks.listRelationTypes(knId);
  console.log(`\n=== Relation Types (${(relationTypes as unknown[]).length}) ===`);
  for (const rt of relationTypes as Array<{
    id?: string; name?: string;
    source_object_type?: { name?: string };
    target_object_type?: { name?: string };
  }>) {
    console.log(`  ${rt.source_object_type?.name} —[${rt.name}]→ ${rt.target_object_type?.name}  (${rt.id})`);
  }

  // 4. List action types
  const actionTypes = await client.knowledgeNetworks.listActionTypes(knId);
  console.log(`\n=== Action Types (${(actionTypes as unknown[]).length}) ===`);
  for (const at of actionTypes as Array<{ id?: string; name?: string }>) {
    console.log(`  ${at.name} (${at.id})`);
  }
}

main().catch(console.error);
