import { registerPredicate } from "../predicate-registry.js";

import { predicate as toolLoopNoStateChange } from "./tool-loop-no-state-change.js";

registerPredicate("tool_loop_no_state_change", toolLoopNoStateChange);

export {};
