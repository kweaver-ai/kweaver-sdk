#!/usr/bin/env python3
"""每家公司只保留 enddate 最新的一条财务记录。"""
import csv
import sys
from pathlib import Path

def main(input_file: str, output_dir: str):
    Path(output_dir).mkdir(parents=True, exist_ok=True)

    latest = {}
    with open(input_file, encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames
        for row in reader:
            code = row.get("comcode", "").strip()
            dt   = row.get("enddate", "").strip()
            if code and (code not in latest or dt > latest[code]["enddate"]):
                latest[code] = dict(row)

    with open(f"{output_dir}/company_latest_fin.csv", "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        w.writerows(latest.values())

    print(f"✓ company_latest_fin.csv: {len(latest)} rows")

if __name__ == "__main__":
    src = sys.argv[1] if len(sys.argv) > 1 else "/Users/xupeng/lab/ht/data/final/financial.csv"
    out = sys.argv[2] if len(sys.argv) > 2 else "/Users/xupeng/lab/ht/data/processed/v1"
    main(src, out)
