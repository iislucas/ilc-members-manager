---
name: codebase-architecture
description: Always read this first. Contains the key architectural patterns, component map, data flow, and how-to guides for the ILC Members Manager codebase. Saves you from re-exploring the code each session.
---

# ILC Members Manager — Architecture Reference

Read this before exploring code. It records the non-obvious patterns discovered during development.

---

## Collections & Data Model

Firestore collections and their TypeScript types (all defined in [functions/src/data-model.ts](../../functions/src/data-model.ts)):

| Collection | Type | Notes |
|---|---|---|
| `/members/{docId}` | `Member` | Primary member record |
| `/schools/{docId}` | `School` | School record; has sub-collections |
| `/instructors/{docId}` | `InstructorPublicData` | Public profile, mirrored from Member |
| `/gradings/{docId}` | `Grading` | One per grading purchase |
| `/events/{docId}` | `IlcEvent` | Calendar-synced + member-proposed |
| `/orders/{docId}` | `SheetsImportOrder \| SquareSpaceOrder` | |
| `/acl/{email}` | `ACL` | Permissions per login email |
| `/system/{doc}` | various | Counters, country codes, cache metadata |

### Subcollections
- `/instructors/{id}/members/{memberDocId}` — cached student list
- `/instructors/{id}/gradings/{gradingDocId}` — cached gradings for instructor
- `/schools/{id}/members/{memberDocId}` — cached school members
- `/schools/{id}/gradings/{gradingDocId}` — cached school gradings
- `/members/{id}/notifications/{notifId}` — `MemberNotification`

### Data model conventions
- Every type has `initXxx()` (all-defaults object) and `firestoreDocToXxx()` (merge over defaults).
- **Never write untyped objects to Firestore**; always use the typed domain model.
- `docId` is never stored inside the Firestore document — it's added on read from `doc.id`.
- `lastUpdated` is stored as a Firestore `Timestamp` but converted to ISO string on read.

### Grading type key fields
```typescript
gradingEventDate: string;    // YYYY-MM-DD, when grading takes place
gradingEvent: string;        // free-text location/event description
gradingEventDocId: string;   // Firestore docId of a linked IlcEvent ('' if none)
status: GradingStatus;
```

---

## Firestore Security Rules

File: [firestore.rules](../../firestore.rules)

**Default-deny**. All reads/writes are `false` unless explicitly allowed.

### Grading update permissions (key rule)
- **Admin**: full write via `allow write`
- **Instructor** (`isGradingInstructor()`): can update `status`, `gradingEventDate`, `gradingEvent`, `gradingEventDocId`, `notes`, `instructorAcceptedDate`, `resultNotes`, `assistantInstructorIds`, `declineNotes`
- **Student** (`isGradingStudent()`): can update `status`, `gradingEvent`, `gradingEventDocId`, `gradingInstructorId`, `studentNotes`, `declineNotes`
- All non-admin updates require `lastUpdated == request.time` (use `serverTimestamp()` on write)

> **When adding new Grading fields**: add them to the appropriate `affectedKeys().hasOnly(...)` list in [firestore.rules](../../firestore.rules), and add tests in [tests/firestore.rules.spec.ts](../../tests/firestore.rules.spec.ts).

---

## Angular App Structure

### State & Data Flow
- [`DataManagerService`](../../src/app/data-manager.service.ts) is the central data service. It holds `SearchableSet` instances that are populated via Firestore `onSnapshot()` listeners.
- [`FirebaseStateService`](../../src/app/firebase-state.service.ts) handles auth and the raw Firebase `App` / `Firestore` / `Auth` objects.
- The Firebase `App` is provided via `FIREBASE_APP` injection token in [app.config.ts](../../src/app/app.config.ts).

### SearchableSet + AutocompleteComponent pattern
`SearchableSet<ID, T>` ([src/app/searchable-set.ts](../../src/app/searchable-set.ts)) wraps a MiniSearch index with Angular signals. It exposes:
- `.entries()` — signal of all items
- `.get(id)` — synchronous lookup by ID
- `.setEntries(items)` — replace all items
- `.search(term, opts?)` — fuzzy search returning IDs

