# Historical Data Migrations (`functions/scripts/data-migrations`)

This directory contains historical one-off data migration scripts run in Cloud Functions / Node environment (using `functions/` dependencies and Firebase Admin).

All scripts here are **archived** and kept for historical audit and rollback reference.

---

## Catalog of Historical Data Migrations

| Script | Related PR / Feature | Date | Commit | Target Scope / Collections | Summary |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `backfill-grading-status-actor.ts` | [PR #8](https://github.com/iislucas/ilc-members-manager/pull/8) | 2026-06-07 | `34762d2` | `/gradings` | Populated `statusActor` and `statusChangedAt` for grading auditability. |
| `backfill-grading-names.ts` | [PR #17](https://github.com/iislucas/ilc-members-manager/pull/17) | 2026-06-15 | `84d792a` | `/gradings` | Cached `studentName` and `instructorName` on gradings for non-admin viewers. |
| `backfill-grading-managers-paid-level.ts` | [PR #24](https://github.com/iislucas/ilc-members-manager/pull/24) | 2026-06-25 | `90b082c` | `/gradings` | Added `gradingManagerIds`, `paid`, and `level` snapshot fields prior to payment gating. |
| `delete-legacy-assistant-instructor-ids.ts` | [PR #29](https://github.com/iislucas/ilc-members-manager/pull/29) | 2026-07-02 | `0e3fc97` | `/gradings` | Removed deprecated `assistantInstructorIds` field from grading records. |
| `mark-legacy-orders-processed.ts` | [PR #20](https://github.com/iislucas/ilc-members-manager/pull/20) | 2026-06-18 | `13264c8` | `/orders` | Marked pre-Stripe legacy import orders as processed. |
| `backfill-school-owner-member-doc-id.ts` | [PR #73](https://github.com/iislucas/ilc-members-manager/pull/73) | 2026-08-13 | `238aa04` | `/schools` | Populated `ownerMemberDocId` on existing school documents. |
| `backfill-acl-expiry-1-may-2026.ts` | ACL Refactor | 2026-05-01 | `fe7bb37` | `/acls` | Cached school IDs and synchronized ACL records for school access. |
