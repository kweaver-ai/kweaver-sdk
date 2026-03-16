# Feature Enhancement Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 monorepo 重构后遗留的 HIGH 和 MEDIUM 优先级问题，使测试套件恢复可运行状态，并保持代码库一致性。

**Architecture:** 分 5 个独立任务：(1) 修复 editable install 指向；(2) 统一 Python CLI 命令名 `bkn`→`kn`；(3) 恢复覆盖率阈值至 75%；(4) 清理根目录残留文件并更新 package 元数据；(5) 更新 skill 文档。每个任务独立提交。

**Tech Stack:** Python 3.10+, uv, pytest, Click, Git

---

## Chunk 1: 基础修复 — install + 命令名

### Task 1: 修复 editable install 指向

**Files:**
- 无需改代码，仅重装包

**问题根因：** `.venv` 中 `kweaver-sdk` editable install 的 `direct_url.json` 指向根目录
`file:///…/kweaver-sdk`，但 monorepo 迁移后 `.py` 源码已全部移至
`packages/python/src/kweaver/`，根目录只剩 `__pycache__`。
Python 找不到真实源文件，报 `cannot import name 'KWeaverClient' from 'kweaver' (unknown location)`。

- [ ] **Step 1: 验证当前状态（测试确实失败）**

```bash
cd /Users/xupeng/dev/github/kweaver-sdk/packages/python
uv run pytest tests/unit/test_errors.py -q 2>&1 | head -10
```

预期：`ImportError: cannot import name 'KWeaverClient' from 'kweaver' (unknown location)`

- [ ] **Step 2: 重新安装 editable install 指向 packages/python**

```bash
cd /Users/xupeng/dev/github/kweaver-sdk
uv pip install -e packages/python
```

- [ ] **Step 3: 验证安装指向已更正**

```bash
uv run python -c "import kweaver; print(kweaver.__file__)"
```

预期输出：`…/packages/python/src/kweaver/__init__.py`

- [ ] **Step 4: 跑一个简单测试确认可 import**

```bash
cd /Users/xupeng/dev/github/kweaver-sdk/packages/python
uv run pytest tests/unit/test_errors.py -q
```

预期：全部通过

---

### Task 2: 统一 Python CLI 命令名 `bkn` → `kn`

**问题：**
- `packages/python/src/kweaver/cli/main.py:26` 注册为 `"bkn"`
- `packages/python/tests/e2e/test_full_flow_e2e.py`（当前 diff）已改为 `"kn"`
- `packages/python/tests/unit/test_cli.py` 大量 `"bkn"` 调用将失败
- `packages/python/tests/unit/test_cli.py:31` 的 help 断言也检查 `"bkn"`

**决策：** Python CLI 改为 `kn`（与 Python 模块名 `kn.py` 一致）；TypeScript 继续用 `bkn`。

**Files:**
- Modify: `packages/python/src/kweaver/cli/main.py:26`
- Modify: `packages/python/tests/unit/test_cli.py`（批量替换）

- [ ] **Step 1: 修改 main.py 注册命令名**

将 `packages/python/src/kweaver/cli/main.py:26`：
```python
cli.add_command(kn_group, "bkn")
```
改为：
```python
cli.add_command(kn_group, "kn")
```

- [ ] **Step 2: 批量更新 test_cli.py 中所有 `"bkn"` → `"kn"`**

需替换的调用（runner.invoke 中）：
- `["bkn", "list"...]` → `["kn", "list"...]`
- `["bkn", "get"...]` → `["kn", "get"...]`
- `["bkn", "export"...]` → `["kn", "export"...]`
- `["bkn", "build"...]` → `["kn", "build"...]`
- `["bkn", "delete"...]` → `["kn", "delete"...]`
- `["bkn", "stats"...]` → `["kn", "stats"...]`
- `["bkn", "update"...]` → `["kn", "update"...]`
- `["bkn", "create"...]` → `["kn", "create"...]`
- `["bkn", "action-log"...]` → `["kn", "action-log"...]`
- `test_cli_help` 中 `assert "bkn" in result.output` → `assert "kn" in result.output`

- [ ] **Step 3: 运行 CLI 相关测试确认通过**

```bash
cd /Users/xupeng/dev/github/kweaver-sdk/packages/python
uv run pytest tests/unit/test_cli.py -q
```

预期：全部通过

- [ ] **Step 4: 提交**

```bash
cd /Users/xupeng/dev/github/kweaver-sdk
git add packages/python/src/kweaver/cli/main.py packages/python/tests/unit/test_cli.py
git commit -m "fix(cli): rename Python CLI kn command from 'bkn' to 'kn' for consistency"
```

