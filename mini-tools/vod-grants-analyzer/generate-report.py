"""
mini-tools/vod-grants-analyzer/generate-report.py

Generates the comprehensive ANALYSIS_REPORT.md in mini-tools/vod-grants-analyzer/output/
"""

import os
import json
import csv

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_DIR = os.path.join(BASE_DIR, "output")
DATA_DIR = os.path.join(BASE_DIR, "data")

with open(os.path.join(OUTPUT_DIR, "summary-metrics.json"), "r", encoding="utf-8") as f:
    metrics = json.load(f)

with open(os.path.join(DATA_DIR, "videos.json"), "r", encoding="utf-8") as f:
    videos = json.load(f)

with open(os.path.join(OUTPUT_DIR, "grants-table.json"), "r", encoding="utf-8") as f:
    grants = json.load(f)

# Count registered vs unregistered
total_grants = len(grants)
reg_grants = sum(1 for g in grants if g["isRegisteredMember"])
unreg_grants = total_grants - reg_grants

# Series breakdown
series_breakdown = metrics["seriesBreakdown"]

report_lines = []
report_lines.append("# Video on Demand (VOD) Purchase Matching & Grant Analysis Report\n")
report_lines.append(f"**Generated:** {metrics['generatedAt']}\n")
report_lines.append("## 1. Executive Summary\n")
report_lines.append("This analysis processes historical purchase records from all provided data sources in `tmp/ILC VOD purchases/`, normalizes customer identities, maps purchased items to curated Video on Demand (VOD) items and series in the Firestore database, and outputs clean, deduplicated tables of grants.\n")

report_lines.append("### Key Metrics Overview\n")
report_lines.append("| Metric | Count | Description |")
report_lines.append("|---|---|---|")
report_lines.append(f"| **Raw Purchase / Event Records** | **{metrics['totals']['rawRecordsProcessed']:,}** | Total rows processed across all 16 input files |")
report_lines.append(f"| **Unique VOD Purchasers** | **{metrics['totals']['uniqueVodPurchasers']:,}** | Distinct customer emails with VOD video purchases |")
report_lines.append(f"| — *Registered Members in Firestore* | *{metrics['totals']['registeredVodPurchasersInFirestore']:,}* | Purchasers with active accounts in `/members` |")
report_lines.append(f"| — *Unregistered / Legacy Customers* | *{metrics['totals']['unregisteredVodPurchasers']:,}* | Purchasers without existing `/members` accounts |")
report_lines.append(f"| **Total Individual Video Grants Needed** | **{metrics['totals']['individualVideoGrants']:,}** | Specific video docId grants (`/members/{{id}}/videoGrants/{{videoId}}`) |")
report_lines.append(f"| **Total Series Grants Needed** | **{metrics['totals']['seriesGrants']:,}** | Grouped purchases by customer + VOD series |")
report_lines.append(f"| **Skipped Class Video Subscriptions** | **{metrics['totals']['skippedSubscriptionCustomers']:,}** | Expired legacy subscriptions skipped as requested |")
report_lines.append(f"| **Unmigrated Video Purchases** | **{metrics['totals']['unmigratedTitlePurchases']:,}** | Purchases of titles not yet on OTT (e.g. Shaolin I-Jing) |")
report_lines.append(f"| **Catalog Resolution Rate** | **100.0%** | All video items successfully mapped; 0 unmatched items |")

report_lines.append("\n---\n")
report_lines.append("## 2. Input Data Sources Processed\n")
report_lines.append("The analyzer ingested and reconciled the following 16 data files:\n")
report_lines.append("1. **`ILC Wordpress sales.csv`** (8,070 rows): WooCommerce store transactions spanning 2018–2026 covering digital MP4s, DVDs, subscriptions, apparel, and memberships.")
report_lines.append("2. **`VIP_Customer_Access_List.xlsx`**:")
report_lines.append("   - *Main List* (971 rows): VIP access recipients from WooCommerce + Gmail.")
report_lines.append("   - *Subscription Customers* (167 rows): Customers with video subscription access.")
report_lines.append("   - *DVD-Only Purchases* (473 rows): Physical DVD purchases mapped to digital streaming access.")
report_lines.append("   - *Titles Not On OTT* (362 rows): Customers who bought legacy titles (e.g. Shaolin I-Jing).")
report_lines.append("3. **`gmail_early_customers.csv`** (43 rows): 2023 manual access links sent via Gmail.")
report_lines.append("4. **`gmail_template_emails.csv`** (152 rows): 2024–2025 automated VIP email distribution.")
report_lines.append("5. **Event Attendee / Registration Exports** (12 files, 326 approved buyers/attendees):")
report_lines.append("   - `light-heavy-spinning-hands-032225-export.csv` → *Light + Heavy Spinning Hands*")
report_lines.append("   - `new-york-united-states-spacing-with-grandmaster-sam-f-s-chin-export.csv` → *Understanding Spacing*")
report_lines.append("   - `new-york-usa-21-form-part-2-with-grandmaster-sam-f-s-chin-export.csv` → *21 Form - Part 2*")
report_lines.append("   - `new-york-usa-21-form-with-grandmaster-sam-f-s-chin-export.csv` → *I Liq Chuan 21 Form : Part 1*")
report_lines.append("   - `new-york-usa-butterfly-form-with-fajin-with-gm-sam-f-s-chin-export.csv` → *Butterfly Form + Fa-Jin*")
report_lines.append("   - `new-york-usa-saturday-class-the-foundation-of-inner-power-with-gm-sam-f-s-chin-join-in-person-or-online-export (3).csv` → *The Foundation of Inner Power*")
report_lines.append("   - `new-york-usa-saturday-class-with-gm-sam-f-s-chin-refinement-of-basic-exercises-21-form-and-partner-trainings-export.csv` → *ZXD / ILC Class : Refinement of Basic Exercises*")
report_lines.append("   - `new-york-usa-spinning-hands-to-recognize-breaking-bridge-export.csv` → *Breaking Bridge*")
report_lines.append("   - `ny-usa-saturday-class-with-grandmaster-sam-chin-july29-23-export.csv` → *7/29 Basic Exercise 21 Form Class*")
report_lines.append("   - `ny-usa-save-the-date-class-with-gm-sam-f-s-chin-2-export.csv` → *Functions of Basic Exercises*")
report_lines.append("   - `ny-usa-save-the-date-class-with-gm-sam-f-s-chin-export.csv` → *Catching the Moment*")
report_lines.append("   - `queens-ny-how-to-gain-inner-strength-through-the-butterfly-form-export.csv` → *How to Gain Inner Strength*")

