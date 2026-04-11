/* global api, esc, enc, extractList, navGeneration, chatMarkdown, renderProgressSteps, fetchAndRenderTrace, renderBubble */

// ── Composer state ──────────────────────────────────────────────────────────

var composerState = {
  step: 1,           // 1=Choose, 2=Generate, 3=Review, 4=Run
  config: null,      // ComposerConfig deep-cloned from template
  exec: null,        // { orchestratorId, agentIds, allAgentIds, conversationId, done }
  templates: null,   // cached templates array
  promptDraft: "",   // persisted natural-language draft from step 1
  generate: null,    // { prompt, fullText, progressItems, error, done, started }
};

// ── Stepper rendering ───────────────────────────────────────────────────────

var COMPOSER_STEPS = [
  { num: 1, label: "Choose" },
  { num: 2, label: "Generate" },
  { num: 3, label: "Review" },
  { num: 4, label: "Run" },
];

function renderComposerStepper(activeStep) {
  var html = '<div class="composer-stepper">';
  for (var i = 0; i < COMPOSER_STEPS.length; i++) {
    var s = COMPOSER_STEPS[i];
    var cls = "composer-step-dot";
    if (s.disabled) cls += " disabled";
    else if (s.num === activeStep) cls += " active";
    else if (s.num < activeStep) cls += " done";

    if (i > 0) html += '<div class="composer-step-line"></div>';
    html += '<div class="' + cls + '">' +
      '<span class="composer-step-num">' + s.num + '</span>' +
      '<span class="composer-step-label">' + esc(s.label) + '</span>' +
      '</div>';
  }
  html += '</div>';
  return html;
}

// ── Main entry point ────────────────────────────────────────────────────────

