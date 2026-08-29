"""
mini-tools/vod-grants-analyzer/analyze-vod-grants.py

Comprehensive VOD Purchase Matching & Access Grant Analyzer

Parses all purchase records across:
  1. tmp/ILC VOD purchases/ILC Wordpress sales.csv
  2. tmp/ILC VOD purchases/VIP_Customer_Access_List.xlsx (all sheets)
  3. tmp/ILC VOD purchases/gmail_early_customers.csv
  4. tmp/ILC VOD purchases/gmail_template_emails.csv
  5. tmp/ILC VOD purchases/*-export*.csv (all 12 event exports)

Matches purchases against the 597 videos in the Firestore catalog,
deduplicates customer grants, links member records, and exports:
  - mini-tools/vod-grants-analyzer/output/grants-table.csv
  - mini-tools/vod-grants-analyzer/output/grants-table.json
  - mini-tools/vod-grants-analyzer/output/series-grants-table.csv
  - mini-tools/vod-grants-analyzer/output/subscriptions-table.csv
  - mini-tools/vod-grants-analyzer/output/unmigrated-titles.csv
  - mini-tools/vod-grants-analyzer/output/summary-report.json

Usage:
  python3 mini-tools/vod-grants-analyzer/analyze-vod-grants.py
"""

import os
import glob
import csv
import json
import re
import zipfile
import xml.etree.ElementTree as ET
from datetime import datetime

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(BASE_DIR, "../.."))
VOD_DIR = os.path.join(PROJECT_ROOT, "tmp/ILC VOD purchases")
DATA_DIR = os.path.join(BASE_DIR, "data")
OUTPUT_DIR = os.path.join(BASE_DIR, "output")

os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(OUTPUT_DIR, exist_ok=True)

# ----------------------------------------------------------------------
# 1. LOAD FIRESTORE CATALOG & MEMBERS
# ----------------------------------------------------------------------
VIDEOS_FILE = os.path.join(DATA_DIR, "videos.json")
MEMBERS_FILE = os.path.join(DATA_DIR, "members.json")

if not os.path.exists(VIDEOS_FILE) or not os.path.exists(MEMBERS_FILE):
    print("❌ videos.json or members.json not found in data/. Run download-vod-library.js first.")
    exit(1)

with open(VIDEOS_FILE, "r", encoding="utf-8") as f:
    videos_catalog = json.load(f)

with open(MEMBERS_FILE, "r", encoding="utf-8") as f:
    members_data = json.load(f)

print(f"Loaded {len(videos_catalog)} videos and {len(members_data)} members.")

# Build member lookup map: email -> member dict
member_by_email = {}
for m in members_data:
    primary = (m.get("email") or "").strip().lower()
    if primary:
        member_by_email[primary] = m
    for e in m.get("emails", []):
        norm = (e or "").strip().lower()
        if norm and norm not in member_by_email:
            member_by_email[norm] = m

# Build video series mapping from Firestore catalog
series_catalog = {}
# First pass: map series trailers
for v in videos_catalog:
    s_title = v.get("forVodSeriesTitle")
    if s_title:
        if s_title not in series_catalog:
            series_catalog[s_title] = {
                "seriesTitle": s_title,
                "trailerVideoId": v.get("docId"),
                "trailerTitle": v.get("title"),
                "parts": []
            }
        else:
            series_catalog[s_title]["trailerVideoId"] = v.get("docId")
            series_catalog[s_title]["trailerTitle"] = v.get("title")

# Second pass: map buyable / direct_purchase parts to series
for v in videos_catalog:
    t_id = v.get("trailerVideoId")
    if t_id:
        # Find trailer in catalog
        trailer = next((x for x in videos_catalog if x.get("docId") == t_id), None)
        if trailer and trailer.get("forVodSeriesTitle"):
            s_title = trailer.get("forVodSeriesTitle")
            if s_title not in series_catalog:
                series_catalog[s_title] = {
                    "seriesTitle": s_title,
                    "trailerVideoId": t_id,
                    "trailerTitle": trailer.get("title"),
                    "parts": []
                }
            if not v.get("isTrailer"):
                if not any(p["docId"] == v.get("docId") for p in series_catalog[s_title]["parts"]):
                    series_catalog[s_title]["parts"].append({
                        "docId": v.get("docId"),
                        "title": v.get("title"),
                        "durationSeconds": v.get("durationSeconds", 0),
                        "priceCents": v.get("priceCents", 0),
                        "stripeProductId": v.get("stripeProductId", ""),
                        "stripePriceId": v.get("stripePriceId", ""),
                    })

print(f"Catalog has {len(series_catalog)} distinct VOD series.")

# ----------------------------------------------------------------------
# 2. DEFINITIVE TITLE MAPPING DICTIONARY
# ----------------------------------------------------------------------
# Maps raw product title / item name from WooCommerce, Gmail, Excel, or Event exports
# to one of:
#   - ("vod_series", target_series_name)
#   - ("subscription", "Class Video Library")
#   - ("unmigrated_video", unmigrated_title)
#   - ("non_video", item_category)
#   - ("ignore", reason)

