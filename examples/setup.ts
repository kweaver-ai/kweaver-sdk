// Monorepo import — published users would use: import { KWeaverClient } from "@kweaver-ai/kweaver-sdk";
import { KWeaverClient } from "../packages/typescript/src/index.js";

/**
 * Initialize a KWeaverClient from ~/.kweaver/ credentials.
 */
export function createClient(): KWeaverClient {
  return new KWeaverClient();
}

/**
 * Find the first BKN that has object types with data.
 * Returns { knId, knName } or throws if none found.
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
  throw new Error("No BKN with data found. Ensure your KWeaver instance has at least one BKN with object types.");
}

/**
 * Find the first accessible agent.
 * Returns { agentId, agentName } or throws if none found.
 */
export async function findAgent(
  client: KWeaverClient,
): Promise<{ agentId: string; agentName: string }> {
  const list = await client.agents.list({ limit: 10 });
  const first = list[0] as { id?: string; name?: string } | undefined;
  if (!first?.id) {
    throw new Error("No accessible agent found.");
  }
  return { agentId: first.id, agentName: first.name ?? first.id };
}

/**
 * Pretty-print a JSON value with indentation.
 */
export function pp(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}
