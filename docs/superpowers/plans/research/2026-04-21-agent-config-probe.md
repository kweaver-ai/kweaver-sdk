# Agent Config Probe — 2026-04-21

**Source:** `kweaver agent get 01KPQ0SHKYHZKCJ4CB6P93D54M --verbose --save-config` against platform `https://115.190.186.186` (operator account, session 8fac7c79), 2026-04-21 UTC.

Agent: "MySQL恢复Agent" (has 2 skills, 13 tools, 1 mcp already attached → ideal probe target).

## Big finding: `skills` is a composite container, not a top-level sibling

Contrary to issue #72's implied shape (`config.skills.skills`, `config.tools`, `config.mcps` as three siblings), the real layout is **one composite object holding all four member arrays**:

```jsonc
{
  "config": {
    // ... system_prompt, data_source, input, output, etc. ...
    "skills": {
      "skills": [ { "skill_id": "..." }, ... ],
      "tools":  [ { "tool_id": "...", "tool_box_id": "...", "tool_input": [...], ... }, ... ],
      "mcps":   [ { "mcp_server_id": "..." }, ... ],
      "agents": []
    },
    "llms": [...],
    // ...
  }
}
```

So the three member types we care about all live under `config.skills.*` — very clean for the `MemberSpec` pattern.

## Per-member findings

### Skill attachment — CLEAN

- **configPath:** `["skills", "skills"]`
- **idField:** `"skill_id"`
- **Sample element:** `{"skill_id": "72161175-c913-402c-94d0-7cadae1d4e3e"}`
- **fetchById endpoint:** `getSkill({skillId})` → returns `{status, name, ...}`. Already exists in `api/skills.ts:242`.
- **Verdict:** Ship as designed. Plan Task 4 needs no change.

### MCP attachment — CLEAN (route confirmed via server source)

- **configPath:** `["skills", "mcps"]`
- **idField:** `"mcp_server_id"`
- **Sample element:** `{"mcp_server_id": "586b8d0e-b5f9-4f73-8735-eadb97f772b9"}` — one field.
- **fetchById endpoint:** `GET /api/agent-operator-integration/v1/mcp/{mcp_id}` (server handler at `kweaver/adp/execution-factory/operator-integration/server/driveradapters/mcp_handler.go:71`); list at `/api/agent-operator-integration/v1/mcp/list`. Response carries `Name` and `Status` (`published`/`draft`/`offline`). Earlier CLI probe missed it because we guessed `/mcp-server(s)`/`/mcp_servers` instead of the actual `/mcp` segment.
- **Verdict:** Fully implementable in this iteration if scope allows; needs a thin `api/mcp-servers.ts` wrapper.

### Tool attachment — RICH ELEMENT, REQUIRES CLIENT-SIDE EXPANSION

- **configPath:** `["skills", "tools"]`
- **idField:** `"tool_id"`
- **Sample element** (truncated — full element spans ~85 lines per tool):

```jsonc
{
  "tool_id": "05275bb1-46e2-4727-9c6f-97d9ea0af94b",
  "tool_box_id": "e521d454-4a0b-4dc9-8a28-d0986de1cef9",
  "tool_timeout": 300,
  "tool_input": [                     // ← per-tool OpenAPI input mapping
    { "input_name": "x-account-id", "input_type": "string", "map_type": "auto", "map_value": "", "enable": false },
    { "input_name": "query",        "input_type": "string", "map_type": "auto", "map_value": "", "enable": true  },
    { "input_name": "options",      "input_type": "object", "children": [ ... nested schema ... ] },
    // ... one entry per OpenAPI parameter ...
  ],
  "intervention": false,
  "intervention_confirmation_message": "",
  "result_process_strategies": null
}
```

- **Fatal issue:** attaching a tool by `{tool_id: "..."}` alone will NOT work. The LLM-side invocation needs `tool_input` populated with the tool's OpenAPI parameter schema + default mapping. Writing bare `{tool_id: x}` produces a config that looks attached but fails at runtime when the agent tries to call the tool.
- **No server-side resolve endpoint:** server stores the value object as `{tool_id, tool_box_id}` + an opaque `tool_input` JSON blob set by the caller — see `kweaver/decision-agent/agent-backend/agent-factory/src/domain/valueobject/daconfvalobj/skillvalobj/skill_tool.go:10-18`. There is no "give me default tool element for tool_id" handler.
- **Client-side path is well-defined:** `GET /api/agent-operator-integration/v1/tool-box/{boxId}/tools/list` (response type `QueryToolListResp` at `kweaver/adp/execution-factory/operator-integration/server/interfaces/logics_toolbox.go:287-292`) returns each tool's full `APISpec.Parameters` (logics_metadata.go:71-80). Mapping rule: each `Parameter` → `{input_name: name, input_type: schema.type, map_type: "auto", map_value: "", enable: required}`; recurse into `children` for object/array params. Plus a UX gap: user only knows `tool_id` but config element needs `tool_box_id` too — CLI must either accept `--box <id>` or scan all boxes.
- **Verdict:** Doable but adds ~150 LOC of OpenAPI-to-input expansion + a UX choice for box resolution. Not "drop-in an id" — needs its own spec + plan.

### Agent (sub-agent) attachment — out of scope

- `config.skills.agents[]` exists but is always `[]` on this agent. Not in this plan's scope (issue #72 didn't mention it).

## Decisions for this plan

User direction (2026-04-21): **minimal change — ship skill only**. Both tool and mcp groups defer to a follow-up issue, even though mcp is technically clean.

1. **Scope:** Tasks 1, 2, 3, 4, 7, 8. Drop Tasks 5 (tool) and 6 (mcp) from this plan.
2. **Spec fidelity:** The spec's "CLI surface" listed 9 commands; this plan ships 3 (skill group). Spec stays correct as a *vision*; implementation lands incrementally.
3. **Composite-container quirk:** `config.skills` is a legacy-named composite holding 4 sub-arrays (skills/tools/mcps/agents). Our `MemberSpec.configPath` already targets the sub-level (`["skills", "skills"]`), so the naming has zero effect on the implementation.

## Follow-up issue to open after skill ships

Title suggestion: `【CLI】agent tool / mcp 关联子命令（#72 延续）`

Body should cite this probe report and the resolved facts so the follow-up doesn't re-research:

- **MCP** is clean: `GET /api/agent-operator-integration/v1/mcp/list` and `/api/agent-operator-integration/v1/mcp/{mcp_id}` (server: `kweaver/adp/execution-factory/operator-integration/server/driveradapters/mcp_handler.go`). Element shape `{mcp_server_id}`. Add `api/mcp-servers.ts` wrapper + reuse `patchAgentMembers`.
- **Tool** needs client-side OpenAPI-to-`tool_input` expansion: source-of-truth response is `QueryToolListResp` at `kweaver/adp/execution-factory/operator-integration/server/interfaces/logics_toolbox.go:287-292`. Plus needs box resolution UX (`--box <id>` vs auto-scan).