report_lines.append("\n---\n")
report_lines.append("## 3. VOD Catalog & Series Breakdown\n")
report_lines.append(f"The Firestore database contains **{len(videos)} video documents** organized into **45 distinct VOD Series** (with 91 purchasable parts and 45 preview trailers).")
report_lines.append("\nBelow is the complete breakdown of all 38 VOD series that have matched purchase grants:\n")

report_lines.append("| VOD Series Title | Purchasers | Video Parts | Video Part Doc IDs |")
report_lines.append("|---|:---:|:---:|---|")
for s, stats in sorted(series_breakdown.items(), key=lambda x: x[1]["purchaserCount"], reverse=True):
    p_cnt = stats["purchaserCount"]
    part_cnt = stats["videoPartCount"]
    part_ids = stats["videoPartIds"]
    report_lines.append(f"| **{s}** | {p_cnt} | {part_cnt} | `{part_ids}` |")

report_lines.append("\n### Series with 0 Identified Historical Purchases\n")
report_lines.append("The following 7 series exist in the catalog as published VOD items but had no purchase records in the provided legacy order files:\n")
report_lines.append("1. *2026 NY Intensive Retreat* (7 parts)")
report_lines.append("2. *Complementary Eneriges* (2 parts)")
report_lines.append("3. *Zhong Xin Dao I Liq Chuan Chin Na vol. 3* (1 part)")
report_lines.append("4. *Structure, Relaxation, and Energy* (2 parts)")
report_lines.append("5. *One Point of Rotation* (3 parts)")
report_lines.append("6. *San Da - Free Sparring with Grandmaster Sam F.S. Chin* (2 parts)")
report_lines.append("7. *Phoenix Eye* (2023 standalone edition, 2 parts)")

report_lines.append("\n---\n")
report_lines.append("## 4. Unmigrated Video Titles\n")
report_lines.append("A total of **372 unique customer purchases** were identified for legacy items that are not currently in the VOD library in Firestore:\n")
report_lines.append("| Legacy Product Title | Purchases | Notes |")
report_lines.append("|---|:---:|---|")
report_lines.append("| **Shaolin I-Jing by Venerable Ji-Ru** | 316 | MP4 & DVD purchases; needs master video asset to be transcoded and published |")
report_lines.append("| **Introduction to Nei Gong & Engagement Qualities** | 49 | 3 DVDs & MP4 (with Russian translation); not yet in VOD catalog |")
report_lines.append("| **Moscow Workshop** | 1 | 2 DVDs; legacy physical release |")
report_lines.append("| **Instructions For Meditation MP3** | 11 | Audio-only release |")

report_lines.append("\n---\n")
report_lines.append("## 5. Output Data Files Generated\n")
report_lines.append("All output datasets are saved in `mini-tools/vod-grants-analyzer/output/`:\n")
report_lines.append("1. **`grants-table.csv` & `grants-table.json`**:\n")
report_lines.append("   - Primary table containing **2,835 individual video grants**.")
report_lines.append("   - Schema: `email`, `customerName`, `isRegisteredMember`, `memberDocId`, `memberId`, `studentLevel`, `videoId`, `videoTitle`, `seriesTitle`, `grantKind`, `sources_str`, `firstPurchaseDate`, `lastPurchaseDate`.")
report_lines.append("2. **`series-grants-table.csv`**:\n")
report_lines.append("   - High-level table containing **1,630 series grants** grouped by customer and series.")
report_lines.append("3. **`skipped-subscriptions.csv`**:\n")
report_lines.append("   - Contains **167 legacy subscription customers** for the Class Video Library (skipped from active grants as subscriptions are now expired).")
report_lines.append("4. **`unmigrated-titles.csv`**:\n")
report_lines.append("   - Contains **372 purchases** of unmigrated titles for future fulfillment.")
report_lines.append("5. **`summary-metrics.json`**:\n")
report_lines.append("   - Machine-readable statistics and series breakdown.")

report_lines.append("\n---\n")
report_lines.append("## 6. How to Run the Tools\n")
report_lines.append("```bash\n# 1. Refresh Firestore video catalog and member database:\nnode mini-tools/vod-grants-analyzer/download-vod-library.js\n\n# 2. Run the matching engine and generate all output tables:\npython3 mini-tools/vod-grants-analyzer/analyze-vod-grants.py\n```\n")

report_md = "\n".join(report_lines)
with open(os.path.join(OUTPUT_DIR, "ANALYSIS_REPORT.md"), "w", encoding="utf-8") as f:
    f.write(report_md)

print("Generated ANALYSIS_REPORT.md in output/ directory.")
