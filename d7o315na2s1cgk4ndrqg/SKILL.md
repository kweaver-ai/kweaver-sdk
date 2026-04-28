# ht_adas_v1 - Agent 使用指南

> **网络ID**: d7o315na2s1cgk4ndrqg  
> **版本**:   

## 网络概览

### 核心对象

| 对象 | 文件路径 | 说明 |
|------|----------|------|
| ht_v1_vehicle | `object_types/d7o315na2s1cgk4ndrrg.bkn` |  |
| ht_v1_supplies_to | `object_types/d7o315na2s1cgk4ndrsg.bkn` |  |
| ht_v1_supplier | `object_types/d7o315na2s1cgk4ndrtg.bkn` |  |
| ht_v1_partners_with | `object_types/d7o315na2s1cgk4ndrug.bkn` |  |
| ht_v1_invests_in | `object_types/d7o315na2s1cgk4ndrvg.bkn` |  |
| ht_v1_industry_node | `object_types/d7o315na2s1cgk4nds0g.bkn` |  |
| ht_v1_enterprise_enriched | `object_types/d7o315na2s1cgk4nds1g.bkn` |  |
| ht_v1_competes_with | `object_types/d7o315na2s1cgk4nds2g.bkn` |  |
| ht_v1_company_node | `object_types/d7o315na2s1cgk4nds3g.bkn` |  |
| ht_v1_company_latest_fin | `object_types/d7o315na2s1cgk4nds4g.bkn` |  |

### 核心关系

| 关系 | 文件路径 | 说明 |
|------|----------|------|
| has_parent | `relation_types/d7o33f7a2s1cgk4ndsbg.bkn` |  |
| has_financial | `relation_types/d7o33f7a2s1cgk4ndscg.bkn` |  |
| company_in_node | `relation_types/d7o33f7a2s1cgk4ndsdg.bkn` |  |
| node_belongs_to | `relation_types/d7o33f7a2s1cgk4ndseg.bkn` |  |
| supplier_company | `relation_types/d7o33f7a2s1cgk4ndsfg.bkn` |  |
| buyer_company | `relation_types/d7o33ffa2s1cgk4ndsgg.bkn` |  |
| competitor_a | `relation_types/d7o33ffa2s1cgk4ndshg.bkn` |  |
| competitor_b | `relation_types/d7o33ffa2s1cgk4ndsig.bkn` |  |
| investor_company | `relation_types/d7o33ffa2s1cgk4ndsjg.bkn` |  |
| investee_company | `relation_types/d7o33ffa2s1cgk4ndskg.bkn` |  |
| partner_source | `relation_types/d7o33fna2s1cgk4ndslg.bkn` |  |
| partner_target | `relation_types/d7o33fna2s1cgk4ndsmg.bkn` |  |

## 目录结构

```
.
├── network.bkn
├── SKILL.md
├── CHECKSUM
├── object_types/
├── relation_types/
```

## 使用建议

### 查询场景

1. **获取所有对象定义**
   - 查看 `object_types/` 目录下的文件

2. **查找关系定义**
   - 查看 `relation_types/` 目录下的文件

## 索引表

### 按类型索引

- **对象定义**: `object_types/`
- **关系定义**: `relation_types/`

## 注意事项

1. 本网络由 BKN SDK 自动生成 SKILL.md
2. 所有定义遵循 BKN 规范
3. 使用 CHECKSUM 文件验证网络完整性
