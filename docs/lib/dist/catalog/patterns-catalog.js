"use strict";
/* patterns-catalog.ts
 *
 * Authoritative registry of core architectural and data patterns in the abstract (View 5).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PATTERNS_CATALOG = void 0;
exports.PATTERNS_CATALOG = [
    {
        id: 'firestore-timestamps-concurrency',
        name: 'The Firestore Timestamp Concurrency & Deserialization Pattern',
        tagline: 'Deterministic write concurrency, server clocks, and normalized ISO strings.',
        problem: 'Client clocks cannot be trusted for ordering or authorization assertions. Furthermore, Firestore stores dates as Timestamp objects ({_seconds, _nanoseconds}), which fail silently or crash client libraries if treated as standard JS Dates or ISO strings.',
        solution: 'Enforce `request.resource.data.lastUpdated == request.time` in security rules for non-admin updates. Clients always write with `serverTimestamp()`. Converter functions (`firestoreDocToXxx`) immediately convert timestamps into standard ISO 8601 strings on read. Export/seed scripts reconstruct Timestamp instances to prevent RangeError: Invalid time value.',
        consequences: 'Guarantees monotonic update ordering and prevents client clock tampering. All application code can treat date properties as predictable ISO strings.',
        canonicalCodePointers: [
            { file: 'firestore.rules', lineRange: 'L120-L135', description: 'Rule assertion checking lastUpdated == request.time' },
            { file: 'functions/src/data-model/members.ts', lineRange: 'L50-L75', description: 'firestoreDocToMember converting lastUpdated to ISO string' },
            { file: 'functions/scripts/seed-emulator.ts', lineRange: 'L40-L60', description: 'Re-instantiating Timestamp instances before emulator write' },
        ],
        relatedDataTypes: ['member', 'grading', 'ilc-event', 'order', 'school'],
        relatedFlows: ['client-reactivity', 'trigger-mirroring'],
    },
    {
        id: 'init-zero-default-converter',
        name: 'The initXxx() Zero-Default & Converter Anti-Partial-Data Pattern',
        tagline: 'Guaranteed non-null, zero-default object definitions for schemaless databases.',
        problem: 'Firestore is schemaless. Older records, manual migrations, or incomplete documents lack new fields, leading to runtime TypeError: Cannot read properties of undefined in client components and triggers.',
        solution: 'Every domain model defines an `initXxx()` constructor providing non-null default values for every field, and a pure `firestoreDocToXxx(doc)` converter that spreads database data over the default object.',
        consequences: 'Completely eliminates undefined property access bugs. Application code and Angular templates never need defensive `?.` optional chaining for core domain fields.',
        canonicalCodePointers: [
            { file: 'functions/src/data-model/gradings.ts', lineRange: 'L60-L110', description: 'initGrading() defaults and firestoreDocToGrading converter' },
            { file: 'functions/src/data-model/members.ts', lineRange: 'L40-L90', description: 'initMember() defaults and firestoreDocToMember converter' },
            { file: 'functions/src/data-model/events.ts', lineRange: 'L80-L130', description: 'initEvent() defaults and firestoreDocToEvent converter' },
        ],
        relatedDataTypes: ['member', 'grading', 'ilc-event', 'product', 'video-item'],
        relatedFlows: ['client-reactivity', 'trigger-mirroring'],
    },
    {
        id: 'searchable-set-signals',
        name: 'The SearchableSet + AutocompleteComponent Pattern',
        tagline: 'Encapsulating fuzzy inverted indexes inside reactive Angular Signals.',
        problem: 'Fast real-time fuzzy search over large datasets (members, instructors) requires client-side indexing without leaking UI dependencies into data services or breaking OnPush reactivity.',
        solution: '`SearchableSet<ID, T>` wraps a MiniSearch index with Angular Signals (`entries()`, `get(id)`, `search(term)`). Decoupled `AutocompleteComponent` accepts display adapters (`toChipId`, `toName`) and chip-matching regexes (`/^\(([^)]+)\)/`).',
        consequences: 'Decouples search indexing from UI rendering while keeping components reactive and fast. Provides instant O(1) synchronous lookup by ID alongside fuzzy search.',
        canonicalCodePointers: [
            { file: 'src/app/searchable-set.ts', lineRange: 'L1-L120', description: 'SearchableSet signal container wrapping MiniSearch' },
            { file: 'src/app/autocomplete/autocomplete.ts', lineRange: 'L1-L150', description: 'Generic AutocompleteComponent consuming SearchableSet' },
            { file: 'src/app/data-manager.service.ts', lineRange: 'L80-L150', description: 'SearchableSet instances populated via onSnapshot' },
        ],
        relatedDataTypes: ['member', 'instructor-profile', 'school'],
        relatedFlows: ['client-reactivity'],
    },
    {
        id: 'zoneless-signals-onpush',
        name: 'The Zoneless Signals & OnPush Reactivity Pattern',
        tagline: 'Modern, zone-free Angular 21 with fine-grained Signal state and Signal Forms.',
        problem: 'zone.js monkey-patching triggers coarse change detection cycles across the entire DOM tree, causing sluggish performance with high-frequency WebSocket snapshot listeners.',
        solution: 'Enable zoneless change detection via `provideZonelessChangeDetection()`. Set `ChangeDetectionStrategy.OnPush` on all components. Use Signals (`signal()`, `computed()`, `effect()`), Angular Signal Forms (`form()`), and native `@if` / `@for` template control flow.',
        consequences: 'Optimal rendering performance with zero unnecessary CD cycles. Eliminates RxJS subscription leaks in components.',
        canonicalCodePointers: [
            { file: 'src/app/app.config.ts', lineRange: 'L1-L40', description: 'provideZonelessChangeDetection configuration' },
            { file: 'src/app/grading-edit/grading-edit.ts', lineRange: 'L50-L120', description: 'Angular Signal Forms with dynamic disabled states' },
        ],
        relatedDataTypes: ['grading', 'member', 'ilc-event'],
        relatedFlows: ['client-reactivity'],
    },
    {
        id: 'subcollection-mirroring-cache',
        name: 'The Subcollection Mirroring & Fan-Out Cache Pattern',
        tagline: 'Server-side fan-out mirroring for ultra-fast, multi-tenant scoped reads.',
        problem: 'Executing cross-collection queries for school rosters or instructor students in Firestore requires complex composite indexes, expensive rules evaluations, and high read latencies.',
        solution: 'When a document updates in `/members/{id}` or `/gradings/{id}`, a Cloud Function trigger (`onGradingUpdate`, `onMemberUpdate`) automatically mirrors copies into dedicated subcollections (`/instructors/{id}/members/{id}`, `/schools/{id}/gradings/{id}`).',
        consequences: 'School managers and instructors execute simple, low-cost collection queries scoped exclusively to their own subcollections with simple, secure security rules.',
        canonicalCodePointers: [
            { file: 'functions/src/on-grading-update.ts', lineRange: 'L80-L140', description: 'Mirroring gradings to instructor and school subcollections' },
            { file: 'functions/src/on-member-update.ts', lineRange: 'L40-L100', description: 'Mirroring members to school and instructor rosters' },
        ],
        relatedDataTypes: ['grading', 'member', 'school', 'instructor-profile'],
        relatedFlows: ['trigger-mirroring'],
    },
    {
        id: 'dynamic-derived-permissions',
        name: 'The Dynamic Derived Permissions Pattern',
        tagline: 'Live permission evaluation from linked documents without stale cached access lists.',
        problem: 'Caching lists of managers or examiners directly on documents creates data desynchronization whenever staff changes on linked parent entities (e.g. event organizers).',
        solution: 'Documents store only the reference ID (`gradingEventDocId`). Security rules execute a guarded `get(/databases/$(database)/documents/events/$(id))` via `isGradingEventManager()` to derive access live from the event. UI components load the linked event reactively.',
        consequences: 'Event organizers and managers automatically gain grading management access the moment an event is linked, with zero backfill operations needed when event staff change.',
        canonicalCodePointers: [
            { file: 'firestore.rules', lineRange: 'L140-L170', description: 'isGradingEventManager() guarded live get rule' },
            { file: 'src/app/grading-edit/grading-edit.ts', lineRange: 'L130-L160', description: 'userIsEventManager signal deriving live permissions' },
        ],
        relatedDataTypes: ['grading', 'ilc-event'],
        relatedFlows: ['client-reactivity', 'trigger-mirroring'],
    },
    {
        id: 'fast-lookup-acl-cache',
        name: 'The Fast-Lookup ACL Email Key Cache Pattern',
        tagline: 'Normalized email-keyed authorization cache for instantaneous rules checks.',
        problem: 'Firestore rules cannot perform multi-collection joins or traverse deep relational paths on every read/write without exceeding strict rule execution resource budgets.',
        solution: 'Document `/acl/{lowercaseEmail}` acts as an aggregated, pre-calculated permissions snapshot containing `memberDocIds`, `isAdmin`, `instructorIds`, `membershipExpires`, and `schoolDocIds`. Maintained by member and school triggers.',
        consequences: 'Security rules evaluate complex user permissions across all applications in a single document read: `get(/databases/$(database)/documents/acl/$(request.auth.token.email.lower()))`.',
        canonicalCodePointers: [
            { file: 'functions/src/data-model/system.ts', lineRange: 'L20-L60', description: 'ACL data model definition' },
            { file: 'firestore.rules', lineRange: 'L30-L70', description: 'getAcl() helper reading /acl/{email}' },
            { file: 'functions/src/on-member-update.ts', lineRange: 'L120-L180', description: 'Updating ACL document on member profile update' },
        ],
        relatedDataTypes: ['acl', 'member', 'school'],
        relatedFlows: ['trigger-mirroring'],
    },
    {
        id: 'early-domain-typing-snapshots',
        name: 'Early Domain Typing on Snapshots & Typed Partial<T> Accumulators',
        tagline: 'Eliminating loose bracket access and untyped database mutations.',
        problem: 'Using untyped `doc.data()` or `Record<string, unknown>` results in bracket string access (`data["field"]`), which bypasses TypeScript checking and causes silent schema divergence.',
        solution: 'Cast document snapshots immediately upon retrieval (`docSnap.data() as IlcEvent | undefined`). Type all update payloads with `Partial<DomainType>` (e.g. `Partial<EventRegistration>` or `MemberUpdates`).',
        consequences: 'Full compile-time validation, IDE autocomplete, and prevention of invalid fields leaking into Firestore.',
        canonicalCodePointers: [
            { file: 'src/app/data-manager.service.ts', lineRange: 'L200-L240', description: 'Snapshot domain casting' },
            { file: 'functions/src/stripe-fulfillment.ts', lineRange: 'L100-L150', description: 'Typed update accumulators for member renewals' },
        ],
        relatedDataTypes: ['ilc-event', 'event-registration', 'member', 'grading'],
        relatedFlows: ['client-reactivity', 'ecommerce-webhooks'],
    },
    {
        id: 'signed-playback-offline-idb',
        name: 'Protected VOD Streaming & Offline IndexedDB Storage Pattern',
        tagline: 'Secure HLS session authentication and offline browser segment caching.',
        problem: 'Video on Demand requires restricting access to authenticated purchasers while supporting offline playback without exposing unprotected master media assets.',
        solution: 'Two-tier protection: Client requests `getVideoPlaybackSession(videoId)` -> Cloud Function verifies `VideoGrant` -> generates short-lived signed playback token. For offline viewing, `VodOfflineStorageService` stores encrypted HLS segments in IndexedDB.',
        consequences: 'Secure, authorized media delivery with smooth offline capability on mobile PWAs.',
        canonicalCodePointers: [
            { file: 'functions/src/vod/get-playback-session.ts', lineRange: 'L1-L80', description: 'Playback session verification and token signing' },
            { file: 'src/app/vod-offline-storage.service.ts', lineRange: 'L1-L120', description: 'IndexedDB segment storage and cache manager' },
        ],
        relatedDataTypes: ['video-item', 'video-grant', 'video-progress'],
        relatedFlows: ['media-transcoding'],
    },
    {
        id: 'micro-frontend-web-components',
        name: 'Autonomous Micro-Frontend Web Components Pattern',
        tagline: 'Embedding Angular components into third-party CMS platforms without framework conflicts.',
        problem: 'Affiliate schools and external organizers need to embed the event calendar and instructor locator into WordPress or Squarespace sites without loading the entire application.',
        solution: 'Build standalone Angular Elements projects (`events-viewer-wc`, `find-an-instructor-wc`) bundled as self-contained Web Components that communicate directly with public Firestore collections.',
        consequences: 'Embeddable via `<script>` and `<events-viewer>` custom elements on any third-party webpage with zero styling or JavaScript framework interference.',
        canonicalCodePointers: [
            { file: 'src/events-viewer.wc.ts', lineRange: 'L1-L50', description: 'Angular Elements registration for events viewer' },
            { file: 'src/find-an-instructor.wc.ts', lineRange: 'L1-L50', description: 'Angular Elements registration for instructor finder' },
        ],
        relatedDataTypes: ['ilc-event', 'instructor-profile'],
        relatedFlows: ['micro-frontends'],
    },
];
//# sourceMappingURL=patterns-catalog.js.map