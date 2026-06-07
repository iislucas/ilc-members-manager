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
`grading` document is created in the `gradings` collection. Admins can also
create a grading manually (then `orderId` is the empty string and
`gradingPurchaseDate` is the creation date).

When a grading document is created, the `onGradingCreated` cloud function:

- adds the grading's docId to the student's `member.gradingDocIds`;
- mirrors a cached copy of the whole grading document into the relevant
  instructor and school subcollections (see [Mirroring](#mirroring-cached-copies));
- notifies the student that the grading is ready (and, if an instructor is
  already selected, that the request has been sent);
- if the grading is already linked to an event, notifies that event's
  organizer and managers that they are now grading managers.

## The data model

Key fields on a `Grading` (see `data-model.ts` for the full list and comments):

| Field | Meaning |
|---|---|
| `gradingPurchaseDate` | Date the grading was purchased (or manually created). |
| `orderId` | Order that created it, or `''` if manual. |
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
| `statusChangedByMemberDocId` / `statusChangedByName` | Who most recently changed the status (any transition). Used for the "Moved back by X" display. |
| `notes` | Instructor/manager notes about the grading. |
| `studentNotes` | Optional note from the student with their request. |
| `resultNotes` | Feedback from the instructor to the student after grading. |
| `declineNotes` | Reason given when a request is declined. |
| `reviewIssue` | Why the grading needs admin review (if any). |

When a grading is set to `passed`, the student's `studentLevel` /
`applicationLevel` is updated to match the grading's `level` (via
`onGradingUpdated`).

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
order's properties don't match the member record).

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
is later moved back (e.g. declined), the view shows **"Moved back by X"** based on
`statusChangedBy*`. When one manager accepts, the other managers' "you are now a
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