ITEM_MAPPING = {
    # --- 15 Basic Exercises ---
    "Introduction to 15 Basic Exercises MP4": ("vod_series", "Introduction To I liq Chuan 15 Basic Exercises"),
    "Introduction to 15 Basic Exercises - 2 DVDs": ("vod_series", "Introduction To I liq Chuan 15 Basic Exercises"),
    "Introduction To I liq Chuan 15 Basic Exercises": ("vod_series", "Introduction To I liq Chuan 15 Basic Exercises"),
    "Introduction to I Liq Chuan 15 Basic Exercises": ("vod_series", "Introduction To I liq Chuan 15 Basic Exercises"),

    # --- 21 Form Instructional ---
    "I Liq Chuan® 21 Form MP4": ("vod_series", "I Liq Chuan 21 Form Instructional Video"),
    "I Liq Chuan 21 Form MP4": ("vod_series", "I Liq Chuan 21 Form Instructional Video"),
    "I Liq Chuan® 21 Form DVD": ("vod_series", "I Liq Chuan 21 Form Instructional Video"),
    "I Liq Chuan 21 Form DVD": ("vod_series", "I Liq Chuan 21 Form Instructional Video"),
    "I Liq Chuan 21 Form Instructional Video": ("vod_series", "I Liq Chuan 21 Form Instructional Video"),

    # --- Butterfly Form: Sequence ---
    "I Liq Chuan Butterfly Form - Sequence.mp4": ("vod_series", "I Liq Chuan Butterfly Form - Sequence"),
    "I Liq Chuan Butterfly Form - Sequence (English with Russian Translation) Instructional DVD": ("vod_series", "I Liq Chuan Butterfly Form - Sequence"),
    "I Liq Chuan Butterfly Form - Sequence": ("vod_series", "I Liq Chuan Butterfly Form - Sequence"),

    # --- Butterfly Form: Application & Fajing ---
    "I Liq Chuan Butterfly Form – Application & Fajing (English with Russian Translation) Instructional MP4": ("vod_series", "I Liq Chuan® Butterfly Form - Application & Fajing (English with Russian Translation) Instructional DVD"),
    "I Liq Chuan Butterfly Form - Application & Fajing (English with Russian Translation) Instructional MP4": ("vod_series", "I Liq Chuan® Butterfly Form - Application & Fajing (English with Russian Translation) Instructional DVD"),
    "I Liq Chuan® Butterfly Form - Application & Fajing (English with Russian Translation) Instructional DVD": ("vod_series", "I Liq Chuan® Butterfly Form - Application & Fajing (English with Russian Translation) Instructional DVD"),
    "I Liq Chuan® Butterfly Form - Application &amp; Fajing (English with Russian Translation) Instructional DVD": ("vod_series", "I Liq Chuan® Butterfly Form - Application & Fajing (English with Russian Translation) Instructional DVD"),

    # --- Point of Contact / Knowing the Moment ---
    "Knowing The Moment – Point of Contact MP4": ("vod_series", "I Liq Chuan® Knowing The Moment - Point of Contact"),
    "Knowing The Moment - Point of Contact MP4": ("vod_series", "I Liq Chuan® Knowing The Moment - Point of Contact"),
    "Knowing The Moment - Point of Contact DVD": ("vod_series", "I Liq Chuan® Knowing The Moment - Point of Contact"),
    "I Liq Chuan® Knowing The Moment - Point of Contact": ("vod_series", "I Liq Chuan® Knowing The Moment - Point of Contact"),
    "I Liq Chuan Knowing The Moment - Point of Contact": ("vod_series", "I Liq Chuan® Knowing The Moment - Point of Contact"),

    # --- Upper Hand Process ---
    "Sticky & Spinning Hands - Upper Hands Process HD MP4": ("vod_series", "I Liq Chuan - Introduction To Upper Hand Process"),
    "Sticky & Spinning Hands - Upper Hands Process - 1 DVD": ("vod_series", "I Liq Chuan - Introduction To Upper Hand Process"),
    "Sticky &amp; Spinning Hands - Upper Hands Process - 1 DVD": ("vod_series", "I Liq Chuan - Introduction To Upper Hand Process"),
    "I Liq Chuan - Introduction To Upper Hand Process": ("vod_series", "I Liq Chuan - Introduction To Upper Hand Process"),

    # --- Lower Hand Process ---
    "Sticky Hands - Introduction to Lower Hand Process - MP4": ("vod_series", "I Liq Chuan - Introduction To Lower Hand Process"),
    "Sticky Hands - Introduction to Lower Hand Process - 1 DVD": ("vod_series", "I Liq Chuan - Introduction To Lower Hand Process"),
    "I Liq Chuan - Introduction To Lower Hand Process": ("vod_series", "I Liq Chuan - Introduction To Lower Hand Process"),

    # --- Chi Kung For Health ---
    "Chi Kung For Health - Featuring GM Sam Chin MP4": ("vod_series", "Chi Kung For Health - Featuring GM Sam Chin"),
    "Chi Kung for Health - 1 DVD": ("vod_series", "Chi Kung For Health - Featuring GM Sam Chin"),
    "Chi Kung For Health - Featuring GM Sam Chin": ("vod_series", "Chi Kung For Health - Featuring GM Sam Chin"),

    # --- Refinement of Basic Exercises (Grading Criteria) ---
    "Grading Criteria for Instructors - 15 Basic Exercises - 3 DVDs": ("vod_series", "Refinement Of I Liq Chuan Basic Exercises - Grading Criterion For Instructors"),
    "Refinement Of I Liq Chuan Basic Exercises - Grading Criterion For Instructors": ("vod_series", "Refinement Of I Liq Chuan Basic Exercises - Grading Criterion For Instructors"),

    # --- San Da Vol. 4 (Throwing Hands) ---
    "San Da Vol. 4 - Throwing Hands MP4": ("vod_series", "San Da Vol. 4 - Throwing Hands"),
    "San Da Vol. 4 - Throwing Hands DVD": ("vod_series", "San Da Vol. 4 - Throwing Hands"),
    "San Da Vol. 4 - Throwing Hands": ("vod_series", "San Da Vol. 4 - Throwing Hands"),

    # --- Structure And Energy ---
    "Structure And Energy - DVD": ("vod_series", "I Liq Chuan - Structure And Energy"),
    "Structure And Energy - MP4": ("vod_series", "I Liq Chuan - Structure And Energy"),
    "I Liq Chuan - Structure And Energy": ("vod_series", "I Liq Chuan - Structure And Energy"),

    # --- Introduction to Phoenix Eye ---
    "Introduction to Phoenix Eye Workshop MP4": ("vod_series", "I Liq Chuan - Introduction To Phoenix Eye"),
    "Introduction to Phoenix Eye Workshop DVD": ("vod_series", "I Liq Chuan - Introduction To Phoenix Eye"),
    "I Liq Chuan - Introduction To Phoenix Eye": ("vod_series", "I Liq Chuan - Introduction To Phoenix Eye"),
    "Phoenix Eye": ("vod_series", "Phoenix Eye"),

    # --- San Da Vol. 6 (Kicking) ---
    "San Da vol. 6 MP4": ("vod_series", "San Da vol. 6 - Kicking"),
    "San Da vol. 6 DVD": ("vod_series", "San Da vol. 6 - Kicking"),
    "San Da vol. 6 : Kicking": ("vod_series", "San Da vol. 6 - Kicking"),
    "San Da vol. 6 - Kicking": ("vod_series", "San Da vol. 6 - Kicking"),

    # --- Five Elements ---
    "Five Elements In I Liq Chuan® - DVD": ("vod_series", "I Liq Chuan - FIve Elements"),
    "Five Elements In I Liq Chuan - DVD": ("vod_series", "I Liq Chuan - FIve Elements"),
    "I Liq Chuan - FIve Elements": ("vod_series", "I Liq Chuan - FIve Elements"),
    "I Liq Chuan - Five Elements": ("vod_series", "I Liq Chuan - FIve Elements"),

    # --- San Da Vol. 3 (Applications of 5 Elements) ---
    "San Da Vol. 3 – Applications of 5 Elements MP4": ("vod_series", "San Da Vol. 3 - Applications of 5 Elements (English with Russian Translation)"),
    "San Da Vol. 3 - Applications of 5 Elements MP4": ("vod_series", "San Da Vol. 3 - Applications of 5 Elements (English with Russian Translation)"),
    "San Da Vol. 3 - Applications of 5 Elements DVD (English with Russian Translation)": ("vod_series", "San Da Vol. 3 - Applications of 5 Elements (English with Russian Translation)"),
    "San Da Vol. 3 - Applications of 5 Elements (English with Russian Translation)": ("vod_series", "San Da Vol. 3 - Applications of 5 Elements (English with Russian Translation)"),

    # --- San Da Vol. 1 (Free Fight Training Workshop) ---
    "San Da Vol. 1 - Free Fight Training Workshop DVD (Introduction to San Shou)": ("vod_series", "San Da Vol. 1 - Free Fight Training Workshop (Introduction to San Shou)"),
    "San Da vol 1 MP4": ("vod_series", "San Da Vol. 1 - Free Fight Training Workshop (Introduction to San Shou)"),
    "San Da Vol. 1 - Free Fight Training Workshop (Introduction to San Shou)": ("vod_series", "San Da Vol. 1 - Free Fight Training Workshop (Introduction to San Shou)"),

    # --- San Da Vol. 2 (Free Fight Training Workshop) ---
    "San Da Vol. 2 - Free Fight Training Workshop DVD (English with Russian Translation)": ("vod_series", "San Da Vol. 2 - Free Fight Training Workshop (English with Russian Translation)"),
    "San Da Vol. 2 - Free Fight Training Workshop (English with Russian Translation)": ("vod_series", "San Da Vol. 2 - Free Fight Training Workshop (English with Russian Translation)"),

    # --- San Da Vol. 5 (Timing and Spacing) ---
    "San Da Vol. 5 - Timing And Spacing DVD": ("vod_series", "San Da Vol. 5 - Timing And Spacing"),
    "San Da Vol. 5 - Timing And Spacing": ("vod_series", "San Da Vol. 5 - Timing And Spacing"),

    # --- Spinning Hands Process ---
    "Spinning Hands Process DVD": ("vod_series", "I Liq Chuan - Spinning Hands Process"),
    "I Liq Chuan - Spinning Hands Process": ("vod_series", "I Liq Chuan - Spinning Hands Process"),

    # --- Finding the Center & Sticky Hands ---
    "Finding the Center &amp; Sticky Hands - Advance Workshop (w/Russian Translation) - 3 DVDs": ("vod_series", "Finding The Center & Sticky Hands"),
    "Finding the Center & Sticky Hands - Advance Workshop (w/Russian Translation) - 3 DVDs": ("vod_series", "Finding The Center & Sticky Hands"),
    "Finding The Center & Sticky Hands": ("vod_series", "Finding The Center & Sticky Hands"),

    # --- Chin-Na: A Flowing Process ---
    "I Liq Chuan® Chin-Na: A Flowing Process - 2 DVDs": ("vod_series", "I Liq Chuan - Chin Na | A Flowing Process"),
    "I Liq Chuan Chin-Na: A Flowing Process - 2 DVDs": ("vod_series", "I Liq Chuan - Chin Na | A Flowing Process"),
    "I Liq Chuan - Chin Na | A Flowing Process": ("vod_series", "I Liq Chuan - Chin Na | A Flowing Process"),

    # --- 3 Day Retreat ---
    "I Liq Chuan 3 Day Retreat MP4": ("vod_series", "I Liq Chuan - Three Day Retreat"),
    "I Liq Chuan® Retreat DVD": ("vod_series", "I Liq Chuan - Three Day Retreat"),
    "I Liq Chuan Retreat DVD": ("vod_series", "I Liq Chuan - Three Day Retreat"),
    "I Liq Chuan - Three Day Retreat": ("vod_series", "I Liq Chuan - Three Day Retreat"),

    # --- Tai Chi Point Training ---
    "Tai Chi Point Training - Introducing Fa-Jing Workshop DVD": ("vod_series", "I Liq Chuan - Tai Chi Point & Intro To Fajin"),
    "I Liq Chuan - Tai Chi Point & Intro To Fajin": ("vod_series", "I Liq Chuan - Tai Chi Point & Intro To Fajin"),

    # --- Meet and Match ---
    "Meet And Match - DVD": ("vod_series", "I  Liq Chuan - Meet & Match"),
    "I  Liq Chuan - Meet & Match": ("vod_series", "I  Liq Chuan - Meet & Match"),
    "I Liq Chuan - Meet & Match": ("vod_series", "I  Liq Chuan - Meet & Match"),

    # --- St. Petersburg Workshop ---
    "St. Petersburg Workshop; English with Russian Translation MP4": ("vod_series", "St. Petersburg Workshop; English with Russian Translation HD MP4"),
    "St. Petersburg Workshop; English with Russian Translation": ("vod_series", "St. Petersburg Workshop; English with Russian Translation HD MP4"),
    "St. Petersburg Workshop; English with Russian Translation - 1 DVD": ("vod_series", "St. Petersburg Workshop; English with Russian Translation HD MP4"),
    "St. Petersburg Workshop; English with Russian Translation HD MP4": ("vod_series", "St. Petersburg Workshop; English with Russian Translation HD MP4"),

    # --- Recent Workshops / Gmail / Events ---
    "Butterfly Form + Fa-Jin": ("vod_series", "Butterfly Form + Fa-Jin"),
    "Catch the Moment": ("vod_series", "Catching the Moment"),
    "Catching the Moment": ("vod_series", "Catching the Moment"),
    "Functions of Basic Exercises": ("vod_series", "Functions of Basic Exercises"),
    "Light + Heavy Spinning Hands": ("vod_series", "Light + Heavy Spinning Hands"),
    "Refinement of the Basic Exercises, 21 Form and Partner Training": ("vod_series", "ZXD / ILC Class : Refinement of Basic Exercises (21 form + Partner Training)"),
    "Spinning Hands with Applications": ("vod_series", "Spinning Hands with Applications"),
    "Understanding Spacing": ("vod_series", "Understanding Spacing"),
    "2026 NY Intensive Retreat": ("vod_series", "2026 NY Intensive Retreat"),
    "21 Form - Part 2": ("vod_series", "21 Form - Part 2"),
    "7/29 Basic Exercise 21 Form Class": ("vod_series", "7/29 Basic Exercise 21 Form Class"),
    "Breaking Bridge": ("vod_series", "Breaking Bridge"),
    "Complementary Eneriges": ("vod_series", "Complementary Eneriges"),
    "How to Gain Inner Strength": ("vod_series", "How to Gain Inner Strength"),
    "One Point of Rotation": ("vod_series", "One Point of Rotation"),
    "San Da - Free Sparring with Grandmaster Sam F.S. Chin": ("vod_series", "San Da - Free Sparring with Grandmaster Sam F.S. Chin"),
    "Structure, Relaxation, and Energy": ("vod_series", "Structure, Relaxation, and Energy"),
    "The Foundation of Inner Power": ("vod_series", "The Foundation of Inner Power"),
    "ZXD / ILC Class : Refinement of Basic Exercises (21 form + Partner Training)": ("vod_series", "ZXD / ILC Class : Refinement of Basic Exercises (21 form + Partner Training)"),
    "Zhong Xin Dao I Liq Chuan Chin Na vol. 3": ("vod_series", "Zhong Xin Dao I Liq Chuan Chin Na vol. 3"),
    "I Liq Chuan 21 Form : Part 1": ("vod_series", "I Liq Chuan 21 Form : Part 1"),

    # --- Event CSV File Mappings ---
    "light-heavy-spinning-hands-032225-export.csv": ("vod_series", "Light + Heavy Spinning Hands"),
    "new-york-united-states-spacing-with-grandmaster-sam-f-s-chin-export.csv": ("vod_series", "Understanding Spacing"),
    "new-york-usa-21-form-part-2-with-grandmaster-sam-f-s-chin-export.csv": ("vod_series", "21 Form - Part 2"),
    "new-york-usa-21-form-with-grandmaster-sam-f-s-chin-export.csv": ("vod_series", "I Liq Chuan 21 Form : Part 1"),
    "new-york-usa-butterfly-form-with-fajin-with-gm-sam-f-s-chin-export.csv": ("vod_series", "Butterfly Form + Fa-Jin"),
    "new-york-usa-saturday-class-the-foundation-of-inner-power-with-gm-sam-f-s-chin-join-in-person-or-online-export (3).csv": ("vod_series", "The Foundation of Inner Power"),
    "new-york-usa-saturday-class-with-gm-sam-f-s-chin-refinement-of-basic-exercises-21-form-and-partner-trainings-export.csv": ("vod_series", "ZXD / ILC Class : Refinement of Basic Exercises (21 form + Partner Training)"),
    "new-york-usa-spinning-hands-to-recognize-breaking-bridge-export.csv": ("vod_series", "Breaking Bridge"),
    "ny-usa-saturday-class-with-grandmaster-sam-chin-july29-23-export.csv": ("vod_series", "7/29 Basic Exercise 21 Form Class"),
    "ny-usa-save-the-date-class-with-gm-sam-f-s-chin-2-export.csv": ("vod_series", "Functions of Basic Exercises"),
    "ny-usa-save-the-date-class-with-gm-sam-f-s-chin-export.csv": ("vod_series", "Catching the Moment"),
    "queens-ny-how-to-gain-inner-strength-through-the-butterfly-form-export.csv": ("vod_series", "How to Gain Inner Strength"),

    # --- Subscription Products (Skipped - Expired legacy subscriptions) ---
    "Video Library Subscriber": ("skipped_subscription", "Class Video Library (Skipped)"),

    # --- Unmigrated Video Products (Titles Not On OTT) ---
    "I Liq Chuan Presents Shaolin I-Jing by Venerable Ji-Ru - MP4 (SD)": ("unmigrated_video", "Shaolin I-Jing by Venerable Ji-Ru (MP4)"),
    "I Liq Chuan® Presents Shaolin I-Jing by Venerable Ji-Ru - 1 DVD": ("unmigrated_video", "Shaolin I-Jing by Venerable Ji-Ru (DVD)"),
    "I Liq Chuan Presents Shaolin I-Jing by Venerable Ji-Ru - 1 DVD MP4 (SD)": ("unmigrated_video", "Shaolin I-Jing by Venerable Ji-Ru (DVD MP4)"),
    "Introduction to Nei Gong &amp; Engagement Qualities (w/Russian Translation) MP4 (SD)": ("unmigrated_video", "Introduction to Nei Gong & Engagement Qualities (MP4)"),
    "Introduction to Nei Gong & Engagement Qualities (w/Russian Translation) MP4 (SD)": ("unmigrated_video", "Introduction to Nei Gong & Engagement Qualities (MP4)"),
    "Introduction to Nei Gong &amp; Engagement Qualities (w/Russian Translation) - 3 DVDs": ("unmigrated_video", "Introduction to Nei Gong & Engagement Qualities (3 DVDs)"),
    "Moscow Workshop; English with Russian Translation - 2 DVDs": ("unmigrated_video", "Moscow Workshop (2 DVDs)"),
    "Instructions For Meditation by Grand Master Sam FS Chin MP3": ("unmigrated_audio", "Instructions For Meditation MP3"),

    # --- Non-Video Items (Memberships, Licenses, Books, Apparel, Grading Fees, Live Workshop Deposits) ---
    "Student Membership - Regular Annual": ("non_video", "Membership"),
    "Student Membership - Annual : Regular": ("non_video", "Membership"),
    "Student Membership - Senior": ("non_video", "Membership"),
    "Student Membership - Lifetime": ("non_video", "Membership"),
    "Student Membership - Annual : 65+ Senior": ("non_video", "Membership"),
    "Student Membership - Lifetime : Regular": ("non_video", "Membership"),
    "Student Membership - Annual : 21 & Under": ("non_video", "Membership"),
    "Student Membership - Senior Lifetime": ("non_video", "Membership"),
    "Student Membership - Minor": ("non_video", "Membership"),
    "Student Membership - Lifetime : 65+ Senior": ("non_video", "Membership"),
    
    "Instructor License": ("non_video", "Instructor License"),
    "Group Leaders and Instructor Licenses - Instructor License : YEARLY $150": ("non_video", "Instructor License"),
    "Group Leaders and Instructor Licenses - Legacy Instructor License : YEARLY $150": ("non_video", "Instructor License"),
    "Group Leaders and Instructor Licenses - Group Leader License : YEARLY $150": ("non_video", "Instructor License"),
    "School Licenses - Instructor with School License : YEARLY $600": ("non_video", "School License"),
    "School Licenses - Group Leader with School License : YEARLY $600": ("non_video", "School License"),

    "Student Level Test Fee - Student Level 1": ("non_video", "Grading Fee"),
    "Student Level Test Fee - Student Level 2": ("non_video", "Grading Fee"),
    "Student Level Test Fee - Student Level 3": ("non_video", "Grading Fee"),
    "Student Level Test Fee - Student Level 4": ("non_video", "Grading Fee"),
    "Student Level Test Fee - Student Level 5": ("non_video", "Grading Fee"),
    "Student Level Test Fee - Student Level 6": ("non_video", "Grading Fee"),
    "Student Level Test Fee - Student Level 7": ("non_video", "Grading Fee"),
    "Student Level Test Fee - Entry Level": ("non_video", "Grading Fee"),
    "Student Level Grading Fee - Entry Level": ("non_video", "Grading Fee"),
    "Student Level Grading Fee - Student Level 1": ("non_video", "Grading Fee"),
    "Student Level Grading Fee - Student Level 2": ("non_video", "Grading Fee"),
    "Student Level Grading Fee - Student Level 3": ("non_video", "Grading Fee"),
    "Student Level Grading Fee - Student Level 4": ("non_video", "Grading Fee"),
    "Student Level Grading Fee - Student Level 5": ("non_video", "Grading Fee"),
    "Student Level Grading Fee - Student Level 6": ("non_video", "Grading Fee"),
    "Student Level Grading Fee - Student Level 7": ("non_video", "Grading Fee"),
    "Instructor Level Test Fee - Level 1": ("non_video", "Grading Fee"),
    "Instructor Level Test Fee - Level 2": ("non_video", "Grading Fee"),
    "Instructor Level Test Fee - Level 4": ("non_video", "Grading Fee"),
    "Instructor Level Test Fee": ("non_video", "Grading Fee"),
    "Application Level Grading - Application Level 1": ("non_video", "Grading Fee"),
    "Application Level Grading - Application Level 2": ("non_video", "Grading Fee"),
    "Application Level Grading - Application Level 3": ("non_video", "Grading Fee"),

    "Zhong Xin Dao I Liq Chuan® System Guide Booklet - 3rd Edition": ("non_video", "Merchandise - Booklet"),
    "I Liq Chuan® System Guide Booklet - 2nd Edition": ("non_video", "Merchandise - Booklet"),
    "I Liq Chuan® System Guide Booklet - 2nd Edition (Out of Print)": ("non_video", "Merchandise - Booklet"),
    "I Liq Chuan® - Martial Art of Awareness (Book)": ("non_video", "Merchandise - Book"),
    "Official I Liq Chuan T-shirt": ("non_video", "Merchandise - Apparel"),
    "Official Uniform Tee": ("non_video", "Merchandise - Apparel"),
    "Official Zhong Xin Dao - Sam Chin Way Tee": ("non_video", "Merchandise - Apparel"),
    "Official I Liq Chuan® Uniform Sash": ("non_video", "Merchandise - Apparel"),
    "I Liq Chuan® Official Uniform Sash": ("non_video", "Merchandise - Apparel"),
    "Official Uniform Sash": ("non_video", "Merchandise - Apparel"),
    "Official I Liq Chuan® Uniform Trousers - 2": ("non_video", "Merchandise - Apparel"),
    "Official I Liq Chuan® Uniform Trousers - 3": ("non_video", "Merchandise - Apparel"),
    "Official I Liq Chuan® Uniform Trousers - 4": ("non_video", "Merchandise - Apparel"),
    "Official I Liq Chuan® Uniform Trousers - 5": ("non_video", "Merchandise - Apparel"),
    "Official Uniform Trousers - 2": ("non_video", "Merchandise - Apparel"),
    "Official Uniform Trousers - 3": ("non_video", "Merchandise - Apparel"),
    "Official Uniform Trousers - 4": ("non_video", "Merchandise - Apparel"),
    "Official Uniform Trousers - 5": ("non_video", "Merchandise - Apparel"),
    "Chinese Calligraphy I Liq Chuan Casual Tee - Black, M": ("non_video", "Merchandise - Apparel"),
    "Chinese Calligraphy I Liq Chuan Casual Tee - Black, L": ("non_video", "Merchandise - Apparel"),
    "Chinese Calligraphy I Liq Chuan Casual Tee - Black, XL": ("non_video", "Merchandise - Apparel"),
    "Chinese Calligraphy I Liq Chuan Casual Tee - Black, S": ("non_video", "Merchandise - Apparel"),
    "Chinese Calligraphy I Liq Chuan Casual Tee - Black, 2XL": ("non_video", "Merchandise - Apparel"),
    "Chinese Calligraphy I Liq Chuan Casual Tee - White, L": ("non_video", "Merchandise - Apparel"),
    "Chinese Calligraphy I Liq Chuan Casual Tee - White, M": ("non_video", "Merchandise - Apparel"),
    "Chinese Calligraphy I Liq Chuan Casual Tee - White, XL": ("non_video", "Merchandise - Apparel"),
    "I Liq Chuan® Wall Posters": ("non_video", "Merchandise - Poster"),
    "Zhong Xin Dao - College Class Uniform": ("non_video", "Merchandise - Apparel"),

    "North Carolina 2018": ("non_video", "Live Workshop Event"),
    "Grants Pass, OR Retreat Deposit": ("non_video", "Live Workshop Event"),
    "March Northampton, MA 2018 1 Day Workshop": ("non_video", "Live Workshop Event"),
    "Hatfield 2018": ("non_video", "Live Workshop Event"),
    "Northampton, MA 2018 1 Day Workshop": ("non_video", "Live Workshop Event"),
    "Netherlands Workshop": ("non_video", "Live Workshop Event"),
    "Arizona 2018": ("non_video", "Live Workshop Event"),
}

