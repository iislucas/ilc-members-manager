# Archived Migration & Backfill Scripts

This directory contains one-off database migration, data normalization, and backfill scripts that have completed execution in production and are retained for historical provenance, auditability, and emergency rollback reference.

> [!NOTE]
> These scripts are **archived** and not intended for routine execution. Active runtime code and build pipelines do not depend on them.

---

## Catalog of Archived Scripts

| Script | Related PR / Feature | Date | Commit | Target Scope / Collections | Status / Summary |
| :--- | :--- | :--- | :--- | :--- | :--- |
| [`backfill-collection-timestamps.ts`](./backfill-collection-timestamps.ts) | [PR #93](https://github.com/iislucas/ilc-members-manager/pull/93) & [PR #95](https://github.com/iislucas/ilc-members-manager/pull/95) (`feat(sync): incremental delta sync`) | Aug–Sep 2026 | `bac0f39`, `f350a63` | `/instructors`, `/members`, `/schools`, `/events`, `/gradings`, `/orders`, `/videos` | **Completed**. Audited and normalized `lastUpdated` to native Firestore `Timestamp` objects for IndexedDB delta sync. Verified 99.98% valid across 5,182 production records. |
| [`backfill-video-series.ts`](./backfill-video-series.ts) | [PR #77](https://github.com/iislucas/ilc-members-manager/pull/77) (`feat(vod): video series collections`) | 2026-09-04 | `6658fc8` | `/videos` | **Completed**. Mapped 45 Vimeo VOD series into Firestore video documents with `seriesId`, `seriesTitle`, `seriesPartIndex`, and `seriesPriceCents`. |
| [`backfill-event-materials.ts`](./backfill-event-materials.ts) | [PR #67](https://github.com/iislucas/ilc-members-manager/pull/67) (`feat: materials management module`) | 2026-08-09 | `17b9768` | Cloud Storage (`events/{id}/materials/`), `/members/{id}/uploads` | **Completed**. Scanned Storage for uploaded event materials and generated indexed Firestore metadata with tokenized download/preview URLs. |
| [`backfill-event-registrations-member-info.ts`](./backfill-event-registrations-member-info.ts) | [PR #86](https://github.com/iislucas/ilc-members-manager/pull/86) (`feat(events): event registration naming & details`) | 2026-09-08 | `52d54ca` | `/events/{id}/registrations`, `/members/{id}/events` | **Completed**. Populated denormalized `memberId`, `studentLevel`, and `applicationLevel` on historical event registration documents. |
| [`backfill-event-schools.ts`](./backfill-event-schools.ts) | [PR #13](https://github.com/iislucas/ilc-members-manager/pull/13) (`feat(school): school profile page + event association`) | 2026-06-14 | `2d48852` | `/events` | **Completed**. Populated `schoolId` / `schoolDocId` on historical events predating school association based on the leading instructor's primary school. |
| [`backfill-event-contacts.ts`](./backfill-event-contacts.ts) | [PR #55](https://github.com/iislucas/ilc-members-manager/pull/55) (`feat(events): creator + managers as public contacts`) | 2026-07-31 | `2da5348` | `/events`, `/members/{id}/events` | **Completed**. Split monolithic `ownerDocId` into `creator` and public `contacts` array, and ensured creator was mirrored into `managerDocIds`. |

---

## Related Data Migrations

Earlier functions-based data migrations are archived in [`functions/scripts/data-migrations/`](../../functions/scripts/data-migrations/README.md), including:
- `backfill-grading-status-actor.ts` ([PR #8](https://github.com/iislucas/ilc-members-manager/pull/8))
- `backfill-grading-names.ts` ([PR #17](https://github.com/iislucas/ilc-members-manager/pull/17))
- `backfill-grading-managers-paid-level.ts` ([PR #24](https://github.com/iislucas/ilc-members-manager/pull/24))
- `delete-legacy-assistant-instructor-ids.ts` ([PR #29](https://github.com/iislucas/ilc-members-manager/pull/29))
- `mark-legacy-orders-processed.ts` ([PR #20](https://github.com/iislucas/ilc-members-manager/pull/20))
- `backfill-school-owner-member-doc-id.ts` ([PR #73](https://github.com/iislucas/ilc-members-manager/pull/73))
