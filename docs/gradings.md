# Gradings

This document describes how gradings work in this system: how they are created,
who can see and act on them, the workflow they move through, how they can be
linked to events, and the notifications they generate.

The authoritative data type is `Grading` in
[`functions/src/data-model.ts`](../functions/src/data-model.ts). Access control is
in [`firestore.rules`](../firestore.rules). Server-side automation (mirroring,
notifications, level updates) is in
[`functions/src/on-grading-update.ts`](../functions/src/on-grading-update.ts). The
member-facing UI is the grading components under `src/app/grading-*`.

## How gradings are created

A grading is normally created from a paid order: the student pays (creating a
document in the `orders` collection), and once the payment is processed a
`grading` document is created in the `gradings` collection — or, if the student
already had an unpaid grading for that level, that record is marked paid instead
(see [Purchasing a grading](#purchasing-a-grading)). A student can also request a
grading before paying, which creates an unpaid record (`requestGrading` in
[`grading-request.ts`](../functions/src/grading-request.ts)); only one such open
request is allowed at a time. Admins can create a grading manually (then
`orderId` is the empty string and `gradingPurchaseDate` is the creation date).

When a grading document is created, the `onGradingCreated` cloud function:

- adds the grading's docId to the student's `member.gradingDocIds`;
- mirrors a cached copy of the whole grading document into the relevant
  instructor and school subcollections (see [Mirroring](#mirroring-cached-copies));
- notifies the student that the grading is ready (and, if an instructor is
  already selected, that the request has been sent);
- if the grading is already linked to an event, notifies that event's
  organizer and managers that they are now grading managers.

## The grading progression

Student and Application levels interleave into one ordered progression
(`gradingProgression` in `data-model.ts`). Application 1 comes **after** Student
3, not after Student 11:

```
Student Entry → Student 1 → Student 2 → Student 3 → Application 1 →
Student 4 → Application 2 → Student 5 → Student 6 → Application 3 →
Student 7 → Student 8 → Application 4 → Student 9 → Student 10 →
Application 5 → Student 11 → Application 6
```

A member's position is held as two fields, `member.studentLevel` and
`member.applicationLevel`, so "Student 3 with no application level" means
everything up to Student 3 is achieved and Application 1 is next.

`nextGradingPayment(studentLevel, applicationLevel, gradings, skipLevel?)` is the
single rule for what a member owes next. It walks the progression and stops at
the first level that:

- has an **unpaid** grading record → the fee is still owed for it, and the
  returned `grading` is the record a payment settles;
- is not achieved, has no paid grading, and is not the `skipLevel`.

A level whose grading is **paid and still open** is stepped over, which is what
lets a student buy their following grading in advance. `not-passed` attempts are
ignored — that level is governed by the free-retake flow.

## Purchasing a grading

The purchase page
([`NextGradingComponent`](../src/app/next-grading/next-grading.ts), at
`/next-grading`) offers exactly one level: the one `nextGradingPayment` returns.
So a student at Student 3 is offered **Application 1**, and a student who
requested a grading but never paid is offered **that same grading** rather than
being pushed to the level after it. The page records the level it charged for in
the Stripe order metadata (`gradingLevel`).

### How a payment is processed

`fulfillGradingForMember` in
[`stripe-fulfillment.ts`](../functions/src/stripe-fulfillment.ts) applies the
payment to the level that was bought — read from the order metadata, falling
back to parsing the line-item description for orders that come from elsewhere:

1. The member has an **unpaid grading at that level** → that record is marked
   `paid-by-stripe` against the order. No second record is created.
2. Otherwise a grading is **created** for that level, paid, awaiting instructor
   selection. Buying a level **above** the student's current one is normal —
   that is how a grading is booked in advance.

Purchases are de-duplicated by `orderId`, so re-processing an order never
creates a second grading.

### Order numbers

Every purchase gets a short, human-friendly order number: the year and month of
the order, then four digits hashed from the real reference (the Stripe invoice
or session id, or the Squarespace order number).

```
202608-4713
└────┘ └──┘
 YYYYMM  hash of the real order reference
```

`orderDisplayNumber(orderDate, sourceRef)` in `data-model.ts` computes it. It is
stable for a given order, short enough to read out loud, and carries nothing
about the underlying account — so it is safe to show to a student's instructors.
The four digits are not unique on their own; the year and month are what
separate two orders that would otherwise collide.

Where it appears:

- **My Orders** (`/my-orders`) computes it from the member's own order record,
  and shows the full Stripe reference underneath it as before. The search box
  matches on it.
- **The grading progress page** shows it beside the grading level, to everyone
  who can see the grading. Instructors and school managers cannot read the order
  document, so the number is stored on the grading itself, in `orderNumber` —
  the same denormalization used for `studentName`. It is stamped on at purchase
  time; gradings bought before that need
  [`backfill-grading-order-numbers.ts`](../functions/scripts/data-migrations/backfill-grading-order-numbers.ts):

```bash
cd functions
pnpm exec ts-node scripts/data-migrations/backfill-grading-order-numbers.ts --project <projectId> --dry-run
```

Manually created gradings have no order, so they have no order number.

### When a payment needs a human

Two cases cannot be fulfilled as above, plus a level that cannot be recognised:

| Case | Meaning |
|---|---|
| **Already achieved** | The level paid for is at or below the student's current level. |
| **Already purchased** | The student already has a paid grading for that level. |
| **Unrecognised level** | The purchased item doesn't name a level in `gradingProgression`. |

In all three the grading is still created — the payment is never lost — but with
status **`in-review`** (`RequiresReview`) so it is held for an admin instead of
being presented to the student as their next step. Two alerts are raised:

- **The student** gets an `OrderNeedsAttention` notification saying what they
  paid, why it needs checking, that admins have been alerted, and the address to
  contact if they don't hear back. That address is `environment.email.from`.
- **The admins** get it through the existing order-issue pipeline: the order is
  set to `needs-manual-processing` with the detail appended to
  `ilcAppOrderIssues`, which admin clients surface in their notification feed
  (`syncOrderIssueNotifications`).

Both alerts are best-effort — a failure to notify is logged and never fails the
payment.

## The data model

Key fields on a `Grading` (see `data-model.ts` for the full list and comments):

| Field | Meaning |
|---|---|
| `gradingPurchaseDate` | Date the grading was purchased (or manually created). |
| `orderId` | Order that created it, or `''` if manual. |
| `orderNumber` | Human-friendly order number for that purchase, e.g. `202608-4713` — see [Order numbers](#order-numbers). `''` if manual. |
| `level` | The level being graded for, e.g. `Student 3`, `Application 2`. |
| `gradingInstructorId` | Human-readable instructorId of the **primary** grading instructor. |
| `assistantInstructorIds` | Human-readable instructorIds of additional **grading managers**. (Legacy field name; the UI labels these "Grading Managers". They have the same edit/accept rights as the primary instructor.) |
| `schoolId` / `schoolDocId` | School hosting the grading (optional). |
| `studentMemberId` / `studentMemberDocId` | The student being graded. |
| `status` | Workflow status — see [Workflow](#the-workflow). |
| `gradingEventDate` | Date the grading takes/took place (`YYYY-MM-DD`). |
| `gradingEvent` | Free-text event/location description. |
| `gradingEventDocId` | DocId of a linked `IlcEvent`, or `''` — see [Linking a grading to an event](#linking-a-grading-to-an-event). |
| `instructorAcceptedDate` | Date the request was accepted. |
| `acceptedByMemberDocId` / `acceptedByName` | Who accepted the request (the acceptance milestone; cleared if later declined). The name is a snapshot for display. |
| `statusChangedByMemberDocId` / `statusChangedByName` | Who most recently changed the status (any transition). |
| `notes` | Instructor/manager notes about the grading. |
| `studentNotes` | Optional note from the student with their request. |
| `resultNotes` | Feedback from the instructor to the student after grading. |
| `declineNotes` | Reason given when a request is declined. |
| `reviewIssue` | Why the grading needs admin review (if any). |

When a grading is **both `passed` and paid**, the student's `studentLevel` /
`applicationLevel` is updated to match the grading's `level` (via
`onGradingUpdated`). An unpaid pass does not promote the student; the promotion
happens later, when the payment is recorded.

## The workflow

Statuses are defined by the `GradingStatus` enum:

1. **Awaiting instructor selection** (`pending`) — the student chooses the
   grading instructor and (optionally) the event/date, then submits the request.
2. **Awaiting acceptance** (`awaiting-instructor-acceptance`) — a manager
   accepts or declines.
3. **Awaiting grading** (`awaiting-instructor-grading`) — accepted; waiting for
   the grading to happen and the result to be recorded.
4. **Passed** (`passed`) / **Not passed** (`not-passed`) — the result is
   recorded with notes. Passing updates the student's level.

Other states: **Declined** (`declined`, the student should pick a different
instructor) and **Requires review** (`in-review`, flagged for an admin when an
order's properties don't match the member record — see
[When a payment needs a human](#when-a-payment-needs-a-human)).

The 3-step workflow is rendered by
[`GradingProgressComponent`](../src/app/grading-progress/grading-progress.ts),
which shows each viewer (student, manager, admin) the contextual message and the
fields they can edit for the current step.

### Who can accept

Any **grading manager** can accept (or decline) a request — not just the primary
instructor. Grading managers are:

- the primary instructor (`gradingInstructorId`),
- the assistant managers (`assistantInstructorIds`), and
- the organizer and managers of a [linked event](#linking-a-grading-to-an-event).

When someone accepts, the grading records `acceptedByMemberDocId` /
`acceptedByName`, and the progress view shows **"Accepted by X"**. If the status
is later moved back (e.g. declined). When one manager accepts, the other managers' "you are now a
manager" notifications are updated to note who accepted.

## Linking a grading to an event

A student (or a manager/admin) can link a grading to a listed `IlcEvent` using
the event picker
([`GradingEventInputComponent`](../src/app/grading-event-input/grading-event-input.ts)).
This sets `gradingEventDocId` (and copies the event's title/date into
`gradingEvent` / `gradingEventDate`).

**Consequence of linking:** the event's **organizer** (`ownerDocId`) and
**managers** (`managerDocIds`) automatically become **grading managers** — they
can view, edit, and accept the grading. This is derived **live** from the link:
there is no cached list of event managers on the grading. Unlinking (or linking
to a different event) therefore revokes/grants access automatically.

- This works even for event staff who are **not** licensed instructors — access
  is matched on member docId (via the ACL `memberDocIds`), see
  `isGradingEventManager()` in `firestore.rules` and `userIsEventManager` in the
  grading components.
- Linking notifies the added event managers (`GradingManagerAdded`); unlinking
  notifies the removed ones (`GradingManagerRemoved`) that the student is no
  longer requesting them as a manager.

**Students may change or remove the linked event at any time** until the grading
is finalised (i.e. not yet `passed`, `not-passed`, or `in-review`).

> Note: a grading linked to an event is readable by event managers and reachable
> from their notification link, but it does **not** appear in the cached
> per-instructor / per-school grading lists (those are keyed by instructorId).

## Visibility and permissions

A grading document is **readable** by (enforced in `firestore.rules`):

- the student being graded,
- the grading managers (primary instructor, assistant managers, and the
  organizer/managers of a linked event),
- managers/owner of the hosting school, and
- admins.

**Editable fields by role** (all non-admin writes must set `lastUpdated` to the
server timestamp):

- **Admin** — everything.
- **Grading manager** — `status`, `gradingEvent`, `gradingEventDate`,
  `gradingEventDocId`, `gradingInstructorId`, `assistantInstructorIds`, `notes`,
  `resultNotes`, `declineNotes`, `instructorAcceptedDate`, the `acceptedBy*` and
  `statusChangedBy*` pairs.
- **Student** — `status`, `gradingEvent`, `gradingEventDate`,
  `gradingEventDocId`, `gradingInstructorId`, `studentNotes`, `declineNotes`, and
  the `statusChangedBy*` pair.

All edits are made to the canonical `gradings/{docId}` document, never to the
cached copies.

## Mirroring (cached copies)

To make queries efficient, the whole grading document is mirrored by
`on-grading-update.ts`:

- **Instructors** — `instructors/{instructorMemberDocId}/gradings/{gradingDocId}`
  for the primary instructor, each assistant manager, and the student's primary
  instructor. Re-mirrored on create/update; removed when an instructor is no
  longer associated. Powers the "Gradings Assessed" view.
- **Schools** — `schools/{schoolDocId}/gradings/{gradingDocId}` for the hosting
  school. Powers the "Gradings Hosted" view.

Because the entire document is mirrored, new `Grading` fields propagate to the
caches automatically — no mirroring changes are needed when fields are added.

## Notifications

`on-grading-update.ts` creates member notifications (see `NotificationKind`) for
the key transitions, including: grading purchased, request sent to an instructor,
request accepted/declined, result passed/not-passed, and grading-manager
added/removed (including when an event link makes/removes someone as a manager).
Notifications are de-duplicated per grading, so a manager only ever has one
"current" notification per grading.

The student's **primary instructor** (sifu — `member.primaryInstructorId`) is
also kept in the loop on their students' progress: they are notified when a
student's grading request is **accepted** and when the **result is recorded**
(passed/not-passed). To avoid redundant self-notifications, the sifu is **not**
notified when they are the member who performed that action — i.e. when they
accepted the request (`acceptedByMemberDocId`) or recorded the result
(`statusChangedByMemberDocId`) themselves.

## Admin view

Admins have a view to list all gradings, create, edit, or delete them, and to
search by student, instructor, and school and filter by status, level, and date
— mirroring the "Members" view's search/filter pattern.

## Migrations

`acceptedBy*` / `statusChangedBy*` are newer fields. To backfill existing grading
documents (fill in `acceptedByName`, and seed `statusChangedBy*` from a recorded
acceptance), run:

```bash
cd functions
pnpm run backfill-grading-status-actor --project <projectId> --dry-run   # preview
pnpm run backfill-grading-status-actor --project <projectId>             # apply
```

The script is idempotent (see
[`functions/scripts/data-migrations/backfill-grading-status-actor.ts`](../functions/scripts/data-migrations/backfill-grading-status-actor.ts)).
Reads never break on missing fields because `firestoreDocToGrading()` merges over
`initGrading()` defaults.
