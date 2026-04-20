/**
 * Debug: force Gate 2 retry with real LLM + fake validator.
 *
 * Exercises compileAndValidateWithRetry's full retry loop:
 *   - initial config from buildConfigFromPrompt (template path)
 *   - regenerate closure that hits the real platform LLM
 *   - fake validator that returns invalid once, valid once
 *
 * Run:
 *   npx tsx test/composer/debug-gate2-retry.ts
 */
import { ensureValidToken } from "../../src/auth/oauth.js";
import { resolveBusinessDomain } from "../../src/config/store.js";
import { fetchAgentInfo, sendChatRequestStream } from "../../src/api/agent-chat.js";
import { listAgents } from "../../src/api/agent-list.js";
import {
  buildConfigFromPrompt,
  compileAndValidateWithRetry,
  extractJsonFromLLMResponse,
  validateComposerConfig,
  FLOW_GENERATION_SYSTEM_PROMPT,
  type ComposerConfig,
} from "../../src/commands/composer-engine.js";
import { validateFlow, type DphValidationResult } from "../../src/commands/composer-flow.js";

async function findRelay(baseUrl: string, accessToken: string, businessDomain: string) {
  const raw = await listAgents({ baseUrl, accessToken, businessDomain, limit: 20 });
  const list = JSON.parse(raw) as { entries?: Array<{ id?: string; is_built_in?: number }> };
  const sorted = [...(list.entries ?? [])].sort((a, b) => (a.is_built_in ?? 0) - (b.is_built_in ?? 0));
  for (const e of sorted) {
    if (!e.id) continue;
    try { return await fetchAgentInfo({ baseUrl, accessToken, agentId: e.id, version: "v0", businessDomain }); } catch { /* try next */ }
  }
  throw new Error("no relay agent");
}

async function main() {
  const t = await ensureValidToken();
  const bd = resolveBusinessDomain("") || "bd_public";
  const relay = await findRelay(t.baseUrl, t.accessToken, bd);
  console.error(`[debug-gate2] relay=${relay.id}`);

  const initial = buildConfigFromPrompt("帮我设计一个小助手：先总结用户问题，再给出建议，最后用一句话归纳要点");
  console.error(`[debug-gate2] initial agents=${initial.agents.map(a => a.ref).join(",")}`);

  let regenerateCalls = 0;
  let lastHint = "";
  const regenerate = async (hint: string): Promise<ComposerConfig | null> => {
    regenerateCalls++;
    lastHint = hint;
    console.error(`\n[debug-gate2] regenerate call #${regenerateCalls}, hint=${hint.slice(0, 120)}...`);

    // Mimic generateConfig's regenerateForGate2 closure, using the real system prompt
    const query = `${FLOW_GENERATION_SYSTEM_PROMPT}\n\n---\n\nUser request: 帮我设计一个小助手：先总结用户问题，再给出建议，最后用一句话归纳要点\n\n${hint}`;

    let fullText = "";
    await sendChatRequestStream(
      { baseUrl: t.baseUrl, accessToken: t.accessToken, agentId: relay.id, agentKey: relay.key, agentVersion: relay.version, query, stream: true, businessDomain: bd },
      { onTextDelta: (ft: string) => { fullText = ft; } },
    );
    const parsed = extractJsonFromLLMResponse(fullText);
    if (!parsed || !validateComposerConfig(parsed)) {
      console.error(`[debug-gate2] regenerate: LLM output not valid ComposerConfig, text=${fullText.slice(0, 200)}`);
      return null;
    }
    if (parsed.orchestrator.flow) {
      const errs = validateFlow(parsed.orchestrator.flow, parsed.agents.map(a => a.ref));
      if (errs.length) {
        console.error(`[debug-gate2] regenerate: Gate 1 failed: ${errs.join("; ")}`);
        return null;
      }
    }
    console.error(`[debug-gate2] regenerate: got valid config, agents=${parsed.agents.map(a => a.ref).join(",")}`);
    return parsed;
  };

  let validatorCalls = 0;
  const fakeValidator = async (_dph: string): Promise<DphValidationResult> => {
    validatorCalls++;
    if (validatorCalls === 1) {
      console.error(`[debug-gate2] validator call #1 → returning INVALID (simulated)`);
      return { is_valid: false, error_message: "unexpected token '@foo' (simulated error for retry test)", line_number: 3 };
    }
    console.error(`[debug-gate2] validator call #${validatorCalls} → returning VALID`);
    return { is_valid: true, error_message: "", line_number: 0 };
  };

  const result = await compileAndValidateWithRetry(initial, regenerate, fakeValidator, 1);

  console.error(`\n[debug-gate2] === RESULT ===`);
  console.error(`  ok=${result.ok}`);
  console.error(`  regenerateCalls=${regenerateCalls}`);
  console.error(`  validatorCalls=${validatorCalls}`);
  console.error(`  lastHint contained 'line 3': ${lastHint.includes("line 3")}`);
  console.error(`  lastHint contained error msg: ${lastHint.includes("@foo")}`);
  if (result.ok) {
    console.error(`  final config.name=${result.config.name}`);
    console.error(`  DPH (first 200): ${result.dph.slice(0, 200)}`);
  } else {
    console.error(`  error=${result.error}`);
  }

  // Assertions
  const pass = result.ok
    && regenerateCalls === 1
    && validatorCalls === 2
    && lastHint.includes("line 3")
    && lastHint.includes("@foo");
  console.error(`\n[debug-gate2] ${pass ? "✅ PASS" : "❌ FAIL"}`);
  process.exit(pass ? 0 : 1);
}

main().catch((err) => { console.error(`[debug-gate2] ERROR: ${err instanceof Error ? err.stack : err}`); process.exit(1); });
