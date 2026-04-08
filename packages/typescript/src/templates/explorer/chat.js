// ── Chat Tab ─────────────────────────────────────────────────────────────────

const chatState = {
  agents: null,          // array of agent objects, null = not loaded
  loading: false,        // agents list loading
  // per-agent conversation history: { [agentId]: Array<{role, text}> }
  conversations: {},
  currentAgentId: null,
  streaming: false,
};

// ── Markdown renderer (minimal) ──────────────────────────────────────────────

function chatMarkdown(text) {
  if (!text) return "";
  let s = esc(text);

  // Fenced code blocks ```...```
  s = s.replace(/```[\s\S]*?```/g, (m) => {
    const inner = m.slice(3, -3).replace(/^[^\n]*\n?/, ""); // strip optional lang tag
    return `<pre><code>${inner}</code></pre>`;
  });

  // Inline code `...`
  s = s.replace(/`([^`]+)`/g, (_m, c) => `<code>${c}</code>`);

  // Bold **...**
  s = s.replace(/\*\*([^*]+)\*\*/g, (_m, c) => `<strong>${c}</strong>`);

  // Line breaks
  s = s.replace(/\n/g, "<br>");

  return s;
}

// ── Agents list loader ───────────────────────────────────────────────────────

async function loadChatAgents() {
  if (chatState.agents !== null) return chatState.agents;
  if (chatState.loading) return null;
  chatState.loading = true;
  try {
    const raw = await api("GET", "/api/chat/agents");
    // API returns { res: [...] } or array directly
    const list = extractList(raw.res ?? raw);
    chatState.agents = list;
    return list;
  } catch (err) {
    chatState.loading = false;
    throw err;
  } finally {
    chatState.loading = false;
  }
}

// ── Send message ─────────────────────────────────────────────────────────────

async function chatSend($messagesEl, $inputEl, $sendBtn, agentId) {
  const message = $inputEl.value.trim();
  if (!message || chatState.streaming) return;

  $inputEl.value = "";
  $inputEl.disabled = true;
  $sendBtn.disabled = true;
  chatState.streaming = true;

  // Append user bubble
  const userDiv = document.createElement("div");
  userDiv.className = "chat-bubble chat-bubble-user";
  userDiv.innerHTML = `<div class="chat-bubble-content">${chatMarkdown(message)}</div>`;
  $messagesEl.appendChild(userDiv);

  // Append assistant placeholder
  const assistantDiv = document.createElement("div");
  assistantDiv.className = "chat-bubble chat-bubble-assistant";
  const contentSpan = document.createElement("div");
  contentSpan.className = "chat-bubble-content";
  contentSpan.innerHTML = '<span class="chat-thinking">Thinking…</span>';
  assistantDiv.appendChild(contentSpan);
  $messagesEl.appendChild(assistantDiv);
  $messagesEl.scrollTop = $messagesEl.scrollHeight;

  // Persist user message
  if (!chatState.conversations[agentId]) chatState.conversations[agentId] = [];
  chatState.conversations[agentId].push({ role: "user", text: message });

  const conversationId = chatState.currentConversationId ?? undefined;

  try {
    const res = await fetch("/api/chat/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId, message, conversationId }),
    });

    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => res.statusText);
      contentSpan.innerHTML = `<span class="chat-error">Error ${res.status}: ${esc(errText)}</span>`;
      chatState.streaming = false;
      $inputEl.disabled = false;
      $sendBtn.disabled = false;
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let lastText = "";

    const gen = navGeneration;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (navGeneration !== gen) { reader.cancel(); break; }

      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const dataStr = line.slice(6).trim();
        if (!dataStr) continue;
        let evt;
        try { evt = JSON.parse(dataStr); } catch { continue; }

        if (evt.type === "text") {
          lastText = evt.fullText ?? "";
          contentSpan.innerHTML = chatMarkdown(lastText);
          $messagesEl.scrollTop = $messagesEl.scrollHeight;
        } else if (evt.type === "done") {
          chatState.currentConversationId = evt.conversationId || chatState.currentConversationId;
          if (lastText) {
            chatState.conversations[agentId].push({ role: "assistant", text: lastText });
          }
        } else if (evt.type === "error") {
          contentSpan.innerHTML = `<span class="chat-error">${esc(evt.error)}</span>`;
        }
      }
    }

    if (!lastText) {
      contentSpan.innerHTML = '<span class="chat-error">No response received.</span>';
    }
  } catch (err) {
    contentSpan.innerHTML = `<span class="chat-error">${esc(err.message || String(err))}</span>`;
  }

  chatState.streaming = false;
  $inputEl.disabled = false;
  $sendBtn.disabled = false;
  $inputEl.focus();
  $messagesEl.scrollTop = $messagesEl.scrollHeight;
}

// ── Render chat conversation area ────────────────────────────────────────────

function renderChatConversation($el, agentId, agentName) {
  const history = chatState.conversations[agentId] ?? [];

  $el.innerHTML = `
    <div class="chat-pane">
      <div class="chat-header">
        <span class="chat-agent-name">${esc(agentName)}</span>
        <button class="chat-clear-btn" onclick="chatClearConversation(${JSON.stringify(agentId)})">Clear</button>
      </div>
      <div class="chat-messages" id="chat-messages">
        ${history.length === 0
          ? `<div class="chat-welcome">Send a message to start chatting with <strong>${esc(agentName)}</strong>.</div>`
          : history.map(msg =>
            `<div class="chat-bubble chat-bubble-${esc(msg.role)}">
              <div class="chat-bubble-content">${chatMarkdown(msg.text)}</div>
            </div>`
          ).join("")}
      </div>
      <div class="chat-input-row">
        <textarea id="chat-input" class="chat-input" rows="2" placeholder="Type a message…" ${chatState.streaming ? "disabled" : ""}></textarea>
        <button id="chat-send-btn" class="chat-send-btn" ${chatState.streaming ? "disabled" : ""}>Send</button>
      </div>
    </div>
  `;

  const $messages = $el.querySelector("#chat-messages");
  const $input = $el.querySelector("#chat-input");
  const $sendBtn = $el.querySelector("#chat-send-btn");

  // Scroll to bottom
  if ($messages) $messages.scrollTop = $messages.scrollHeight;

  // Wire up send
  const doSend = () => chatSend($messages, $input, $sendBtn, agentId);
  $sendBtn.addEventListener("click", doSend);
  $input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  });

  if (!chatState.streaming) $input.focus();
}

// ── Clear conversation ───────────────────────────────────────────────────────

function chatClearConversation(agentId) {
  chatState.conversations[agentId] = [];
  chatState.currentConversationId = undefined;
  // Re-render conversation area
  const $pane = document.getElementById("chat-conversation-pane");
  if ($pane) {
    const agent = (chatState.agents ?? []).find(a => (a.id || a.agent_id) === agentId);
    const name = agent ? (agent.name || agent.agent_name || agentId) : agentId;
    renderChatConversation($pane, agentId, name);
  }
}

// ── Select agent ─────────────────────────────────────────────────────────────

function chatSelectAgent(agentId) {
  if (chatState.currentAgentId === agentId) return;
  chatState.currentAgentId = agentId;
  // Reset conversation ID for new agent unless we have history
  if (!chatState.conversations[agentId] || chatState.conversations[agentId].length === 0) {
    chatState.currentConversationId = undefined;
  }
  location.hash = `#/chat/${enc(agentId)}`;
}