---

## Chunk 2: 覆盖率恢复

### Task 3: 恢复覆盖率阈值至 75%

**问题：** `packages/python/pyproject.toml` 的 `fail_under` 从 75 降至 60。
先跑覆盖报告确认当前实际覆盖率，再决定是否需要补充测试。

**Files:**
- Modify: `packages/python/pyproject.toml`（阈值）

- [ ] **Step 1: 运行覆盖报告，查看实际数值**

```bash
cd /Users/xupeng/dev/github/kweaver-sdk/packages/python
uv run pytest tests/unit/ \
  --cov=src/kweaver \
  --cov-report=term-missing \
  -q 2>&1 | tail -20
```

记录实际总覆盖率。

- [ ] **Step 2: 根据实际覆盖率决定路径**

- 如果 ≥ 75%：直接将 `fail_under` 改回 75，完成。
- 如果 65–74%：补充少量测试（见 Step 3），再改阈值。
- 如果 < 65%：先改阈值到实际值+2，记录剩余缺口供后续处理。

- [ ] **Step 3（按需）: 补充缺失覆盖 — `_http.py` retry 路径**

`_http.py` 的 retry 逻辑（500 重试、网络错误重试）缺少覆盖。
在 `tests/unit/test_errors.py` 或新建 `tests/unit/test_http.py` 中添加：

```python
# tests/unit/test_http.py
import httpx
import pytest
from kweaver._http import HttpClient
from kweaver._auth import TokenAuth
from kweaver._errors import NetworkError, ServerError

def _make_client(handler, fail_count=0):
    call_count = {"n": 0}
    def counting_handler(req):
        call_count["n"] += 1
        return handler(req, call_count["n"])
    transport = httpx.MockTransport(counting_handler)
    return HttpClient(
        base_url="https://mock",
        auth=TokenAuth("tok"),
        transport=transport,
    ), call_count

def test_retry_on_500_then_success():
    """Should retry on 500 and succeed on 3rd attempt."""
    def handler(req, n):
        if n < 3:
            return httpx.Response(500, json={"error": "server busy"})
        return httpx.Response(200, json={"ok": True})
    client, call_count = _make_client(handler)
    result = client.get("/api/test")
    assert result == {"ok": True}
    assert call_count["n"] == 3

def test_no_retry_on_post():
    """POST should not retry (retry=False by default)."""
    call_count = {"n": 0}
    def handler(req):
        call_count["n"] += 1
        return httpx.Response(500, json={"error": "fail"})
    transport = httpx.MockTransport(handler)
    client = HttpClient(base_url="https://mock", auth=TokenAuth("tok"), transport=transport)
    with pytest.raises(ServerError):
        client.post("/api/test", json={"x": 1})
    assert call_count["n"] == 1

def test_network_error_raises_network_error():
    """httpx.HTTPError should be wrapped as NetworkError."""
    def handler(req):
        raise httpx.ConnectError("unreachable")
    transport = httpx.MockTransport(handler)
    client = HttpClient(base_url="https://mock", auth=TokenAuth("tok"), transport=transport)
    with pytest.raises(NetworkError):
        client.get("/api/test")
```

- [ ] **Step 4: 运行测试确认新测试通过**

```bash
cd /Users/xupeng/dev/github/kweaver-sdk/packages/python
uv run pytest tests/unit/ --cov=src/kweaver --cov-report=term-missing -q 2>&1 | tail -5
```

- [ ] **Step 5: 将 `fail_under` 改为 75（或实际可达值）**

修改 `packages/python/pyproject.toml`：
```toml
[tool.coverage.report]
fail_under = 75   # 从 60 恢复
```

- [ ] **Step 6: 确认覆盖率检查通过**

```bash
cd /Users/xupeng/dev/github/kweaver-sdk/packages/python
uv run pytest tests/unit/ --cov=src/kweaver --cov-fail-under=75 -q 2>&1 | tail -3
```

预期：`Required test coverage of 75% reached.` 或 `passed`

- [ ] **Step 7: 提交**

```bash
cd /Users/xupeng/dev/github/kweaver-sdk
git add packages/python/pyproject.toml packages/python/tests/unit/
git commit -m "test: restore coverage threshold to 75%, add http retry unit tests"
```

---

## Chunk 3: 清理与元数据

### Task 4: 清理根目录残留 `__pycache__` 及更新 package 元数据

