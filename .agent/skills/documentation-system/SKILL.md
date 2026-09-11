---
name: documentation-system
description: Guide for authoring, structuring, and maintaining documentation in ILC Members Manager. Enforces the 5-view unified mental model (Setup, User Journeys & Interaction Graphs, Data Types, Architecture Flow, Patterns), cross-linking requirements, dual code link formats (VS Code & GitHub), file/data/story catalogs, docs website generation, and implementation plan lifecycle (deleting implemented plans from docs/plans/ and updating canonical docs).
---

# ILC Documentation System & Authoring Guide

This skill governs how documentation is created, structured, cross-linked, and maintained across the ILC Members Manager codebase.

---

## 1. The 5-View Unified Mental Model

All system documentation is organised into **five interrelated and interlinked perspectives**. No feature, component, or system change is fully documented unless it is represented across or connected to these five views:

```
                      ┌───────────────────────────────────────┐
                      │                VIEW 1                 │
                      │       Setup & Instance Creation       │
                      │  (Dev, Emulators, GCP, Provisioning)  │
                      └──────────────────┬────────────────────┘
                                         │
                                         │ seeds & configures
                                         ▼
┌────────────────────────┐  interlinks   ┌────────────────────────┐
│         VIEW 2         │ ────────────> │         VIEW 3         │
│ User Journeys & Graphs │ <──────────── │    Core Data Types     │
│ (Actors, Plans, Views) │   operates on │ (Groups, Schema, Dims) │
└───────────┬────────────┘               └───────────┬────────────┘
            │                                        │
            │ initiates                  mutates &   │
            │ actions                   persists to  │
            ▼                                        ▼
┌─────────────────────────────────────────────────────────────────┐
│                             VIEW 4                              │
│             Information Flow & System Architecture              │
│         (Signals, Triggers, Mirroring, Webhooks, VOD)           │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 │ implements abstract patterns from
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                             VIEW 5                              │
│              Core Architectural & Data Patterns                 │
│         (initXxx, Timestamps, SearchableSet, ACL Cache)         │
└─────────────────────────────────────────────────────────────────┘
```

---

### View 1: Setup & Instance Creation (`docs/setup/`)
- **Target Audience:** Developers, DevOps, HQ Administrators setting up a new chapter or local environment.
- **Scope:**
  - Local workstation prerequisites: Node.js, pnpm (strict prohibition of npm/npx), Java JRE for Firebase emulator, Google Cloud SDK (`gcloud`), Firebase CLI (`firebase-tools`).
  - Environment files configuration: `src/environments/environment.local.ts`, `environment.emulator.ts`, `functions/src/environment/environment.ts`.
  - Local Firebase Emulator Suite startup sequence (`pnpm build:functions` -> `pnpm emulator:start` -> `pnpm export:anonymized` -> `pnpm seed:emulator` -> `pnpm start:emulator`).
  - Anonymized production data exports & seed datasets (`tmp/seed-data/*.json`, `tests/fixtures/seed/`).
  - Seed test accounts & credentials (`member-us536@example.com`, `testpassword123`).
  - Production GCP / Firebase cloud instance provisioning: Firestore DB creation, Auth configuration, Storage bucket CORS, Cloud Functions deploy, Security rules deploy.
  - Third-party integrations: Stripe webhook registration (`pnpm register:stripe-webhook`), Stripe products & prices sync (`pnpm sync:video-products`), GCP Transcoder API & Pub/Sub configuration for VOD.
  - Standalone Web Components build & deploy (`find-an-instructor-wc`, `events-viewer-wc`, `markdown-editor-wc`).
  - Backup & Disaster Recovery: Scheduled Cloud Function exports (`functions/src/backup.ts`) to GCS.

---

