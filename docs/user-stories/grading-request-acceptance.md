# Student's grading request is accepted or declined

- **ID:** grading-request-acceptance
- **Status:** Implemented
- **Area:** Gradings

## Story

As a **student**, I want to know when the instructor I asked accepts or declines
my grading request, so that I know whether to prepare to be graded or to choose
a different instructor.

As a **grading manager**, I want to be able to accept or decline a request I am
responsible for, even if I am not the named primary instructor, so that any
manager of the grading can move it forward.

## Acceptance criteria

### Scenario: any grading manager can accept
- **Given** a grading awaiting acceptance with primary instructor A and
  assistant manager B,
- **When** manager B accepts the request,
- **Then** the status moves to `awaiting-instructor-grading`,
- **and** `acceptedByMemberDocId` / `acceptedByName` record manager B.

### Scenario: student notified on acceptance
- **Given** a grading awaiting acceptance,
- **When** a manager accepts it,
- **Then** the student receives a notification (kind `GradingRequestAccepted`).

### Scenario: student notified and asked to re-pick on decline
- **Given** a grading awaiting acceptance,
- **When** a manager declines it (status → `declined`),
- **Then** the student receives a notification (kind `GradingRequestDeclined`)
  prompting them to select a different instructor,
- **and** the declined instructor's "requests you" notification is cancelled.

### Scenario: other managers see who accepted
- **Given** a grading with several managers, each holding a "you are now a
  manager" notification,
- **When** one manager accepts,
- **Then** the other managers' notifications are annotated with who accepted
  (the acceptor's own notification is not annotated).

## Implementation

- Code: `functions/src/on-grading-update.ts` → `onGradingUpdated`
  - student accepted/declined notifications,
  - `annotateManagerNotificationsWithAcceptor()`.
- Access control: `firestore.rules` (`isGradingManager` / `isGradingEventManager`).
- Tests: _planned_ — emulator-driven trigger + rules tests under `tests/`,
  `describe('story: grading-request-acceptance', …)`.

## Notes

- "Grading manager" = primary instructor + assistant managers + organizer/
  managers of a linked event. See
  [grading-event-managers](grading-event-managers.md).
- See [docs/gradings.md](../gradings.md) → The workflow / Who can accept.
