# 认证命令参考

平台认证管理。凭据存储在 `~/.kweaver/`。

与 CLI 一致：运行 `kweaver auth` 或 `kweaver auth login --help` 可查看与当前版本同步的用法。

## 命令

```bash
kweaver auth login <url> [--alias <name>] [--no-auth] [--no-browser] [-u user] [-p pass]
                         [--new-password <pwd>] [--http-signin]
                         [--port <n>] [--insecure|-k]
kweaver auth <url> [--alias <name>] ...              # 同上（简写）
kweaver auth change-password [<url>] [-u <account>] [-o <old>] [-n <new>]
                                 [--insecure|-k]
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

## 环境变量与 ~/.kweaver/ 的边界

| 场景 | 是否读 `KWEAVER_TOKEN` / `KWEAVER_BASE_URL` | 说明 |
|------|---------------------------------------------|------|
| 业务命令（`bkn`、`call`、`agent`、`kn`、`vega` 等） | 是 | 解析顺序一般为 **显式参数 > 环境变量 > `~/.kweaver/`**（与 SDK 一致）。 |
| `kweaver auth status`、`kweaver auth whoami`、`kweaver config show` | 是（兜底） | 默认读 `~/.kweaver/` 的当前平台；**若无当前平台**，可同时设置 `KWEAVER_BASE_URL` + `KWEAVER_TOKEN`，CLI 会本地解 JWT 展示身份。token 为 opaque 时省略身份字段并给出简短提示，**不额外请求远端接口、不增加新旗标**。 |
| `kweaver auth users` / `auth switch` / `auth export`、`kweaver config set-bd` | 否 | 只操作本地已保存的多用户档案或写 `~/.kweaver/`；环境变量中的 token **不会**被这些命令读取。 |

**常用环境变量**：`KWEAVER_BASE_URL`（与 `KWEAVER_TOKEN` 配对时通常必填）、`KWEAVER_TOKEN`（可带或不带 `Bearer ` 前缀）、`KWEAVER_TLS_INSECURE`、`KWEAVER_BUSINESS_DOMAIN`、`KWEAVER_USER`、`KWEAVER_NO_AUTH`。

**env 模式下 `auth status` / `whoami` 输出**：`whoami` 会标注 `Source: env (KWEAVER_TOKEN)`；refresh_token 在 env 路径下为 **n/a**。`whoami --json` 输出包含 `"source": "env"` 以及 JWT payload（若 token 为 JWT）。

**FAQ：只设置了 `KWEAVER_TOKEN` 仍报错？**  
`auth status` / `whoami` / `config show` 需要能定位平台：请同时设置 **`KWEAVER_BASE_URL`**，或执行 `kweaver auth login <url>` 将凭据写入 `~/.kweaver/`。

## 无认证平台（no-auth）

部分环境未启用 OAuth（例如内网开发机）。可显式保存为 no-auth 平台，或与正常登录一样执行 `kweaver auth login <url>`：若 `POST /oauth2/clients` 返回 **404**，CLI 会提示并自动保存为 no-auth 模式。

- **`--no-auth`**：`kweaver auth <url> --no-auth` 与 `kweaver auth login <url> --no-auth` 等价，跳过浏览器/OAuth。
- **环境变量**：`KWEAVER_NO_AUTH=1` 且未设置 `KWEAVER_TOKEN` 时，CLI 使用与磁盘 no-auth 相同的 sentinel（需配合 `KWEAVER_BASE_URL` 或已选平台）。
- 凭据仍写入 `~/.kweaver/`，可用 `auth use` / `auth list` 切换；内置 **default** 用户目录（与 TS/Python SDK 一致）。

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

## 回调地址

默认回调地址为 `http://localhost:9010/callback`。

| 选项 | 说明 |
|------|------|
| `--port <n>` | 修改本地回调端口（默认 9010）。端口被占用时使用。 |
| `--no-browser` | 不自动打开浏览器；打印授权 URL，在终端粘贴回调地址栏中的完整 URL 或仅粘贴 `code` 值。适用于无图形界面或自动打开失败时。若本机 `openBrowser` 失败，CLI 也会自动进入该模式。 |

```bash
# 端口被占用
kweaver auth login https://platform.example.com --port 8080

# 无浏览器：打印 URL，用手机/另一台电脑浏览器登录后，从地址栏复制回调 URL 粘贴到终端
kweaver auth login https://platform.example.com --no-browser
```

**Python SDK**（`OAuth2BrowserAuth`）：与 CLI 行为一致；无浏览器时在代码中调用 `login(no_browser=True)`，终端会提示粘贴回调 URL 或 code。若 `webbrowser.open` 失败，会自动进入同一粘贴流程。

```python
from kweaver import OAuth2BrowserAuth
auth = OAuth2BrowserAuth("https://platform.example.com")
auth.login(no_browser=True)
```

**无浏览器的服务器（备选）**：在有浏览器的机器上登录后，将回调页面上显示的 `--refresh-token` 命令复制到无浏览器的服务器执行，或使用 `kweaver auth export` 导出凭据。

## 说明

- **OAuth2 授权码登录**（默认）：浏览器流程，获取 `access_token` + `refresh_token`，过期自动刷新。
- **HTTP 密码登录**（`-u`/`-p`，可选 `--http-signin`）：直接 `POST /oauth2/signin`，无需浏览器，可拿到 `refresh_token`。公钥优先取登录页，否则使用内置候选。缺失的 `-u`/`-p` 会从 stdin 提示输入（TTY 下密码隐藏）。DIP 可设 `KWEAVER_OAUTH_PRODUCT=dip`。解密失败等见 `packages/typescript/README.md` 环境变量说明。
- **初始密码（错误码 401001017）**：服务端仍要求使用初始密码时，HTTP 登录会失败。交互终端可确认后按提示设置新密码（6–100 字符）并自动重试登录；非交互环境请使用 `--new-password <pwd>` 后重跑同一登录命令。
- **修改密码**（`kweaver auth change-password [<url>] [-u <account>] [-o <old>] [-n <new>]`）：调用 EACP `POST /api/eacp/v1/auth1/modifypassword`，**不需要**已保存的 OAuth token；`<url>` 省略时使用当前激活平台（`kweaver auth use`），`-u` 省略时使用该平台**当前激活账号**（`token.json` 中的 `displayName`）。TTY 可省略 `-o`/`-n` 以隐藏输入。
- **`--no-browser` 粘贴流程**（不带 `-u`/`-p`）：打印授权 URL，由用户在任意浏览器登录后粘贴回调 URL 或 `code` 到终端。
- **`--no-browser` + `-u`/`-p`**：等价于 HTTP 密码登录，缺失字段同样从 stdin 提示。
- Token 有效期 1 小时
- `--alias` 设置短名称方便切换
- `--insecure` / `-k`：跳过 TLS 证书校验（仅用于自签名/内网开发环境）
