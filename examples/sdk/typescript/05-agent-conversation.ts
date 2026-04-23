/**
 * Example 05: Agent Conversation — chat with an AI agent over the knowledge graph
 *
 * Demonstrates: Agent discovery, single-shot chat, streaming, progress chain, conversation history.
 *
 * Run: npx tsx examples/sdk/05-agent-conversation.ts
 */
import { createClient, findAgent, pp } from "./setup.js";
// Monorepo import — published users would use: import type { ProgressItem } from "@kweaver-ai/kweaver-sdk";
import type { ProgressItem } from "../../../packages/typescript/src/index.js";

async function main() {
  const client = await createClient();

  // 1. List available agents
  let agentList: unknown[];
  try {
    agentList = await client.agents.list({ limit: 10 });
  } catch (e) {
    console.error(`Agent service unavailable (${(e as Error).message}); skipping example.`);
    return;
  }
  console.log(`=== Available Agents (${agentList.length}) ===`);
  for (const a of agentList as Array<{ id?: string; name?: string; description?: string }>) {
    console.log(`  ${a.name} (${a.id}) — ${a.description ?? ""}`);
  }

  if (agentList.length === 0) {
    console.log("\nNo published agents available.");
    console.log("Create one via CLI:  npx tsx packages/typescript/src/cli.ts agent create --name test --profile test --llm-id <model-id>");
    console.log("Then publish it:     npx tsx packages/typescript/src/cli.ts agent publish <agent-id>");
    return;
  }

  const { agentId, agentName } = await findAgent(client);
  console.log(`\nUsing agent: ${agentName} (${agentId})\n`);

  // 2. Single-shot chat
  console.log("=== Single-Shot Chat ===");
  const reply = await client.agents.chat(agentId, "你好，请介绍一下你能做什么");
  console.log(`Reply: ${reply.text}\n`);

  // Show the agent's reasoning/progress chain
  if (reply.progress && reply.progress.length > 0) {
    console.log("Progress chain:");
    for (const step of reply.progress) {
      console.log(`  [${step.skill_info?.type ?? "step"}] ${step.skill_info?.name ?? step.agent_name} → ${step.status}`);
    }
  }

  // 3. Streaming chat — real-time text output
  // Note: onTextDelta receives the FULL accumulated text each time, not a delta.
  // We track the previous length to print only the new portion.
  console.log("\n=== Streaming Chat ===");
  process.stdout.write("Reply: ");
  let prevLen = 0;
  const streamResult = await client.agents.stream(
    agentId,
    "请列出知识网络中的主要概念",
    {
      onTextDelta: (fullText: string) => {
        process.stdout.write(fullText.slice(prevLen));
        prevLen = fullText.length;
      },
      onProgress: (progress: ProgressItem[]) => {
        for (const p of progress) {
          if (p.skill_info?.name) {
            process.stderr.write(`\n  [progress] ${p.skill_info.name} → ${p.status ?? ""}\n`);
          }
        }
      },
    },
  );
  console.log("\n");

  // 4. Conversation history
  const conversationId = reply.conversationId;
  if (conversationId) {
    console.log("=== Conversation History ===");
    const messages = await client.conversations.listMessages(agentId, conversationId);
    console.log(`${(messages as unknown[]).length} message(s) in conversation ${conversationId}:`);
    for (const msg of messages as Array<{ role?: string; content?: string }>) {
      const preview = (msg.content ?? "").slice(0, 80);
      console.log(`  [${msg.role}] ${preview}${(msg.content?.length ?? 0) > 80 ? "..." : ""}`);
    }
  }

  // 5. List all conversation sessions for this agent
  console.log("\n=== Conversation Sessions ===");
  const sessions = await client.conversations.list(agentId, { limit: 5 });
  console.log(`${(sessions as unknown[]).length} session(s):`);
  for (const s of sessions as Array<{ id?: string; created_at?: string }>) {
    console.log(`  ${s.id} — ${s.created_at ?? ""}`);
  }
}

main().catch(console.error);
