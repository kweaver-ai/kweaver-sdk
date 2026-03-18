# 通用 API 调用

直接调用 KWeaver REST API，自动注入 `authorization`、`token`、`x-business-domain` Header。用于调试或 CLI 未封装的接口。

## 命令总览

```bash
kweaver call <url> [options]
```

| 选项 | 说明 |
|------|------|
| `-X, --request METHOD` | HTTP 方法，默认 GET |
| `-d, --data, --data-raw '<json>'` | 请求体（POST/PUT 等） |
| `-H, --header "Name: Value"` | 自定义 Header，可多次 |
| `-bd, --biz-domain <domain>` | 业务域，默认 bd_public |
| `--pretty` | 格式化 JSON 输出 |
| `--verbose` | 打印请求详情到 stderr |
| `--url <url>` | 显式指定 URL（与位置参数二选一） |

## 何时使用

- CLI 没有对应命令时
- 需要调试底层 API 时
- 需要调用未封装的端点时

## URL 说明

第一个位置参数为**完整 URL**（如 `https://platform.example.com/api/ontology-manager/v1/knowledge-networks`）。若使用相对路径，需自行拼接 `KWEAVER_BASE_URL`。

## 用法示例

```bash
# GET（完整 URL）
kweaver call https://platform.example.com/api/ontology-manager/v1/knowledge-networks

# POST with JSON body
kweaver call https://platform.example.com/api/ontology-query/v1/knowledge-networks/<kn-id>/object-types/<ot-id> \
  -X POST -d '{"limit":10,"condition":{"operation":"and","sub_conditions":[]}}'

# DELETE
kweaver call https://platform.example.com/api/ontology-manager/v1/knowledge-networks/<kn-id> -X DELETE

# 指定业务域
kweaver call https://platform.example.com/api/agent-factory/v1/agents -bd bd_public

# 自定义 Header
kweaver call https://platform.example.com/api/... -H "X-Custom: value"
```

## JSON 请求体格式

`-d` 后的 JSON 需符合目标 API 的 schema。常见结构见 [json-formats.md](json-formats.md)。

**Shell 引号规则**：用单引号包裹整个 JSON，内部键值用双引号。
