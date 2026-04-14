// ── Chat Tab ─────────────────────────────────────────────────────────────────

const chatState = {
  agents: null,          // array of agent objects, null = not loaded
  loading: false,        // agents list loading
  // per-agent conversation history: { [agentId]: Array<{role, text}> }
  conversations: {},
  currentAgentId: null,
  streaming: false,
  abortController: null, // AbortController for current stream
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
  const avatar = isUser ? exploreIcon("user", 20) : exploreIcon("bot", 20);
  return `<div class="chat-message-row ${isUser ? 'user' : 'assistant'}">
    ${!isUser ? `<div class="chat-avatar" aria-hidden="true">${avatar}</div>` : ""}
    <div class="chat-bubble chat-bubble-${esc(msg.role)}">
      ${!isUser ? `<div class="chat-bubble-sender">${esc(agentName)}</div>` : ""}
      <div class="chat-bubble-content">${chatMarkdown(msg.text)}</div>
    </div>
    ${isUser ? `<div class="chat-avatar" aria-hidden="true">${avatar}</div>` : ""}
  </div>`;
};

// ── Markdown renderer (minimal) ──────────────────────────────────────────────

function isJsonData(text) {
  if (!text) return false;
  var trimmed = text.trim();
  if ((trimmed.startsWith('[{') || trimmed.startsWith('{"')) && trimmed.length > 200) {
    try { JSON.parse(trimmed); return true; } catch(e) { return false; }
  }
  return false;
}

function renderJsonData(text) {
  var trimmed = text.trim();
  try {
    var parsed = JSON.parse(trimmed);
    var formatted = JSON.stringify(parsed, null, 2);
    var preview = formatted.length > 150 ? formatted.substring(0, 150) + "..." : formatted;
    var count = Array.isArray(parsed) ? " (" + parsed.length + " rows)" : "";
    return '<details class="chat-json-data"><summary>' + exploreIcon("bar-chart-2", 16) + ' Data result' + esc(count) + '</summary><pre><code>' + esc(formatted) + '</code></pre></details>';
  } catch(e) {
    return '<pre><code>' + esc(trimmed) + '</code></pre>';
  }
}

