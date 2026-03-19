# 智能体协作规则

本文件对本仓库全局生效（除非子目录有更具体的 `AGENTS.md` 覆盖）。

## 智能体人设

你是一个经验丰富的编程大师，专注于高效、可扩展、兼容、可维护、注释良好和低熵的代码。

## 项目上下文

### BKN SDK 包名

- **TypeScript SDK**: `@kweaver-ai/bkn`（npm 包）
- **Python SDK**: `pip install kweaver-bkn`

### BKN 规范

- 当前权威版本：**v2.0.0**，以 <https://github.com/kweaver-ai/bkn-specification/blob/main/docs/SPECIFICATION.md> 为准
- BKN 目录结构采用模块化组织：`network.bkn` 为根，子目录 `object_types/`、`relation_types/`、`action_types/`、`risk_types/`、`concept_groups/`
- `CHECKSUM` 文件放在 BKN 目录**内部**（与 `network.bkn` 同级），可选，不影响加载
- macOS 打包 tar 时必须设置 `COPYFILE_DISABLE=1`，防止 `._*` 元数据文件被打入 tar 导致后端解析失败

## 代码规范

- 所有代码注释（含 docstring）必须使用英文
- 所有新增日志（log message）必须使用英文

## 熵减原则（Entropy Reduction）

目标：每次变更都应让系统更"有序"——更易理解、更一致、更可维护；避免引入无谓复杂度与噪声。

### 适用范围

- 代码、测试、配置、脚本、文档、目录结构与命名

### 具体规则

- 优先做"根因修复"，避免临时补丁式堆叠
- 除非必要，不做大范围无关格式化/重命名/移动文件（减少 diff 噪声）
- 保持一致性：遵循既有架构、命名、目录分层与风格；新增模式需说明收益与迁移策略
- 降低复杂度：能删就删（dead code/unused deps/重复逻辑）；能合并就合并（重复配置/重复文档）
- 提升可读性：抽象层级清晰、接口边界明确、默认行为可预测；避免"聪明但难懂"的写法
- 变更可验证：新增/修改行为应配套最小必要的测试或可运行示例；并同步更新文档

### PR 自检清单

- [ ] diff 是否只包含与目标相关的改动？
- [ ] 是否减少了重复/耦合/临时逻辑，而不是增加？
- [ ] 命名、目录、风格是否与现有保持一致？
- [ ] 是否补齐了必要的测试/文档/示例？

## 测试（Tests）

> 完整规范见 [rules/TESTING.zh.md](rules/TESTING.zh.md)

### 测试分层

| 层级 | 缩写 | 定义 | 外部依赖 |
|------|------|------|----------|
| 单元测试 | UT | 验证单个函数/方法逻辑，全 mock | 无 |
| 端到端测试 | E2E | 验证与真实服务的交互 | 运行中的服务 |

**关键约束**：`make test` 仅代表 UT，无外部依赖即可通过；E2E 由 `test-e2e` 单独入口执行。

### 目录与入口

- 测试目录：
  - Python：`packages/python/tests/unit/`（单元测试）、`packages/python/tests/e2e/`（E2E）
  - TypeScript：`packages/typescript/test/`、`packages/typescript/test/e2e/`（E2E）
- 统一入口：根目录 `make test`（UT）、`make ci`（lint + 覆盖率）、`make test-cover`（覆盖率）
- 各包单独运行：`make -C packages/python test`、`make -C packages/python test-e2e`、`make -C packages/typescript test`；TS E2E：`npm run test:e2e -w packages/typescript`

### Makefile 契约（MUST）

| 目标 | 用途 | 必选 |
|------|------|------|
| `test` | 运行 UT（无外部依赖） | 是 |
| `test-cover` | 运行 UT + 生成覆盖率 | 是 |
| `lint` | 静态检查 | 是 |
| `ci` | CI 入口：`lint + test-cover` | 是 |

### 产物输出

- 输出到 `<module>/test-result/`（加入 `.gitignore`）
- Python：`coverage.xml`
- TypeScript：`tap.txt`（覆盖率报告）

### 可验证规则（MUST）

- M1 模块存在 Makefile
- M2/M3/M4 Makefile 包含 `test`、`ci`、`lint` target
- M5 `make test` 无外部依赖即可通过
- M6 `test-result/` 在 `.gitignore` 中

### Agent 工作流

1. 读取目标模块源码与已有测试
2. 生成/修改测试代码，保持风格一致
3. `make test` 验证通过
4. `make test-cover` 确认覆盖率变化

## 文档约定

- 稳定文档放在 `docs/`
- 中间过程/阶段性文档放在 `baks/`，后续会逐步淘汰

## 文档架构最佳实践

### 语言政策

- **Usage 文档 (`docs/usage/`)**: 英文为主，面向所有使用者和开发者
- **Design 文档 (`docs/design/`)**: 中文为主，面向团队内部技术讨论
- **例外**: 详细技术指南可保留中文，但需提供英文快速参考版本

### 文档结构

```
docs/
├── README.md                    # 文档导航入口，包含语言政策说明
├── design/                      # 设计文档（中文）
└── usage/                       # 使用文档（英文）
    ├── quick_start/             # 快速开始
    ├── concepts/                # 核心概念
    ├── guides/                  # 操作指南
    └── configuration/           # 配置参考
```

### 必备文档清单

1. **README.md** - 文档导航和语言政策
2. **Quick Start Guide** - 5分钟快速上手
3. **Installation Guide** - 详细安装说明
4. **Troubleshooting Guide** - 常见问题解决
5. **CLI Reference** - 命令行参考（如适用）
6. **Configuration Reference** - 配置格式说明（如适用）

### 文档规范

#### 命名与格式
- 文件名：小写字母+下划线，如 `getting_started.md`
- 标题：清晰描述性，英文文档用英文，中文文档可双语
- 路径：使用 `$PROJECT_ROOT` 或相对路径，避免硬编码个人路径

#### 内容要求
- 清晰的标题层级（`#`, `##`, `###`）
- 长文档提供目录
- 包含可运行的代码示例
- 使用表格整理结构化信息
- 相对路径链接，确保在 README.md 中可达

#### 代码示例规范
```bash
# ✅ 好的示例
./bin/run --name my_experiment

# ❌ 避免
cd /home/alice/my-project  # 硬编码路径
```

### 文档维护

#### 更新时机
- 新功能 → 同步更新文档
- 配置变更 → 更新配置参考
- 发现错误 → 立即修正

#### 质量检查清单
- [ ] 符合语言政策（Usage英文/Design中文）
- [ ] 无硬编码个人路径
- [ ] 代码示例可执行
- [ ] 链接有效且可达
- [ ] 标题层级清晰
- [ ] 无拼写错误
- [ ] 格式一致

#### 版本控制
- 设计文档添加"最后更新"日期
- 重大变更记录版本历史
- 废弃文档移至 `baks/` 而非删除

### 特殊文档类型

- **快速参考**: 简洁聚焦，提供常用命令表格，链接详细文档
- **详细指南**: 完整功能说明，包含高级特性和架构原理
- **故障排除**: 按问题分类，提供症状-原因-解决方案结构