# Helper to look up mapping
def resolve_item(raw_title):
    raw_title = raw_title.strip()
    if raw_title in ITEM_MAPPING:
        return ITEM_MAPPING[raw_title]
    
    # Try normalized
    norm = raw_title.replace("&amp;", "&").replace("®", "").replace("–", "-").replace("—", "-")
    norm = re.sub(r"\s+", " ", norm).strip()
    for k, v in ITEM_MAPPING.items():
        k_norm = k.replace("&amp;", "&").replace("®", "").replace("–", "-").replace("—", "-")
        k_norm = re.sub(r"\s+", " ", k_norm).strip()
        if norm.lower() == k_norm.lower():
            return v
    
    return ("unmatched", raw_title)

# ----------------------------------------------------------------------
# 3. PARSE ALL SOURCES
# ----------------------------------------------------------------------
raw_records = []

# --- Source A: WooCommerce (ILC Wordpress sales.csv) ---
wp_path = os.path.join(VOD_DIR, "ILC Wordpress sales.csv")
if os.path.exists(wp_path):
    print(f"Parsing {wp_path}...")
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
            total_cost = (row.get("Total Cost") or row.get("Item Cost") or "0").strip()
            payment_method = (row.get("Payment Method") or "").strip()
            status = (row.get("Status") or "").strip()

            raw_records.append({
                "source": "woocommerce",
                "source_file": "ILC Wordpress sales.csv",
                "source_order_id": order_id,
                "email": email,
                "customer_name": name,
                "item_raw": item_name,
                "date": date,
                "amount": total_cost,
                "payment_method": payment_method,
                "status": status,
            })
    print(f"  Loaded {len(raw_records)} rows from WooCommerce.")

