# Python SDK 开发者指南

本文说明如何在应用或脚本中使用 PyPI 上的 **`kweaver-sdk`**。若关注 MCP、CLI、Cursor 接入与整体架构，请先阅读 [AI 应用开发者接入指南](./ai-app-integration.md)。

完整 runnable 示例与章节锚点以英文版为准：[Python SDK developer guide](./python-sdk-guide.md)。

## 文档用途

- Python **3.10+**
- 需要在代码里调用 KWeaver 平台 HTTP API 的开发者。

命令行 CLI 仍以 Node/TypeScript 包为主；Python 包提供同名能力的编程接口。快捷函数（`configure`、`search`、`chat`）见 [packages/python/README.zh.md](../../packages/python/README.zh.md)。

## 安装

```bash
pip install kweaver-sdk
```

可选 CLI 组件：

```bash
pip install "kweaver-sdk[cli]"
```

## 认证方式概览

| 方式 | 场景 |
|------|------|
| `TokenAuth` | 已有 access token 字符串 |
| `ConfigAuth` | 凭据在 `~/.kweaver/`（与 TS CLI `kweaver auth login` 共用） |
| `HttpSigninAuth` / `kweaver.login` | 用户名密码 HTTP 登录 |
| `NoAuth` | 无鉴权的开发环境 |

业务域 **`business_domain`**（请求头 `X-Business-Domain`）在多数部署下必填；未设置时列表接口可能为空。可与 CLI `kweaver config show` 对照。

## 创建客户端（示例）

```python
from kweaver import KWeaverClient, TokenAuth

with KWeaverClient(
    base_url="https://your-kweaver.example.com",
    auth=TokenAuth("your-access-token"),
    business_domain="your-bd-uuid-or-slug",
) as client:
    kns = client.knowledge_networks.list(limit=30)
    print(len(kns))
```

使用已登录的 CLI 配置：

```python
from kweaver import KWeaverClient, ConfigAuth

with KWeaverClient(auth=ConfigAuth()) as client:
    print(client.agents.list(limit=20))
```

可选参数：`vega_url`、`mf_model_manager_base_url`、`mf_model_api_base_url`、`tls_insecure`（仅开发）等，详见英文指南与源码 docstring。

## 常用操作（摘要）

- **知识网络**：`client.knowledge_networks.list` / `get` / `statistics`
- **Agent**：`client.agents.list` / `get`
- **模型工厂**：`client.models.llm.list`、`client.models.invocation.chat` 等（经理 / API 网关与平台一致时再覆写 base URL）
- **Vega**：`client.vega.health`、`client.vega.catalogs.list`

分页参数 **`limit` / `offset`** 各接口默认值可能不同；与 CLI 默认对齐时请显式传参。约定说明见仓库根目录 [AGENTS.md](../../AGENTS.md)。

## 异常与排障

SDK 抛出 **`kweaver._errors`** 中的类型化异常（如 `AuthenticationError`、`NotFoundError`）。可先捕获 **`KWeaverError`**。

常见问题：401（令牌失效）、列表为空（业务域错误）、TLS（证书/代理）。

## API 参考（自动生成）

模块与类的完整说明由源码 **英文 docstring** 经工具生成。在仓库根执行：

```bash
make -C packages/python docs-python
```

或在仓库根执行 **`make docs-python`**（转发到同一目标）。

在 **`docs/reference/python-api-html/`** 打开 HTML（默认已 `.gitignore`，不提交）。

## 相关链接

- [Python SDK developer guide](./python-sdk-guide.md)（英文完整版）
- [AI 应用开发者接入指南](./ai-app-integration.md)
- [packages/python/README.zh.md](../../packages/python/README.zh.md)
