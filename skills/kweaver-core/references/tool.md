# Tool 命令参考（tool）

在指定 [`toolbox`](toolbox.md) 下注册、启停具体工具（tool）。当前后端只接受 **OpenAPI** 规范作为元数据来源。

后端：`/api/agent-operator-integration/v1/tool-box/{boxId}/...`。

## 命令

```bash
kweaver tool upload  --toolbox <box-id> <openapi-spec-path> [--metadata-type openapi] [-bd value] [--pretty|--compact]
kweaver tool list    --toolbox <box-id> [-bd value] [--pretty|--compact]
kweaver tool enable  --toolbox <box-id> <tool-id>... [-bd value]
kweaver tool disable --toolbox <box-id> <tool-id>... [-bd value]
```

## 子命令说明

### `upload`

- 以 multipart 方式把一个 OpenAPI 规范文件上传到指定 toolbox，由后端解析并注册 tool。
- 必填：`--toolbox <box-id>` 和位置参数 `<openapi-spec-path>`。位置参数与 `--toolbox` 顺序无关（解析器允许任一在前）。
- `--metadata-type` 仅支持 `openapi`（默认即 `openapi`；传入其他值会以 `Unsupported --metadata-type: ...` 报错并退出非零）。
- 文件不存在时报 `File not found: ...` 并退出非零。
- 输出：后端原始响应，典型形如 `{"success_ids": ["<tool-id>", ...]}`，可直接喂给 `tool enable`（CLI 不解析其结构）。

```bash
kweaver tool upload --toolbox 1234567890123456789 ./openapi.json
kweaver tool upload --toolbox 1234567890123456789 ./openapi.yaml --compact
```

### `list`

- 列出指定 toolbox 下的 tool。
- 必填：`--toolbox`。CLI 未发分页参数，分页行为完全由后端决定。
- 输出：后端原始 JSON（典型形如 `{"entries": [{"tool_id": "...", "status": "..."}, ...]}`），按 `--pretty`/`--compact` 格式化。

```bash
kweaver tool list --toolbox 1234567890123456789
```

### `enable` / `disable`

- 批量切换 tool 的启用状态（`enabled` / `disabled`）。
- 必填：`--toolbox` + 一个或多个 `<tool-id>`（通过位置参数传入）。
- 成功在 stderr 打印 `Enabled N tool(s) in toolbox <box-id>`，stdout 无内容（脚本友好）。

```bash
kweaver tool enable  --toolbox 1234567890123456789 tool-a tool-b
kweaver tool disable --toolbox 1234567890123456789 tool-c
```

## 通用选项

| 选项 | 说明 | 适用子命令 |
|------|------|-----------|
| `-bd, --biz-domain <s>` | 覆盖业务域。默认走 `resolveBusinessDomain()`（`KWEAVER_BUSINESS_DOMAIN` env → 当前平台 `config.json` → `bd_public`） | 全部 |
| `--pretty` | 把响应体当作 JSON 解析后以 2 空格缩进重排（解析失败则按原文输出，默认） | `upload`、`list` |
| `--compact` | 原样输出后端响应文本，不做美化（便于管道处理） | `upload`、`list` |

## 注意

- 上传的 OpenAPI 文件路径相对于当前 shell 工作目录解析。
- 上传响应里的 `success_ids` 即本次新注册的 `tool_id`，可直接传给 `tool enable`；如果只需要后续按需启用，也可以用 `tool list` 兜底。
- 新注册 tool 的初始启停状态由后端决定，CLI 不假设。

## 关联

- Toolbox 管理与发布：[toolbox.md](toolbox.md)
