import { registerPredicate } from "../predicate-registry.js";

import { predicate as toolLoopNoStateChange } from "./tool-loop-no-state-change.js";
import { predicate as toolErrorSwallowed } from "./tool-error-swallowed.js";
import { predicate as retrievalEmptyNoFallback } from "./retrieval-empty-no-fallback.js";
import { predicate as llmResponseTruncatedNoContinue } from "./llm-response-truncated-no-continue.js";

registerPredicate("tool_loop_no_state_change", toolLoopNoStateChange);
registerPredicate("tool_error_swallowed", toolErrorSwallowed);
registerPredicate("retrieval_empty_no_fallback", retrievalEmptyNoFallback);
registerPredicate("llm_response_truncated_no_continue", llmResponseTruncatedNoContinue);

export {};
