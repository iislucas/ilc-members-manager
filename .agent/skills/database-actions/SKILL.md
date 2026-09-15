---
name: database-actions
description: Guide and reference for autonomous agents and scripts to perform consistent database operations using the TypeScript actions library in functions/src/actions/. Use whenever querying, creating, updating, or performing operations on members, schools, gradings, events, videos, or orders.
---

# ILC Database Actions Library — Agent & Scripting Guide

This skill guides autonomous agents, automated workers, and developers on how to interact with the ILC Firestore database using the high-level, human-conceptual Actions Library located in [`functions/src/actions/`](../../functions/src/actions/).

---

## 1. The Golden Rule: Use Actions Over Raw Firestore Writes

> [!CAUTION]
> **Never write raw, untyped documents directly to Firestore** (e.g. `db.collection('members').doc(...).set({ ... })`).
>
> Direct untyped writes bypass critical consistency logic:
> - **Schema Defaults**: Missing fields cause runtime crashes in converters like `firestoreDocToMember()`.
> - **Atomic Counters**: Manual ID generation causes collisions in `memberId`, `schoolId`, or `instructorId`.
> - **Timestamps**: Omitting `FieldValue.serverTimestamp()` breaks change tracking, caching, and triggers.
> - **Denormalized Snapshots**: Changing names or relationships without updating mirrors desyncs student lists, event organizers, and grading managers.
>
> **Always import and call action helpers from `functions/src/actions`**.

---

## 2. Execution Context & Safety (`ActionContext`)

Every action function takes an `ActionContext` as its first argument:

```typescript
import { createActionContext } from '../src/actions';

const ctx = createActionContext({
  projectId: 'ilc-paris-class-tracker', // optional, defaults to env var or default app
  dryRun: true,                          // ALWAYS test complex mutations in dry-run first!
  actor: {
    name: 'Agent Assistant',
    email: 'agent@iliqchuan.com',
    isAdmin: true,
  },
});
```

### Dry-Run Mode
When `dryRun: true`:
- All argument validation is performed.
- Existing records are fetched and verified.
- New state and generated IDs are computed.
- **NO writes are sent to Firestore**.
- Returns `{ success: true, data: ..., dryRun: true }`.

---

## 3. Domain Action Catalog

All actions and types are exported directly from `functions/src/actions` (or `functions/src/index.ts` under `actions.*`).

### Members (`members.ts`)

| Action | Purpose | Key Parameters |
|---|---|---|
| `createMember(ctx, input)` | Allocates next `memberId` atomically, initializes defaults, creates doc in `/members`. | `name`, `email`, `countryCode` (required) |
| `getMember(ctx, memberDocId)` | Fetches member by Firestore document ID. | `memberDocId` |
| `getMemberByMemberId(ctx, memberId)` | Fetches member by public ID (e.g. `'US402'`). | `memberId` |
| `getMemberByEmail(ctx, email)` | Looks up member by email address across `email` and `emails` array. | `email` |
| `searchMembers(ctx, options)` | Queries members with filtering by role, status, school, instructor, or term. | `searchTerm`, `membershipType`, `countryCode` |
| `updateMember(ctx, memberDocId, patch)` | Updates fields safely with timestamp freshness and email array synchronization. | `memberDocId`, `patch` |
| `renewMembership(ctx, memberDocId, options)` | Extends `currentMembershipExpires`, preserves `firstMembershipStarted`, sets `Active`. | `expirationDate` (`YYYY-MM-DD`), `membershipType` |
| `setMemberStatus(ctx, memberDocId, status)` | Transitions membership status (`Active`, `Inactive`, `Honorary`, `Life`). | `status: MembershipType` |
| `assignMemberInstructor(ctx, studentDocId, instructorId)` | Sets student's primary instructor (`sifu`). | `studentDocId`, `instructorId` |
| `assignMemberSchool(ctx, memberDocId, schoolId)` | Sets member's managing school. | `memberDocId`, `schoolId` |
| `scheduleMemberAccountDeletion(ctx, docId, days)` | Enqueues pending account deletion. | `docId`, `daysUntilDeletion` (default 30) |
| `cancelMemberAccountDeletion(ctx, docId)` | Removes pending account deletion. | `docId` |

### Schools (`schools.ts`)

