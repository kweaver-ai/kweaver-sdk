# KWeaver 后端 API 一致性与设计问题

> 来源：kweaver-sdk 开发过程中发现的后端系统问题。SDK 已通过防御性代码绕过，但这些是后端应该修复的根因。

---

## 1. 错误响应格式不统一

### 现象

SDK 被迫用 4 层 fallback 链提取错误信息：

```python
# _errors.py — 实际代码
error_code = body.get("error_code") or body.get("ErrorCode") or body.get("code")
message = body.get("message") or body.get("Description") or body.get("detail") or body.get("description")
```

### 各服务现状

| 服务 | error_code 字段 | message 字段 | 备注 |
|------|----------------|-------------|------|
| ontology-manager | `error_code` | `message` 或 `Description`（大写 D） | |
| ontology-query | `error_code` | `message` | |
| data-connection | **不返回** | `message`（中文内容） | 异类 |
| mdl-data-model | `error_code` | `message` | |
| vega-backend | `error_code` | `message` | |
| agent-factory | `error_code` | `message` | |
| agent-app | `error_code` | `message` | |
| agent-retrieval (MCP) | `error.data.error_code` | `error.data.message` | JSON-RPC 嵌套 |

### 核心问题

- ontology-manager 偶尔用 `Description`（大写 D），与其他服务不一致
- data-connection 不返回 `error_code`，只靠中文 message 判断（SDK 匹配 `"已存在"`）
- 成功响应不带 `trace_id` header，只有错误 body 里有 — 无法追踪"成功但慢"的请求

### 建议

统一所有服务的错误响应格式：

```json
{
  "error_code": "RESOURCE_EXISTED",
  "message": "Knowledge network with name 'xxx' already exists",
  "trace_id": "tr-abc123"
}
```

同时，成功响应也应在 header 中返回 `x-trace-id`。

---

## 2. List 响应信封不统一

### 现象

SDK 在 **27 处**用同样的防御代码：

```python
entries = data.get("entries", data.get("data", [])) if isinstance(data, dict) else data
```

### 各服务现状

| 服务 | list 格式 | get 格式 | 特殊情况 |
|------|----------|---------|---------|
| ontology-manager | `{"entries": [...]}` 或 `{"data": [...]}` | 裸对象 或 `{"entries": [obj]}` | get 有时包装有时不包装 |
| ontology-query | 裸对象 | 裸对象 | **`{"datas": [...]}`**（疑似拼写错误） |
| data-connection | `{"entries": [...]}` 或 `{"data": [...]}` | 裸对象 | |
| mdl-data-model | `{"entries": [...]}` | 裸 list 或 `{"entries": [...]}` | create 返回裸 list |
| vega-backend | `{"entries": [...]}` | 裸对象 或 `{"entries": [obj]}` | |
| agent-factory | `{"entries": [...]}` 或 `{"data": [...]}` | 裸对象 | |
| agent-app | `entries`/`items`/`messages`/`list`/`data` 五种之一 | 裸对象 | **5 种 key** |

### 核心问题

1. `"datas"` — ontology-query 实例查询用 `datas` 而非 `data`，全系统唯一
2. agent-app 的 list_messages 有 5 种可能的 key（`entries`/`items`/`messages`/`list`/`data`）
3. get 单个对象时不一致 — 有的裸返回，有的包在 `{"entries": [obj]}` 里
4. 没有 `total_count` — SDK 无法高效分页或计数

### 建议

统一为：

```json
// list
{"entries": [...], "total": 1234}

// get
{...}  // 始终裸对象，不包装
```

在 API Gateway 层做格式转换，不改各服务内部实现。`"datas"` 改为 `"data"` 或 `"entries"`。

---

## 3. Create 接口不支持幂等

### 现象

SDK 对 5 种资源的 create 都要 catch "已存在" 错误 → list 全量 → 按名称查找：