**Files:**
- Delete: `/src/` 目录（仅含 `__pycache__`，无 `.py` 文件）
- Delete: `/tests/` 目录（仅含 `__pycache__`，无 `.py` 文件）
- Modify: `package.json`（根目录）
- Modify: `packages/typescript/package.json`（repo URL）

- [ ] **Step 1: 验证根目录 src/ 只含 __pycache__（无 .py 文件）**

```bash
find /Users/xupeng/dev/github/kweaver-sdk/src -name "*.py" 2>/dev/null | wc -l
find /Users/xupeng/dev/github/kweaver-sdk/tests -name "*.py" 2>/dev/null | wc -l
```

预期：均为 0。若非 0，停止并人工确认后再删除。

- [ ] **Step 2: 删除根目录残留目录**

```bash
rm -rf /Users/xupeng/dev/github/kweaver-sdk/src
rm -rf /Users/xupeng/dev/github/kweaver-sdk/tests
```

- [ ] **Step 3: 更新根目录 package.json 描述和版本**

将：
```json
{
  "name": "kweaver-sdk",
  "version": "0.5.0",
  "description": "KWeaver/ADP Python SDK — Agent skills for knowledge network construction, querying, and Decision Agent conversations.",
```
改为：
```json
{
  "name": "kweaver-sdk",
  "version": "0.6.0",
  "description": "KWeaver SDK monorepo — Python SDK + TypeScript CLI + Claude skills",
```

- [ ] **Step 4: 修复 TypeScript package.json 仓库 URL**

将 `packages/typescript/package.json` 中：
```json
"url": "git+https://github.com/sh00tg0a1/kweaver-caller.git"
```
改为：
```json
"url": "git+https://github.com/kweaver-ai/kweaver-sdk.git"
```

- [ ] **Step 5: 验证 Python 测试不受影响**

```bash
cd /Users/xupeng/dev/github/kweaver-sdk/packages/python
uv run pytest tests/unit/ -q 2>&1 | tail -5
```

- [ ] **Step 6: 提交**

```bash
cd /Users/xupeng/dev/github/kweaver-sdk
git add -A
git commit -m "chore: remove stale root src/tests cache dirs, update package metadata and repo URLs"
```

---

### Task 5: 更新 skill 文档以反映 Python CLI 命令名变更

**Files:**
- Modify: `skills/kweaver-core/references/bkn.md`

- [ ] **Step 1: 在 bkn.md 头部添加 Python vs TypeScript 说明**

在文件第一行 `# 知识网络管理与查询` 后添加：

```markdown
> **命令名说明：** TypeScript CLI 使用 `kweaver bkn …`，Python CLI 使用 `kweaver kn …`。
> 本文档以 TypeScript CLI 为主（`bkn`）；Python 用户将所有 `bkn` 替换为 `kn` 即可。
```

- [ ] **Step 2: 更新"典型编排"部分 Python 独有说明**

在 `### Python 独有：数据源与高层查询` 下方 `ds connect/list/get/tables` 前加注：

```markdown
> Python CLI 使用 `kweaver kn create/build/list/get/export …`（对应 TypeScript 的 `bkn`）
```

- [ ] **Step 3: 提交**

```bash
cd /Users/xupeng/dev/github/kweaver-sdk
git add skills/kweaver-core/references/bkn.md
git commit -m "docs(skills): note Python CLI uses 'kn' command vs TypeScript 'bkn'"
```

---

## 最终回归验证

- [ ] **Step 1: 运行完整 Python 单元测试套件**

```bash
cd /Users/xupeng/dev/github/kweaver-sdk/packages/python
uv run pytest tests/unit/ -v 2>&1 | tail -20
```

预期：全部 PASSED，覆盖率 ≥ 75%

- [ ] **Step 2: 运行 TypeScript 测试套件**

```bash
cd /Users/xupeng/dev/github/kweaver-sdk/packages/typescript
node --import tsx --test test/*.test.ts 2>&1 | tail -10
```

预期：全部通过

- [ ] **Step 3: 验证 Python CLI help 正确显示 kn 命令**

```bash
cd /Users/xupeng/dev/github/kweaver-sdk/packages/python
uv run python -m kweaver.cli.main --help 2>&1 | grep -E "^  (kn|bkn|auth|ds|query)"
```

预期：看到 `kn`，不看到 `bkn`

- [ ] **Step 4: 运行根 Makefile test-equiv 目标（双端）**

```bash
cd /Users/xupeng/dev/github/kweaver-sdk
make test-equiv 2>&1 | tail -5
```

预期：`Test equivalence: Python and TypeScript suites both passed`