### View 2: Users, Key Journeys & Multi-User Interaction Graphs (`docs/user-journeys/`)
- **Target Audience:** Product managers, developers building UI/UX, QA engineers, end users.
- **Three-Tier Exploration Structure:**
  1. **User Actors & Personas:**
     - **ILC Admins (HQ):** Global governance, member verification, manual grading generation, order overrides, backups.
     - **School Managers:** School profile, student roster, school gradings, school license renewals.
     - **Instructors / Sifus:** Mentorship roster, grading evaluations (accept/decline/result), public profile (`/instructors/{id}`), license renewals.
     - **Students / Members:** Digital passbook, grading requests/payments, event registrations, VOD streaming, order history, profile updates.
     - **Event Organizers:** Event proposals, ticket tier management, attendee check-in, event-linked grading management.
     - **Public Visitors:** Instructor locator, school locator, event calendar, video trailers, membership application.
  2. **Site Surface Map (What Users Do on Each Part of the Site):**
     - Complete mapping of all 97+ application views (from `Views` enum in `src/app/app.config.ts`) to:
       - Which actors have permission to view it.
       - What actions and mutations each actor can perform on that screen.
       - What form controls, dialogs, or subcomponents are active.
  3. **Multi-User Collaborative Interaction Graphs (Directed Plans):**
     - User flows are not isolated single-user linear steps; they form **directed node-edge interaction graphs (Plans)** representing multi-actor collaboration:
       - *The Grading Examination Plan:* Student requests/pays -> Sifu notified & accepts/declines -> Event Manager links event -> Examiner conducts test & inputs result -> System triggers level upgrade & mirrors records -> Student views updated passbook.
       - *The Event Hosting & Ticketing Plan:* Organizer proposes event -> Admin approves/publishes -> Attendee purchases ticket -> Stripe webhook issues ticket & mirror registrations -> Organizer checks in attendee.
       - *The School & Instructor Licensing Plan:* School Manager renews license -> Stripe webhook updates school record -> Cloud trigger recalculates `/acl/{email}` -> School Instructors and Students receive access privileges.
     - Interactive Graph Explorer: The documentation website renders these plans as interactive, clickable directed graphs where nodes represent actor actions or system events and edges represent data transitions.
  4. **User Stories Framework:**
     - Integration with `docs/user-stories/<story-id>.md`.
     - Given/When/Then acceptance criteria linked to e2e emulator tests (`tests/e2e/<story-id>.spec.ts`) and source code (`// story: docs/user-stories/<story-id>.md`).

---

### View 3: Core Data Types, Groups & Levels of Detail (`docs/data-types/`)
- **Target Audience:** Backend developers, frontend data service authors, database auditors.
- **Domain Grouping:**
  All data models are organized into 8 functional domain groups:
  1. *Identity, Membership & Authorization:* `Member`, `ACL`, `InstructorPublicData`
  2. *Organizational & School:* `School`, cached student rosters, cached school gradings
  3. *Curriculum & Progression:* `Grading`, `curriculum.ts` progression, levels, status actors
  4. *Events & Ticketing:* `IlcEvent`, `EventRegistration`, `Product`
  5. *Media & VOD Streaming:* `VideoItem`, `VideoGrant`, `VideoProgress`, `VideoTimeRange`
  6. *Commerce & Fulfillment:* `Order` (`StripeOrder`, `SquareSpaceOrder`, `SheetsImportOrder`), customer portal, licenses
  7. *Community & Content:* `MembersPost`, `ArticlesPost`, `NewsPost`, `content-cache.ts`
  8. *System & Infrastructure:* `Counters`, `CacheMetadata`, `Statistics`, `PushSubscription`
- **Three Hierarchical Levels of Detail:**
  - **Level 1 (Executive & Domain Summary):** Purpose of entity, collection path (`FirestoreCollection`), cardinality, owner, and key relationships.
  - **Level 2 (Data Flow & Security Summary):** Who can read/write, security rule summary (`firestore.rules`), mirroring targets, attached Cloud Function triggers.
  - **Level 3 (Full Technical Schema):** Exact TypeScript interface, `initXxx()` zero-default values, `firestoreDocToXxx()` converter logic, field-by-field dictionary with types, nullability, constraints, and Firestore timestamp conversions.

---

### View 4: Information Flow & System Architecture (`docs/architecture/`)
- **Target Audience:** System architects, full-stack engineers, security auditors.
- **Scope:**
  - End-to-end data pipelines:
    1. **Client UI Reactivity Pipeline**: User gesture -> Angular Signals / Signal Forms -> `DataManagerService` -> Firestore `onSnapshot` real-time listeners -> `SearchableSet` (MiniSearch) -> OnPush DOM render.
    2. **Document Mutation & Cloud Trigger Automation Pipeline**: Client write -> `firestore.rules` validation -> Firestore mutation -> Cloud triggers (`onGradingUpdate`, `onMemberUpdate`, `onSchoolUpdate`, `mirrorInstructorsToPublicProfile`) -> Subcollection mirroring -> ACL recalculation -> Notification generation -> Connected client snapshot auto-update.
    3. **E-Commerce & Stripe Webhook Pipeline**: Client checkout request -> `createStripeCheckoutSession` -> Stripe hosted checkout -> Webhook `checkout.session.completed` -> `stripeWebhook` Cloud Function -> Order recording -> `stripe-fulfillment.ts` -> Member subscription extension / Grading doc creation / Video grant / Event ticket issuance.
    4. **VOD Media Transcoding & Streaming Pipeline**: Video upload to GCS -> Transcode trigger -> GCP Cloud Transcoder API -> Multi-bitrate HLS playlist & fragments -> Pub/Sub -> `onTranscodeFinished` -> Video doc status update -> `getVideoPlaybackSession` authentication -> Signed URLs -> Hls.js playback + IndexedDB offline caching.
    5. **Web Components Embedding Pipeline**: Angular Elements packaging -> `events-viewer.wc`, `find-an-instructor.wc` -> Embed script distribution -> Public Firestore read integration.
  - Interactive orthogonal architecture diagrams generated via `@ilc/diagram-router`.