| Action | Purpose | Key Parameters |
|---|---|---|
| `createSchool(ctx, input)` | Allocates next `schoolId` (`SCH-xxx`) atomically, initializes defaults, creates doc. | `schoolName`, `schoolCountry` |
| `getSchool(ctx, schoolDocId)` | Fetches school by document ID. | `schoolDocId` |
| `getSchoolBySchoolId(ctx, schoolId)` | Fetches school by public ID (e.g. `'SCH-100'`). | `schoolId` |
| `listSchools(ctx, options)` | Lists schools filtered by country, owner, or search term. | `country`, `searchTerm` |
| `updateSchool(ctx, schoolDocId, patch)` | Updates school details. If `schoolId` changes, updates linked students. | `schoolDocId`, `patch` |
| `addSchoolManager(ctx, schoolDocId, instructorId)` | Adds instructor ID to `managerInstructorIds`. | `schoolDocId`, `instructorId` |
| `removeSchoolManager(ctx, schoolDocId, instructorId)` | Removes instructor ID from managers. | `schoolDocId`, `instructorId` |
| `deleteSchool(ctx, schoolDocId)` | Removes school document. | `schoolDocId` |

### Gradings (`gradings.ts`)

| Action | Purpose | Key Parameters |
|---|---|---|
| `createGrading(ctx, input)` | Verifies student, populates name snapshot, initializes doc. | `studentMemberDocId`, `level`, `gradingInstructorId` |
| `getGrading(ctx, gradingDocId)` | Fetches grading by document ID. | `gradingDocId` |
| `listGradings(ctx, filter)` | Queries gradings by student, instructor, event, or status. | `studentMemberDocId`, `status`, `level` |
| `acceptGrading(ctx, gradingDocId, actor?)` | Sets `status: AwaitingGrading`, records `acceptedBy*` and `statusChangedBy*`. | `gradingDocId`, `actor` |
| `declineGrading(ctx, gradingDocId, notes, actor?)` | Sets `status: Declined`, records decline notes and resets acceptance. | `gradingDocId`, `notes` |
| `recordGradingResult(ctx, gradingDocId, options, actor?)` | Records `Passed` or `NotPassed`. If passed and `awardLevel=true`, updates member's level! | `pass: boolean`, `resultNotes`, `awardLevel` |
| `linkGradingToEvent(ctx, gradingDocId, eventDocId)` | Links grading to `IlcEvent`, copying date and event title snapshot. | `gradingDocId`, `eventDocId` |
| `unlinkGradingFromEvent(ctx, gradingDocId)` | Unlinks grading from event. | `gradingDocId` |

### Events (`events.ts`)

| Action | Purpose | Key Parameters |
|---|---|---|
| `createEvent(ctx, input)` | Resolves organizer identity, sets timestamps, creates event. | `title`, `start`, `location`, `ownerDocId` |
| `getEvent(ctx, eventDocId)` | Fetches event by document ID. | `eventDocId` |
| `listEvents(ctx, options)` | Lists events filtered by status (`Listed`, `Proposed`, etc.) or date range. | `status`, `startDate`, `searchTerm` |
| `updateEvent(ctx, eventDocId, patch)` | Updates event details. | `eventDocId`, `patch` |
| `setEventStatus(ctx, eventDocId, status)` | Transitions status (`Listed`, `Cancelled`, `Completed`). | `eventDocId`, `status: EventStatus` |
| `addEventManager(ctx, eventDocId, memberDocId)` | Grants event management rights to member. | `eventDocId`, `memberDocId` |
| `removeEventManager(ctx, eventDocId, memberDocId)` | Removes event manager. | `eventDocId`, `memberDocId` |
| `deleteEvent(ctx, eventDocId)` | Deletes event document. | `eventDocId` |

### Video on Demand (`vod.ts`)

| Action | Purpose | Key Parameters |
|---|---|---|
| `createVideo(ctx, input)` | Initializes video catalog entry in `/videos`. | `title`, `accessTier`, `tags`, `priceCents` |
| `getVideo(ctx, videoId)` | Fetches video catalog item. | `videoId` |
| `listVideos(ctx, options)` | Filters catalog by access tier, published state, series, or tag. | `isPublished`, `seriesId`, `tag` |
| `listVideoSeries(ctx, options)` | Lists curated series with grouped videos, pricing, and metadata. | `searchTerm`, `limitCount` |
| `updateVideo(ctx, videoId, patch)` | Updates video metadata, tags, or pricing. | `videoId`, `patch` |
| `setVideoPublished(ctx, videoId, isPublished)` | Publishes/unpublishes video item. | `videoId`, `isPublished` |
| `createOrUpdateVideoSeries(ctx, seriesId, data, ids)` | Batches series title, price, and sequence indices across videos. | `seriesId`, `seriesData`, `orderedVideoIds` |
| `grantVideoAccess(ctx, input)` | Provisions video or entire series grant in `/members/{id}/videoGrants` & `/video_grants`. | `videoId` or `seriesId`, `recipientMemberDocId` |
| `revokeVideoAccess(ctx, memberDocId, videoId)` | Revokes grant from member subcollection and global collection. | `memberDocId`, `videoId` |
| `listMemberVideoGrants(ctx, memberDocId)` | Lists all grants assigned to member. | `memberDocId` |

### Orders (`orders.ts`)

