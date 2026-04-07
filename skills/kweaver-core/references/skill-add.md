# skill-add - Add Skills to Agent

Add tools, MCP servers, or agents to an Agent's `config.skills` configuration.

## Overview

Agent config supports three types of skills under `config.skills`:

| Type | Source | Description |
|------|--------|-------------|
| `tools` | Execution Factory (Toolbox) | Published tools from toolboxes |
| `mcps` | Execution Factory (MCP) | Published MCP servers |
| `agents` | Agent Factory | Published agents with `publish_to_bes` containing `"skill_agent"` |

## Prerequisites

- Authenticated session (`kweaver auth login`)
- Target agent exists and you have write access

## Operation Flow

### Step 1: Get Current Agent Config

```bash
kweaver agent get <agent_id> --save-config /tmp/
# Output: /tmp/agent-config-<timestamp>.json
```

This saves the current `config` object to a file for modification.

### Step 2: List Available Tools

```bash
# List all published toolboxes
kweaver exec toolbox list

# List tools in a specific toolbox
kweaver exec toolbox tool-list <box_id>

# Get detailed info for a specific tool (includes input schema)
kweaver exec toolbox tool-get <box_id> <tool_id>
```

**Tool selection flow**:
1. Run `toolbox list` to see available toolboxes
2. User selects a toolbox → run `toolbox tool-list <box_id>`
3. User selects a tool → run `toolbox tool-get <box_id> <tool_id>` to get full details
4. Use the returned `details` object as the template for the skill entry

### Step 3: List Available MCP Servers

```bash
# List all published MCP servers
kweaver exec mcp list

# Get detailed info for a specific MCP server (includes tool list)
kweaver exec mcp get <mcp_id>
```

**MCP selection flow**:
1. Run `mcp list` to see available MCP servers
2. User selects an MCP server → run `mcp get <mcp_id>` to get details
3. Use the response to build the MCP skill entry with its tools

### Step 4: List Available Agent Skills

```bash
# List all published agents
kweaver agent list --verbose
```

**Filter criteria**: From the results, filter agents where `publish_to_bes` array contains `"skill_agent"`.

**Note**: Use `--verbose` flag to see the full agent details including `publish_to_bes`.

### Step 5: Build Skills Configuration

Merge selected skills into the existing `config.skills` object:

```json
{
  "skills": {
    "tools": [
      {
        "tool_id": "<uuid>",
        "tool_box_id": "<uuid>",
        "tool_input": [
          {
            "input_name": "<param_name>",
            "input_type": "string|boolean|array|object|integer",
            "map_type": "auto",
            "map_value": "",
            "enable": true
          }
        ],
        "intervention": false,
        "details": { ... }
      }
    ],
    "agents": [
      {
        "agent_key": "<key>",
        "agent_version": "<version>",
        "agent_input": [
          {
            "enable": true,
            "input_name": "<param_name>",
            "input_type": "string",
            "map_type": "auto"
          }
        ],
        "intervention": false,
        "data_source_config": { "type": "self_configured" },
        "llm_config": { "type": "self_configured" },
        "details": { ... }
      }
    ],
    "mcps": [
      {
        "mcp_server_id": "<uuid>",
        "details": {
          "tools": [
            {
              "tool_type": "mcp",
              "tool_id": "<tool_name>",
              "tool_name": "<tool_name>",
              "tool_box_id": "<mcp_server_id>",
              "tool_box_name": "<mcp_name>",
              "tool_desc": "<description>",
              "intervention": false,
              "tool_input": [ ... ]
            }
          ]
        }
      }
    ]
  }
}
```

**Important**: When adding skills, **merge** with existing skills rather than replacing. Append new entries to each array.

### Step 6: Update Agent Config

```bash
kweaver agent update <agent_id> --config-path /tmp/agent-config-<timestamp>.json
```

This reads the modified config file and updates the agent on the platform.

## Data Structures

### Tool Skill Entry

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `tool_id` | string (UUID) | Yes | Tool ID from toolbox |
| `tool_box_id` | string (UUID) | Yes | Parent toolbox ID |
| `tool_input` | array | Yes | Input parameter mappings |
| `intervention` | boolean | No | Whether human intervention is required (default: false) |
| `details` | object | No | Full tool details from `tool-get` response |

#### tool_input Item Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `input_name` | string | Yes | Parameter name |
| `input_type` | string | Yes | One of: `string`, `boolean`, `array`, `object`, `integer` |
| `map_type` | string | No | Mapping type (default: `"auto"`) |
| `map_value` | string | No | Mapped value (default: `""`) |
| `enable` | boolean | No | Whether this input is enabled (default: true) |

