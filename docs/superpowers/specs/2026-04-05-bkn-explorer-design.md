# BKN Explorer — 知识网络浏览器

## 目标

提供 `kweaver bkn explore` 命令，在本地浏览器中以列表、卡片、交叉链接的方式展示任意 BKN 的知识网络，类似 [buffett-letters](https://buffett-letters-eir.pages.dev) 的阅读体验。

## 用户流程

```
$ kweaver bkn explore
? 选择一个知识网络:
  ❯ 巴菲特股东信 (kn-abc123)
    技术文档库 (kn-def456)

✔ 已启动，浏览器已打开 http://localhost:3721
  按 Ctrl+C 退出
```

- 传入 `<bkn-id>` 则跳过选择
- `--port <number>` 自定义端口（默认 3721）
- `--no-open` 不自动打开浏览器

## 架构

```
kweaver bkn explore [bkn-id]
         │
         ▼
    CLI (TypeScript)
    ├── 无 bkn-id → 调 knowledgeNetworks.list()，交互式选择
    ├── 读取 ~/.kweaver/ 凭证
    ├── 启动本地 HTTP server (localhost:port)
    │   ├── GET /            → serve 静态前端
    │   ├── GET /api/meta    → 返回 BKN 基本信息 + schema（OT/RT/AT 列表 + 统计）
    │   └── /api/*           → 代理转发到 BKN API（解决 CORS）
    └── 自动打开浏览器（open 包）
```

### 本地 server 职责

1. **静态文件服务**：serve `templates/bkn-explorer/` 下的 HTML/CSS/JS
2. **API 代理**：将前端的 `/api/*` 请求代理到真实 BKN API，附加认证 header
3. **Meta 端点**：`GET /api/meta` 返回预加载的 schema 数据，前端首屏渲染用，避免多次请求

### Meta 端点返回结构

```json
{
  "bkn": { "id": "kn-xxx", "name": "巴菲特股东信" },
  "statistics": { "object_count": 216, "relation_count": 4726 },
  "objectTypes": [
    { "id": "ot-1", "name": "信件", "displayKey": "title", "propertyCount": 8, "instanceCount": 98 },
    { "id": "ot-2", "name": "投资概念", "displayKey": "name", "propertyCount": 5, "instanceCount": 49 }
  ],
  "relationTypes": [
    { "id": "rt-1", "name": "提及", "sourceOtId": "ot-1", "targetOtId": "ot-2", "sourceOtName": "信件", "targetOtName": "投资概念" }
  ],
  "actionTypes": [
    { "id": "at-1", "name": "相关性分析" }
  ]
}
```

## 前端页面

### 技术选型

- 纯原生 HTML + vanilla JS + CSS，无框架，无构建步骤
- 模板文件即最终产物，CLI 直接 serve
- 浏览器端通过 `fetch('/api/...')` 按需加载数据

### 页面结构

```
templates/bkn-explorer/
  index.html       — 入口 + 首页
  style.css        — 全局样式
  app.js           — 路由、API 调用、渲染逻辑
```

使用 hash 路由（`#/ot/ot-1`、`#/instance/ot-1/id`），单文件 SPA，无需多个 HTML。

### 页面视图

#### 1. 首页（`#/`）

- BKN 名称 + 描述
- 统计卡片：实体数、关系数、Object Type 数
- Object Type 分类卡片列表，每张卡片显示：
  - OT 名称
  - 实例数量
  - 点击进入该 OT 的实例列表

#### 2. Object Type 实例列表（`#/ot/:otId`）

- OT 名称 + 描述
- 实例列表，每行显示 display_key 值
- 翻页（调 `queryInstances` 分页加载）
- 点击实例进入详情

#### 3. 实例详情（`#/instance/:otId/:instanceId`）

- 实例名称（display_key）
- 属性表：key-value 列表，展示该实例所有属性
- 关联实例列表：按 Relation Type 分组
  - 关系名称 → 关联实例链接列表
  - 点击链接跳转到关联实例详情
- 这是知识网络的核心体验：通过链接在实例间不断「探索」

#### 4. 搜索结果（`#/search?q=xxx`）

- 顶部搜索框（所有页面都有）
- 调 `semanticSearch` API
- 结果列表：concept 名称 + 类型 + 匹配分数
- 点击跳转到对应实例详情

### 前端调用的 API

| 页面 | API 调用 | SDK 方法 |
|------|---------|---------|
| 首页 | `GET /api/meta` | 预加载，无需额外调用 |
| 实例列表 | `POST /api/instances` | `bkn.queryInstances(knId, otId, { page, limit })` |
| 实例详情 | `POST /api/instances` + `POST /api/subgraph` | `queryInstances`（条件过滤）+ `querySubgraph`（关联查询） |
| 搜索 | `POST /api/search` | `bkn.semanticSearch(bknId, query)` |

### 样式风格

- 简洁、可读性优先，参考 buffett-letters 的排版风格
- 浅色主题，衬线/无衬线混排
- 响应式：桌面端侧边栏导航 + 主内容区，移动端折叠

## CLI 实现

### 新增文件

```
packages/typescript/src/
  commands/bkn-explore.ts    — explore 命令逻辑
  templates/bkn-explorer/    — 前端静态文件
    index.html
    style.css
    app.js
```

### bkn-explore.ts 职责

```typescript
export async function runBknExplore(args: string[], ctx: ClientContext): Promise<void> {
  // 1. 解析参数：bknId, --port, --no-open
  // 2. 无 bknId → 调 knowledgeNetworks.list()，用 inquirer 交互选择
  // 3. 加载 schema：listObjectTypes + listRelationTypes + listActionTypes + get(knId, { include_statistics: true })
  // 4. 启动 HTTP server（Node http 模块）
  //    - 静态文件：读取 templates/bkn-explorer/ 目录
  //    - /api/meta：返回预加载的 schema JSON
  //    - /api/*：代理到 BKN API（附加 Authorization header）
  // 5. 打开浏览器（使用 open 包）
  // 6. 等待 Ctrl+C，优雅退出
}
```

### HTTP 代理实现

用 Node 原生 `http` 模块，不引入 express/koa。代理逻辑：

1. 前端发 `POST /api/instances`，body 里带 `otId`、分页参数等
2. server 解析路由，映射到对应 SDK 方法调用
3. 返回 JSON 结果

不做通用 URL 透传代理（安全考虑），而是定义明确的几个 API 端点，server 端调 SDK 方法后返回结果。

### 路由表

| 前端请求 | server 处理 |
|---------|------------|
| `GET /api/meta` | 返回预加载的 schema |
| `POST /api/instances` body: `{ otId, page, limit, condition? }` | `bkn.queryInstances()` |
| `POST /api/subgraph` body: `{ relationTypePaths }` | `bkn.querySubgraph()` |
| `POST /api/search` body: `{ query, maxConcepts? }` | `bkn.semanticSearch()` |
| `POST /api/properties` body: `{ otId, identities }` | `bkn.queryProperties()` |

## 不做的事

- 不做图谱可视化（力导向图等），只做列表+链接
- 不做数据编辑/写入，只读浏览
- 不做用户认证（本地 server，信任 localhost）
- 不做静态站点导出（未来可加）
- 不引入前端框架或构建工具
- 不引入 express/koa 等 server 框架

## 依赖

- `open`：打开浏览器（已在项目中使用或作为轻量依赖）
- Node 原生 `http`：本地 server
- 无新增前端依赖（CDN 也不用，全部手写）
