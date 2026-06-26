# Block new grading requests while payment is outstanding

- **ID:** grading-unpaid-request-guard
- **Status:** Implemented
- **Area:** Gradings

## Story

As **ILC**, I want a student who has a completed grading that hasn't been paid
for yet to be unable to request a new grading from an instructor, so that
students settle outstanding gradings before booking more.

A grading counts as "completed but unpaid" when its status is `passed` or
`not-passed` and its `paymentStatus` is `not-yet-paid` (see `isGradingPaid`).

## Acceptance criteria

- When a non-admin student tries to request a grading (move it to
  `awaiting-instructor-acceptance`) while they have any other completed grading
  that is not yet paid, the request is refused.
  - **Client:** the request form shows a "Payment outstanding" warning and the
    Submit button is disabled (`grading-progress`).
  - **Server:** the `onGradingUpdated` trigger reverts the status (and grading
    instructor) back to its previous value and notifies the student. This is the
    authoritative check, since Firestore rules cannot query the student's other
    gradings.
- **Admins are exempt** — they can move a grading into acceptance regardless
  (the trigger skips the check when the acting member, `statusChangedByMemberDocId`,
  is an admin).