function chatMarkdown(text) {
  if (!text) return "";

  // Detect raw JSON data and render as collapsible
  if (isJsonData(text)) return renderJsonData(text);

  // Detect SSE error events embedded in text (various formats)
  var errMatch = text.match(/event:error[\s\S]*?data:\s*(\{[\s\S]*\})\s*$/);
  if (!errMatch) errMatch = text.match(/event:error[\s\S]*?data:\s*(\{[\s\S]*\})/);
  if (errMatch) {
    try {
      var err = JSON.parse(errMatch[1]);
      var errMsg = err.description || err.details || errMatch[1];
      if (err.solution && err.solution !== "无" && err.solution !== "none") errMsg += "\nTip: " + err.solution;
      // Show detailed error info (code, details, link) in a collapsible block
      var errExtra = [];
      if (err.code) errExtra.push("Code: " + err.code);
      if (err.details && err.details !== err.description) errExtra.push("Details: " + err.details);
      if (err.link && err.link !== "无") errExtra.push("Link: " + err.link);
      var detailBlock = "";
      if (errExtra.length > 0) {
        detailBlock = "\n\n<details><summary>Error details</summary>\n" + errExtra.join("\n") + "\n</details>";
      }
      // Keep text before the error
      var beforeErr = text.substring(0, text.indexOf("event:error")).trim();
      text = (beforeErr ? beforeErr + "\n\n" : "") + errMsg + detailBlock;
    } catch(e) { /* keep original */ }
  }

  // Extract <details> blocks before escaping so they render as HTML
  var detailsBlocks = [];
  text = text.replace(/<details>([\s\S]*?)<\/details>/g, function(m) {
    var idx = detailsBlocks.length;
    detailsBlocks.push(m);
    return "%%DETAILS_" + idx + "%%";
  });

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

  // Restore <details> blocks
  for (var di = 0; di < detailsBlocks.length; di++) {
    // Render inner markdown of the details block
    var block = detailsBlocks[di];
    // Extract summary and body
    var sumMatch = block.match(/<summary>([\s\S]*?)<\/summary>/);
    var sumText = sumMatch ? sumMatch[1] : "";
    var bodyContent = block.replace(/<\/?details>/g, "").replace(/<summary>[\s\S]*?<\/summary>/, "").trim();
    // Render code blocks inside details
    bodyContent = bodyContent.replace(/```json\n([\s\S]*?)\n```/g, function(_m, code) {
      return '<pre class="chat-error-detail-code">' + esc(code) + '</pre>';
    });
    bodyContent = bodyContent.replace(/```([\s\S]*?)```/g, function(_m, code) {
      return '<pre>' + esc(code) + '</pre>';
    });
    s = s.replace("%%DETAILS_" + di + "%%", '<details class="chat-error-detail"><summary>' + sumText + '</summary>' + bodyContent + '</details>');
  }

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
        const list = extractListFromAgentApiResponse(raw);
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
    var skillType = (item.skill_info && item.skill_info.type) || "";
    var status = (item.status || "running").toLowerCase();
    var icon = status === "completed" || status === "success" ? exploreIcon("check-circle", 18)
             : status === "failed" || status === "error" ? exploreIcon("x-circle", 18)
             : '<span class="trace-spinner"></span>';
    var desc = item.description || "";

    // Tool call details
    var detailParts = [];

    // Show skill args
    if (item.skill_info && item.skill_info.args && item.skill_info.args.length > 0) {
      var argsHtml = item.skill_info.args.map(function(arg) {
        var val = arg.value;
        if (typeof val === "object" && val !== null) val = JSON.stringify(val);
        return '<span class="tool-arg"><span class="tool-arg-name">' + esc(arg.name || "") + ':</span> ' + esc(String(val || "")) + '</span>';
      }).join("");
      detailParts.push('<div class="tool-args">' + argsHtml + '</div>');
    }

    // Show input_message
    if (item.input_message) {
      detailParts.push('<div class="tool-io"><span class="tool-io-label">Input:</span> ' + esc(item.input_message) + '</div>');
    }

    // Show result/answer
    var resultText = item.result || "";
    if (!resultText && item.answer) {
      resultText = typeof item.answer === "string" ? item.answer : JSON.stringify(item.answer, null, 2);
    }
    if (resultText) {
      var truncated = resultText.length > 200 ? resultText.substring(0, 200) + "..." : resultText;
      detailParts.push(
        '<div class="tool-io">' +
          '<span class="tool-io-label">Output:</span>' +
          '<span class="tool-io-value">' + esc(truncated) + '</span>' +
          (resultText.length > 200 ? '<div class="tool-result-full" style="display:none"><pre>' + esc(resultText) + '</pre></div><span class="tool-expand" onclick="var el=this.previousElementSibling;el.style.display=el.style.display===\'none\'?\'block\':\'none\';this.textContent=el.style.display===\'none\'?\'Expand\':\'Collapse\'">Expand</span>' : '') +
        '</div>'
      );
    }

    var detailHtml = detailParts.length > 0
      ? '<div class="tool-detail">' + detailParts.join("") + '</div>'
      : "";

    var typeLabel = skillType ? '<span class="tool-type-badge">' + esc(skillType) + '</span>' : '';

    return '<div class="trace-step trace-status-' + esc(status) + '">' +
      '<span class="trace-step-icon">' + icon + '</span>' +
      '<span class="trace-step-name">' + esc(name) + '</span>' +
      typeLabel +
      (desc ? '<span class="trace-step-desc">' + esc(desc) + '</span>' : "") +
      detailHtml +
    '</div>';
  });
  return '<div class="trace-steps">' + steps.join("") + '</div>';
}

// ── Tool Detail Slide-out Panel ──────────────────────────────────────────────

