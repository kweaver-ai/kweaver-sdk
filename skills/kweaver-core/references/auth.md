# 认证与多平台切换

管理 KWeaver 平台认证，支持多平台凭据存储与切换。

## 命令总览

| 命令 | 说明 |
|------|------|
| `kweaver auth login <platform-url>` | 登录平台（打开浏览器 OAuth） |
| `kweaver auth login <platform-url> --alias <name>` | 登录并命名该平台 |
| `kweaver auth status` | 查看当前平台认证状态 |
| `kweaver auth list` | 列出已登录的平台 |
| `kweaver auth use <alias>` | 切换到指定平台 |
| `kweaver auth delete <alias>` | 删除平台凭据 |
| `kweaver auth logout` | 登出当前平台 |
| `kweaver token` | 打印当前 access token |

## 何时使用

- 首次使用 CLI 前必须执行 `auth login`
- 需要切换不同 KWeaver 实例时使用 `auth use`
- 调试 API 时可用 `token` 获取 Bearer token

## 用法示例

```bash
# 首次登录
kweaver auth login https://platform.example.com

# 登录多个平台并命名
kweaver auth login https://prod.example.com --alias prod
kweaver auth login https://dev.example.com --alias dev

# 查看状态
kweaver auth status
kweaver auth list

# 切换平台
kweaver auth use prod

# 获取 token（用于 curl 等）
kweaver token
```

## 默认策略

- 用户未认证时，提示执行 `kweaver auth login <platform-url>`
- 多平台场景下，用 `auth list` 确认可用平台，用 `auth use` 切换