# --- Source B: VIP_Customer_Access_List.xlsx (Sheets 2, 3, 4, 6) ---
def parse_xlsx_sheet_data(path, sheet_idx):
    with zipfile.ZipFile(path) as z:
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

xlsx_path = os.path.join(VOD_DIR, "VIP_Customer_Access_List.xlsx")
if os.path.exists(xlsx_path):
    print(f"Parsing {xlsx_path}...")
    
    # Sheet 2: Main List (Cols: A: Title, B: Customer Email, C: Customer Name, D: Date, E: Source)
    main_rows = parse_xlsx_sheet_data(xlsx_path, 2)
    count_main = 0
    for r in main_rows[1:]:
        title = (r.get("A") or "").strip()
        email = (r.get("B") or "").strip().lower()
        name = (r.get("C") or "").strip()
        date = (r.get("D") or "").strip()
        src = (r.get("E") or "vip_xlsx_main").strip()
        if email and "@" in email and title:
            raw_records.append({
                "source": f"xlsx_main_{src}",
                "source_file": "VIP_Customer_Access_List.xlsx (Main List)",
                "source_order_id": "",
                "email": email,
                "customer_name": name,
                "item_raw": title,
                "date": date,
                "amount": "",
                "payment_method": "",
                "status": "completed",
            })
            count_main += 1
    print(f"  Loaded {count_main} rows from VIP XLSX Sheet 2 (Main List).")

    # Sheet 3: Subscription Customers (Cols: A: Customer Email, B: Customer Name, C: Date, D: Source)
    sub_rows = parse_xlsx_sheet_data(xlsx_path, 3)
    count_sub = 0
    for r in sub_rows[1:]:
        email = (r.get("A") or "").strip().lower()
        name = (r.get("B") or "").strip()
        date = (r.get("C") or "").strip()
        src = (r.get("D") or "vip_xlsx_sub").strip()
        if email and "@" in email:
            raw_records.append({
                "source": f"xlsx_sub_{src}",
                "source_file": "VIP_Customer_Access_List.xlsx (Subscription Customers)",
                "source_order_id": "",
                "email": email,
                "customer_name": name,
                "item_raw": "Video Library Subscriber",
                "date": date,
                "amount": "",
                "payment_method": "",
                "status": "completed",
            })
            count_sub += 1
    print(f"  Loaded {count_sub} rows from VIP XLSX Sheet 3 (Subscription Customers).")

    # Sheet 4: DVD-Only Purchases (Cols: A: Title, B: Customer Email, C: Customer Name, D: Date)
    dvd_rows = parse_xlsx_sheet_data(xlsx_path, 4)
    count_dvd = 0
    for r in dvd_rows[1:]:
        title = (r.get("A") or "").strip()
        email = (r.get("B") or "").strip().lower()
        name = (r.get("C") or "").strip()
        date = (r.get("D") or "").strip()
        if email and "@" in email and title:
            raw_records.append({
                "source": "xlsx_dvd_purchases",
                "source_file": "VIP_Customer_Access_List.xlsx (DVD-Only Purchases)",
                "source_order_id": "",
                "email": email,
                "customer_name": name,
                "item_raw": title,
                "date": date,
                "amount": "",
                "payment_method": "",
                "status": "completed",
            })
            count_dvd += 1
    print(f"  Loaded {count_dvd} rows from VIP XLSX Sheet 4 (DVD-Only Purchases).")

    # Sheet 6: Titles Not On OTT (Cols: A: Original Item Name, B: Customer Email, C: Customer Name, D: Date)
    not_ott_rows = parse_xlsx_sheet_data(xlsx_path, 6)
    count_not_ott = 0
    for r in not_ott_rows[1:]:
        title = (r.get("A") or "").strip()
        email = (r.get("B") or "").strip().lower()
        name = (r.get("C") or "").strip()
        date = (r.get("D") or "").strip()
        if email and "@" in email and title and "Summary:" not in title:
            raw_records.append({
                "source": "xlsx_titles_not_on_ott",
                "source_file": "VIP_Customer_Access_List.xlsx (Titles Not On OTT)",
                "source_order_id": "",
                "email": email,
                "customer_name": name,
                "item_raw": title,
                "date": date,
                "amount": "",
                "payment_method": "",
                "status": "completed",
            })
            count_not_ott += 1
    print(f"  Loaded {count_not_ott} rows from VIP XLSX Sheet 6 (Titles Not On OTT).")

