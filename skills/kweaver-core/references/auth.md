# 认证命令参考

平台认证管理。凭据存储在 `~/.kweaver/`。

与 CLI 一致：运行 `kweaver auth` 或 `kweaver auth login --help` 可查看与当前版本同步的用法。

## 前提

```bash
npm install playwright && npx playwright install chromium
```

## 命令

```bash
kweaver auth login <url> [--alias <name>] [-u user] [-p pass] [--playwright] [--insecure|-k]
kweaver auth <url> [--alias <name>] ...              # 同上（简写）
kweaver auth whoami [url|alias] [--json]              # 显示当前用户身份
kweaver auth export [url|alias] [--json]              # 导出凭据（用于无浏览器的服务器）
kweaver auth status [url|alias]                       # 查看 token 状态
kweaver auth list                                     # 树形列出所有平台及用户
kweaver auth use <url|alias>                          # 切换平台
kweaver auth users [url|alias]                        # 列出平台下所有用户
kweaver auth switch [url|alias] --user <id|username>  # 切换活跃用户
kweaver auth logout [url|alias] [--user <id|username>]
kweaver auth delete <url|alias> [--user <id|username>]
```

## 多账号支持

同一平台 URL 支持多个用户账号。登录时自动获取用户名，`--user` 参数支持用户名或 userId。

### 免切换调用

全局 `--user` 参数或 `KWEAVER_USER` 环境变量可直接使用指定用户的凭证，无需手动切换：

```bash
# 全局 --user 参数
kweaver --user alice bkn list
kweaver --user alice agent list

# 环境变量（适合脚本/CI）
export KWEAVER_USER=alice
kweaver bkn list

# Python SDK 同样支持
KWEAVER_USER=alice python my_script.py
```

### 工作流示例

```bash
# 登录两个账号
kweaver auth login https://kweaver.example.com --alias prod
kweaver auth login https://kweaver.example.com

# 树形列出所有平台及用户
kweaver auth list
# * https://kweaver.example.com (prod)
#   ├── bob (bob-uuid) *
#   └── alice (alice-uuid)

# 用用户名切换（永久）
kweaver auth switch prod --user alice

# 或单次使用其他用户的凭证
kweaver --user bob bkn list

# 登出特定用户
kweaver auth logout prod --user bob
```

## 说明

- **OAuth2 授权码登录**（默认）：获取 `access_token` + `refresh_token`，过期自动刷新
- **Playwright cookie 登录**（`-u`/`-p` 或 `--playwright`）：无 `refresh_token`，过期需重新登录
- Token 有效期 1 小时
- `--alias` 设置短名称方便切换
- `--insecure` / `-k`：跳过 TLS 证书校验（仅用于自签名/内网开发环境）
