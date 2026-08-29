"""
mini-tools/vod-grants-analyzer/analyze_vod_grants_helper.py

Helper module to load and compact raw order rows for the Orders Explorer
"""

import os
import glob
import csv
import zipfile
import xml.etree.ElementTree as ET

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(BASE_DIR, "../.."))
VOD_DIR = os.path.join(PROJECT_ROOT, "tmp/ILC VOD purchases")

def load_raw_records_compact():
    records = []

    # 1. WooCommerce
    wp_path = os.path.join(VOD_DIR, "ILC Wordpress sales.csv")
    if os.path.exists(wp_path):
        with open(wp_path, "r", encoding="utf-8", errors="replace") as f:
            reader = csv.DictReader(f)
            for row in reader:
                email = (row.get("Email") or "").strip().lower()
                if not email or "@" not in email:
                    continue
                item_name = (row.get("Item Name") or "").strip()
                date = (row.get("Date") or "").strip()
                order_id = (row.get("Order ID") or "").strip()
                first_name = (row.get("First Name") or "").strip()
                last_name = (row.get("Last Name") or "").strip()
                name = f"{first_name} {last_name}".strip()
                cost = (row.get("Total Cost") or row.get("Item Cost") or "0").strip()

                cat = "other"
                item_low = item_name.lower()
                if "video library subscriber" in item_low:
                    cat = "subscription"
                elif "shaolin i-jing" in item_low or "nei gong" in item_low or "moscow" in item_low or "meditation" in item_low:
                    cat = "unmigrated_video"
                elif any(w in item_low for w in ["mp4", "dvd", "video", "form", "hands", "fajing", "fajin", "contact", "chi kung", "refinement", "retreat", "meet", "rotation", "sparring"]):
                    cat = "vod_purchase"
                else:
                    cat = "non_video"

                records.append({
                    "id": order_id,
                    "email": email,
                    "name": name,
                    "item": item_name,
                    "cat": cat,
                    "date": date[:10] if len(date) >= 10 else date,
                    "amount": cost,
                    "source_file": "ILC Wordpress sales.csv",
                })

    # 2. VIP XLSX
    xlsx_path = os.path.join(VOD_DIR, "VIP_Customer_Access_List.xlsx")
    if os.path.exists(xlsx_path):
        def parse_sheet(sheet_idx):
            with zipfile.ZipFile(xlsx_path) as z:
                shared_strings = []
                if "xl/sharedStrings.xml" in z.namelist():
                    tree = ET.fromstring(z.read("xl/sharedStrings.xml"))
                    ns = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
                    for si in tree.findall(f"{ns}si"):
                        t = si.find(f"{ns}t")
                        if t is not None and t.text:
                            shared_strings.append(t.text)
                        else:
                            parts = [elem.text for elem in si.findall(f".//{ns}t") if elem.text]
                            shared_strings.append("".join(parts))
                
                sheet_path = f"xl/worksheets/sheet{sheet_idx}.xml"
                rows_data = []
                if sheet_path in z.namelist():
                    stree = ET.fromstring(z.read(sheet_path))
                    ns = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
                    for r in stree.findall(f".//{ns}row"):
                        row_map = {}
                        for c in r.findall(f"{ns}c"):
                            t_attr = c.attrib.get("t")
                            v_el = c.find(f"{ns}v")
                            is_el = c.find(f"{ns}is")
                            val = ""
                            if is_el is not None:
                                t_sub = is_el.find(f"{ns}t")
                                if t_sub is not None: val = t_sub.text or ""
                            elif v_el is not None and v_el.text is not None:
                                val = v_el.text
                                if t_attr == "s":
                                    try: val = shared_strings[int(val)]
                                    except: pass
                            col = "".join([ch for ch in c.attrib.get("r") if ch.isalpha()])
                            row_map[col] = val
                        rows_data.append(row_map)
                return rows_data

        # Sheet 2: Main List
        for r in parse_sheet(2)[1:]:
            title = (r.get("A") or "").strip()
            email = (r.get("B") or "").strip().lower()
            name = (r.get("C") or "").strip()
            date = (r.get("D") or "").strip()
            if email and "@" in email and title:
                records.append({
                    "id": "",
                    "email": email,
                    "name": name,
                    "item": title,
                    "cat": "vod_purchase",
                    "date": date[:10] if len(date) >= 10 else date,
                    "amount": "",
                    "source_file": "VIP_Customer_Access_List.xlsx (Main)",
                })

        # Sheet 3: Subscriptions
        for r in parse_sheet(3)[1:]:
            email = (r.get("A") or "").strip().lower()
            name = (r.get("B") or "").strip()
            date = (r.get("C") or "").strip()
            if email and "@" in email:
                records.append({
                    "id": "",
                    "email": email,
                    "name": name,
                    "item": "Video Library Subscriber",
                    "cat": "subscription",
                    "date": date[:10] if len(date) >= 10 else date,
                    "amount": "",
                    "source_file": "VIP_Customer_Access_List.xlsx (Subs)",
                })

        # Sheet 4: DVD Purchases
        for r in parse_sheet(4)[1:]:
            title = (r.get("A") or "").strip()
            email = (r.get("B") or "").strip().lower()
            name = (r.get("C") or "").strip()
            date = (r.get("D") or "").strip()
            if email and "@" in email and title:
                records.append({
                    "id": "",
                    "email": email,
                    "name": name,
                    "item": title,
                    "cat": "vod_purchase",
                    "date": date[:10] if len(date) >= 10 else date,
                    "amount": "",
                    "source_file": "VIP_Customer_Access_List.xlsx (DVDs)",
                })

        # Sheet 6: Titles Not On OTT
        for r in parse_sheet(6)[1:]:
            title = (r.get("A") or "").strip()
            email = (r.get("B") or "").strip().lower()
            name = (r.get("C") or "").strip()
            date = (r.get("D") or "").strip()
            if email and "@" in email and title and "Summary:" not in title:
                records.append({
                    "id": "",
                    "email": email,
                    "name": name,
                    "item": title,
                    "cat": "unmigrated_video",
                    "date": date[:10] if len(date) >= 10 else date,
                    "amount": "",
                    "source_file": "VIP_Customer_Access_List.xlsx (Not On OTT)",
                })

    # 3. Gmail files
    for gf in ["gmail_early_customers.csv", "gmail_template_emails.csv"]:
        gp = os.path.join(VOD_DIR, gf)
        if os.path.exists(gp):
            with open(gp, "r", encoding="utf-8") as f:
                for r in csv.DictReader(f):
                    title = (r.get("title") or "").strip()
                    email = (r.get("email") or "").strip().lower()
                    date = (r.get("date_sent") or "").strip()
                    if email and "@" in email and title:
                        records.append({
                            "id": "",
                            "email": email,
                            "name": "",
                            "item": title,
                            "cat": "vod_purchase",
                            "date": date[:10] if len(date) >= 10 else date,
                            "amount": "",
                            "source_file": gf,
                        })

    # 4. Event CSV exports
    for ef in sorted(glob.glob(os.path.join(VOD_DIR, "*-export*.csv"))):
        fname = os.path.basename(ef)
        with open(ef, "r", encoding="utf-8", errors="replace") as f:
            lines = [l.strip() for l in f if l.strip()]
            header_idx = next((i for i, l in enumerate(lines[:10]) if "Name,Status" in l or "Ticket Name" in l), -1)
            if header_idx != -1:
                for r in csv.DictReader(lines[header_idx:]):
                    email = (r.get("E-mail") or r.get("Email") or "").strip().lower()
                    name = (r.get("Name") or "").strip()
                    status = (r.get("Status") or "").strip()
                    ticket = (r.get("Ticket Name") or "").strip()
                    paid = (r.get("Total Paid") or r.get("Total") or "").strip()
                    if email and "@" in email and status == "Approved":
                        records.append({
                            "id": "",
                            "email": email,
                            "name": name,
                            "item": f"{fname} ({ticket})",
                            "cat": "vod_purchase",
                            "date": "",
                            "amount": paid,
                            "source_file": fname,
                        })

    return records