---

### View 5: Core Architectural & Data Patterns in the Abstract (`docs/patterns/`)
- **Target Audience:** All developers learning the design philosophy and patterns of the codebase.
- **Catalog of Abstract Patterns:**
  1. **The Firestore Timestamps & Concurrency Pattern:**
     - Write-time server assertion: `lastUpdated == request.time` in `firestore.rules`.
     - Client-side write using `serverTimestamp()`.
     - Read-time deserialization: Firestore `Timestamp` (`{ _seconds, _nanoseconds }`) converted to standard ISO 8601 strings in converters.
     - Emulator seeding: Restoring raw JSON timestamps back to `admin.firestore.Timestamp` instances to prevent `RangeError: Invalid time value`.
  2. **The `initXxx()` Zero-Default & Converter Anti-Partial-Data Pattern:**
     - Problem: Firestore documents with missing or partial fields cause runtime `undefined` property crashes.
     - Solution: Every domain type has an `initXxx()` constructor returning complete default values for all properties. The `firestoreDocToXxx(doc)` converter merges database data over this default object, guaranteeing defined properties everywhere.
  3. **The SearchableSet + AutocompleteComponent Pattern:**
     - Reactive state container wrapping a `MiniSearch` index with Angular Signals (`entries()`, `get(id)`, `search()`, `setEntries()`).
     - Decoupled `AutocompleteComponent` with custom display adapters and regex-based ID extractors (`(ID) Name` or `Name [ID]`).
  4. **The Zoneless Signals & OnPush Reactivity Pattern:**
     - Angular 21 zoneless change detection using Signals (`signal()`, `computed()`, `effect()`).
     - Strict avoidance of RxJS in components (`toSignal()`, no `subscribe()`).
     - Native template control flow (`@if`, `@for`, `@switch`).
     - Signal-based Forms with dynamic role-based disabled states.
  5. **The Subcollection Mirroring & Fan-Out Cache Pattern:**
     - Top-level document mutations trigger Cloud Functions to copy full or partial snapshots into subcollections (`/instructors/{id}/gradings/{id}`, `/schools/{id}/members/{id}`).
     - Enables low-latency, strictly scoped client-side queries without complex join operations.
  6. **The Dynamic Derived Permissions Pattern:**
     - Avoids stale denormalized access control fields on documents.
     - E.g. `isGradingEventManager()` in `firestore.rules` performs a live, guarded `get()` on `/events/{gradingEventDocId}` to dynamically derive permissions from the linked event's organizers.
  7. **The Fast-Lookup ACL Email Key Cache Pattern:**
     - Centralized `/acl/{lowercaseEmail}` document caching aggregate roles, linked IDs, and expiration dates.
     - Normalized to lowercase to guarantee deterministic rule evaluation.
  8. **Early Domain Typing on Snapshots & Typed Mutation Accumulators:**
     - Immediate casting on document snapshot read (`snap.data() as Member`).
     - Update payloads typed with `Partial<DomainType>` (e.g. `Partial<EventRegistration>` or `MemberUpdates`), preventing bracket-string errors.
  9. **Protected VOD Streaming & Offline IndexedDB Storage Pattern:**
     - Two-phase authorization: Cloud Function checks grant -> short-lived signed playback token -> Hls.js segment streaming.
     - Offline caching: IndexedDB chunk storage with service worker intercept.
  10. **Autonomous Micro-Frontend Web Components Pattern:**
     - Packaging standalone components (`find-an-instructor.wc`, `events-viewer.wc`) using `@angular/elements` for external CMS embed without Angular framework collision.

---

## 2. Mandatory Interlinking Rules (The 5-Way Link Contract)

Every document in the documentation system must explicitly link to relevant entities in the other views:

