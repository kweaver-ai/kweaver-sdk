# Action 执行

查询和执行知识网络中的 Action Type（有副作用）。

## CLI 命令总览

| 命令 | 说明 |
|------|------|
| `kweaver action query <kn-id> <at-id>` | 查询 Action 定义和参数 |
| `kweaver action execute <kn-id> <at-id> [--params '<json>'] [--no-wait] [--timeout N]` | 执行 Action |
| `kweaver action logs <kn-id> [--limit N]` | 列出执行日志 |
| `kweaver action log <kn-id> <log-id>` | 查看单条日志 |

## SDK Skill 用法

```python
from kweaver.skills import ExecuteActionSkill
skill = ExecuteActionSkill(client)

# 按名称执行（自动查找 action_type_id）
result = skill.run(kn_name="erp_prod", action_name="库存盘点")
# -> { execution_id, status, result }

# 按 ID 执行，传入参数
result = skill.run(
    kn_id="<id>", action_type_id="<at_id>",
    params={"warehouse": "华东"},
    timeout=600,
)

# 异步执行（不等待完成）
result = skill.run(kn_id="<id>", action_type_id="<at_id>", wait=False)
# -> { execution_id, status: "pending" }
```

## SDK Resource 底层用法

```python
# 查询 Action 定义
info = client.action_types.query(kn_id, action_type_id)

# 执行 Action
execution = client.action_types.execute(kn_id, action_type_id, params={...})
result = execution.wait(timeout=300)  # 等待完成

# 查看日志
logs = client.action_types.list_logs(kn_id, limit=20)
log = client.action_types.get_log(kn_id, log_id)

# 取消执行
client.action_types.cancel(kn_id, log_id)
```

## 关键约束

- Action 有**副作用**（修改数据、触发流程），仅在用户**明确请求**时执行
- 执行前向用户确认 Action 名称和参数
- 默认 `wait=True`，Skill 会阻塞等待执行完成（最多 300 秒）
- `cancel` 只能取消正在运行的执行

## 默认策略

- 用户说"执行某个 Action"：先 `action query` 查看参数定义，确认后 `action execute`
- 用户说"看看执行记录"：`action logs`
- 用户说"取消执行"：需要 `log_id`，先 `action logs` 找到正在运行的记录
