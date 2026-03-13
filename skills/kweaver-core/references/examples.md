# kweaver 命令示例

按需阅读本文件：当你需要参考完整命令形态或端到端流程时使用。

---

## 认证

```bash
kweaver auth login https://platform.example.com
kweaver auth login https://platform.example.com --alias prod
kweaver auth status
kweaver auth list
kweaver auth use prod
kweaver auth logout
```

---

## 知识网络管理

列表：

```bash
kweaver kn list
kweaver kn list --name erp
```

查看详情与导出：

```bash
kweaver kn get <kn-id>
kweaver kn export <kn-id>
```

构建：

```bash
kweaver kn build <kn-id>                   # 等待完成
kweaver kn build <kn-id> --no-wait         # 不等待
kweaver kn build <kn-id> --timeout 600     # 自定义超时
```

删除：

```bash
kweaver kn delete <kn-id>
```

---

## 查询

语义搜索：

```bash
kweaver query search <kn-id> "高库存的产品"
kweaver query search <kn-id> "高血压治疗方案" --max-concepts 20
```

对象实例查询：

```bash
kweaver query instances <kn-id> <ot-id>
kweaver query instances <kn-id> <ot-id> --limit 50
kweaver query instances <kn-id> <ot-id> --condition '{"field":"status","operation":"eq","value":"active"}'
```

组合条件查询：

```bash
kweaver query instances <kn-id> <ot-id> --condition '{
  "operation": "and",
  "sub_conditions": [
    {"field": "name", "operation": "like", "value": "高血压"},
    {"field": "severity", "operation": "eq", "value": "重度"}
  ]
}'
```

KN Schema 搜索：

```bash
kweaver query kn-search <kn-id> "products"
kweaver query kn-search <kn-id> "products" --only-schema
```

---

## Action

查询 Action 定义：

```bash
kweaver action query <kn-id> <at-id>
```

执行 Action：

```bash
kweaver action execute <kn-id> <at-id>                           # 等待完成
kweaver action execute <kn-id> <at-id> --no-wait                 # 异步
kweaver action execute <kn-id> <at-id> --params '{"warehouse":"华东"}'
kweaver action execute <kn-id> <at-id> --timeout 600
```

查看日志：

```bash
kweaver action logs <kn-id>
kweaver action logs <kn-id> --limit 50
kweaver action log <kn-id> <log-id>
```

---

## Agent 对话

列出 Agent：

```bash
kweaver agent list
kweaver agent list --keyword "供应链"
```

首轮对话：

```bash
kweaver agent chat <agent-id> -m "华东仓库库存情况如何？"
```

续聊（带 conversation-id）：

```bash
kweaver agent chat <agent-id> -m "和上个月相比呢？" --conversation-id <conversation-id>
```

---

## 通用 API 调用

```bash
# GET
kweaver call /api/ontology-manager/v1/knowledge-networks

# POST with body
kweaver call /api/ontology-query/v1/knowledge-networks/<kn-id>/object-types/<ot-id> \
  -X POST -d '{"limit":10,"condition":{"operation":"and","sub_conditions":[]}}'

# DELETE
kweaver call /api/ontology-manager/v1/knowledge-networks/<kn-id> -X DELETE
```

---

## SDK 端到端示例

### 从零构建知识网络

```python
# Step 1: 连接数据库
result = ConnectDbSkill(client).run(
    db_type="mysql", host="10.0.1.100", port=3306,
    database="erp_prod", account="readonly", password="xxx",
)
ds_id = result["datasource_id"]

# Step 2: 构建知识网络
result = BuildKnSkill(client).run(
    datasource_id=ds_id, network_name="erp_prod",
    tables=["products", "inventory", "suppliers"],
    relations=[{
        "name": "产品_库存",
        "from_table": "products", "to_table": "inventory",
        "from_field": "material_number", "to_field": "material_code",
    }],
)
kn_id = result["kn_id"]

# Step 3: 查看 Schema
result = LoadKnContextSkill(client).run(mode="schema", kn_name="erp_prod")

# Step 4: 查询数据
result = QueryKnSkill(client).run(kn_id=kn_id, mode="search", query="高库存的产品")
```

### Agent 多轮对话

```python
skill = ChatAgentSkill(client)

# 首轮
result = skill.run(mode="ask", agent_name="供应链助手", question="华东仓库库存情况")
conv_id = result["conversation_id"]

# 续聊
result = skill.run(mode="ask", agent_name="供应链助手",
                   question="和上个月相比呢？", conversation_id=conv_id)
```

### 执行 Action

```python
skill = ExecuteActionSkill(client)
result = skill.run(kn_name="erp_prod", action_name="库存盘点")
print(f"状态: {result['status']}, 结果: {result.get('result')}")
```
