// Monorepo import — published users would use: import { KWeaverClient } from "@kweaver-ai/kweaver-sdk";
import { KWeaverClient } from "../../../packages/typescript/src/index.js";

/**
 * Initialize a KWeaverClient from ~/.kweaver/ credentials.
 * Uses `connect()` which auto-refreshes expired tokens.
 * Run `npx tsx packages/typescript/src/cli.ts auth login <url>` first to set up credentials.
 */
export async function createClient(): Promise<KWeaverClient> {
  try {
    return await KWeaverClient.connect();
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes("baseUrl") || msg.includes("accessToken") || msg.includes("platform")) {
      console.error("Auth not configured. Run:\n  npx tsx packages/typescript/src/cli.ts auth login <your-platform-url>");
    }
    throw e;
  }
}

/**
 * Find the first BKN that has object types, otherwise exit 0.
 *
 * Examples need a populated BKN to be useful; we treat "no data" as an
 * expected, environment-driven outcome (not an example bug) and print a
 * friendly message instead of throwing.
 */
export async function findKnWithData(
  client: KWeaverClient,
): Promise<{ knId: string; knName: string }> {
  const kns = await client.knowledgeNetworks.list({ limit: 20 });
  for (const kn of kns) {
    const item = kn as { id?: string; name?: string };
    if (!item.id) continue;
    const ots = await client.knowledgeNetworks.listObjectTypes(item.id);
    if (Array.isArray(ots) && ots.length > 0) {
      return { knId: item.id, knName: item.name ?? item.id };
    }
  }
  console.error(
    "No BKN with object types found for the current user. " +
    "Create or get access to a populated BKN, then re-run.",
  );
  process.exit(0);
}

/** Find the first accessible agent, otherwise exit 0 (see findKnWithData). */
export async function findAgent(
  client: KWeaverClient,
): Promise<{ agentId: string; agentName: string }> {
  let list: unknown[];
  try {
    list = await client.agents.list({ limit: 10 });
  } catch (e) {
    console.error(`Agent service unavailable (${(e as Error).message}); skipping example.`);
    process.exit(0);
  }
  const first = list[0] as { id?: string; name?: string } | undefined;
  if (!first?.id) {
    console.error("No accessible agent for the current user; skipping example.");
    process.exit(0);
  }
  return { agentId: first.id, agentName: first.name ?? first.id };
}

/**
 * Pretty-print a JSON value with indentation.
 */
export function pp(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}
