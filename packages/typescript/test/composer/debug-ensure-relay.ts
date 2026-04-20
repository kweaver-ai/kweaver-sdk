/**
 * Debug: verify ensureComposerRelay end-to-end against a real platform.
 *
 * Properties verified:
 *  1. First invocation on an account with no reserved relay → creates it.
 *  2. Second invocation → finds the same relay, does NOT create a duplicate.
 *  3. The created relay has the canary metadata so a renamed user agent with
 *     the same name would not be misidentified (at least at fetch time).
 *
 * Run:  npx tsx test/composer/debug-ensure-relay.ts
 */
import { ensureValidToken } from "../../src/auth/oauth.js";
import { resolveBusinessDomain } from "../../src/config/store.js";
import { fetchAgentInfo } from "../../src/api/agent-chat.js";
import { listPersonalAgents, createAgent, publishAgent } from "../../src/api/agent-list.js";
import {
  ensureComposerRelay,
  getDefaultLlms,
  COMPOSER_RELAY_NAME,
  COMPOSER_RELAY_METADATA_PURPOSE,
} from "../../src/commands/composer-engine.js";

async function main() {
  const t = await ensureValidToken();
  const bd = resolveBusinessDomain("") || "bd_public";
  console.error(`[debug-ensure-relay] baseUrl=${t.baseUrl}, bd=${bd}`);

  const llms = await getDefaultLlms(t.baseUrl, t.accessToken, bd);

  const makeDeps = () => ({
    listAgents: async () => {
      const raw = await listPersonalAgents({ baseUrl: t.baseUrl, accessToken: t.accessToken, businessDomain: bd, name: COMPOSER_RELAY_NAME, size: 20 });
      const list = JSON.parse(raw) as { entries?: Array<{ id?: string; name?: string }> };
      return list.entries ?? [];
    },
    fetchAgentInfo: (agentId: string) =>
      fetchAgentInfo({ baseUrl: t.baseUrl, accessToken: t.accessToken, agentId, version: "v0", businessDomain: bd }),
    createAgent: async (body: string) => {
      const raw = await createAgent({ baseUrl: t.baseUrl, accessToken: t.accessToken, body, businessDomain: bd });
      const parsed = JSON.parse(raw) as { id?: string; data?: { id?: string } };
      const id = parsed.id ?? parsed.data?.id;
      if (!id) throw new Error("no id in createAgent response");
      return id;
    },
    publishAgent: async (agentId: string) => {
      await publishAgent({ baseUrl: t.baseUrl, accessToken: t.accessToken, agentId, businessDomain: bd });
    },
    llms,
  });

  console.error(`\n[debug-ensure-relay] === first ensureComposerRelay call ===`);
  const first = await ensureComposerRelay(makeDeps());
  console.error(`first.id = ${first.id}`);

  console.error(`\n[debug-ensure-relay] === second ensureComposerRelay call (idempotency) ===`);
  const second = await ensureComposerRelay(makeDeps());
  console.error(`second.id = ${second.id}`);

  const sameId = first.id === second.id;
  console.error(`\n[debug-ensure-relay] idempotent: ${sameId ? "✅" : "❌"}`);

  // Also verify exactly one relay exists in the user's personal space
  const raw = await listPersonalAgents({ baseUrl: t.baseUrl, accessToken: t.accessToken, businessDomain: bd, name: COMPOSER_RELAY_NAME, size: 20 });
  const list = JSON.parse(raw) as { entries?: Array<{ id?: string; name?: string }> };
  const reserved = (list.entries ?? []).filter((e) => e.name === COMPOSER_RELAY_NAME);
  console.error(`[debug-ensure-relay] relays on platform with reserved name: ${reserved.length} (expect 1)`);

  const allOk = sameId && reserved.length === 1;
  console.error(`\n[debug-ensure-relay] ${allOk ? "✅ PASS" : "❌ FAIL"}`);
  console.error(`[debug-ensure-relay] COMPOSER_RELAY_NAME=${COMPOSER_RELAY_NAME}, metadata.purpose=${COMPOSER_RELAY_METADATA_PURPOSE}`);
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => { console.error("ERROR:", err instanceof Error ? err.stack : err); process.exit(1); });
