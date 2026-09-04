# VOD Purchase Matching & Grant Analyzer

A standalone data analysis and matching toolkit for turning historical video purchases into structured Video on Demand (VOD) grants in the ILC Members Manager.

All scripting and output files in this folder are completely isolated from the main application codebase.

---

## Quick Start

```bash
# 1. Download/Refresh current videos catalog & member database from Firestore:
node mini-tools/vod-grants-analyzer/download-vod-library.js

# 2. Parse purchases, match to VOD catalog, and generate grant tables:
python3 mini-tools/vod-grants-analyzer/analyze-vod-grants.py

# 3. Run the strict accounting and integrity validation suite:
python3 mini-tools/vod-grants-analyzer/validate-accounting.py

# 4. (Optional) Rebuild the markdown report:
python3 mini-tools/vod-grants-analyzer/generate-report.py

# 5. Build and launch the interactive web application:
python3 mini-tools/vod-grants-analyzer/build-web-app.py
node mini-tools/vod-grants-analyzer/serve.js   # Open http://localhost:3333

# 6. Apply grants to Firestore (Idempotent, supports single user & dry-run):
# Dry run preview for a single user:
node mini-tools/vod-grants-analyzer/apply-vod-grants.js --email lucas.dixon@gmail.com --dry-run

# Live write for a single user:
node mini-tools/vod-grants-analyzer/apply-vod-grants.js --email lucas.dixon@gmail.com

# Live write for all registered members:
node mini-tools/vod-grants-analyzer/apply-vod-grants.js
```

---

## Directory Structure

```
mini-tools/vod-grants-analyzer/
├── README.md                      # Documentation and usage guide
├── download-vod-library.js        # Downloads /videos and /members from Firestore
├── analyze-vod-grants.py          # Main matching & grant generation engine
├── validate-accounting.py         # 6-point strict validation & row conservation suite
├── generate-report.py             # Generates markdown analysis report
├── build-web-app.py               # Compiles payload for the interactive web app
├── index.html                     # Single-page web app for exploring orders & grants
├── app.js                         # Web app interactive logic & CSV exporter
├── styles.css                     # Web app stylesheet
├── serve.js                       # Local static HTTP server for the web app
├── data/                          # Downloaded Firestore data cache
│   ├── videos.json                # All 597 videos from Firestore /videos
│   └── members.json               # Member profiles from Firestore /members
└── output/                        # Generated analysis and grant tables
    ├── grants-table.csv           # 2,835 individual video grants (ready for import)
    ├── grants-table.json          # JSON representation of individual video grants
    ├── series-grants-table.csv    # 1,630 series-level grants grouped by customer
    ├── skipped-subscriptions.csv  # 167 Class Video Library subscriptions (skipped/expired)
    ├── unmigrated-titles.csv      # 372 purchases of titles not yet in OTT catalog
    ├── summary-metrics.json       # Machine-readable summary statistics
    ├── validation-results.json    # Machine-readable validation results
    └── ANALYSIS_REPORT.md         # Comprehensive markdown analysis report
```

---

## Input Data Sources

The analyzer ingests all files from `tmp/ILC VOD purchases/`:
- `ILC Wordpress sales.csv`: WooCommerce order history (2018–2026).
- `VIP_Customer_Access_List.xlsx`: Curated VIP access lists across all sheets (Main List, Subscriptions, DVD Purchases, Titles Not on OTT).
- `gmail_early_customers.csv`: Early customer access links from Gmail.
- `gmail_template_emails.csv`: Templated VIP access delivery emails from Gmail.
- `*-export*.csv`: 12 Event export CSV files with approved attendee lists for specific workshop recordings.

---

## Output Data Schemas

### `output/grants-table.csv`
The definitive grant table ready for backfill or granting into `/members/{memberDocId}/videoGrants/{videoId}`:
- `email`: Customer email address.
- `customerName`: Full name snapshot.
- `isRegisteredMember`: Boolean indicating if an account already exists in Firestore `/members`.
- `memberDocId`: Document ID in `/members` (if registered).
- `memberId`: Official Member ID e.g. `US402` (if registered).
- `studentLevel`: Member grading level (if registered).
- `videoId`: Target Firestore video document ID (e.g. `vimeo_123811999`).
- `videoTitle`: Video title in Firestore catalog.
- `seriesTitle`: Parent VOD series title.
- `grantKind`: `admin_grant`.
- `sources_str`: Provenance tracking all source files where this purchase was recorded.
- `firstPurchaseDate`: Earliest recorded transaction date.
- `lastPurchaseDate`: Most recent recorded transaction date.