| Action | Purpose | Key Parameters |
|---|---|---|
| `getOrder(ctx, orderDocId)` | Fetches order by document ID. | `orderDocId` |
| `getOrderByNumber(ctx, orderNumber)` | Looks up order by customer order number or reference number. | `orderNumber` |
| `listOrders(ctx, options)` | Lists orders with status, date, or customer email filtering. | `orderKind`, `status`, `customerEmail` |
| `updateOrderNotes(ctx, orderDocId, notes)` | Updates free-form admin notes on order. | `orderDocId`, `notes` |
| `linkOrderToMember(ctx, orderDocId, memberId, index?)` | Manually overrides inferred member on order line item. | `orderDocId`, `memberId`, `lineItemIndex` |
| `linkOrderToSchool(ctx, orderDocId, schoolId, index?)` | Manually overrides inferred school on order line item. | `orderDocId`, `schoolId`, `lineItemIndex` |
| `reprocessOrder(ctx, orderDocId)` | Clears order processing state so cloud functions re-fulfill it. | `orderDocId` |

---

## 4. How to Write a Custom Standalone Script

When an agent needs to perform an automated migration, inspection, or administrative batch task, write a script in `functions/scripts/<script-name>.ts`:

```typescript
/* <script-name>.ts
 * Description of what this script accomplishes.
 *
 * Usage:
 *   cd functions
 *   pnpm exec ts-node scripts/<script-name>.ts [--dry-run]
 */

import { createActionContext, searchMembers, renewMembership } from '../src/actions';

async function main() {
  const isDryRun = process.argv.includes('--dry-run');
  const ctx = createActionContext({ dryRun: isDryRun });

  // 1. Query target entities
  const members = await searchMembers(ctx, { countryCode: 'FR', limitCount: 50 });
  console.log(`Found ${members.length} members.`);

  // 2. Perform actions safely
  for (const m of members) {
    const res = await renewMembership(ctx, m.docId, {
      expirationDate: '2028-12-31',
    });
    if (!res.success) {
      console.error(`Failed to renew member ${m.name}:`, res.error);
    }
  }
}

main().catch(console.error);
```

---

## 5. CLI Runner: `functions/scripts/run-action.ts`

For quick manual executions from the terminal, use the built-in runner:

```bash
cd functions

# View options
pnpm exec ts-node scripts/run-action.ts --help

# Lookup member
pnpm exec ts-node scripts/run-action.ts --action get-member --member "sam@example.com"

# Dry run creation of a member
pnpm exec ts-node scripts/run-action.ts --action create-member --name "Alex Doe" --email "alex@example.com" --country US --dry-run

# Commit member creation
pnpm exec ts-node scripts/run-action.ts --action create-member --name "Alex Doe" --email "alex@example.com" --country US

# Renew membership
pnpm exec ts-node scripts/run-action.ts --action renew-member --member <DOC_ID> --expires 2028-12-31

# Record grading result (awards level automatically on pass!)
pnpm exec ts-node scripts/run-action.ts --action record-grading --grading <GRADING_DOC_ID> --pass true --notes "Excellent progress"

# List or search video series in catalog
pnpm exec ts-node scripts/run-action.ts --action list-series --search "spinning"

# Grant a single video or an entire series to a member
pnpm exec ts-node scripts/run-action.ts --action grant-video --member "US658" --series 504000
pnpm exec ts-node scripts/run-action.ts --action grant-video --member "sam@example.com" --video vimeo_123812468
```

> [!TIP]
> **Admin Web Verification URL**:
> After granting videos or series to a member, administrators can confirm active grants on the web at:
> `https://app.iliqchuan.com/members/<MEMBER_DOC_ID>` (or navigate to **Manage Members** -> search member ID/name -> expand the **VOD Video & Series Grants** card).

---

## 6. VOD Batch Analysis & Grant Tool: `functions/scripts/grant-member-vod-series.ts`

For multi-series catalog matching and batch grants to a member:

```bash
cd functions

# 1. Search series catalog
pnpm exec ts-node scripts/grant-member-vod-series.ts --search "butterfly"

# 2. Fuzzy match multiple requested titles against the catalog
pnpm exec ts-node scripts/grant-member-vod-series.ts --match "Meet and Match; Finding the Center; Butterfly form"

# 3. Dry-run grant multiple series to a member (preview without writes)
pnpm exec ts-node scripts/grant-member-vod-series.ts --member US658 --series 504000,36073,143555 --dry-run

# 4. Live commit multi-series grant
pnpm exec ts-node scripts/grant-member-vod-series.ts --member US658 --series 504000,36073,143555 --notes "Purchased via manual bank transfer"
```

After granting, the script outputs the direct URL to inspect on the web:
`https://app.iliqchuan.com/members/<MEMBER_DOC_ID>`