`AutocompleteComponent` ([src/app/autocomplete/autocomplete.ts](../../src/app/autocomplete/autocomplete.ts)) takes:
```typescript
[searchableSet]="mySet"
[displayFns]="{ toChipId: (item) => item.id, toName: (item) => item.label }"
[inputBoxIsChip]="false"   // set false for plain text (no chip badge)
placeholder="Search..."
(itemSelected)="onSelected($event)"
(textUpdated)="onTextChange($event)"
```

**To add a new autocomplete for a data type not already in the service**: create a local `SearchableSet` in the component, load data via a `dataService.getXxx()` call inside an `effect()`, and call `set.setEntries(results)`.

### Display format conventions (enforced everywhere)
- Member display: `(MEM-001) Full Name`  — extract ID with `/^\(([^)]+)\)/`
- Instructor display: `Full Name [INST-001]` — extract ID with `/\[([^\]]+)\]$/`

### Component anti-patterns to avoid
- **Never `subscribe()`** in components — use `toSignal()` or `effect()`
- **Never constructor injection** — always `inject()`
- **No NgModules, CommonModule, NgIf, NgFor** — use `@if`, `@for`, standalone components
- **Never `any` type** — use `unknown` or proper types

---

## Grading Component Map

| Component | Path | Role |
|---|---|---|
| `GradingListComponent` | [src/app/grading-list/](../../src/app/grading-list/) | List with search, admin/instructor/student tabs |
| `GradingRowHeaderComponent` | [src/app/grading-row-header/](../../src/app/grading-row-header/) | Single row summary (status, name, level, instructor, date, event) |
| `GradingEditComponent` | [src/app/grading-edit/](../../src/app/grading-edit/) | Full edit form with role-based field permissions |
| `GradingViewComponent` | [src/app/grading-view/](../../src/app/grading-view/) | Detail page at `/gradings/{id}` |
| `GradingProgressComponent` | [src/app/grading-progress/](../../src/app/grading-progress/) | Visual 3-step workflow indicator |

### GradingEditComponent form permission summary
Uses Angular Signal Forms (`form()` from `@angular/forms/signals`). Disabled rules:
- **Admin-only**: `gradingPurchaseDate`, `orderId`, `level`, `studentMemberId`, `studentMemberDocId`, `assistantInstructorIds`, `schoolId`, `reviewIssue`
- **Instructor or admin**: `status`, `gradingEventDate`, `notes`, `instructorAcceptedDate`, `resultNotes`
- **Instructor, student, or admin**: `gradingEvent`, `gradingEventDocId`, `gradingInstructorId`
- **Student or admin**: `studentNotes`

---

## Firebase Emulator Setup

### Full startup sequence (do this in order)

```bash
# 1. Build functions first — REQUIRED before starting the emulator
#    The functions environment file must be up to date: functions/src/environment/environment.ts
pnpm build:functions

# 2. Start all emulators (auth 9099, Firestore 8080, functions 5001, storage 9199, UI 4000)
pnpm emulator:start

# 3. Export anonymized prod data (only needed once, or when prod data changes significantly)
pnpm export:anonymized   # → tmp/seed-data/*.json

# 4. Seed the emulator (with emulators running)
pnpm seed:emulator       # Firestore + Auth accounts

# 5. Start Angular dev server wired to emulators (separate terminal)
pnpm start:emulator
```

### Test login credentials
All seeded Auth accounts use password `testpassword123`:
- **Admin**: `member-us536@example.com`
- **Regular member**: `member-pl100@example.com`
- Any other member: `member-{memberId.toLowerCase()}@example.com`