| Current Document View | Must Explicitly Link To: |
|---|---|
| **View 1: Setup & Instances** | • **View 2:** Which user accounts/credentials test this setup.<br>• **View 3:** Which data types are seeded or provisioned.<br>• **View 4:** Which pipelines/services this setup boots.<br>• **View 5:** Patterns relevant to configuration and seeding. |
| **View 2: User Journeys & Graphs** | • **View 1:** Local emulator setup & seed accounts to reproduce the journey.<br>• **View 3:** Which data models are read or mutated by the user.<br>• **View 4:** The information flow and triggers executing during the journey.<br>• **View 5:** Abstract patterns employed by the journey.<br>• **User Stories:** Direct links to `docs/user-stories/<id>.md`.<br>• **Code:** Direct links to Angular UI components and services. |
| **View 3: Data Types** | • **View 1:** How the collection is seeded (`seed-emulator.ts`) and configured.<br>• **View 2:** Which personas have read/write/edit access to the data.<br>• **View 4:** The triggers and security rules that guard and mirror the data.<br>• **View 5:** Abstract data patterns (`initXxx`, timestamps, casting).<br>• **Code:** Direct links to `data-model/*.ts` and `firestore.rules`. |
| **View 4: Architecture Flow** | • **View 1:** Setup requirements and emulator flags for the pipeline.<br>• **View 2:** User interactions that trigger the flow.<br>• **View 3:** Input, intermediate, and output data structures.<br>• **View 5:** Design patterns governing the flow.<br>• **Code:** Direct links to Cloud Functions (`functions/src/*`) and client services. |
| **View 5: Patterns** | • **View 1:** Seed/config scripts implementing the pattern.<br>• **View 2:** User journeys influenced by the pattern.<br>• **View 3:** Data types utilizing the pattern.<br>• **View 4:** Information flows structured by the pattern.<br>• **Code:** Canonical code examples demonstrating the pattern. |

---

## 3. Code Linking Standards

To ensure docs are actionable during local development and online review, all code references must provide direct, clickable links using standard formats:

### Dual Code Link Convention
In Markdown and HTML documentation, provide both local IDE and GitHub links:

1. **Local VS Code URI (One-Click Local File Open):**
   ```markdown
   [src/app/data-manager.service.ts](vscode://file//Users/ldixon/code/zxd/ilc-members-manager/src/app/data-manager.service.ts:45)
   ```

2. **GitHub Repository URI (Online Web View):**
   ```markdown
   [data-manager.service.ts](https://github.com/iislucas/ilc-members-manager/blob/main/src/app/data-manager.service.ts#L45-L60)
   ```

3. **Symbol Reference Format:**
   Always mention the exact class, function, or interface name in backticks with file link:
   - [`DataManagerService.addGrading`](file:///Users/ldixon/code/zxd/ilc-members-manager/src/app/data-manager.service.ts)
   - [`Grading`](file:///Users/ldixon/code/zxd/ilc-members-manager/functions/src/data-model/gradings.ts)
   - [`onGradingUpdate`](file:///Users/ldixon/code/zxd/ilc-members-manager/functions/src/on-grading-update.ts)

---

## 4. Completeness Standards: Total Codebase Referencing

1. **All Files Referenced:**
   Every single source file in the repository (under `src/`, `functions/src/`, `scripts/`, `tests/`, and `docs/minitools/`) must be indexed in the **Codebase File Catalog**.
2. **All Data Components Referenced:**
   Every Firestore collection (`FirestoreCollection`), subcollection (`FirestoreSubcollection`), and TypeScript interface in `functions/src/data-model/` must be documented with its lifecycle, field dictionary, default initialization, and converter.
3. **All User Stories Referenced:**
   Every story file in `docs/user-stories/*.md` must be cataloged in the User Stories Index, linked to its parent User Journey/Plan, its acceptance test, and the implementing source code.
4. **All Architectural Flows & Plans Referenced:**
   Every multi-user collaborative plan, trigger pipeline, webhook receiver, and background backup job must be cataloged with an orthogonal schematic diagram.

---

## 5. Documentation Website & Library Architecture

The documentation is built as a website powered by a dedicated TypeScript library `@ilc/docs-core` located in `docs/lib/`:

### Library Structure (`docs/lib/`)
- `src/models/`: Strongly-typed TypeScript interfaces for docs entities (`CodeFileEntry`, `DataTypeEntry`, `UserJourneyEntry`, `UserStoryEntry`, `ArchFlowEntry`, `SetupGuideEntry`, `PatternEntry`).
- `src/catalog/`: Centralized registry declaring all files, data types, journeys, plans, flows, and patterns.
- `src/resolvers/`: Link resolver converting file paths to `vscode://` and GitHub URLs.
- `src/search/`: MiniSearch index generator for fuzzy instant search across the entire docs corpus.
- `src/validator/`: Completeness test verifying 100% of source files are cataloged and no dead links exist.
- `src/renderer/`: Website builder producing the interactive HTML/CSS/JS site.

### Documentation Tooling Commands
```bash
pnpm build:docs     # Builds the documentation website & generates architecture diagrams
pnpm test:docs      # Runs Vitest tests on @ilc/docs-core and verifies 100% catalog coverage
pnpm start:docs     # Serves the documentation website locally
```
