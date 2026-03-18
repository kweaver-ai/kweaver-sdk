# 数据源管理

TS CLI 通过 `ds` 命令组管理数据源（datasource）：连接、列表、详情、表结构、删除。

## 命令总览

| 命令 | 说明 |
|------|------|
| `kweaver ds list [options]` | 列出数据源 |
| `kweaver ds get <id>` | 获取数据源详情 |
| `kweaver ds delete <id> [-y]` | 删除数据源 |
| `kweaver ds tables <id> [options]` | 列出数据源的表及列 |
| `kweaver ds connect <db_type> <host> <port> <database> --account X --password Y` | 测试连接、注册数据源并发现表 |

## 何时使用

- 用户说"连接数据库"、"注册数据源"：`ds connect`
- 用户说"有哪些数据源"：`ds list`
- 用户说"查看数据源详情/表结构"：`ds get` / `ds tables`
- 用户说"删除数据源"：`ds delete`

## 参数说明

### ds list

| 参数 | 说明 |
|------|------|
| `--keyword` | 按关键词过滤 |
| `--type` | 按类型过滤（如 mysql、postgresql） |
| `-bd` | 业务域，默认 bd_public |
| `--pretty` | 格式化 JSON（默认） |

### ds get

| 参数 | 说明 |
|------|------|
| `-bd` | 业务域 |
| `--pretty` | 格式化 JSON |

### ds delete

| 参数 | 说明 |
|------|------|
| `-y, --yes` | 跳过确认 |
| `-bd` | 业务域 |

### ds tables

| 参数 | 说明 |
|------|------|
| `--keyword` | 按表名关键词过滤 |
| `-bd` | 业务域 |
| `--pretty` | 格式化 JSON |

### ds connect

| 参数 | 说明 |
|------|------|
| `<db_type>` | 数据库类型：mysql、postgresql、oracle 等 |
| `<host>` | 主机地址 |
| `<port>` | 端口 |
| `<database>` | 数据库名 |
| `--account` | 账号（必填） |
| `--password` | 密码（必填） |
| `--schema` | Schema（部分数据库需要） |
| `--name` | 数据源显示名称 |
| `-bd` | 业务域 |

## 用法示例

```bash
# 列出
kweaver ds list
kweaver ds list --keyword mysql --type mysql

# 详情与表结构
kweaver ds get <ds-id>
kweaver ds tables <ds-id>
kweaver ds tables <ds-id> --keyword order

# 连接并注册
kweaver ds connect mysql 192.168.1.10 3306 mydb --account root --password secret
kweaver ds connect postgresql localhost 5432 warehouse --account admin --password pwd --schema public --name "生产库"

# 删除
kweaver ds delete <ds-id> -y
```

## 典型编排

1. **连接并创建知识网络**：`ds connect` → 获取 ds-id → `bkn create-from-ds <ds-id> --name X`
2. **探索已有数据源**：`ds list` → `ds get <id>` → `ds tables <id>`
3. **清理**：`ds delete <id> -y`

## 注意事项

- `ds connect` 会先测试连接，成功后再注册；密码会经平台加密后存储
- 创建知识网络时可用 `bkn create-from-ds <ds-id>` 从数据源自动创建 dataview、对象类并可选触发 build
