import { registerPredicate } from "../predicate-registry.js";

import { predicate as toolLoopNoStateChange } from "./tool-loop-no-state-change.js";
import { predicate as toolErrorSwallowed } from "./tool-error-swallowed.js";

registerPredicate("tool_loop_no_state_change", toolLoopNoStateChange);
registerPredicate("tool_error_swallowed", toolErrorSwallowed);

export {};
