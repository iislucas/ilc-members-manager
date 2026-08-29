"""
mini-tools/vod-grants-analyzer/build-web-app.py

Builds a self-contained, interactive single-page web application in
mini-tools/vod-grants-analyzer/index.html to explore:
  - Dashboard & statistics
  - All 10,564 historical orders / purchase records
  - All 2,835 deduplicated video grants
  - All 1,630 series grants
  - All 45 VOD library series & coverage
  - Legacy / unmigrated titles
  - Validation & accounting suite
"""

import os
import json
import csv
import glob

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_DIR = os.path.join(BASE_DIR, "output")
DATA_DIR = os.path.join(BASE_DIR, "data")
PROJECT_ROOT = os.path.abspath(os.path.join(BASE_DIR, "../.."))
VOD_DIR = os.path.join(PROJECT_ROOT, "tmp/ILC VOD purchases")

print("Generating web app data payload...")

# Load datasets
with open(os.path.join(OUTPUT_DIR, "summary-metrics.json"), "r", encoding="utf-8") as f:
    summary_metrics = json.load(f)

with open(os.path.join(OUTPUT_DIR, "validation-results.json"), "r", encoding="utf-8") as f:
    validation_results = json.load(f)

with open(os.path.join(OUTPUT_DIR, "grants-table.json"), "r", encoding="utf-8") as f:
    grants_table = json.load(f)

with open(os.path.join(DATA_DIR, "videos.json"), "r", encoding="utf-8") as f:
    videos_catalog = json.load(f)

# Load series grants from CSV
series_grants = []
with open(os.path.join(OUTPUT_DIR, "series-grants-table.csv"), "r", encoding="utf-8") as f:
    series_grants = list(csv.DictReader(f))

# Load unmigrated from CSV
unmigrated_titles = []
with open(os.path.join(OUTPUT_DIR, "unmigrated-titles.csv"), "r", encoding="utf-8") as f:
    unmigrated_titles = list(csv.DictReader(f))

# Load skipped subscriptions
skipped_subs = []
with open(os.path.join(OUTPUT_DIR, "skipped-subscriptions.csv"), "r", encoding="utf-8") as f:
    skipped_subs = list(csv.DictReader(f))

# Collect sample / all raw records for the Orders Explorer (compacted for performance)
# Import parse logic from analyze-vod-grants.py
from analyze_vod_grants_helper import load_raw_records_compact

raw_records_compact = load_raw_records_compact()

# Calculate stats for timeline and top customers
timeline_stats = {}
customer_stats = {}
channel_stats = {}

for r in raw_records_compact:
    # Year stats
    dt = r.get("date", "")
    year = dt[:4] if len(dt) >= 4 and dt[:4].isdigit() else "Unknown"
    timeline_stats[year] = timeline_stats.get(year, 0) + 1

    # Channel stats
    src = r.get("source_file", "Other")
    channel_stats[src] = channel_stats.get(src, 0) + 1

for g in grants_table:
    em = g["email"]
    name = g.get("customerName") or em
    if em not in customer_stats:
        customer_stats[em] = {
            "email": em,
            "name": name,
            "isRegistered": g["isRegisteredMember"],
            "memberId": g.get("memberId", ""),
            "grantCount": 0,
            "series": set(),
        }
    customer_stats[em]["grantCount"] += 1
    customer_stats[em]["series"].add(g["seriesTitle"])

top_customers = []
for em, c in sorted(customer_stats.items(), key=lambda x: x[1]["grantCount"], reverse=True)[:50]:
    top_customers.append({
        "email": c["email"],
        "name": c["name"],
        "isRegistered": c["isRegistered"],
        "memberId": c["memberId"],
        "grantCount": c["grantCount"],
        "seriesCount": len(c["series"]),
    })

web_payload = {
    "summaryMetrics": summary_metrics,
    "validationResults": validation_results,
    "timelineStats": timeline_stats,
    "channelStats": channel_stats,
    "topCustomers": top_customers,
    "grants": grants_table,
    "seriesGrants": series_grants,
    "unmigrated": unmigrated_titles,
    "skippedSubs": skipped_subs,
    "rawOrders": raw_records_compact,
    "seriesBreakdown": summary_metrics["seriesBreakdown"],
}

print(f"Bundled {len(grants_table)} grants, {len(raw_records_compact)} orders, and {len(top_customers)} top customers into web payload.")

# Write data.js
data_js_path = os.path.join(BASE_DIR, "data.js")
with open(data_js_path, "w", encoding="utf-8") as f:
    f.write("window.APP_DATA = " + json.dumps(web_payload) + ";\n")

print(f"Wrote payload to {data_js_path}")
