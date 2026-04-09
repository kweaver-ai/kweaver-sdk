// ── Chat Tab ─────────────────────────────────────────────────────────────────

const chatState = {
  agents: null,          // array of agent objects, null = not loaded
  loading: false,        // agents list loading
  // per-agent conversation history: { [agentId]: Array<{role, text}> }
  conversations: {},
  currentAgentId: null,
  streaming: false,
};

// ── Chat Settings & Agents Filter ────────────────────────────────────────────

window.chatFilterAgents = function(query) {
  const q = query.toLowerCase();
  const items = document.querySelectorAll('.chat-agent-item');
  items.forEach(el => {
    const text = el.textContent.toLowerCase();
    el.style.display = text.includes(q) ? 'flex' : 'none';
  });
};

window.renderBubble = function(msg, agentName) {
  const isUser = msg.role === "user";
  const avatar = isUser ? "👤" : "🤖";
  return `<div class="chat-message-row ${isUser ? 'user' : 'assistant'}">
    ${!isUser ? `<div class="chat-avatar">${avatar}</div>` : ""}
    <div class="chat-bubble chat-bubble-${esc(msg.role)}">
      ${!isUser ? `<div class="chat-bubble-sender">${esc(agentName)}</div>` : ""}
      <div class="chat-bubble-content">${chatMarkdown(msg.text)}</div>
    </div>
    ${isUser ? `<div class="chat-avatar">${avatar}</div>` : ""}
  </div>`;
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

  // Agent thoughts
  s = s.replace(/&lt;(think|thought|thinking)&gt;([\s\S]*?)&lt;\/\1&gt;/gi, function(m, p1, inner) {
    return `<details class="agent-thoughts"><summary>Agent Thoughts</summary><div class="agent-thoughts-content">${inner}</div></details>`;
  });

  // Raw JSON array of thoughts
  s = s.replace(/\[\s*(?:&quot;|")[^\]]+(?:&quot;|")\s*\]/g, (match) => {
    try {
      let unescaped = match.replace(/&quot;/g, '"');
      let arr = JSON.parse(unescaped);
      if (Array.isArray(arr) && arr.length > 0 && typeof arr[0] === 'string') {
        let listStr = arr.map(step => `<li>${esc(step)}</li>`).join('');
        return `<details class="agent-thoughts" open><summary>Decision Process</summary><ul class="agent-thoughts-content">${listStr}</ul></details>`;
      }
    } catch(e) {}
    return match;
  });

  // Inline code `...`
  s = s.replace(/`([^`]+)`/g, (_m, c) => `<code>${c}</code>`);

  // Bold **...**
  s = s.replace(/\*\*([^*]+)\*\*/g, (_m, c) => `<strong>${c}</strong>`);

  // Italic *...*
  s = s.replace(/\*([^*]+)\*/g, (_m, c) => `<em>${c}</em>`);

  // Headings ### / ## / #
  s = s.replace(/^(#{1,4})\s+(.+)$/gm, (_m, hashes, content) => {
    const level = hashes.length;
    return `<h${level} class="chat-md-heading">${content}</h${level}>`;
  });

  // Horizontal rule ---
  s = s.replace(/^-{3,}$/gm, '<hr class="chat-md-hr">');

  // Unordered lists (- item or * item), consecutive lines
  s = s.replace(/(?:^[\-\*]\s+.+$\n?)+/gm, (block) => {
    const items = block.trim().split("\n").map(line =>
      `<li>${line.replace(/^[\-\*]\s+/, "")}</li>`
    ).join("");
    return `<ul class="chat-md-list">${items}</ul>`;
  });

  // Ordered lists (1. item), consecutive lines
  s = s.replace(/(?:^\d+\.\s+.+$\n?)+/gm, (block) => {
    const items = block.trim().split("\n").map(line =>
      `<li>${line.replace(/^\d+\.\s+/, "")}</li>`
    ).join("");
    return `<ol class="chat-md-list">${items}</ol>`;
  });

  // Line breaks (but not after block elements)
  s = s.replace(/\n/g, "<br>");
  // Clean up <br> right after block elements
  s = s.replace(/(<\/(?:ul|ol|li|pre|h[1-4]|hr|details|div)>)\s*<br>/g, "$1");
  s = s.replace(/<br>\s*(<(?:ul|ol|pre|h[1-4]|hr|details)[\s>])/g, "$1");

  return s;
}

// ── Agents list loader ───────────────────────────────────────────────────────

async function loadChatAgents() {
  if (chatState.agents !== null) return chatState.agents;
  if (chatState.loading) return null;
  chatState.loading = true;
  const MAX_RETRIES = 2;
  const RETRY_DELAY = 1500;
  try {
    let lastErr;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const raw = await api("GET", "/api/chat/agents");
        // API returns { res: [...] } or array directly
        const list = extractList(raw.res ?? raw);
        chatState.agents = list;
        return list;
      } catch (err) {
        lastErr = err;
        if (attempt < MAX_RETRIES) await new Promise(r => setTimeout(r, RETRY_DELAY));
      }
    }
    throw lastErr;
  } finally {
    chatState.loading = false;
  }
}

// ── Trace rendering ─────────────────────────────────────────────────────────

function renderProgressSteps(items) {
  if (!items || items.length === 0) return "";
  const steps = items.map(function(item) {
    var name = (item.skill_info && item.skill_info.name) || item.agent_name || "Step";
    var status = (item.status || "running").toLowerCase();
    var icon = status === "completed" || status === "success" ? "✅"
             : status === "failed" || status === "error" ? "❌"
             : '<span class="trace-spinner"></span>';
    var desc = item.description || "";
    return '<div class="trace-step trace-status-' + esc(status) + '">' +
      '<span class="trace-step-icon">' + icon + '</span>' +
      '<span class="trace-step-name">' + esc(name) + '</span>' +
      (desc ? '<span class="trace-step-desc">' + esc(desc) + '</span>' : "") +
    '</div>';
  });
  return '<div class="trace-steps">' + steps.join("") + '</div>';
}

async function fetchAndRenderTrace(bubbleEl, agentId, conversationId, $messagesEl) {
  try {
    var data = await api("GET", "/api/chat/trace?agentId=" + enc(agentId) + "&conversationId=" + enc(conversationId));
    var sessions = extractList(data);
    if (!sessions || sessions.length === 0) return;

    var latestSession = sessions[sessions.length - 1];
    var spans = latestSession.spans || latestSession.steps || latestSession.traces || [];
    if (spans.length === 0) return;

    var totalDuration = spans.reduce(function(sum, s) { return sum + (s.duration_ms || s.duration || 0); }, 0);
    var totalSec = (totalDuration / 1000).toFixed(1);

    var $trace = bubbleEl.querySelector(".trace-section");
    if (!$trace) {
      $trace = document.createElement("div");
      $trace.className = "trace-section trace-expanded";
      bubbleEl.appendChild($trace);
    }

    $trace.innerHTML =
      '<div class="trace-header" onclick="this.parentElement.classList.toggle(\'trace-expanded\')">' +
        '<span class="trace-toggle">▶</span> ' +
        '执行过程 (' + spans.length + ' 步, ' + totalSec + 's)' +
      '</div>' +
      '<div class="trace-body">' +
        spans.map(renderTraceSpan).join("") +
      '</div>';

    if ($messagesEl) $messagesEl.scrollTop = $messagesEl.scrollHeight;
  } catch (e) {
    // Trace is best-effort, don't break the conversation
  }
}

function renderTraceSpan(span) {
  var name = span.name || span.skill_name || span.operation_name || "Step";
  var status = (span.status || "completed").toLowerCase();
  var icon = status === "completed" || status === "success" || status === "ok" ? "✅"
           : status === "failed" || status === "error" ? "❌"
           : "⏳";
  var durationMs = span.duration_ms || span.duration || 0;
  var durationLabel = durationMs >= 1000 ? (durationMs / 1000).toFixed(1) + "s" : durationMs + "ms";

  var hasDetail = span.input || span.output || span.args || span.result;
  var detailHtml = "";
  if (hasDetail) {
    detailHtml =
      '<div class="trace-detail">' +
        '<div class="trace-detail-toggle" onclick="this.parentElement.classList.toggle(\'trace-detail-expanded\')">▶ 查看详情</div>' +
        '<div class="trace-detail-content">' +
          (span.input ? '<div class="trace-kv"><span class="trace-kv-label">输入:</span><pre>' + esc(typeof span.input === "string" ? span.input : JSON.stringify(span.input, null, 2)) + '</pre></div>' : "") +
          (span.args ? '<div class="trace-kv"><span class="trace-kv-label">参数:</span><pre>' + esc(typeof span.args === "string" ? span.args : JSON.stringify(span.args, null, 2)) + '</pre></div>' : "") +
          (span.output ? '<div class="trace-kv"><span class="trace-kv-label">输出:</span><pre>' + esc(typeof span.output === "string" ? span.output : JSON.stringify(span.output, null, 2)) + '</pre></div>' : "") +
          (span.result ? '<div class="trace-kv"><span class="trace-kv-label">结果:</span><pre>' + esc(typeof span.result === "string" ? span.result : JSON.stringify(span.result, null, 2)) + '</pre></div>' : "") +
        '</div>' +
      '</div>';
  }

  return '<div class="trace-step trace-status-' + esc(status) + '">' +
    '<span class="trace-step-icon">' + icon + '</span>' +
    '<span class="trace-step-name">' + esc(name) + '</span>' +
    '<span class="trace-step-duration">' + esc(durationLabel) + '</span>' +
    detailHtml +
  '</div>';
}

// ── Send message ─────────────────────────────────────────────────────────────

async function chatSend($messagesEl, $inputEl, $sendBtn, agentId) {
  const message = $inputEl.value.trim();
  if (!message || chatState.streaming) return;

  $inputEl.value = "";
  $inputEl.disabled = true;
  $sendBtn.disabled = true;
  chatState.streaming = true;

  // Remove welcome box if present
  const welcome = $messagesEl.querySelector('.chat-welcome-box');
  if (welcome) welcome.remove();

  // Append user bubble
  const userRow = document.createElement("div");
  userRow.className = "chat-message-row user";
  userRow.innerHTML = `
    <div class="chat-bubble chat-bubble-user">
      <div class="chat-bubble-content">${chatMarkdown(message)}</div>
    </div>
    <div class="chat-avatar">👤</div>
  `;
  $messagesEl.appendChild(userRow);

  // Append assistant placeholder
  const assistantRow = document.createElement("div");
  assistantRow.className = "chat-message-row assistant";
  assistantRow.innerHTML = `<div class="chat-avatar">🤖</div>`;

  const assistantDiv = document.createElement("div");
  assistantDiv.className = "chat-bubble chat-bubble-assistant";
  
  const agent = (chatState.agents ?? []).find(a => (a.id || a.agent_id) === agentId);
  const agentName = agent ? (agent.name || agent.agent_name || agentId) : agentId;
  assistantDiv.innerHTML = `<div class="chat-bubble-sender">${esc(agentName)}</div>`;

  const contentSpan = document.createElement("div");
  contentSpan.className = "chat-bubble-content";
  contentSpan.innerHTML = '<div class="chat-thinking-pulse"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>';
  
  assistantDiv.appendChild(contentSpan);
  assistantRow.appendChild(assistantDiv);
  
  $messagesEl.appendChild(assistantRow);
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
        } else if (evt.type === "progress" && Array.isArray(evt.items)) {
          let $trace = assistantDiv.querySelector(".trace-section");
          if (!$trace) {
            $trace = document.createElement("div");
            $trace.className = "trace-section trace-expanded";
            assistantDiv.appendChild($trace);
          }
          $trace.innerHTML = renderProgressSteps(evt.items);
          $messagesEl.scrollTop = $messagesEl.scrollHeight;
        } else if (evt.type === "done") {
          chatState.currentConversationId = evt.conversationId || chatState.currentConversationId;
          if (lastText) {
            chatState.conversations[agentId].push({ role: "assistant", text: lastText });
          }
          // Fetch full trace after completion
          const traceConvId = evt.conversationId || chatState.currentConversationId;
          if (traceConvId) {
            fetchAndRenderTrace(assistantDiv, agentId, traceConvId, $messagesEl);
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
        <button class="chat-clear-btn" onclick="chatClearConversation(${JSON.stringify(agentId)})" title="Clear Conversation">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: middle; margin-right: 4px;"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg> 
          Clear
        </button>
      </div>
      <div class="chat-messages" id="chat-messages">
        ${history.length === 0
          ? `<div class="chat-welcome-box">
               <div class="chat-welcome-icon">💭</div>
               <div class="chat-welcome-text">Start a conversation with <strong>${esc(agentName)}</strong></div>
             </div>`
          : history.map(msg => window.renderBubble(msg, agentName)).join("")}
      </div>
      <div class="chat-input-bar">
        <textarea id="chat-input" class="chat-input" rows="1" placeholder="Type a message…" ${chatState.streaming ? "disabled" : ""}></textarea>
        <button id="chat-send-btn" class="chat-send-btn" ${chatState.streaming ? "disabled" : ""}>
          Send
          <svg style="vertical-align: middle; margin-left: 4px;" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
        </button>
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

  $el.innerHTML = '<div class="loading-skeleton"><div class="skeleton skeleton-title"></div><div class="loading-skeleton grid"><div class="skeleton skeleton-card"></div><div class="skeleton skeleton-card"></div></div></div>';

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
    $el.innerHTML = '<div class="error-banner">No published decision agents found. Publish an agent in KWeaver Core first.</div>';
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
        <div class="chat-sidebar-header">Decision Agents</div>
        <div class="chat-sidebar-search">
          <input type="text" id="chat-agent-search" placeholder="Search agents..." oninput="chatFilterAgents(this.value)">
        </div>
        <div class="chat-agent-list" id="chat-agent-list">
          ${agents.map(agent => {
            const id = agent.id || agent.agent_id;
            const name = agent.name || agent.agent_name || id;
            const desc = agent.description || "";
            const isActive = id === activeAgentId;
            return `<div class="chat-agent-item${isActive ? " active" : ""}" data-agent-id="${esc(id)}" onclick="chatSelectAgent(${esc(JSON.stringify(id))})">
              <div class="chat-agent-item-icon">🤖</div>
              <div class="chat-agent-item-content">
                <div class="chat-agent-item-name">${esc(name)}</div>
                ${desc ? `<div class="chat-agent-item-desc">${esc(desc)}</div>` : ""}
              </div>
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
