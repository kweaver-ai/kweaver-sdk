# Skill 命令参考

ADP/KWeaver Skill 资源域：注册、市场查找、渐进式读取、下载与本地安装。

与 CLI 一致：运行 `kweaver skill --help` 或 `kweaver skill <subcommand> --help` 查看当前版本同步的参数。

## 常用命令

```bash
kweaver skill list [--name <kw>] [--status unpublish|published|offline] [--page-size 30]
kweaver skill market [--name <kw>] [--source <src>] [--page-size 30]
kweaver skill get <skill_id>
kweaver skill register --content-file <path> [--source <src>] [--extend-info '{"tag":"demo"}']
kweaver skill market-get <skill_id>
kweaver skill register --zip-file <skill.zip> [--source <src>] [--extend-info '{"tag":"demo"}']
kweaver skill status <skill_id> <unpublish|published|offline>
kweaver skill delete <skill_id> [-y]
```

## 编辑与历史

```bash
# Update draft metadata
kweaver skill update-metadata <skill_id> \
  --name "Demo" \
  --description "Demo skill" \
  --category system \
  --source internal \
  --extend-info '{"owner":"sdk"}'

# Replace draft package from SKILL.md or ZIP
kweaver skill update-package <skill_id> --content-file ./SKILL.md
kweaver skill update-package <skill_id> --zip-file ./demo-skill.zip

# Inspect release history and restore one version
kweaver skill history <skill_id>
kweaver skill republish <skill_id> --version v1.0.0
kweaver skill publish-history <skill_id> --version v1.0.0
```

## 渐进式读取

```bash
# Read the content index only (download URL + file manifest)
kweaver skill content <skill_id>

# Fetch and print SKILL.md body
kweaver skill content <skill_id> --raw

# Save SKILL.md locally
kweaver skill content <skill_id> --output ./SKILL.md

# Read one file entry
kweaver skill read-file <skill_id> references/guide.md

# Fetch file bytes and save locally
kweaver skill read-file <skill_id> references/guide.md --output ./guide.md
```

## 下载与安装

```bash
# Download the ZIP archive
kweaver skill download <skill_id> --output ./demo-skill.zip

# Install to a local folder (extract ZIP)
kweaver skill install <skill_id> ./skills/demo-skill

# Replace an existing non-empty directory
kweaver skill install <skill_id> ./skills/demo-skill --force
```

## 说明

- `list` 与 `market` 默认每页 30 条，`--page-size` / `--limit` 可覆盖
- `content` / `read-file` 默认返回索引元数据；加 `--raw` 或 `--output` 才会真正抓取远端内容
- `register --content-file` 支持上传单个 `SKILL.md`，也支持指定包含 `SKILL.md` 的目录（会自动打包为 ZIP）；`register --zip-file` 适合上传已构建好的 `.zip` 压缩包
- `update-metadata` / `update-package` 更新的是当前草稿态；历史版本恢复可用 `republish` / `publish-history`
- `install` 本质是 `download + unzip` 的本地便捷封装
