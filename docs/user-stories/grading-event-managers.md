# Linking a grading to an event grants event staff manager access

- **ID:** grading-event-managers
- **Status:** Implemented
- **Area:** Gradings

## Story

As a **student**, I want to link my grading to a listed event, so that the
event's organizer and helpers can manage and grade it — even helpers who are not
licensed instructors.

As an **event organizer or manager**, I want grading-manager access to gradings
linked to my event (and to lose it when they are unlinked), so that access
tracks the event link automatically without anyone maintaining a list.

## Acceptance criteria

### Scenario: linking grants access and notifies
- **Given** a grading not linked to any event,
- **and** an event with organizer O and manager M,
- **When** the grading is linked to that event (`gradingEventDocId` set),
- **Then** O and M can read/edit/accept the grading,
- **and** O and M each receive a `GradingManagerAdded` notification referencing
  the event.

### Scenario: unlinking revokes access and notifies
- **Given** a grading linked to an event with organizer O and manager M,
- **When** the grading is unlinked (or linked to a different event),
- **Then** O and M can no longer read/edit/accept the grading,
- **and** O and M each receive a `GradingManagerRemoved` notification.

### Scenario: non-instructor event staff can manage
- **Given** an event manager M who is **not** a licensed instructor,
- **When** a grading is linked to that event,
- **Then** M (matched by member docId) can still read/edit/accept the grading.

### Scenario: access is live, not cached
- **Given** a grading linked to an event,
- **When** the event's `managerDocIds` change,
- **Then** grading-manager access reflects the new managers without re-saving
  the grading.

### Scenario: an event manager accepts the linked grading
- **Given** a grading linked to an event with organizer O and manager M,
  awaiting acceptance,
- **When** manager M accepts the request (status →
  `awaiting-instructor-grading`, recording `acceptedByMemberDocId` /
  `acceptedByName` as M),
- **Then** the student receives a `GradingRequestAccepted` notification,
- **and** the other event managers' (O's) `GradingManagerAdded` notification is
  annotated with who accepted ("Accepted by M"),
- **and** M's own notification is **not** annotated.

### Scenario: a non-instructor event manager can grade the linked grading
- **Given** a grading linked to an event, accepted by event manager M (who is
  not a licensed instructor),
- **When** M records the result (e.g. `passed`),
- **Then** the result is saved and the student is notified of it — i.e. event
  staff can carry a grading all the way through, not just accept it.

## Implementation

- Code: `functions/src/on-grading-update.ts`
  - `resolveEventManagers()`, `notifyEventManagers()`, and the event-link
    change handling in `onGradingCreated` / `onGradingUpdated`.
  - `annotateManagerNotificationsWithAcceptor()` (the acceptance flow).
- Access control: `firestore.rules` → `isGradingEventManager()`.
- UI: `userIsEventManager` in the grading components.
- Tests: `tests/e2e/grading-event-managers.spec.ts`
  (`describe('story: grading-event-managers', …)`), run against the Firebase
  emulator via `pnpm test:e2e`.

## Notes

- Linked gradings are readable by event managers but do **not** appear in the
  cached per-instructor / per-school grading lists (those are keyed by
  instructorId).
- See [docs/gradings.md](../gradings.md) → Linking a grading to an event.
