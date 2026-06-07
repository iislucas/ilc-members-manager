# User Stories

This directory holds one file per **user story**: a small, self-contained
description of something a member needs the system to do, written from the
user's point of view, with **acceptance criteria** that are concrete enough to
drive an end-to-end (e2e) test against the Firebase emulator.

The goal is a two-way link between intent and implementation:

- **Code → story:** code that implements a story carries a comment
  `// story: docs/user-stories/<story-id>.md` (the full relative path, so the
  link is unambiguous) so you can find the requirement behind it.
- **Story → code/tests:** each story file lists the code and tests that
  satisfy it, so you can find the implementation behind a requirement.

## Conventions

- **One story per file**, named `<story-id>.md` (kebab-case).
- **Story ID** is the file name without `.md` (e.g. `grading-sifu-notifications`).
  It is the stable identifier used in `// story:` code comments, in test
  `describe()` titles, and in the index below. Don't rename a story ID once code
  references it; if a story is dropped, mark it `Status: Retired` instead.
- **Acceptance criteria** are written as `Given / When / Then` scenarios. Each
  scenario should be checkable by a single e2e test. Keep them behavioural
  (observable outcomes), not implementation detail.
- **Linking code:** add a comment `// story: docs/user-stories/<story-id>.md`
  at the top of the function/block that implements a scenario. Tests reference
  the story by putting the ID in the top-level `describe()` (e.g.
  `describe('story: grading-sifu-notifications', ...)`).

## File template

```markdown
# <Title>

- **ID:** <story-id>
- **Status:** Draft | Implemented | Retired
- **Area:** <feature area, e.g. Gradings>

## Story

As a **<role>**, I want **<capability>**, so that **<benefit>**.

## Acceptance criteria

### Scenario: <name>
- **Given** <initial state>
- **When** <action>
- **Then** <observable outcome>

(repeat scenarios as needed)

## Implementation

- Code: <file:symbol references, each marked `// story: docs/user-stories/<story-id>.md`>
- Tests: <e2e/test references, `describe('story: <story-id>', …)`>

## Notes

<edge cases, decisions, open questions>
```

## Running the e2e tests

E2e tests exercise the real Firestore triggers and rules against the Firebase
emulator (no production data is touched). See the developer guide section
"Local Firebase Emulator Development" for the full setup.

```bash
pnpm test:rules        # Firestore security-rules tests (emulator)
pnpm test:e2e          # story-driven e2e tests: real Cloud Function triggers
                       # against the Firestore + Functions emulators
```

Story e2e tests live in `tests/e2e/<story-id>.spec.ts` with the story ID in the
top-level `describe()` (e.g. `describe('story: grading-event-managers', …)`).

## Index

| Story | ID | Status | Area |
|---|---|---|---|
| [Primary instructor notified of student grading progress](grading-sifu-notifications.md) | `grading-sifu-notifications` | Implemented | Gradings |
| [Student sees their grading result and level update](grading-result-recorded.md) | `grading-result-recorded` | Implemented | Gradings |
| [Student's grading request is accepted or declined](grading-request-acceptance.md) | `grading-request-acceptance` | Implemented | Gradings |
| [Linking a grading to an event grants event staff manager access](grading-event-managers.md) | `grading-event-managers` | Implemented | Gradings |