### How emulator connection works
[app.config.ts](../../src/app/app.config.ts) calls `connectFirestoreEmulator` / `connectAuthEmulator` / `connectFunctionsEmulator` / `connectStorageEmulator` eagerly (IIFE at module-load time, not lazy) when `environment.useEmulator === true`. The emulator environment file is [src/environments/environment.emulator.ts](../../src/environments/environment.emulator.ts).

> **Why IIFE not useFactory**: Services that call `getFirestore()` with no app argument (e.g. `notification.service.ts`) rely on the default Firebase app being registered at module-load time. `useFactory` is lazy and breaks those services in tests and on first load.

### Known gotchas

**1. Functions not loaded** — always `pnpm build:functions` before `pnpm emulator:start`. The emulator loads from `functions/dist/` at startup and does NOT hot-reload TypeScript source. It DOES hot-reload if you rebuild the JS dist while it's running.

**2. Missing `functions/src/environment/environment.ts`** — `build:functions` will fail silently (type errors) if this file is missing or incomplete. It must include `googleCalendar.calendarId`. Copy from `environment.template.ts` if needed.

**3. Timestamp deserialization** — `firebase-admin` exports Firestore Timestamps as `{_seconds, _nanoseconds}` plain objects in JSON. The seed script restores these to proper `admin.firestore.Timestamp` instances before writing, so `firestoreDocToXxx()` converters work. If you see `RangeError: Invalid time value` from `firestoreDocToMember`, this is why.

**4. Email case-sensitivity** — `checkEmailStatus` and `getUserDetails` normalize emails to lowercase. ACL document IDs must therefore be lowercase. The export script produces all email-based IDs as `member-{memberId.toLowerCase()}@example.com`.

**5. `onMemberCreated` crash in emulator** — the trigger fires when the seed script writes member docs, but crashes with `TypeError: Cannot read properties of undefined (reading 'arrayUnion')`. This is a pre-existing functions emulator issue (FieldValue not available in the emulator environment). It doesn't affect seeded data since the ACL is seeded separately. Not blocking for development.

Angular build configuration `emulator` (in [angular.json](../../angular.json)) swaps in `environment.emulator.ts`.

### Anonymization rules (export script)
See [functions/scripts/export-anonymized-data.ts](../../functions/scripts/export-anonymized-data.ts). Key mappings:
- Member name → `"Test Member {memberId}"`
- Member emails → `["member-{memberId}@example.com"]`
- ACL doc key → `"member-{memberId}@example.com"` (consistent with member emails)
- Instructor name → `"Instructor {instructorId}"`
- School name → `"Test School {schoolId}"`

---

## Firebase Functions (Cloud Functions)

Key triggers in [functions/src/](../../functions/src/):

| File | Trigger | Purpose |
|---|---|---|
| `on-grading-update.ts` | Firestore onUpdate `/gradings/{id}` | Mirrors to instructor/school subcollections, sends notifications, updates student level on Pass |
| `on-member-update.ts` | Firestore onUpdate `/members/{id}` | Mirrors member to instructor/school subcollections |
| `on-school-update.ts` | Firestore onUpdate `/schools/{id}` | Updates ACL for school managers |
| `mirror-instructors-to-public-profile.ts` | onUpdate member | Syncs member → `/instructors/{id}` |
| `backup.ts` | Scheduled | Exports all collections to Cloud Storage |

> **When adding new fields to `Grading`**: `on-grading-update.ts` mirrors the whole document, so no changes needed there. But update `firestore.rules` + its tests.

---

## Testing

```bash
pnpm test              # vitest unit tests (Angular components, utils)
pnpm test:rules        # Firestore rules tests (spins up emulator)
pnpm test:functions    # Firebase functions unit tests
```

Rules tests are in [tests/firestore.rules.spec.ts](../../tests/firestore.rules.spec.ts). They use `@firebase/rules-unit-testing` and a dedicated project ID `ilc-members-manager-tests`. The emulator is started automatically via `firebase emulators:exec`.

**After adding new Grading fields**: run `pnpm test:rules` to catch permission gaps.
**After any code change**: run `pnpm build` — template errors and complex type mismatches only surface at build time.