```python
# knowledge_networks.py — 实际代码
try:
    data = self._http.post("/api/.../knowledge-networks", json=body)
    return _parse_kn(data)
except KWeaverError as exc:
    if "Existed" in (exc.error_code or ""):
        existing = self.list(name=name)
        for kn in existing:
            if kn.name == name:
                return kn
    raise
```

### 各资源的冲突处理差异

| 资源 | 错误码匹配 | 消息匹配 | 回退策略 |
|------|-----------|---------|---------|
| KnowledgeNetwork | `"Existed" in error_code` | — | list + find |
| ObjectType | `"Existed" in error_code` | `"已存在" in message` | list + find |
| DataSource | — | `"已存在" in message` | list(keyword=) + find |
| RelationType | `"Existed" in error_code` | — | list + find |
| DataView | `"Existed" in error_code` | — | **UUID 后缀重试 3 次** |

### 核心问题

1. **不一致的错误码** — 有的返回英文 `Existed`，有的返回中文 `已存在`，data-connection 不返回 error_code
2. **`"Existed"` 是子串匹配**（`in`），不是精确匹配 — `"SomethingExisted"` 也会命中
3. **回退逻辑有竞态** — catch 和 list 之间资源可能被删除或名称被修改
4. **HTTP 状态码不明确** — 不确定返回的是 409 还是 400 还是其他

### 建议

两种修法（选其一）：

**方案 A：幂等 Create（推荐）**

如果资源已存在，返回 200 + 现有资源，而非报错：

```
POST /api/.../knowledge-networks
Body: {"name": "erp-kn"}
Response 200: {"id": "kn-123", "name": "erp-kn", ...}  // 无论新建还是已存在
```

**方案 B：明确的 409 Conflict**

```
POST /api/.../knowledge-networks
Body: {"name": "erp-kn"}
Response 409: {
  "error_code": "RESOURCE_EXISTED",
  "message": "Knowledge network 'erp-kn' already exists",
  "existing_id": "kn-123"           // ← 关键：返回已存在资源的 ID
}
```

SDK 直接 `get(existing_id)` 即可，不需要 list + 遍历。

---

## 4. Object Type 创建的 data_properties 隐式必填

### 现象

SDK 被迫自动生成 `data_properties`，因为 build 引擎需要但 create API 不验证：

```python
# object_types.py — 实际代码（3 层 fallback）
# 1. 用户显式传了 → 用
# 2. 从 dataview 拉字段 → 自动生成（含 mapped_field）
# 3. 都拿不到 → 用 primary_key + display_key 生成最小集
```

### 核心问题

1. **Create API 不验证** — `data_properties` 缺失或 `mapped_field` 缺失时，create 返回 200 OK。错误延迟到 build 阶段才暴露，排查困难

2. **后端有全部信息但不用** — OT 引用了 `dataview_id`，后端能直接查 dataview 字段并填充 `mapped_field`，但不做，要求客户端组装：

```json
{
  "name": "cpu",
  "type": "float",
  "mapped_field": {           // 与父结构完全重复
    "name": "cpu",
    "type": "float",
    "display_name": "CPU"
  }
}
```

3. **类型归一化在客户端** — dataview 存的是数据库原始类型（`varchar`/`bigint`），后端要求 ADP 类型（`string`/`integer`）。SDK 维护了 18 条映射规则（`_TYPE_MAP`），如果后端新增数据库支持，SDK 不更新就会出错

### 建议

**服务端自动填充**：

Create OT 时，如果 `data_properties` 未传或缺少 `mapped_field`：
1. 根据 `dataview_id` 查 dataview 字段列表
2. 自动生成 `mapped_field`（name → name 直接映射）
3. 类型归一化在服务端完成（服务端知道支持哪些类型）
4. 如果 dataview 也找不到，返回 **400 明确告知缺少必填字段**，不要延迟到 build

---

