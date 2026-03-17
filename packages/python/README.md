# KWeaver Python SDK

简洁的 Python 接口，用于访问 KWeaver BKN（Business Knowledge Network）和 Agent。

## 安装

```bash
pip install kweaver-sdk
```

## 快速上手

### 场景一：只读查询（直连 BKN，无需构建）

已有 BKN，只需搜索或与 Agent 对话时使用此模式。**不需要调用 `weaver()`。**

```python
import kweaver

kweaver.configure(
    url="https://kweaver.example.com",
    token="my-token",
    bkn_id="supply-chain-bkn-id",
    agent_id="supply-chain-agent-id",
)

# 语义搜索 BKN
results = kweaver.search("供应链有哪些关键风险？")
for concept in results.concepts:
    print(concept.concept_name, concept.rerank_score)

# 与 Agent 对话
reply = kweaver.chat("帮我分析一下今年的库存风险")
print(reply.content)

# 流式输出
for chunk in kweaver.chat("给我生成一份风险报告", stream=True):
    print(chunk.delta, end="", flush=True)
```

---

### 场景二：写入数据源后构建索引

接入了新数据源、新增了对象类或关系类之后，需要调用 `weaver()` 重建 BKN 索引，才能让变更生效并被 Agent 检索到。

```python
import kweaver
from kweaver import KWeaverClient, TokenAuth

kweaver.configure(
    url="https://kweaver.example.com",
    token="my-token",
    bkn_id="supply-chain-bkn-id",
)

# 通过底层客户端做写操作（如接入数据源、定义对象类等）
client = kweaver._default_client
client.datasources.create(name="erp_db", type="mysql", ...)
client.object_types.create(bkn_id="supply-chain-bkn-id", ...)

# 写操作完成后，触发 BKN 全量构建（建立索引）
kweaver.weaver(wait=True)   # 同步等待完成，默认超时 300s
print("BKN 构建完成，可以开始搜索")

# 构建完成后即可搜索
results = kweaver.search("新接入的 ERP 数据中有哪些供应商？")
```

异步触发（不阻塞）：

```python
job = kweaver.weaver()          # 立即返回 BuildJob
status = job.poll()             # 手动轮询
print(status.state)             # "running" / "completed" / "failed"

# 或稍后等待
status = job.wait(timeout=600)
```

---

### 场景三：管理多个 BKN

需要同时操作多个 BKN 时，在各函数中显式指定 `bkn_id`：

```python
import kweaver

kweaver.configure(
    url="https://kweaver.example.com",
    token="my-token",
)

# 列出所有 BKN
for bkn in kweaver.bkns():
    print(bkn.id, bkn.name)

# 分别搜索不同 BKN
results_sc = kweaver.search("库存预警", bkn_id="supply-chain-bkn-id")
results_hr = kweaver.search("员工离职率", bkn_id="hr-bkn-id")

# 对指定 BKN 触发构建
kweaver.weaver(bkn_id="supply-chain-bkn-id", wait=True)
kweaver.weaver(bkn_id="hr-bkn-id", wait=True)
```

---

### 场景四：浏览 Agent

```python
import kweaver

kweaver.configure(url="https://kweaver.example.com", token="my-token")

# 列出所有已发布的 Agent
for agent in kweaver.agents(status="published"):
    print(f"{agent.name}  (id={agent.id}, bkn={agent.kn_ids})")

# 与指定 Agent 多轮对话
conv_id = ""
for question in ["你能做什么？", "分析最近的库存数据", "给出改进建议"]:
    reply = kweaver.chat(question, agent_id="supply-chain-agent-id", conversation_id=conv_id)
    conv_id = reply.conversation_id
    print(f"Q: {question}")
    print(f"A: {reply.content}\n")
```

---

## API 参考

### `kweaver.configure(url, *, token, bkn_id, agent_id, ...)`

初始化默认客户端。所有其他函数都需要先调用此函数。

| 参数 | 说明 |
|------|------|
| `url` | KWeaver 服务地址 |
| `token` | Bearer Token（推荐） |
| `username` / `password` | 用户名密码登录（需要 Playwright） |
| `config` | 使用本地配置文件中的凭证 |
| `bkn_id` | 默认 BKN ID，供 `search()` 和 `weaver()` 使用 |
| `agent_id` | 默认 Agent ID，供 `chat()` 使用 |

### `kweaver.search(query, *, bkn_id, mode, max_concepts)`

对 BKN 做语义搜索，返回 `SemanticSearchResult`。

### `kweaver.chat(message, *, agent_id, stream, conversation_id)`

向 Agent 发送消息，返回 `Message`（或 `Iterator[MessageChunk]` 当 `stream=True`）。

### `kweaver.weaver(*, bkn_id, wait, timeout)`

触发 BKN 全量构建/重建索引。**只在写操作后需要调用**，纯只读场景无需调用。返回 `BuildJob`。

### `kweaver.agents(*, keyword, status, limit)`

列出 Agent，返回 `list[Agent]`。

### `kweaver.bkns(*, name, limit)`

列出 BKN，返回 `list[KnowledgeNetwork]`。

---

## 底层客户端

顶层 API 封装了最常用的操作。如需访问完整功能（数据源、对象类、关系类、Action 等），直接使用底层客户端：

```python
import kweaver

kweaver.configure(url="...", token="...")
client = kweaver._default_client   # KWeaverClient 实例

# 完整 API
client.datasources.list(bkn_id="...")
client.object_types.list(bkn_id="...")
client.action_types.execute(bkn_id="...", action_type_id="...")
```

或直接实例化：

```python
from kweaver import KWeaverClient, TokenAuth

client = KWeaverClient(
    base_url="https://kweaver.example.com",
    auth=TokenAuth("my-token"),
)
```