### Agent Skill Entry

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `agent_key` | string | Yes | Agent unique key |
| `agent_version` | string | Yes | Agent version (e.g., `"v3"`) |
| `agent_input` | array | Yes | Input parameter mappings |
| `intervention` | boolean | No | Default: false |
| `data_source_config` | object | No | Data source config (default: `{ "type": "self_configured" }`) |
| `llm_config` | object | No | LLM config (default: `{ "type": "self_configured" }`) |
| `details` | object | No | Full agent details |

### MCP Skill Entry

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `mcp_server_id` | string (UUID) | Yes | MCP server ID |
| `details` | object | Yes | Contains `tools` array |

## Complete Example

```bash
# 1. Get current config
CONFIG_FILE=$(kweaver agent get <agent_id> --save-config /tmp/ | tr -d '\n')

# 2. List available resources (present options to user)
kweaver exec toolbox list
kweaver exec mcp list
kweaver agent list --verbose

# 3. After user selection, build updated config with new skills
# (modify $CONFIG_FILE to add chosen skills)

# 4. Update agent
kweaver agent update <agent_id> --config-path $CONFIG_FILE
```

### Example: Adding a Tool

User wants to add "submit_ticket" tool from "ticket_api" toolbox:

```bash
# Get tool details
kweaver exec toolbox tool-get <toolbox_id> <tool_id>
# Response includes details.tool_input schema

# Add to config.skills.tools array:
{
  "tool_id": "38ef3e36-cb41-413c-bdf8-71f390fe838d",
  "tool_box_id": "0304c19b-e23e-47e1-8151-a110e554d966",
  "tool_input": [
    { "input_name": "workspaceId", "input_type": "string", "map_type": "auto", "map_value": "", "enable": true },
    { "input_name": "title", "input_type": "string", "map_type": "auto", "map_value": "", "enable": true },
    { "input_name": "priority", "input_type": "integer", "map_type": "auto", "map_value": "", "enable": false }
  ],
  "intervention": false,
  "details": { /* from tool-get response */ }
}
```

### Example: Adding an MCP Server

User wants to add "execution_factory_tools" MCP server:

```bash
# Get MCP details
kweaver exec mcp get <mcp_id>
# Response includes tools list

# Add to config.skills.mcps array:
{
  "mcp_server_id": "f09ca3a2-8772-44c1-8281-35b28b7a4b6e",
  "details": {
    "tools": [
      {
        "tool_type": "mcp",
        "tool_id": "get_operator_schema",
        "tool_name": "get_operator_schema",
        "tool_box_id": "f09ca3a2-8772-44c1-8281-35b28b7a4b6e",
        "tool_box_name": "Execution Factory Tools",
        "tool_desc": "Get operator schema from market",
        "intervention": false,
        "tool_input": [
          { "input_name": "operator_id", "input_type": "string", "map_type": "auto", "map_value": "", "enable": true }
        ]
      }
    ]
  }
}
```

### Example: Adding an Agent as Skill

User wants to add "Plan_Agent" as a sub-agent skill:

```bash
# Verify agent has publish_to_bes containing "skill_agent"
kweaver agent list --verbose
# Check publish_to_bes field in response

# Add to config.skills.agents array:
{
  "agent_key": "Plan_Agent",
  "agent_version": "v3",
  "agent_input": [
    { "enable": true, "input_name": "query", "input_type": "string", "map_type": "auto" }
  ],
  "intervention": false,
  "data_source_config": { "type": "self_configured" },
  "llm_config": { "type": "self_configured" },
  "details": {
    "tool_type": "agent",
    "tool_id": "Plan_Agent",
    "tool_name": "Plan_Agent",
    "tool_desc": "Planning agent"
  }
}
```

## Notes

- **Always merge** new skills with existing ones — do not replace the entire `skills` object
- For **tools**, use `toolbox tool-get` to retrieve the complete `details` object including `tool_input` schema
- For **agents**, verify `publish_to_bes` contains `"skill_agent"` before adding
- For **mcps**, use `mcp get` to retrieve the complete tool list within the MCP server
- The `tool_input` / `agent_input` arrays define how agent inputs map to tool parameters — `enable: true` means the parameter will be passed through
- After updating, consider re-publishing the agent if it was already published: `kweaver agent publish <agent_id>`
