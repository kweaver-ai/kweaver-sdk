#!/usr/bin/env python3
"""给企业表加 is_listed 字段（来自 company_rel.is_trading_stock）。"""
import csv
import sys
from pathlib import Path

def main(enterprise_file: str, rel_file: str, output_dir: str, financial_file: str = None):
    Path(output_dir).mkdir(parents=True, exist_ok=True)

    # 层1：从 company_rel is_trading_llm / is_trading_stock 标记上市
    listed = {}
    with open(rel_file, encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            code = row.get("comcode", "").strip().rstrip(".0")
            val_llm   = row.get("is_trading_llm", "").strip()
            val_stock = row.get("is_trading_stock", "").strip()
            if code:
                is_l = (val_llm in ("是", "Yes")) or \
                       (val_stock not in ("", "nan", "否", "0", "false", "False") and bool(val_stock))
                listed[code] = listed.get(code, False) or is_l

    # 层2：financial.csv 中有记录 → 大概率上市公司
    if financial_file:
        with open(financial_file, encoding="utf-8-sig") as f:
            for row in csv.DictReader(f):
                code = row.get("comcode", "").strip()
                if code:
                    listed[code] = True

    with open(enterprise_file, encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        fieldnames = list(reader.fieldnames) + ["is_listed"]
        rows = list(reader)

    with open(f"{output_dir}/enterprise_enriched.csv", "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for row in rows:
            code = row.get("comcode", "").strip()
            row["is_listed"] = "true" if listed.get(code, False) else "false"
            w.writerow(row)

    listed_count = sum(1 for v in listed.values() if v)
    print(f"✓ enterprise_enriched.csv: {len(rows)} rows, {listed_count} companies marked listed")

if __name__ == "__main__":
    base = "/Users/xupeng/lab/ht/data/final"
    out  = sys.argv[1] if len(sys.argv) > 1 else "/Users/xupeng/lab/ht/data/processed/v1"
    main(f"{base}/enterprise.csv", f"{base}/company_rel.csv", out, f"{base}/financial.csv")
