# Primary instructor notified of student grading progress

- **ID:** grading-sifu-notifications
- **Status:** Implemented
- **Area:** Gradings

## Story

As a **primary instructor (sifu)**, I want to be notified when one of my
students' gradings is **accepted** and when its **result is recorded**, so that
I can stay aware of my students' progress even when I am not the grading
manager handling it.

A student's primary instructor is `member.primaryInstructorId` (see the "sifu"
terminology in the developer guide). The sifu is distinct from the grading
manager who accepts/grades a request — which may be a different instructor or an
event organizer.

## Acceptance criteria

### Scenario: notified when a student's grading request is accepted
- **Given** a student whose `primaryInstructorId` is Sifu A,
- **and** a grading for that student awaiting acceptance, with grading manager
  Instructor B (B ≠ A),
- **When** Instructor B accepts the request (status →
  `awaiting-instructor-grading`),
- **Then** Sifu A receives a notification (kind `GradingRequestAccepted`) naming
  the student and the accepting manager.

### Scenario: notified when a student's result is recorded as passed
- **Given** a student whose `primaryInstructorId` is Sifu A,
- **and** a grading for that student being graded by Instructor B (B ≠ A),
- **When** Instructor B records the result as `passed`,
- **Then** Sifu A receives a notification (kind `GradingPassed`) naming the
  student.

### Scenario: notified when a student's result is recorded as not passed
- **Given** a student whose `primaryInstructorId` is Sifu A,
- **and** a grading for that student being graded by Instructor B (B ≠ A),
- **When** Instructor B records the result as `not-passed`,
- **Then** Sifu A receives a notification (kind `GradingNotPassed`) naming the
  student.

### Scenario: sifu is not notified about their own action
- **Given** a student whose `primaryInstructorId` is Sifu A,
- **and** a grading for that student where Sifu A is the grading manager,
- **When** Sifu A accepts the request, or records the result,
- **Then** Sifu A receives **no** "your student" notification for that action
  (the actor is matched via `acceptedByMemberDocId` for acceptance and
  `statusChangedByMemberDocId` for the result).

### Scenario: no sifu, no notification
- **Given** a student with no resolvable `primaryInstructorId`,
- **When** the grading is accepted or its result is recorded,
- **Then** no primary-instructor notification is created (only the existing
  student/manager notifications).

## Implementation

- Code: `functions/src/on-grading-update.ts` (marked `// story: docs/user-stories/grading-sifu-notifications.md`)
  - `resolvePrimaryInstructorToNotify()` — resolves the sifu to notify, skipping
    when there is no sifu, the sifu is the actor, or the sifu is the student.
  - `onGradingUpdated` — calls it in the acceptance branch and in the
    passed / not-passed result branches.
- Tests: _planned_ — emulator-driven trigger test under `tests/`,
  `describe('story: grading-sifu-notifications', …)`.

## Notes

- De-duplication is per grading per member, so the sifu only ever holds one
  "current" notification per grading (an accept notification is replaced by the
  later result notification).
- Reuses the student-facing notification kinds (`GradingRequestAccepted`,
  `GradingPassed`, `GradingNotPassed`) with sifu-tailored markdown rather than
  introducing new kinds.
- See also [docs/gradings.md](../gradings.md) → Notifications.