function showToolDetailPanel(detail, toolName) {
  // Toggle: if panel is already open for the same tool, close it
  var existing = document.querySelector(".tool-detail-panel");
  if (existing) {
    var isSameTool = existing.getAttribute("data-panel-tool") === toolName;
    existing.classList.remove("tool-detail-panel-open");
    setTimeout(function() { existing.remove(); }, 250);
    if (isSameTool) return;
  }

  var panel = document.createElement("div");
  panel.className = "tool-detail-panel";
  panel.setAttribute("data-panel-tool", toolName || "");

  var sections = [];

  // Args / Input
  if (detail.args && detail.args.length > 0) {
    var argsHtml = detail.args.map(function(a) {
      var val = a.value;
      if (typeof val === "object" && val !== null) val = JSON.stringify(val, null, 2);
      return '<div class="tool-detail-kv"><span class="tool-detail-key">' + esc(a.name || "") + '</span><span class="tool-detail-val">' + esc(String(val || "")) + '</span></div>';
    }).join("");
    sections.push('<div class="tool-detail-section"><div class="tool-detail-section-title">Arguments</div>' + argsHtml + '</div>');
  }
  if (detail.input) {
    var inputStr = typeof detail.input === "string" ? detail.input : JSON.stringify(detail.input, null, 2);
    sections.push('<div class="tool-detail-section"><div class="tool-detail-section-title">Input</div><pre>' + esc(inputStr) + '</pre></div>');
  }

  // Output
  if (detail.output) {
    var outputStr = typeof detail.output === "string" ? detail.output : JSON.stringify(detail.output, null, 2);
    sections.push('<div class="tool-detail-section"><div class="tool-detail-section-title">Output</div><pre>' + esc(outputStr) + '</pre></div>');
  }

  panel.innerHTML =
    '<div class="tool-detail-panel-header">' +
      '<span class="tool-detail-panel-title">' + exploreIcon("wrench", 18) + ' ' + esc(toolName || "Tool details") + '</span>' +
      '<button type="button" class="tool-detail-panel-close" aria-label="Close panel" onclick="this.closest(\'.tool-detail-panel\').remove()">&times;</button>' +
    '</div>' +
    '<div class="tool-detail-panel-body">' +
      (sections.length > 0 ? sections.join("") : '<div class="tool-detail-empty">No additional details.</div>') +
    '</div>';

  document.body.appendChild(panel);
  // Animate in
  requestAnimationFrame(function() { panel.classList.add("tool-detail-panel-open"); });
}

