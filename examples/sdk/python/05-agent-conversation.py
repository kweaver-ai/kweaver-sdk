"""Example 05: Agent Conversation — chat with an AI agent over the knowledge graph.

Demonstrates: agent discovery, single-shot chat, streaming, conversation history.

Run: python examples/sdk/05-agent-conversation.py
"""

from __future__ import annotations

import sys

from setup import create_client, find_agent


def main() -> None:
    client = create_client()

    try:
        agents = client.agents.list(limit=10)
    except Exception as e:
        print(f"Agent service unavailable ({e}); skipping example.")
        return
    print(f"=== Available Agents ({len(agents)}) ===")
    for a in agents:
        print(f"  {a.name} ({a.id}) — {getattr(a, 'description', '') or ''}")

    if not agents:
        print("\nNo published agents available.")
        print("Create one via CLI:  kweaver agent create --name test --profile test --llm-id <model-id>")
        print("Then publish it:     kweaver agent publish <agent-id>")
        return

    agent_id, agent_name = find_agent(client)
    print(f"\nUsing agent: {agent_name} ({agent_id})\n")

    # 1. Single-shot chat (non-streaming)
    print("=== Single-Shot Chat ===")
    reply = client.conversations.send_message(
        "", "你好，请介绍一下你能做什么", agent_id=agent_id
    )
    print(f"Reply: {reply.content}\n")

    # 2. Streaming chat — print each delta as it arrives
    print("=== Streaming Chat ===")
    sys.stdout.write("Reply: ")
    sys.stdout.flush()
    final_text = ""
    for chunk in client.conversations.send_message(
        "", "请列出知识网络中的主要概念", agent_id=agent_id, stream=True
    ):
        sys.stdout.write(chunk.delta)
        sys.stdout.flush()
        final_text = chunk.delta if chunk.finished else final_text
    print("\n")

    # 3. Conversation history
    conv_id = getattr(reply, "conversation_id", None)
    if conv_id:
        print("=== Conversation History ===")
        messages = client.conversations.list_messages(conv_id, limit=10)
        print(f"{len(messages)} message(s) in conversation {conv_id}:")
        for msg in messages:
            content = getattr(msg, "content", "") or ""
            preview = content[:80]
            ellipsis = "..." if len(content) > 80 else ""
            print(f"  [{getattr(msg, 'role', '?')}] {preview}{ellipsis}")

    # 4. List all conversation sessions for this agent
    print("\n=== Conversation Sessions ===")
    sessions = client.conversations.list(agent_id=agent_id, limit=5)
    print(f"{len(sessions)} session(s):")
    for s in sessions:
        print(f"  {s.id} — {getattr(s, 'last_active', '') or ''}")


if __name__ == "__main__":
    main()
