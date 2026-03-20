/**
 * Example 01: Quick Start — 5 minutes to your first search
 *
 * Demonstrates: Simple API, auto-auth from ~/.kweaver/, BKN listing, semantic search.
 *
 * Run: npx tsx examples/01-quick-start.ts
 */
// Monorepo import — published users would use: import kweaver from "@kweaver-ai/kweaver-sdk/kweaver";
import kweaver from "../packages/typescript/src/kweaver.js";

async function main() {
  // 1. Configure — reads credentials from ~/.kweaver/ automatically
  kweaver.configure({ config: true });
  console.log("✓ Configured from ~/.kweaver/\n");

  // 2. List available knowledge networks
  const knList = await kweaver.bkns({ limit: 10 });
  console.log(`Found ${knList.length} knowledge network(s):`);
  for (const kn of knList) {
    const item = kn as { id?: string; name?: string };
    console.log(`  - ${item.name} (${item.id})`);
  }

  if (knList.length === 0) {
    console.log("\nNo BKNs found. Create one first.");
    return;
  }

  // 3. Pick the first BKN and do a semantic search
  const first = knList[0] as { id?: string; name?: string };
  const bknId = first.id!;
  console.log(`\nSearching in "${first.name}"...`);

  const result = await kweaver.search("数据", { bknId, maxConcepts: 5 });
  console.log(`\nSearch results (${result.hits_total ?? 0} hits):`);
  for (const concept of result.concepts ?? []) {
    const c = concept as { concept_name?: string; intent_score?: number };
    console.log(`  - ${c.concept_name} (score: ${c.intent_score})`);
  }
}

main().catch(console.error);