async function fetchAndRenderTrace(bubbleEl, agentId, conversationId, $messagesEl) {
  // Trace data may not be available immediately after chat ends — retry with backoff
  var TRACE_RETRY_DELAYS = [2000, 4000];
  var sessions = null;

  for (var attempt = 0; attempt <= TRACE_RETRY_DELAYS.length; attempt++) {
    if (attempt > 0) {
      await new Promise(function(r) { setTimeout(r, TRACE_RETRY_DELAYS[attempt - 1]); });
    }
    try {
      var data = await api("GET", "/api/chat/trace?agentId=" + enc(agentId) + "&conversationId=" + enc(conversationId));
      sessions = Array.isArray(data) ? data
        : Array.isArray(data?.sessions) ? data.sessions
        : Array.isArray(data?.results) ? data.results
        : extractList(data);
      if (sessions && sessions.length > 0) break;
    } catch (e) {
      // Trace is best-effort
    }
  }

  try {
    if (!sessions || sessions.length === 0) return;

    var latestSession = sessions[sessions.length - 1];
    var spans = latestSession.spans || latestSession.steps || latestSession.traces || latestSession.operations || [];
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
        "Trace (" + spans.length + " steps, " + totalSec + "s)" +
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
  var icon = status === "completed" || status === "success" || status === "ok" ? exploreIcon("check-circle", 18)
           : status === "failed" || status === "error" ? exploreIcon("x-circle", 18)
           : '<span class="trace-spinner"></span>';
  var durationMs = span.duration_ms || span.duration || 0;
  var durationLabel = durationMs >= 1000 ? (durationMs / 1000).toFixed(1) + "s" : durationMs + "ms";

  var hasDetail = span.input || span.output || span.args || span.result;
  var detailHtml = "";
  if (hasDetail) {
    detailHtml =
      '<div class="trace-detail">' +
        '<div class="trace-detail-toggle" onclick="this.parentElement.classList.toggle(\'trace-detail-expanded\')">Show details</div>' +
        '<div class="trace-detail-content">' +
          (span.input ? '<div class="trace-kv"><span class="trace-kv-label">Input:</span><pre>' + esc(typeof span.input === "string" ? span.input : JSON.stringify(span.input, null, 2)) + '</pre></div>' : "") +
          (span.args ? '<div class="trace-kv"><span class="trace-kv-label">Arguments:</span><pre>' + esc(typeof span.args === "string" ? span.args : JSON.stringify(span.args, null, 2)) + '</pre></div>' : "") +
          (span.output ? '<div class="trace-kv"><span class="trace-kv-label">Output:</span><pre>' + esc(typeof span.output === "string" ? span.output : JSON.stringify(span.output, null, 2)) + '</pre></div>' : "") +
          (span.result ? '<div class="trace-kv"><span class="trace-kv-label">Result:</span><pre>' + esc(typeof span.result === "string" ? span.result : JSON.stringify(span.result, null, 2)) + '</pre></div>' : "") +
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

function showStopButton($sendBtn) {
  $sendBtn.classList.add("chat-stop-mode");
  $sendBtn.setAttribute("aria-label", "Stop generation");
  $sendBtn.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="vertical-align: middle; margin-right: 4px;" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"></rect></svg>
    Stop`;
  $sendBtn.disabled = false;
}

function showSendButton($sendBtn) {
  $sendBtn.classList.remove("chat-stop-mode");
  $sendBtn.setAttribute("aria-label", "Send message");
  $sendBtn.innerHTML = `
    Send
    <svg style="vertical-align: middle; margin-left: 4px;" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>`;
  $sendBtn.disabled = false;
}

async function chatSend($messagesEl, $inputEl, $sendBtn, agentId) {
  const message = $inputEl.value.trim();
  if (!message || chatState.streaming) return;

  $inputEl.value = "";
  $inputEl.disabled = true;
  chatState.streaming = true;

  // Show stop button
  const abortController = new AbortController();
  chatState.abortController = abortController;
  showStopButton($sendBtn);

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
    <div class="chat-avatar" aria-hidden="true">${exploreIcon("user", 20)}</div>
  `;
  $messagesEl.appendChild(userRow);

  const agent = (chatState.agents ?? []).find(a => (a.id || a.agent_id) === agentId);
  const agentName = agent ? (agent.name || agent.agent_name || agentId) : agentId;

  // Container for the entire assistant response (interleaved: segment → tool → segment → tool → ...)
  const assistantContainer = document.createElement("div");
  assistantContainer.className = "chat-assistant-container";

  // Current streaming bubble (always at the bottom)
  const currentBubble = document.createElement("div");
  currentBubble.className = "chat-bubble chat-bubble-assistant";
  currentBubble.innerHTML = `<div class="chat-bubble-sender">${esc(agentName)}</div>`;

  const contentSpan = document.createElement("div");
  contentSpan.className = "chat-bubble-content";
  contentSpan.innerHTML = '<div class="chat-thinking-pulse"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>';
  currentBubble.appendChild(contentSpan);
  assistantContainer.appendChild(currentBubble);

  // Wrap in a message row
  const assistantRow = document.createElement("div");
  assistantRow.className = "chat-message-row assistant";
  assistantRow.innerHTML = `<div class="chat-avatar" aria-hidden="true">${exploreIcon("bot", 20)}</div>`;
  assistantRow.appendChild(assistantContainer);

  $messagesEl.appendChild(assistantRow);
  $messagesEl.scrollTop = $messagesEl.scrollHeight;

  // Smart auto-scroll: only scroll if user is near the bottom
  let userScrolledUp = false;
  function onUserScroll() {
    var threshold = 80;
    userScrolledUp = ($messagesEl.scrollHeight - $messagesEl.scrollTop - $messagesEl.clientHeight) > threshold;
  }
  $messagesEl.addEventListener("scroll", onUserScroll);
  function autoScroll() {
    if (!userScrolledUp) {
      $messagesEl.scrollTop = $messagesEl.scrollHeight;
    }
  }

  // Persist user message
  if (!chatState.conversations[agentId]) chatState.conversations[agentId] = [];
  chatState.conversations[agentId].push({ role: "user", text: message });

  const conversationId = chatState.currentConversationId ?? undefined;
  let aborted = false;
  let stepCount = 0;
  let receivedDone = false;

  try {
    const res = await fetch("/api/chat/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId, message, conversationId }),
      signal: abortController.signal,
    });

    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => res.statusText);
      // Detect auth errors and show friendly message
      var isAuthError = res.status === 401 || res.status === 403;
      if (!isAuthError) {
        try {
          var errObj = JSON.parse(errText);
          isAuthError = errObj.upstream_status === 401 || errObj.upstream_status === 403
            || (errObj.error && /认证|auth|token|expired|unauthorized/i.test(errObj.error));
        } catch(e) {}
      }
      if (isAuthError) {
        contentSpan.innerHTML = '<div class="chat-auth-error">' +
          '<div class="chat-auth-error-icon" aria-hidden="true">' + exploreIcon("lock", 28) + '</div>' +
          '<div class="chat-auth-error-title">Session expired</div>' +
          '<div class="chat-auth-error-desc">Sign in again from the terminal, then refresh this page.</div>' +
          '<div class="chat-auth-error-cmd"><code>kweaver auth login</code></div>' +
          '</div>';
      } else {
        var displayErr = errText;
        try {
          var parsedErr = JSON.parse(errText);
          displayErr = parsedErr.error || errText;
          if (parsedErr.detail) {
            var detailContent = parsedErr.detail;
            try { detailContent = JSON.stringify(JSON.parse(parsedErr.detail), null, 2); } catch(e2) {}
            contentSpan.innerHTML = '<span class="chat-error">' + exploreIcon("alert-triangle", 16) + ' ' + esc(displayErr) + '</span>' +
              '<details class="chat-error-detail"><summary>Details</summary><pre>' + esc(detailContent) + '</pre></details>';
            chatState.streaming = false;
            chatState.abortController = null;
            $inputEl.disabled = false;
            showSendButton($sendBtn);
            return;
          }
        } catch(e3) {}
        contentSpan.innerHTML = `<span class="chat-error">${exploreIcon("alert-triangle", 16)} Error ${res.status}: ${esc(displayErr)}</span>`;
      }
      chatState.streaming = false;
      chatState.abortController = null;
      $inputEl.disabled = false;
      showSendButton($sendBtn);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let lastText = "";

    const gen = navGeneration;
    // Stall detection: if no data arrives for 30s, show warning; 90s = abort
    const STALL_WARN_MS = 30000;
    const STALL_ABORT_MS = 90000;
    let lastDataTime = Date.now();
    let stallWarningShown = false;
    const stallInterval = setInterval(() => {
      const elapsed = Date.now() - lastDataTime;
      if (elapsed >= STALL_ABORT_MS) {
        abortController.abort();
      } else if (elapsed >= STALL_WARN_MS && !stallWarningShown) {
        stallWarningShown = true;
        var warn = document.createElement("div");
        warn.className = "chat-stall-warning";
        warn.textContent = "Still waiting for a response. You can press Stop and try again.";
        currentBubble.appendChild(warn);
      }
    }, 3000);

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (navGeneration !== gen) { reader.cancel(); break; }
      if (abortController.signal.aborted) { reader.cancel(); aborted = true; break; }
      lastDataTime = Date.now();
      if (stallWarningShown) {
        stallWarningShown = false;
        var existingWarn = currentBubble.querySelector(".chat-stall-warning");
        if (existingWarn) existingWarn.remove();
      }

      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const dataStr = line.slice(6).trim();
        if (!dataStr) continue;
        let evt;
        try { evt = JSON.parse(dataStr); } catch { continue; }

        if (evt.type === "segment") {
          var segText = (evt.text || "").trim();
          // Skip trivial segments: too short, just agent name, or whitespace only
          if (segText.length < 5 || segText === agentName) {
            contentSpan.innerHTML = '<div class="chat-thinking-pulse"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>';
          } else {
            stepCount++;
            // Insert segment bubble before the current streaming bubble
            var segBubble = document.createElement("div");
            segBubble.className = "chat-bubble chat-bubble-assistant chat-segment-bubble";
            segBubble.innerHTML = '<div class="chat-bubble-content">' + chatMarkdown(segText) + '</div>';
            assistantContainer.insertBefore(segBubble, currentBubble);
            // Reset streaming bubble for next phase
            contentSpan.innerHTML = '<div class="chat-thinking-pulse"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>';
          }
          autoScroll();
        } else if (evt.type === "text") {
          lastText = evt.fullText ?? "";
          var currentText = evt.currentText ?? lastText;
          if (currentText) {
            contentSpan.innerHTML = chatMarkdown(currentText);
            contentSpan.classList.add("chat-streaming-cursor");
            // Detect if text contains a terminal error — flag for auto-stop
            if (/event:error[\s\S]*?"code"/.test(currentText)) {
              chatState.conversations[agentId].push({ role: "assistant", text: lastText });
              reader.cancel();
              aborted = true;
            }
          }
          autoScroll();
        } else if (evt.type === "step_meta") {
          // Tool call metadata — dedup by tool id, update in place
          var meta = evt.meta || {};
          if (!meta || meta === null) { /* null meta = reset, skip */ }
          else {
            var statusText = meta.status || "";
            var toolId = meta.id || (meta.skill_info && meta.skill_info.name) || meta.agent_name || "";
            var toolName = (meta.skill_info && meta.skill_info.name) || meta.agent_name || "";
            if (!toolName && meta.description) toolName = meta.description;
            if (!toolId) toolId = toolName;
            // Skip if no meaningful info
            if (toolName || statusText) {
              var isRunning = statusText === "running" || statusText === "processing";
              var isCompleted = statusText === "completed" || statusText === "success";
              var isFailed = statusText === "failed" || statusText === "error";

              // Build brief args string from skill_info.args
              var argsStr = "";
              if (meta.skill_info && meta.skill_info.args && meta.skill_info.args.length > 0) {
                argsStr = meta.skill_info.args.map(function(a) {
                  var v = a.value;
                  if (typeof v === "string" && v.length > 30) v = v.substring(0, 30) + "…";
                  if (typeof v === "object" && v !== null) v = JSON.stringify(v).substring(0, 30) + "…";
                  return (a.name || "") + "=" + v;
                }).join(", ");
              } else if (meta.input_message) {
                argsStr = meta.input_message.length > 60 ? meta.input_message.substring(0, 60) + "…" : meta.input_message;
              }

              // Format time
              var timeStr = "";
              var tsRaw = meta.end_time || meta.start_time;
              if (tsRaw) {
                var ts = parseFloat(String(tsRaw));
                if (ts > 1e9 && ts < 1e12) timeStr = new Date(ts * 1000).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                else if (ts > 1e12) timeStr = new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
              }

              var icon = isRunning ? '<span class="trace-spinner"></span>' : isCompleted ? exploreIcon("check-circle", 18) : isFailed ? exploreIcon("x-circle", 18) : exploreIcon("wrench", 18);

              // Build tool card HTML
              var cardHtml = '<span class="chat-tool-call-icon">' + icon + '</span>' +
                '<span class="chat-tool-call-name">' + esc(toolName || statusText) + '</span>' +
                (argsStr ? '<span class="chat-tool-call-args">(' + esc(argsStr) + ')</span>' : '') +
                (timeStr ? '<span class="chat-tool-call-time">' + esc(timeStr) + '</span>' : '');

              // Store full I/O data for detail panel
              var detailData = {};
              if (meta.input_message) detailData.input = meta.input_message;
              if (meta.skill_info && meta.skill_info.args) detailData.args = meta.skill_info.args;
              if (meta.block_answer) detailData.output = meta.block_answer;

              // Dedup: find existing card for same tool id
              var existingCard = assistantContainer.querySelector('.chat-tool-call[data-tool-id="' + esc(toolId) + '"]');
              if (existingCard) {
                // Update existing card
                existingCard.innerHTML = cardHtml;
                existingCard.className = "chat-tool-call" + (isRunning ? " chat-tool-call-running" : "");
                if (Object.keys(detailData).length > 0) {
                  existingCard.setAttribute("data-tool-detail", JSON.stringify(detailData));
                }
              } else {
                var toolCard = document.createElement("div");
                toolCard.className = "chat-tool-call" + (isRunning ? " chat-tool-call-running" : "");
                toolCard.setAttribute("data-tool-id", toolId);
                toolCard.innerHTML = cardHtml;
                if (Object.keys(detailData).length > 0) {
                  toolCard.setAttribute("data-tool-detail", JSON.stringify(detailData));
                }
                // Click to show detail panel
                toolCard.addEventListener("click", function() {
                  var raw = this.getAttribute("data-tool-detail");
                  if (!raw) return;
                  showToolDetailPanel(JSON.parse(raw), this.querySelector(".chat-tool-call-name").textContent);
                });
                toolCard.style.cursor = "pointer";
                toolCard.title = "Show details";
                assistantContainer.insertBefore(toolCard, currentBubble);
              }
              autoScroll();
            }
          }
        } else if (evt.type === "progress" && Array.isArray(evt.items)) {
          // Insert/update progress steps before the streaming bubble
          var existingProgress = assistantContainer.querySelector(".chat-progress-inline");
          if (!existingProgress) {
            existingProgress = document.createElement("div");
            existingProgress.className = "chat-progress-inline";
            assistantContainer.insertBefore(existingProgress, currentBubble);
          }
          existingProgress.innerHTML = renderProgressSteps(evt.items);
          autoScroll();
        } else if (evt.type === "done") {
          receivedDone = true;
          chatState.currentConversationId = evt.conversationId || chatState.currentConversationId;
          if (lastText) {
            chatState.conversations[agentId].push({ role: "assistant", text: lastText });
          }
          // Fetch full trace after completion — append at end of container
          const traceConvId = evt.conversationId || chatState.currentConversationId;
          if (traceConvId) {
            var traceHolder = document.createElement("div");
            traceHolder.className = "chat-trace-holder";
            assistantContainer.appendChild(traceHolder);
            fetchAndRenderTrace(traceHolder, agentId, traceConvId, $messagesEl);
          }
        } else if (evt.type === "conversation_id") {
          chatState.currentConversationId = evt.conversationId;
        } else if (evt.type === "error") {
          var errHtml = '<span class="chat-error">' + exploreIcon("alert-triangle", 16) + ' ' + esc(evt.error) + '</span>';
          if (evt.detail) {
            var detailStr = evt.detail;
            try {
              detailStr = JSON.stringify(JSON.parse(evt.detail), null, 2);
            } catch(e) {}
            errHtml += '<details class="chat-error-detail"><summary>Details</summary><pre>' + esc(detailStr) + '</pre></details>';
          }
          contentSpan.innerHTML = errHtml;
        }
      }
    }

    clearInterval(stallInterval);
    contentSpan.classList.remove("chat-streaming-cursor");
    var leftoverWarn = currentBubble.querySelector(".chat-stall-warning");
    if (leftoverWarn) leftoverWarn.remove();

    if (aborted) {
      if (lastText) {
        chatState.conversations[agentId].push({ role: "assistant", text: lastText });
      } else {
        contentSpan.innerHTML = '<span class="chat-stopped">Response stopped.</span>';
      }
    } else if (!lastText) {
      contentSpan.innerHTML = '<span class="chat-error">No response received.</span>';
    }

    // Fallback: if stream ended without a "done" event (e.g. 502, connection reset),
    // still attempt to fetch trace using whatever conversationId we have
    if (!receivedDone && !aborted && lastText) {
      chatState.conversations[agentId].push({ role: "assistant", text: lastText });
      var fallbackConvId = chatState.currentConversationId;
      if (fallbackConvId) {
        var traceHolder = document.createElement("div");
        traceHolder.className = "chat-trace-holder";
        assistantContainer.appendChild(traceHolder);
        fetchAndRenderTrace(traceHolder, agentId, fallbackConvId, $messagesEl);
      }
    }
  } catch (err) {
    clearInterval(stallInterval);
    contentSpan.classList.remove("chat-streaming-cursor");
    if (err.name === "AbortError") {
      contentSpan.innerHTML = '<span class="chat-stopped">Response stopped.</span>';
    } else {
      contentSpan.innerHTML = `<span class="chat-error">${esc(err.message || String(err))}</span>`;
    }
  }

  chatState.streaming = false;
  chatState.abortController = null;
  $inputEl.disabled = false;
  showSendButton($sendBtn);
  $inputEl.focus();
  $messagesEl.removeEventListener("scroll", onUserScroll);
  $messagesEl.scrollTop = $messagesEl.scrollHeight;
}

