/* global api, esc, enc, extractList, navGeneration, chatMarkdown, renderProgressSteps, fetchAndRenderTrace, renderBubble */

// ── Composer state ──────────────────────────────────────────────────────────

const composerState = {
  step: 1,           // 1=Choose, 3=Review, 4=Run (step 2 is Phase 2)
  config: null,      // ComposerConfig
  exec: null,        // execution state
};

// ── Main entry point ────────────────────────────────────────────────────────

// eslint-disable-next-line no-unused-vars
function renderComposer($el, parts, params) {
  $el.innerHTML = '<div class="composer-wizard"><h2>Composer</h2><p>Coming soon...</p></div>';
}