// eslint-disable-next-line no-unused-vars
function renderComposer($el, parts, params) {
  var html = '<div class="composer-wizard">' +
    renderComposerStepper(composerState.step) +
    '<div class="composer-content" id="composer-content"></div>' +
    '</div>';
  $el.innerHTML = html;

  var $content = document.getElementById("composer-content");
  if (!$content) return;

  if (composerState.step === 1) {
    renderComposerChoose($content);
  } else if (composerState.step === 2) {
    renderComposerGenerate($content);
  } else if (composerState.step === 3) {
    renderComposerReview($content);
  } else if (composerState.step === 4) {
    renderComposerRun($content);
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function composerGoTo(step) {
  composerState.step = step;
  var $el = document.getElementById("content");
  if ($el) renderComposer($el, [], new URLSearchParams());
}

// ── Step 1: Choose ──────────────────────────────────────────────────────────

function renderComposerChoose($content) {
  $content.innerHTML =
    '<div class="composer-choose-layout">' +
      '<div class="composer-choose-left">' +
        '<h3>Natural Language</h3>' +
        '<textarea class="composer-nl-input" id="composer-nl-input" placeholder="Describe your multi-agent workflow...">' + esc(composerState.promptDraft || "") + '</textarea>' +
        '<div class="composer-hint">Describe the workflow you want, then generate a draft composition before reviewing it.</div>' +
        '<div class="composer-nav composer-choose-nav">' +
          '<button class="composer-btn composer-btn-primary" id="composer-nl-next-btn">Generate Draft &rarr;</button>' +
        '</div>' +
      '</div>' +
      '<div class="composer-choose-right">' +
        '<h3>Templates</h3>' +
        '<div class="composer-template-grid" id="composer-template-grid">' +
          '<div class="loading-skeleton">Loading templates...</div>' +
        '</div>' +
      '</div>' +
    '</div>';

  loadComposerTemplates();

  var $input = document.getElementById("composer-nl-input");
  var $nextBtn = document.getElementById("composer-nl-next-btn");
  if ($input) {
    $input.addEventListener("input", function() {
      composerState.promptDraft = this.value;
      if ($nextBtn) $nextBtn.disabled = !this.value.trim();
    });
    $input.focus();
  }
  if ($nextBtn) {
    $nextBtn.disabled = !(composerState.promptDraft || "").trim();
    $nextBtn.addEventListener("click", function() {
      composerState.generate = {
        prompt: composerState.promptDraft,
        fullText: "",
        progressItems: [],
        error: "",
        done: false,
        started: false,
      };
      composerState.config = null;
      composerState.exec = null;
      composerGoTo(2);
    });
  }
}

// ── Step 2: Generate ────────────────────────────────────────────────────────

function renderComposerGenerate($content) {
  var state = composerState.generate;
  if (!state || !state.prompt) { composerGoTo(1); return; }

  $content.innerHTML =
    '<div class="composer-generate-layout">' +
      '<div class="composer-generate-summary">' +
        '<div class="composer-generate-label">Prompt</div>' +
        '<div class="composer-generate-prompt">' + esc(state.prompt) + '</div>' +
      '</div>' +
      '<div class="composer-stream-progress" id="composer-generate-progress"></div>' +
      '<div class="composer-stream-text composer-generate-text" id="composer-generate-text"></div>' +
      '<div id="composer-generate-error"></div>' +
    '</div>' +
    '<div class="composer-nav">' +
      '<button class="composer-btn composer-btn-secondary" id="composer-generate-back-btn">&larr; Back</button>' +
    '</div>';

  document.getElementById("composer-generate-back-btn").addEventListener("click", function() {
    if (composerState.generate && composerState.generate._abort) {
      composerState.generate._abort.abort();
    }
    composerState.generate = null;
    composerGoTo(1);
  });

  renderComposerGenerateState();
  if (!state.started) startComposerGenerate();
}

function renderComposerGenerateState() {
  var state = composerState.generate;
  if (!state) return;

  var $progress = document.getElementById("composer-generate-progress");
  var $text = document.getElementById("composer-generate-text");
  var $error = document.getElementById("composer-generate-error");

  if ($progress) {
    $progress.style.display = state.progressItems && state.progressItems.length ? "block" : "none";
    $progress.innerHTML = state.progressItems && state.progressItems.length ? renderProgressSteps(state.progressItems) : "";
  }

  if ($text) {
    $text.innerHTML = state.fullText ? chatMarkdown(state.fullText) : '<div class="chat-thinking-pulse"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>';
  }

  if ($error) {
    $error.innerHTML = state.error ? '<div class="error-banner">' + esc(state.error) + '</div>' : '';
  }
}

function startComposerGenerate() {
  var state = composerState.generate;
  if (!state || state.started) return;
  state.started = true;
  state.error = "";
  renderComposerGenerateState();

  var controller = new AbortController();
  state._abort = controller;

  fetch("/api/composer/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: state.prompt }),
    signal: controller.signal,
  }).then(function(res) {
    if (!res.ok || !res.body) {
      return res.text().then(function(errText) {
        state.error = errText || ("Error " + res.status);
        renderComposerGenerateState();
      });
    }

    var reader = res.body.getReader();
    var decoder = new TextDecoder();
    var buf = "";

    function readChunk() {
      return reader.read().then(function(result) {
        if (result.done) {
          if (composerState.config) {
            composerGoTo(3);
          } else if (!state.error) {
            state.error = "Stream ended unexpectedly without producing a config.";
            renderComposerGenerateState();
          }
          return;
        }

        buf += decoder.decode(result.value, { stream: true });
        var lines = buf.split("\n");
        buf = lines.pop() || "";

        for (var i = 0; i < lines.length; i++) {
          var line = lines[i];
          if (!line.startsWith("data: ")) continue;
          var dataStr = line.slice(6).trim();
          if (!dataStr) continue;

          var evt;
          try { evt = JSON.parse(dataStr); } catch(e) { continue; }

          if (evt.type === "text") {
            state.fullText = evt.fullText || state.fullText || "";
          } else if (evt.type === "progress" && Array.isArray(evt.items)) {
            state.progressItems = evt.items;
          } else if (evt.type === "composer_config" && evt.config) {
            composerState.config = evt.config;
          } else if (evt.type === "error") {
            state.error = evt.error || "Generate failed";
          } else if (evt.type === "done") {
            state.done = true;
          }
        }

        renderComposerGenerateState();

        if (state.done && composerState.config) {
          composerGoTo(3);
          return;
        }

        return readChunk();
      });
    }

    return readChunk();
  }).catch(function(err) {
    if (err.name === "AbortError") return;
    state.error = 'Generate failed: ' + err.message;
    renderComposerGenerateState();
  });
}

function loadComposerTemplates() {
  var $grid = document.getElementById("composer-template-grid");
  if (!$grid) return;

  if (composerState.templates) {
    renderTemplateCards($grid, composerState.templates);
    return;
  }

  api("GET", "/api/composer/templates").then(function(data) {
    var templates = data.templates || extractList(data);
    composerState.templates = templates;
    renderTemplateCards($grid, templates);
  }).catch(function(err) {
    $grid.innerHTML = '<div class="error-banner">Failed to load templates: ' + esc(err.message) + '</div>';
  });
}

function renderTemplateCards($grid, templates) {
  if (!templates || templates.length === 0) {
    $grid.innerHTML = '<div class="composer-hint">No templates available</div>';
    return;
  }

  var html = "";
  for (var i = 0; i < templates.length; i++) {
    var t = templates[i];
    var agentCount = (t.config && t.config.agents) ? t.config.agents.length : 0;
    html += '<div class="composer-template-card" data-idx="' + i + '">' +
      '<div class="composer-template-name">' + esc(t.name || t.config && t.config.name || "Untitled") + '</div>' +
      '<div class="composer-template-desc">' + esc(t.description || "") + '</div>' +
      '<div class="composer-template-meta">' + agentCount + ' agent' + (agentCount !== 1 ? 's' : '') + '</div>' +
      '</div>';
  }
  $grid.innerHTML = html;

  // Attach click handlers
  var cards = $grid.querySelectorAll(".composer-template-card");
  for (var j = 0; j < cards.length; j++) {
    cards[j].addEventListener("click", function() {
      var idx = parseInt(this.getAttribute("data-idx"), 10);
      var template = composerState.templates[idx];
      composerState.config = JSON.parse(JSON.stringify(template.config));
      composerState.exec = null;
      composerGoTo(3);
    });
  }
}

// ── Step 3: Review ──────────────────────────────────────────────────────────

function renderComposerReview($content) {
  var config = composerState.config;
  if (!config) { composerGoTo(1); return; }

  var agents = config.agents || [];

  // Left side: config info + agent cards
  var leftHtml = '<div class="composer-review-header">' + esc(config.name || "Untitled Config") + '</div>' +
    '<div class="composer-review-desc">' + esc(config.description || "") + '</div>';

  for (var i = 0; i < agents.length; i++) {
    var a = agents[i];
    leftHtml += '<details class="composer-agent-card">' +
      '<summary>' + esc(a.ref || "agent-" + i) + ' — ' + esc(a.name || "") + '</summary>' +
      '<div class="composer-agent-detail">' +
        '<div class="composer-field"><strong>Ref:</strong> ' + esc(a.ref || "") + '</div>' +
        '<div class="composer-field"><strong>Name:</strong> ' + esc(a.name || "") + '</div>' +
        '<div class="composer-field"><strong>Profile:</strong> ' + esc(a.profile || "") + '</div>' +
        '<div class="composer-field"><strong>System Prompt:</strong></div>' +
        '<pre class="composer-prompt-preview">' + esc(a.system_prompt || "(none)") + '</pre>' +
      '</div>' +
      '</details>';
  }

  // Right side: Flow + compiled DPH
  var orch = config.orchestrator || {};
  var rightHtml = '';

  if (orch.flow && orch.flow.do) {
    rightHtml += '<h4>Workflow Flow</h4>' +
      '<pre class="composer-flow-preview">' + esc(JSON.stringify(orch.flow, null, 2)) + '</pre>';
  }

  if (orch.dolphin) {
    rightHtml += '<details class="composer-dph-details">' +
      '<summary>Compiled DPH Script</summary>' +
      '<pre class="composer-dph-editor">' + esc(orch.dolphin) + '</pre>' +
      '</details>';
  }

  rightHtml += '<div class="composer-mode-display"><strong>Mode:</strong> ' + esc(orch.is_dolphin_mode ? "dolphin" : "react") + '</div>';

  $content.innerHTML =
    '<div class="composer-review-layout">' +
      '<div class="composer-review-left">' + leftHtml + '</div>' +
      '<div class="composer-review-right">' + rightHtml + '</div>' +
    '</div>' +
    '<div class="composer-nav">' +
      '<button class="composer-btn composer-btn-secondary" id="composer-back-btn">&larr; Back</button>' +
      '<button class="composer-btn composer-btn-primary" id="composer-create-btn">Create &amp; Run &rarr;</button>' +
    '</div>';

  document.getElementById("composer-back-btn").addEventListener("click", function() {
    composerGoTo(1);
  });
  document.getElementById("composer-create-btn").addEventListener("click", function() {
    composerGoTo(4);
  });
}

// ── Step 4: Run ─────────────────────────────────────────────────────────────

function renderComposerRun($content) {
  var config = composerState.config;
  if (!config) { composerGoTo(1); return; }

  $content.innerHTML =
    '<div class="composer-exec-log" id="composer-exec-log"></div>' +
    '<div class="composer-stream-area" id="composer-stream-area" style="display:none;"></div>' +
    '<div class="composer-trace" id="composer-trace"></div>' +
    '<div class="composer-nav" id="composer-run-nav"></div>';

  // If we already have exec state (came back to this step), show appropriate UI
  if (composerState.exec && composerState.exec.orchestratorId) {
    renderComposerRunPhase();
  } else {
    runComposerCreate();
  }
}

function runComposerCreate() {
  var $log = document.getElementById("composer-exec-log");
  if (!$log) return;

  $log.innerHTML = '<div class="composer-log-entry">Creating agents...</div>';

  api("POST", "/api/composer/create", { config: composerState.config }).then(function(data) {
    composerState.exec = {
      orchestratorId: data.orchestratorId,
      agentIds: data.agentIds || {},
      allAgentIds: data.allAgentIds || [],
      conversationId: null,
      done: false,
    };

    // Show creation log
    var logHtml = '<div class="composer-log-entry">Orchestrator created: <span class="composer-log-detail">' + esc(data.orchestratorId) + '</span></div>';
    var refs = Object.keys(data.agentIds || {});
    for (var i = 0; i < refs.length; i++) {
      logHtml += '<div class="composer-log-entry">Agent <strong>' + esc(refs[i]) + '</strong>: <span class="composer-log-detail">' + esc(data.agentIds[refs[i]]) + '</span></div>';
    }
    logHtml += '<div class="composer-log-entry" style="color: var(--clr-ok, #4caf50);">All agents created successfully.</div>';
    $log.innerHTML = logHtml;

    renderComposerRunPhase();
  }).catch(function(err) {
    $log.innerHTML = '<div class="error-banner">Failed to create agents: ' + esc(err.message) + '</div>' +
      '<div class="composer-nav">' +
        '<button class="composer-btn composer-btn-secondary" onclick="composerGoTo(3)">&larr; Back to Review</button>' +
      '</div>';
  });
}

function renderComposerRunPhase() {
  var exec = composerState.exec;
  if (!exec) return;

  var $stream = document.getElementById("composer-stream-area");
  var $nav = document.getElementById("composer-run-nav");
  if (!$stream || !$nav) return;

  if (exec.done) {
    // Already completed — show results and nav
    renderComposerPostRun();
    return;
  }

  // Show input section
  $stream.style.display = "block";
  $stream.innerHTML =
    '<div class="composer-input-section">' +
      '<div class="composer-input-row">' +
        '<input type="text" class="composer-run-input" id="composer-run-input" placeholder="Enter a message for the orchestrator..." />' +
        '<button class="composer-btn composer-btn-primary" id="composer-run-btn">Run</button>' +
      '</div>' +
    '</div>' +
    '<div class="composer-stream-text" id="composer-stream-text" style="display:none;"></div>' +
    '<div class="composer-stream-progress" id="composer-stream-progress" style="display:none;"></div>';

  $nav.innerHTML = '';

  var $input = document.getElementById("composer-run-input");
  var $runBtn = document.getElementById("composer-run-btn");

  function submitRun() {
    var message = $input.value.trim();
    if (!message) return;
    $input.disabled = true;
    $runBtn.disabled = true;
    runComposerStream(message);
  }

  $runBtn.addEventListener("click", submitRun);
  $input.addEventListener("keydown", function(e) {
    if (e.key === "Enter") { e.preventDefault(); submitRun(); }
  });

  $input.focus();
}

function runComposerStream(message) {
  var exec = composerState.exec;
  var $text = document.getElementById("composer-stream-text");
  var $progress = document.getElementById("composer-stream-progress");
  var $stream = document.getElementById("composer-stream-area");
  if (!exec || !$text || !$progress || !$stream) return;

  $text.style.display = "block";
  $text.innerHTML = '<div class="chat-thinking-pulse"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>';

  var fullText = "";
  var conversationId = null;
  var receivedDone = false;

  fetch("/api/composer/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orchestratorId: exec.orchestratorId, message: message }),
  }).then(function(res) {
    if (!res.ok || !res.body) {
      return res.text().then(function(errText) {
        var displayErr = errText;
        try { var p = JSON.parse(errText); displayErr = p.error || errText; } catch(e) {}
        $text.innerHTML = '<div class="error-banner">Error ' + res.status + ': ' + esc(displayErr) + '</div>';
        renderComposerPostRunNav();
      });
    }

    var reader = res.body.getReader();
    var decoder = new TextDecoder();
    var buf = "";

    function readChunk() {
      return reader.read().then(function(result) {
        if (result.done) {
          onStreamEnd();
          return;
        }

        buf += decoder.decode(result.value, { stream: true });
        var lines = buf.split("\n");
        buf = lines.pop() || "";

        for (var i = 0; i < lines.length; i++) {
          var line = lines[i];
          if (!line.startsWith("data: ")) continue;
          var dataStr = line.slice(6).trim();
          if (!dataStr) continue;
          var evt;
          try { evt = JSON.parse(dataStr); } catch(e) { continue; }

          if (evt.type === "text") {
            fullText = evt.fullText || fullText;
            if (fullText) {
              $text.innerHTML = chatMarkdown(fullText);
            }
          } else if (evt.type === "progress" && Array.isArray(evt.items)) {
            $progress.style.display = "block";
            $progress.innerHTML = renderProgressSteps(evt.items);
          } else if (evt.type === "step_meta") {
            var meta = evt.meta || {};
            var toolName = (meta.skill_info && meta.skill_info.name) || meta.agent_name || meta.description || "";
            var statusText = meta.status || "";
            if (toolName || statusText) {
              var isRunning = statusText === "running" || statusText === "processing";
              var isCompleted = statusText === "completed" || statusText === "success";
              var isFailed = statusText === "failed" || statusText === "error";
              var icon = isRunning ? "..." : isCompleted ? "OK" : isFailed ? "ERR" : "-";

              var stepDiv = document.createElement("div");
              stepDiv.className = "composer-step-meta";
              stepDiv.innerHTML = '<span>' + esc(icon) + '</span> <strong>' + esc(toolName || statusText) + '</strong>';

              var $stepArea = $stream.querySelector(".composer-step-meta-area");
              if (!$stepArea) {
                $stepArea = document.createElement("div");
                $stepArea.className = "composer-step-meta-area";
                $stream.insertBefore($stepArea, $text);
              }
              $stepArea.appendChild(stepDiv);
            }
          } else if (evt.type === "conversation_id") {
            conversationId = evt.conversationId;
          } else if (evt.type === "done") {
            receivedDone = true;
            conversationId = evt.conversationId || conversationId;
          } else if (evt.type === "error") {
            $text.innerHTML = '<div class="error-banner">' + esc(evt.error || "Unknown error") + '</div>';
          }
        }

        return readChunk();
      });
    }

    function onStreamEnd() {
      exec.conversationId = conversationId;
      exec.done = true;
      composerState.exec = exec;

      if (!fullText && !receivedDone) {
        $text.innerHTML = '<span class="chat-error">No response received.</span>';
      }

      // Fetch trace
      if (conversationId && exec.orchestratorId) {
        var $trace = document.getElementById("composer-trace");
        if ($trace) {
          $trace.innerHTML = '<div class="composer-trace-loading">Loading trace...</div>';
          var $streamArea = document.getElementById("composer-stream-area");
          fetchAndRenderTrace($trace, exec.orchestratorId, conversationId, $streamArea);
        }
      }

      renderComposerPostRunNav();
    }

    return readChunk();
  }).catch(function(err) {
    $text.innerHTML = '<div class="error-banner">Stream error: ' + esc(err.message) + '</div>';
    renderComposerPostRunNav();
  });
}