// ── Render chat conversation area ────────────────────────────────────────────

function renderChatConversation($el, agentId, agentName) {
  const history = chatState.conversations[agentId] ?? [];

  $el.innerHTML = `
    <div class="chat-pane">
      <div class="chat-header">
        <span class="chat-agent-name">${esc(agentName)}</span>
        <button type="button" class="chat-clear-btn" onclick="chatClearConversation(${JSON.stringify(agentId)})" title="Clear conversation" aria-label="Clear conversation">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: middle; margin-right: 4px;"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg> 
          Clear
        </button>
      </div>
      <div class="chat-messages" id="chat-messages">
        ${history.length === 0
          ? `<div class="chat-welcome-box">
               <div class="chat-welcome-icon" aria-hidden="true">${exploreIcon("message-circle", 48)}</div>
               <div class="chat-welcome-text">Start a conversation with <strong>${esc(agentName)}</strong></div>
             </div>`
          : history.map(msg => window.renderBubble(msg, agentName)).join("")}
      </div>
      <div class="chat-input-bar">
        <label for="chat-input" class="visually-hidden">Message to send</label>
        <textarea id="chat-input" class="chat-input" rows="1" placeholder="Type a message…" autocomplete="off" ${chatState.streaming ? "disabled" : ""}></textarea>
        <button type="button" id="chat-send-btn" class="chat-send-btn" aria-label="Send message" ${chatState.streaming ? "disabled" : ""}>
          Send
          <svg style="vertical-align: middle; margin-left: 4px;" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
        </button>
      </div>
    </div>
  `;

  const $messages = $el.querySelector("#chat-messages");
  const $input = $el.querySelector("#chat-input");
  const $sendBtn = $el.querySelector("#chat-send-btn");

  // Scroll to bottom
  if ($messages) $messages.scrollTop = $messages.scrollHeight;

  // Wire up send / stop
  const doSend = () => chatSend($messages, $input, $sendBtn, agentId);
  const doStop = () => {
    if (chatState.abortController) {
      chatState.abortController.abort();
    }
  };
  $sendBtn.addEventListener("click", () => {
    if (chatState.streaming) {
      doStop();
    } else {
      doSend();
    }
  });
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

  // Detect test agents and sort them to the end
  function isTestAgent(agent) {
    const name = (agent.name || agent.agent_name || "").toLowerCase();
    const key = (agent.key || "").toLowerCase();
    const byName = (agent.published_by_name || "").toLowerCase();
    return byName === "testbot"
      || /测试智能体/.test(name)
      || /test[_-]agent/.test(key)
      || /^(api|chat|publish|unpublish)[_-]test/.test(key);
  }

  // Sort: non-test first, then test; within each group keep original order
  agents.sort((a, b) => {
    const aTest = isTestAgent(a) ? 1 : 0;
    const bTest = isTestAgent(b) ? 1 : 0;
    return aTest - bTest;
  });

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
          <input type="search" id="chat-agent-search" placeholder="Search agents..." aria-label="Search agents" oninput="chatFilterAgents(this.value)">
        </div>
        <div class="chat-agent-list" id="chat-agent-list">
          ${agents.map(agent => {
            const id = agent.id || agent.agent_id;
            const name = agent.name || agent.agent_name || id;
            const desc = agent.description || "";
            const isActive = id === activeAgentId;
            const testFlag = isTestAgent(agent);
            return `<div class="chat-agent-item${isActive ? " active" : ""}${testFlag ? " chat-agent-test" : ""}" data-agent-id="${esc(id)}" onclick="chatSelectAgent(${esc(JSON.stringify(id))})">
              <div class="chat-agent-item-icon" aria-hidden="true">${testFlag ? exploreIcon("flask", 20) : exploreIcon("bot", 20)}</div>
              <div class="chat-agent-item-content">
                <div class="chat-agent-item-name">${esc(name)}${testFlag ? ' <span class="chat-test-badge">TEST</span>' : ""}</div>
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
