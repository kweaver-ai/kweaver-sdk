#!/usr/bin/env python3
"""从 industry_graph.csv 提取唯一产业链节点，生成节点树和企业归属关系。"""
import csv
import hashlib
import sys
from pathlib import Path

LEVEL_COLS = [
    "产业链板块",
    "行业图谱节点（一级分类）",
    "行业图谱节点（二级分类）",
    "行业图谱节点（三级分类）",
    "行业图谱节点（四级分类）",
    "行业图谱节点（五级分类）",
    "行业图谱节点（六级分类）",
]

def node_id(full_path: str) -> str:
    return "node_" + hashlib.md5(full_path.encode()).hexdigest()[:10]

def main(input_file: str, output_dir: str, enterprise_file: str = None, rel_file: str = None):
    Path(output_dir).mkdir(parents=True, exist_ok=True)

    # 第一层：enterprise.csv 建名称→comcode 索引（简称 / 全称）
    name_to_comcode = {}
    if enterprise_file:
        with open(enterprise_file, encoding="utf-8-sig") as f:
            for row in csv.DictReader(f):
                code = row.get("comcode", "").strip()
                abbr = row.get("chinameabbr", "").strip()
                full = row.get("chiname", "").strip()
                if code:
                    if abbr:
                        name_to_comcode.setdefault(abbr, code)
                    if full:
                        name_to_comcode.setdefault(full, code)

    # 第二层：company_rel 补充（source 侧 comabbr / comname_std）
    if rel_file:
        with open(rel_file, encoding="utf-8-sig") as f:
            for row in csv.DictReader(f):
                code = row.get("comcode", "").strip().rstrip(".0")
                for field in ("comabbr", "comname_std", "comname"):
                    val = row.get(field, "").strip()
                    if val and code:
                        name_to_comcode.setdefault(val, code)
        # 第三层：target 侧（relation_comabbr / relation_comname）
        with open(rel_file, encoding="utf-8-sig") as f:
            for row in csv.DictReader(f):
                code = row.get("relation_comcode", "").strip().rstrip(".0")
                for field in ("relation_comabbr", "relation_comname"):
                    val = row.get(field, "").strip()
                    if val and code and val != "nan":
                        name_to_comcode.setdefault(val, code)

    nodes = {}        # full_path -> dict
    company_rows = [] # {comcode, node_id, company_name}

    with open(input_file, encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            sector = row.get("产业链板块", "").strip()
            if not sector or sector == "nan":
                continue

            path_parts = [sector]
            if sector not in nodes:
                nodes[sector] = {
                    "node_id": node_id(sector),
                    "name": sector,
                    "level": 0,
                    "sector": sector,
                    "parent_node_id": "",
                    "full_path": sector,
                }
            last_nid = nodes[sector]["node_id"]

            for lvl, col in enumerate(LEVEL_COLS[1:], 1):
                val = row.get(col, "").strip()
                if not val or val == "nan":
                    break
                path_parts.append(val)
                fp = "/".join(path_parts)
                if fp not in nodes:
                    parent_fp = "/".join(path_parts[:-1])
                    nodes[fp] = {
                        "node_id": node_id(fp),
                        "name": val,
                        "level": lvl,
                        "sector": sector,
                        "parent_node_id": nodes[parent_fp]["node_id"],
                        "full_path": fp,
                    }
                last_nid = nodes[fp]["node_id"]

            company_name = row.get("公司简称", "").strip()
            # 优先用公司代码，为空则通过名称查 enterprise
            comcode = row.get("公司代码", "").strip()
            if not comcode or comcode == "nan":
                comcode = name_to_comcode.get(company_name, "")
            if company_name:  # 有公司名就记录（comcode 可能为空）
                company_rows.append({
                    "comcode": comcode,
                    "node_id": last_nid,
                    "company_name": company_name,
                })

    # 写 industry_node.csv
    with open(f"{output_dir}/industry_node.csv", "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["node_id", "name", "level", "sector", "parent_node_id", "full_path"])
        w.writeheader()
        w.writerows(nodes.values())

    # 写 company_node.csv（去重：有 comcode 用 comcode+node_id，否则用 name+node_id）
    seen = set()
    cn_id = 0
    with open(f"{output_dir}/company_node.csv", "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["cn_id", "comcode", "node_id", "company_name"])
        w.writeheader()
        for r in company_rows:
            dedup_key = (r["comcode"] or r["company_name"], r["node_id"])
            if dedup_key not in seen:
                seen.add(dedup_key)
                cn_id += 1
                w.writerow({"cn_id": cn_id, **r})

    print(f"✓ industry_node.csv: {len(nodes)} nodes")
    print(f"✓ company_node.csv:  {len(seen)} links")

    # 抽样验证
    sample = list(nodes.values())[:3]
    for n in sample:
        print(f"  sample: {n['node_id']} | {n['name']} | level={n['level']} | parent={n['parent_node_id']}")

if __name__ == "__main__":
    src = sys.argv[1] if len(sys.argv) > 1 else "/Users/xupeng/lab/ht/data/final/industry_graph.csv"
    out = sys.argv[2] if len(sys.argv) > 2 else "/Users/xupeng/lab/ht/data/processed/v1"
    ent = sys.argv[3] if len(sys.argv) > 3 else "/Users/xupeng/lab/ht/data/final/enterprise.csv"
    rel = sys.argv[4] if len(sys.argv) > 4 else "/Users/xupeng/lab/ht/data/final/company_rel.csv"
    main(src, out, ent, rel)