# --- Source C: Gmail Files ---
for gf in ["gmail_early_customers.csv", "gmail_template_emails.csv"]:
    gp = os.path.join(VOD_DIR, gf)
    if os.path.exists(gp):
        print(f"Parsing {gp}...")
        with open(gp, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            c = 0
            for r in reader:
                title = (r.get("title") or "").strip()
                email = (r.get("email") or "").strip().lower()
                date = (r.get("date_sent") or "").strip()
                src = (r.get("source") or gf).strip()
                if email and "@" in email and title:
                    raw_records.append({
                        "source": src,
                        "source_file": gf,
                        "source_order_id": "",
                        "email": email,
                        "customer_name": "",
                        "item_raw": title,
                        "date": date,
                        "amount": "",
                        "payment_method": "",
                        "status": "completed",
                    })
                    c += 1
        print(f"  Loaded {c} rows from {gf}.")

# --- Source D: Event CSV Exports ---
for ef in sorted(glob.glob(os.path.join(VOD_DIR, "*-export*.csv"))):
    fname = os.path.basename(ef)
    print(f"Parsing Event export: {fname}...")
    with open(ef, "r", encoding="utf-8", errors="replace") as f:
        lines = [line.strip() for line in f if line.strip()]
        header_idx = -1
        for i, l in enumerate(lines[:10]):
            if "Name,Status" in l or "Ticket Name" in l:
                header_idx = i
                break
        
        c = 0
        if header_idx != -1:
            reader = csv.DictReader(lines[header_idx:])
            for r in reader:
                email = (r.get("E-mail") or r.get("Email") or "").strip().lower()
                name = (r.get("Name") or "").strip()
                status = (r.get("Status") or "").strip()
                ticket = (r.get("Ticket Name") or "").strip()
                paid = (r.get("Total Paid") or r.get("Total") or "").strip()
                
                # All approved event registrations get access to the event's recorded video
                if email and "@" in email and status == "Approved":
                    raw_records.append({
                        "source": "event_registration",
                        "source_file": fname,
                        "source_order_id": "",
                        "email": email,
                        "customer_name": name,
                        "item_raw": fname, # file name mapped to series
                        "ticket_name": ticket,
                        "date": "", # event date extracted if needed
                        "amount": paid,
                        "payment_method": "",
                        "status": "completed",
                    })
                    c += 1
        print(f"  Loaded {c} approved attendees from {fname}.")

print(f"\nTotal raw purchase/registration records collected across all sources: {len(raw_records)}")

# ----------------------------------------------------------------------
# 4. RESOLVE & CATEGORIZE PURCHASES
# ----------------------------------------------------------------------
unmatched_items = {}
categorized_records = []

for rec in raw_records:
    cat, target = resolve_item(rec["item_raw"])
    rec["category"] = cat
    rec["target"] = target
    
    if cat == "unmatched":
        unmatched_items[rec["item_raw"]] = unmatched_items.get(rec["item_raw"], 0) + 1
    
    categorized_records.append(rec)

print(f"\nCategorization breakdown:")
cat_counts = {}
for r in categorized_records:
    cat_counts[r["category"]] = cat_counts.get(r["category"], 0) + 1

for cat, count in sorted(cat_counts.items(), key=lambda x: x[1], reverse=True):
    print(f"  - {cat:20s}: {count:5d} records")

if unmatched_items:
    print("\n⚠️ UNMATCHED ITEMS FOUND:")
    for it, cnt in sorted(unmatched_items.items(), key=lambda x: x[1], reverse=True):
        print(f"  {cnt:3d} x \"{it}\"")
else:
    print("\n✅ 100% OF ALL ITEMS MATCHED! Zero unmatched items.")

# ----------------------------------------------------------------------
# 5. BUILD DEDUPLICATED GRANTS TABLES
# ----------------------------------------------------------------------
# Grant Table 1: Individual Video Grants (Per Member + Video Item DocId)
# Key: (email, videoDocId)
video_grants_map = {}

# Grant Table 2: Series Grants (Per Member + Series Title)
# Key: (email, seriesTitle)
series_grants_map = {}

# Skipped Subscriptions (Class Video Library - Expired)
# Key: email
skipped_subscriptions_map = {}

# Table 4: Unmigrated Purchases (Per Member + Unmigrated Title)
# Key: (email, unmigratedTitle)
unmigrated_grants_map = {}

for rec in categorized_records:
    email = rec["email"]
    cat = rec["category"]
    target = rec["target"]
    name = rec["customer_name"]
    date = rec["date"]
    source = rec["source_file"]
    
    # Lookup member in Firestore
    member = member_by_email.get(email, {})
    member_doc_id = member.get("docId", "")
    member_id = member.get("memberId", "")
    member_name = member.get("name", "") or name
    student_level = member.get("studentLevel", "")
    
    if cat == "vod_series":
        series_info = series_catalog.get(target)
        if not series_info:
            print(f"❌ Error: Series {target} not found in series_catalog!")
            continue
        
        parts = series_info.get("parts", [])
        trailer_id = series_info.get("trailerVideoId", "")
        
        # Add to series grants
        s_key = (email, target)
        if s_key not in series_grants_map:
            series_grants_map[s_key] = {
                "email": email,
                "customerName": member_name,
                "isRegisteredMember": bool(member_doc_id),
                "memberDocId": member_doc_id,
                "memberId": member_id,
                "studentLevel": student_level,
                "seriesTitle": target,
                "partCount": len(parts),
                "partVideoIds": "; ".join([p["docId"] if isinstance(p, dict) else p for p in parts]),
                "sources": [source],
                "firstPurchaseDate": date,
                "lastPurchaseDate": date,
            }
        else:
            if source not in series_grants_map[s_key]["sources"]:
                series_grants_map[s_key]["sources"].append(source)
            if date and (not series_grants_map[s_key]["firstPurchaseDate"] or date < series_grants_map[s_key]["firstPurchaseDate"]):
                series_grants_map[s_key]["firstPurchaseDate"] = date
            if date and (not series_grants_map[s_key]["lastPurchaseDate"] or date > series_grants_map[s_key]["lastPurchaseDate"]):
                series_grants_map[s_key]["lastPurchaseDate"] = date
        
        # Add individual video parts
        for part in parts:
            part_id = part["docId"] if isinstance(part, dict) else part
            part_title = part["title"] if isinstance(part, dict) else part
            
            v_key = (email, part_id)
            if v_key not in video_grants_map:
                video_grants_map[v_key] = {
                    "email": email,
                    "customerName": member_name,
                    "isRegisteredMember": bool(member_doc_id),
                    "memberDocId": member_doc_id,
                    "memberId": member_id,
                    "studentLevel": student_level,
                    "videoId": part_id,
                    "videoTitle": part_title,
                    "seriesTitle": target,
                    "grantKind": "admin_grant",
                    "sources": [source],
                    "firstPurchaseDate": date,
                    "lastPurchaseDate": date,
                }
            else:
                if source not in video_grants_map[v_key]["sources"]:
                    video_grants_map[v_key]["sources"].append(source)
                if date and (not video_grants_map[v_key]["firstPurchaseDate"] or date < video_grants_map[v_key]["firstPurchaseDate"]):
                    video_grants_map[v_key]["firstPurchaseDate"] = date
                if date and (not video_grants_map[v_key]["lastPurchaseDate"] or date > video_grants_map[v_key]["lastPurchaseDate"]):
                    video_grants_map[v_key]["lastPurchaseDate"] = date

    elif cat == "skipped_subscription":
        if email not in skipped_subscriptions_map:
            skipped_subscriptions_map[email] = {
                "email": email,
                "customerName": member_name,
                "isRegisteredMember": bool(member_doc_id),
                "memberDocId": member_doc_id,
                "memberId": member_id,
                "studentLevel": student_level,
                "currentClassVideoSub": member.get("classVideoLibrarySubscription", False),
                "currentClassVideoExpiry": member.get("classVideoLibraryExpirationDate", ""),
                "sources": [source],
                "firstPurchaseDate": date,
                "lastPurchaseDate": date,
                "orderCount": 1,
            }
        else:
            skipped_subscriptions_map[email]["orderCount"] += 1
            if source not in skipped_subscriptions_map[email]["sources"]:
                skipped_subscriptions_map[email]["sources"].append(source)
            if date and (not skipped_subscriptions_map[email]["firstPurchaseDate"] or date < skipped_subscriptions_map[email]["firstPurchaseDate"]):
                skipped_subscriptions_map[email]["firstPurchaseDate"] = date
            if date and (not skipped_subscriptions_map[email]["lastPurchaseDate"] or date > skipped_subscriptions_map[email]["lastPurchaseDate"]):
                skipped_subscriptions_map[email]["lastPurchaseDate"] = date

    elif cat in ("unmigrated_video", "unmigrated_audio"):
        u_key = (email, target)
        if u_key not in unmigrated_grants_map:
            unmigrated_grants_map[u_key] = {
                "email": email,
                "customerName": member_name,
                "isRegisteredMember": bool(member_doc_id),
                "memberDocId": member_doc_id,
                "memberId": member_id,
                "unmigratedTitle": target,
                "itemType": cat,
                "sources": [source],
                "firstPurchaseDate": date,
                "lastPurchaseDate": date,
            }
        else:
            if source not in unmigrated_grants_map[u_key]["sources"]:
                unmigrated_grants_map[u_key]["sources"].append(source)

print(f"\n--- Summary of Deduped Grants ---")
print(f"Total Unique Individual Video Grants: {len(video_grants_map)}")
print(f"Total Unique Series Grants:           {len(series_grants_map)}")
print(f"Total Skipped Subscription Customers: {len(skipped_subscriptions_map)}")
print(f"Total Unique Unmigrated Titles:       {len(unmigrated_grants_map)}")

# Unique customers receiving video grants
unique_vod_emails = set(k[0] for k in video_grants_map.keys())
registered_vod_emails = set(k[0] for k, v in video_grants_map.items() if v["isRegisteredMember"])
print(f"Unique VOD purchasers: {len(unique_vod_emails)} ({len(registered_vod_emails)} registered in Firestore /members)")

# ----------------------------------------------------------------------
# 6. WRITE OUTPUT CSV & JSON FILES
# ----------------------------------------------------------------------
# 1. Individual Video Grants Table (CSV & JSON)
video_grants_list = sorted(video_grants_map.values(), key=lambda x: (x["email"], x["seriesTitle"], x["videoId"]))
for g in video_grants_list:
    g["sources_str"] = ", ".join(g["sources"])

grants_csv_path = os.path.join(OUTPUT_DIR, "grants-table.csv")
with open(grants_csv_path, "w", newline="", encoding="utf-8") as f:
    writer = csv.DictWriter(f, fieldnames=[
        "email", "customerName", "isRegisteredMember", "memberDocId", "memberId",
        "studentLevel", "videoId", "videoTitle", "seriesTitle", "grantKind",
        "sources_str", "firstPurchaseDate", "lastPurchaseDate"
    ])
    writer.writeheader()
    for g in video_grants_list:
        writer.writerow({
            "email": g["email"],
            "customerName": g["customerName"],
            "isRegisteredMember": g["isRegisteredMember"],
            "memberDocId": g["memberDocId"],
            "memberId": g["memberId"],
            "studentLevel": g["studentLevel"],
            "videoId": g["videoId"],
            "videoTitle": g["videoTitle"],
            "seriesTitle": g["seriesTitle"],
            "grantKind": g["grantKind"],
            "sources_str": g["sources_str"],
            "firstPurchaseDate": g["firstPurchaseDate"],
            "lastPurchaseDate": g["lastPurchaseDate"],
        })

grants_json_path = os.path.join(OUTPUT_DIR, "grants-table.json")
with open(grants_json_path, "w", encoding="utf-8") as f:
    json.dump(video_grants_list, f, indent=2)

print(f"💾 Exported {len(video_grants_list)} individual grants to {grants_csv_path} and {grants_json_path}")

# 2. Series Grants Table (CSV & JSON)
series_grants_list = sorted(series_grants_map.values(), key=lambda x: (x["email"], x["seriesTitle"]))
for g in series_grants_list:
    g["sources_str"] = ", ".join(g["sources"])

series_csv_path = os.path.join(OUTPUT_DIR, "series-grants-table.csv")
with open(series_csv_path, "w", newline="", encoding="utf-8") as f:
    writer = csv.DictWriter(f, fieldnames=[
        "email", "customerName", "isRegisteredMember", "memberDocId", "memberId",
        "studentLevel", "seriesTitle", "partCount", "partVideoIds", "sources_str",
        "firstPurchaseDate", "lastPurchaseDate"
    ])
    writer.writeheader()
    for g in series_grants_list:
        writer.writerow({
            "email": g["email"],
            "customerName": g["customerName"],
            "isRegisteredMember": g["isRegisteredMember"],
            "memberDocId": g["memberDocId"],
            "memberId": g["memberId"],
            "studentLevel": g["studentLevel"],
            "seriesTitle": g["seriesTitle"],
            "partCount": g["partCount"],
            "partVideoIds": g["partVideoIds"],
            "sources_str": g["sources_str"],
            "firstPurchaseDate": g["firstPurchaseDate"],
            "lastPurchaseDate": g["lastPurchaseDate"],
        })

# 3. Skipped Subscriptions Table (CSV & JSON)
subs_list = sorted(skipped_subscriptions_map.values(), key=lambda x: x["email"])
for s in subs_list:
    s["sources_str"] = ", ".join(s["sources"])

subs_csv_path = os.path.join(OUTPUT_DIR, "skipped-subscriptions.csv")
with open(subs_csv_path, "w", newline="", encoding="utf-8") as f:
    writer = csv.DictWriter(f, fieldnames=[
        "email", "customerName", "isRegisteredMember", "memberDocId", "memberId",
        "studentLevel", "currentClassVideoSub", "currentClassVideoExpiry", "orderCount",
        "sources_str", "firstPurchaseDate", "lastPurchaseDate"
    ])
    writer.writeheader()
    for s in subs_list:
        writer.writerow({
            "email": s["email"],
            "customerName": s["customerName"],
            "isRegisteredMember": s["isRegisteredMember"],
            "memberDocId": s["memberDocId"],
            "memberId": s["memberId"],
            "studentLevel": s["studentLevel"],
            "currentClassVideoSub": s["currentClassVideoSub"],
            "currentClassVideoExpiry": s["currentClassVideoExpiry"],
            "orderCount": s["orderCount"],
            "sources_str": s["sources_str"],
            "firstPurchaseDate": s["firstPurchaseDate"],
            "lastPurchaseDate": s["lastPurchaseDate"],
        })

# 4. Unmigrated Titles Table (CSV & JSON)
unmigrated_list = sorted(unmigrated_grants_map.values(), key=lambda x: (x["unmigratedTitle"], x["email"]))
for u in unmigrated_list:
    u["sources_str"] = ", ".join(u["sources"])

unmigrated_csv_path = os.path.join(OUTPUT_DIR, "unmigrated-titles.csv")
with open(unmigrated_csv_path, "w", newline="", encoding="utf-8") as f:
    writer = csv.DictWriter(f, fieldnames=[
        "email", "customerName", "isRegisteredMember", "memberDocId", "memberId",
        "unmigratedTitle", "itemType", "sources_str", "firstPurchaseDate", "lastPurchaseDate"
    ])
    writer.writeheader()
    for u in unmigrated_list:
        writer.writerow({
            "email": u["email"],
            "customerName": u["customerName"],
            "isRegisteredMember": u["isRegisteredMember"],
            "memberDocId": u["memberDocId"],
            "memberId": u["memberId"],
            "unmigratedTitle": u["unmigratedTitle"],
            "itemType": u["itemType"],
            "sources_str": u["sources_str"],
            "firstPurchaseDate": u["firstPurchaseDate"],
            "lastPurchaseDate": u["lastPurchaseDate"],
        })

# 5. Comprehensive Summary & Metrics
summary_metrics = {
    "generatedAt": datetime.now().isoformat(),
    "totals": {
        "rawRecordsProcessed": len(raw_records),
        "categorizedRecords": len(categorized_records),
        "individualVideoGrants": len(video_grants_map),
        "seriesGrants": len(series_grants_map),
        "skippedSubscriptionCustomers": len(skipped_subscriptions_map),
        "unmigratedTitlePurchases": len(unmigrated_grants_map),
        "uniqueVodPurchasers": len(unique_vod_emails),
        "registeredVodPurchasersInFirestore": len(registered_vod_emails),
        "unregisteredVodPurchasers": len(unique_vod_emails - registered_vod_emails),
    },
    "catalogStats": {
        "totalFirestoreVideos": len(videos_catalog),
        "vodSeriesInCatalog": len(series_catalog),
    },
    "seriesBreakdown": {},
}

for (email, series_title), data in series_grants_map.items():
    if series_title not in summary_metrics["seriesBreakdown"]:
        summary_metrics["seriesBreakdown"][series_title] = {
            "seriesTitle": series_title,
            "purchaserCount": 0,
            "videoPartCount": data["partCount"],
            "videoPartIds": data["partVideoIds"],
        }
    summary_metrics["seriesBreakdown"][series_title]["purchaserCount"] += 1

summary_json_path = os.path.join(OUTPUT_DIR, "summary-metrics.json")
with open(summary_json_path, "w", encoding="utf-8") as f:
    json.dump(summary_metrics, f, indent=2)

print("\n" + "="*80)
print("📊 FINAL VOD GRANTS ANALYSIS SUMMARY")
print("="*80)
print(f"Raw purchase records processed:      {len(raw_records)}")
print(f"Unique customers with video grants:  {len(unique_vod_emails)} ({len(registered_vod_emails)} registered in /members)")
print(f"Total individual video grants:       {len(video_grants_map)}")
print(f"Total VOD series grants:             {len(series_grants_map)}")
print(f"Total Skipped Video subscriptions:  {len(skipped_subscriptions_map)}")
print(f"Total unmigrated title purchases:    {len(unmigrated_grants_map)}")
print("\nTop 15 VOD Series by Purchase Grants:")
for s, stats in sorted(summary_metrics["seriesBreakdown"].items(), key=lambda x: x[1]["purchaserCount"], reverse=True)[:15]:
    print(f"  {stats['purchaserCount']:3d} purchasers -> \"{s}\" ({stats['videoPartCount']} parts)")

print("\n✅ All output files successfully written to mini-tools/vod-grants-analyzer/output/!")
