import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { QueryFailureAnalysis } from "../src/trace-ai/exp/schemas.js";

describe("QueryFailureAnalysis", () => {
  it("has required fields", () => {
    const a: QueryFailureAnalysis = {
      query_id: "Q38",
      verdict: "fail",
      assertion_reason: "agent returned wrong data",
      tool_call_summary: ["kn_search(vehicle_sales)→10 records"],
    };
    assert.strictEqual(a.query_id, "Q38");
    assert.deepStrictEqual(a.tool_call_summary, ["kn_search(vehicle_sales)→10 records"]);
  });
});