## 5. OAuth2 标准流程签发的 Token 被 API 网关拒绝

### 现象

通过标准 OAuth2 Authorization Code 流程（`/oauth2/auth` → `/oauth2/token`）获取的 `access_token`，调用业务 API 时返回 401：

```
GET /api/ontology-manager/v1/knowledge-networks
Authorization: Bearer ory_at_XXX
→ 401: {"error_code": "Public.Unauthorized", "description": "认证失败", "error_details": "oauth info is not active"}
```

而通过浏览器登录流程（`/api/dip-hub/v1/login` → 提取 `dip.oauth2_token` cookie）获取的 token 调用同一 API 正常。

### 对比实验

| 获取方式 | Token 前缀 | API 调用结果 |
|---------|-----------|-------------|
| OAuth2 Authorization Code（`/oauth2/token`） | `ory_at_...` | 401 — "oauth info is not active" |
| 浏览器 Cookie（`dip.oauth2_token`） | `ory_at_...` | 200 — 正常 |

两个 token 格式相同（都是 `ory_at_` 前缀，由同一个 Ory Hydra 实例签发），但只有通过浏览器 cookie 方式获取的才被 API 网关认可。

### 已排除的因素

- curl 直接调用，排除 SDK 代码问题
- Token 在换取后立即使用，未过期（`expires_in=3600`）
- 重新注册 OAuth2 Client 后重试，结果相同

### SDK 中的证据

SDK 有两条认证路径，实现上都是正确的：

```python
# 路径 A：PasswordAuth（能用）— _auth.py:86-88
# 通过 Playwright 浏览器登录，提取 dip.oauth2_token cookie
for cookie in context.cookies():
    if cookie["name"] == "dip.oauth2_token":
        token = cookie["value"]

# 路径 B：OAuth2BrowserAuth（401）— _auth.py:402-414
# 标准 OAuth2 Authorization Code 流程，/oauth2/token 换 token
resp = httpx.post(f"{self._base_url}/oauth2/token", data={
    "grant_type": "authorization_code",
    "code": code,
    "redirect_uri": redirect_uri,
})
```

### 根因推测

API 网关的 token 校验不走标准 Ory OAuth2 token introspection（`POST /oauth2/introspect`），而是依赖浏览器登录流程写入的某个服务端 session 状态。通过标准 OAuth2 流程拿到的 `access_token` 虽然由同一个 Ory 实例签发且格式有效，但在 API 网关侧没有对应的 active session 记录。

### 影响

- **CLI 认证只能走 Playwright 浏览器模拟**（`PasswordAuth`），依赖 headless Chromium，安装成本高（>200MB）
- **无法在无头服务器 / CI 环境中使用标准 OAuth2 认证**
- **第三方集成无法通过标准 OAuth2 接入** — 标准 SDK 开发者拿到的 token 无法使用

### 建议

API 网关的 token 校验应走标准 Ory token introspection（`POST /oauth2/introspect`），而非绑定 dip-hub 登录 session。这样任何标准 OAuth2 客户端签发的 token 都能被业务 API 识别。

---

## 代码引用索引

| 问题 | 关键代码位置 |
|------|------------|
| #1 错误格式 | `_errors.py:122`（3 种 error_code）、`_errors.py:125`（4 种 message） |
| #2 响应信封 | `query.py:98`（"datas"）、`conversations.py:175`（5 种 key）、27 处 fallback |
| #3 幂等 | `knowledge_networks.py:39`、`object_types.py:79`（双语）、`datasources.py:90`（仅中文）、`dataviews.py:110`（UUID 重试） |
| #4 data_properties | `object_types.py:50`（注释）、`object_types.py:62`（`except Exception: pass`）、`object_types.py:126-145`（18 条 TYPE_MAP） |
| #5 OAuth2 token | `_auth.py:86-88`（cookie 路径）、`_auth.py:402-414`（标准 OAuth2 路径） |
