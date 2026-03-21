# 认证命令参考

平台认证管理。凭据存储在 `~/.kweaver/`。

## 前提

```bash
npm install playwright && npx playwright install chromium
```

## 命令

```bash
kweaver auth login <url> [--alias <name>]      # 输入账号密码登录
kweaver auth <url> [--alias <name>]             # 同上（简写）
kweaver auth logout [<platform>]                 # 登出（清除本地 token）
kweaver auth status                              # 查看 token 状态
kweaver auth list                                # 列出已保存的平台
kweaver auth use <platform>                      # 切换平台（URL 或 alias）
kweaver auth delete <platform> [-y]              # 删除平台凭证
```

## 说明

- `login` 通过 Playwright headless 浏览器完成登录，提取平台 token
- Token 有效期 1 小时，过期后需重新 `auth login`
- 不支持自动刷新
- 支持多平台，用 `--alias` 设置短名称方便切换

## 示例

```bash
kweaver auth login https://kweaver.example.com --alias prod
kweaver auth login https://kweaver-dev.example.com --alias dev
kweaver auth list
kweaver auth use prod
kweaver auth status
```