// ── Main render ──────────────────────────────────────────────────────────────

async function renderChat($el, parts, _params) {
  const gen = navGeneration;

  // Determine target agent from URL parts
  const urlAgentId = parts && parts[0] ? decodeURIComponent(parts[0]) : null;

  $el.innerHTML = '<div class="loading">Loading agents…</div>';

  let agents;
  try {
    agents = await loadChatAgents();
  } catch (err) {
    if (navGeneration !== gen) return;
    $el.innerHTML = `<div class="error-banner">Failed to load agents: ${esc(err.message || String(err))}</div>`;
    return;
  }

  if (navGeneration !== gen) return;

  if (!agents || agents.length === 0) {
    $el.innerHTML = '<div class="error-banner">No published agents found. Publish an agent in KWeaver first.</div>';
    return;
  }

  // Pick active agent
  let activeAgentId = urlAgentId || chatState.currentAgentId;
  if (!activeAgentId || !agents.find(a => (a.id || a.agent_id) === activeAgentId)) {
    activeAgentId = agents[0].id || agents[0].agent_id;
  }
  chatState.currentAgentId = activeAgentId;

  // Layout: sidebar + conversation
  $el.innerHTML = `
    <div class="chat-layout">
      <div class="chat-sidebar" id="chat-sidebar">
        <div class="chat-sidebar-header">Agents</div>
        <div class="chat-agent-list" id="chat-agent-list">
          ${agents.map(agent => {
            const id = agent.id || agent.agent_id;
            const name = agent.name || agent.agent_name || id;
            const desc = agent.description || "";
            const isActive = id === activeAgentId;
            return `<div class="chat-agent-item${isActive ? " active" : ""}" data-agent-id="${esc(id)}" onclick="chatSelectAgent(${JSON.stringify(id)})">
              <div class="chat-agent-item-name">${esc(name)}</div>
              ${desc ? `<div class="chat-agent-item-desc">${esc(desc)}</div>` : ""}
            </div>`;
          }).join("")}
        </div>
      </div>
      <div class="chat-conversation" id="chat-conversation-pane"></div>
    </div>
  `;

  // Render the conversation for the active agent
  const activeAgent = agents.find(a => (a.id || a.agent_id) === activeAgentId);
  const activeName = activeAgent ? (activeAgent.name || activeAgent.agent_name || activeAgentId) : activeAgentId;
  const $pane = $el.querySelector("#chat-conversation-pane");
  renderChatConversation($pane, activeAgentId, activeName);
}
