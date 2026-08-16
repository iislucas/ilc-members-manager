# Student sees their grading result and level update

- **ID:** grading-result-recorded
- **Status:** Implemented
- **Area:** Gradings

## Story

As a **student**, I want to be told as soon as my grading result is recorded and
to have my level updated automatically when I pass, so that my membership
record always reflects my current level without anyone updating it by hand.

## Acceptance criteria

### Scenario: notified and levelled up on a pass
- **Given** a student with a grading for `Student 3` being graded,
- **When** a grading manager sets the result to `passed`,
- **Then** the student receives a notification (kind `GradingPassed`) for that
  level,
- **and** the student's `studentLevel` is updated to `3`.

### Scenario: application levels update the application field
- **Given** a student with a grading for `Application 2` being graded,
- **When** a grading manager sets the result to `passed`,
- **Then** the student's `applicationLevel` is updated to `2` (not
  `studentLevel`).

### Scenario: notified but not levelled down on a not-pass
- **Given** a student with a grading being graded,
- **When** a grading manager sets the result to `not-passed`,
- **Then** the student receives a notification (kind `GradingNotPassed`),
- **and** the student's level is unchanged.

### Scenario: result notification is replaced, not duplicated
- **Given** a student who already has a `GradingPassed`/`GradingNotPassed`
  notification for a grading,
- **When** the result for that same grading is changed again,
- **Then** the student still has exactly one current notification for that
  grading (de-duplicated by `gradingDocId`).

## Implementation

- Code: `functions/src/on-grading-update.ts` → `onGradingUpdated`
  - level update on `passed` (via `extractLevelValue`),
  - student `GradingPassed` / `GradingNotPassed` notifications.
- Tests: _planned_ — emulator-driven trigger test under `tests/`,
  `describe('story: grading-result-recorded', …)`.

## Notes

- The sifu also gets notified about the result — that is a separate story,
  [grading-sifu-notifications](grading-sifu-notifications.md).
- See [docs/gradings.md](../gradings.md) → The data model / Workflow.