function renderComposerPostRun() {
  var exec = composerState.exec;
  var $stream = document.getElementById("composer-stream-area");
  if ($stream) {
    $stream.style.display = "block";
    $stream.innerHTML = '<div class="composer-stream-text">' +
      '<div class="composer-hint">Run completed. See trace below.</div>' +
      '</div>';
  }

  // Fetch trace if we have conversation id
  if (exec && exec.conversationId && exec.orchestratorId) {
    var $trace = document.getElementById("composer-trace");
    if ($trace && !$trace.querySelector(".trace-section")) {
      $trace.innerHTML = '<div class="composer-trace-loading">Loading trace...</div>';
      fetchAndRenderTrace($trace, exec.orchestratorId, exec.conversationId, $stream);
    }
  }

  renderComposerPostRunNav();
}

function renderComposerPostRunNav() {
  var exec = composerState.exec;
  var $nav = document.getElementById("composer-run-nav");
  if (!$nav) return;

  var html = '';
  if (exec && exec.allAgentIds && exec.allAgentIds.length > 0) {
    html += '<button class="composer-btn composer-btn-secondary" id="composer-cleanup-btn">Cleanup Agents</button>';
  }
  if (exec && exec.orchestratorId) {
    html += '<button class="composer-btn composer-btn-primary" id="composer-open-chat-btn">Open in Chat &rarr;</button>';
  }
  $nav.innerHTML = html;

  var $cleanup = document.getElementById("composer-cleanup-btn");
  if ($cleanup) {
    $cleanup.addEventListener("click", function() {
      $cleanup.disabled = true;
      $cleanup.textContent = "Cleaning up...";
      api("DELETE", "/api/composer/cleanup", { agentIds: exec.allAgentIds }).then(function() {
        $cleanup.textContent = "Cleaned up";
        $cleanup.style.opacity = "0.5";
      }).catch(function(err) {
        $cleanup.textContent = "Cleanup failed";
        $cleanup.disabled = false;
        alert("Cleanup failed: " + err.message);
      });
    });
  }

  var $openChat = document.getElementById("composer-open-chat-btn");
  if ($openChat) {
    $openChat.addEventListener("click", function() {
      location.hash = "#/chat/" + enc(exec.orchestratorId);
    });
  }
}
