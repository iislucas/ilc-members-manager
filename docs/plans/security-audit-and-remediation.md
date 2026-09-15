# Comprehensive Security Remediation Implementation Plan

This implementation plan provides a structured, end-to-end technical approach to resolve all vulnerabilities discovered during the security audit across Firebase Cloud Functions v2, Firestore Security Rules, Cloud Storage Security Rules, Frontend Sanitization, and Hosting configurations.

---

## User Review Required

> [!IMPORTANT]
> **VOD Streaming Media Delivery Architecture (HIGH-1)**:
> In the current architecture, `/vod/{videoId}/*` in Cloud Storage has `allow read: if true;`, and `/videos/{videoId}` documents expose the HLS master playlist URL (`manifestUrl`) publicly in Firestore. To enforce the paywall and subscription checks:
> - The public `/videos/{videoId}` catalog documents will **omit** `manifestUrl` (keeping title, tags, description, prices, thumbnails, and preview trailer URLs public).
> - Only the authorized callable `getVideoPlaybackSession` will return the playable `manifestUrl` for entitled members/buyers.
> - For Cloud Storage, video trailers (`/vod/{trailerVideoId}/*`) remain public, while full VOD feature streams (`/vod/{videoId}/*`) require authentication.
>
> Please confirm if this matches your expectation for VOD streaming gating.

> [!WARNING]
> **School Manager Member Updates Restriction (CRIT-2)**:
> Currently, school managers have unrestricted `allow write` on member profiles belonging to their school, which inadvertently allows them to set `isAdmin: true` or alter core membership types. The proposed change converts this to a restricted `allow update` that explicitly whitelists fields school managers may edit (e.g. `notes`, `address`, `phone`, `primarySchoolId`, `primaryInstructorId`), while strictly blocking changes to `isAdmin`, `membershipType`, `studentLevel`, and license expirations.

---

## Open Questions

1. **Email Unsubscribe Secret Migration (CRIT-4)**:
   - Moving the secret out of the publicly readable `/system/mail-settings` can be done via Google Cloud Secret Manager (`UNSUBSCRIBE_SECRET`) or an admin-only document (`/system/mail-secrets`). We propose checking Secret Manager first, and defaulting to a dynamically generated secret in `/system/mail-secrets` if not set. Does this work for your deployment workflow?
2. **Third-Party Sanitizer Library (`dompurify`) (HIGH-3)**:
   - For eliminating Stored XSS in `MarkdownViewer`, we plan to add `dompurify` and `@types/dompurify`. We will scan and verify them with `scan_dependencies` before installing.

---

## Proposed Changes

The remediation is organized into 5 logical modules, ordered from database security rules and core backend functions to frontend sanitization and hosting hardening.

---

### Module 1: Firestore Security Rules (`firestore.rules`)

#### [MODIFY] [firestore.rules](file:///Users/ldixon/code/zxd/ilc-members-manager/firestore.rules)
- **CRIT-1 (Student Grading Status Self-Pass Prevention)**:
  - In `match /gradings/{gradingId}`:
  - For `!gradingIsAccepted()`: restrict student updates so `request.resource.data.status` may only be set to `resource.data.status`, `'pending'`, or `'awaiting-instructor-acceptance'`.
  - For `gradingIsAccepted()`: completely remove `'status'` from the student's allowed `affectedKeys()`, ensuring only grading managers or admins can update status once accepted.
- **CRIT-2 (School Manager Privilege Escalation Elimination)**:
  - In `match /members/{memberDocId}`:
  - Remove line 58: `allow write: if hasValidEditUpdate() && (isAdmin() || isManagerOfMemberSchool());`.
  - Set `allow write: if hasValidEditUpdate() && isAdmin();`.
  - Add explicit `allow update: if hasValidEditUpdate() && isManagerOfMemberSchool() && request.resource.data.diff(resource.data).affectedKeys().hasOnly([...])`, allowing only appropriate school management fields (`notes`, `address`, `city`, `phone`, `primarySchoolDocId`, `primaryInstructorId`, `notificationSettings`) and strictly disallowing `isAdmin`, `membershipType`, `studentLevel`, `instructorId`, etc.
- **CRIT-4 (Unsubscribe Secret Doc Lockdown)**:
  - Keep `/system/mail-settings` public for client UI status checks, but ensure no secrets are stored there.
  - Add explicit rule for `/system/mail-secrets`: `allow read, write: if isAdmin();`.
- **HIGH-1 (VOD Catalog Field Gating)**:
  - Keep `/videos/{videoId}` read public for catalog browsing. Ensure client code does not rely on `manifestUrl` existing on the raw public document.
- **MED-2 (Member Email Hijacking Prevention)**:
  - In `match /members/{memberDocId}` update rule for `isOwner()`: require that `request.auth.token.email in request.resource.data.emails` so users cannot detach their authenticated email or spoof others.

---

### Module 2: Cloud Storage Rules (`storage.rules`)

#### [MODIFY] [storage.rules](file:///Users/ldixon/code/zxd/ilc-members-manager/storage.rules)
- **MED-5 (Null-Safe Auth Guards)**:
  - Update `isAdmin()`, `getUserMemberDocIds()`, `getUserSchoolDocIds()`, `hasActiveMembership()`, etc., to explicitly check `request.auth != null && request.auth.token.email != null` before evaluating paths.
- **MED-1 (Editor Images Lockdown)**:
  - In `match /editor-images/{fileId}`:
  - Require `request.resource.size < 5 * 1024 * 1024` (5 MB max limit).
  - Require `request.resource.contentType.matches('image/(jpeg|png|webp|gif)')`.
- **HIGH-1 (VOD Segments Gating)**:
  - In `match /vod/{videoId}/{allFiles=**}`:
  - Allow read if `isAdmin()` or if the video is designated as a trailer / public preview; require authenticated access for full VOD streams.

---

### Module 3: Cloud Functions Backend (`functions/src/`)

#### [MODIFY] [functions/src/proposed-events.ts](file:///Users/ldixon/code/zxd/ilc-members-manager/functions/src/proposed-events.ts)
- **CRIT-3 (Arbitrary Storage File Deletion via Traversal)**:
  - Update `deleteStorageFiles(urls: string[], eventId: string)`:
  - For each extracted path, assert `path.startsWith('events/' + eventId + '/')`.
  - Log a security warning and immediately skip any URL pointing outside the event's prefix.
- **HIGH-4 (Product Re-Linking Authorization)**:
  - In `submitProposedEvent`: before updating `/products/{productId}`, check that the product exists and that its `eventDocId` is empty or belongs to the caller, or the caller is an admin.

#### [MODIFY] [functions/src/unsubscribe-token.ts](file:///Users/ldixon/code/zxd/ilc-members-manager/functions/src/unsubscribe-token.ts)
- **CRIT-4 (Secure Storage of Unsubscribe Secret)**:
  - Change `getUnsubscribeSecret(db)`:
  - Check `process.env['UNSUBSCRIBE_SECRET']` first.
  - If not set, retrieve or bootstrap the secret in `/system/mail-secrets` (admin-only) instead of `/system/mail-settings` (public).
  - Clean up / delete any legacy `unsubscribeSecret` key from `system/mail-settings`.

#### [MODIFY] [functions/src/social-preview.ts](file:///Users/ldixon/code/zxd/ilc-members-manager/functions/src/social-preview.ts)
- **CRIT-5 (Host Header Injection & SSRF)**:
  - Implement `resolveWhitelistedHost(rawHost?: string): string`.
  - Validate against `environment.domains` and project Firebase hosting domains.
  - If an untrusted Host/X-Forwarded-Host header is received, default strictly to `environment.links.appBase` host (`app.iliqchuan.com`) to prevent fetching external URLs into `cachedIndexHtml`.

#### [MODIFY] [functions/src/on-grading-update.ts](file:///Users/ldixon/code/zxd/ilc-members-manager/functions/src/on-grading-update.ts)
- **CRIT-1 (Backend Level-Promotion Defense)**:
  - In the trigger handling `becamePassed`:
  - Assert that `statusChangedByMemberDocId` does not equal `studentMemberDocId` (unless caller is admin).
  - Prevent level promotion if the status transition was initiated directly by the student.

#### [MODIFY] [functions/src/stripe-product-checkout.ts](file:///Users/ldixon/code/zxd/ilc-members-manager/functions/src/stripe-product-checkout.ts)
- **HIGH-2 (Admin Authorization Consistency)**:
  - In `markEventRegistrationPaid` (line 1162): replace the broken `request.auth?.token?.admin === true` check with the unified ACL check:
    ```typescript
    const aclSnap = await db.collection(FirestoreCollection.Acl).doc(callerEmail).get();
    const isAdmin = aclSnap.data()?.isAdmin === true;
    ```

#### [MODIFY] [functions/src/check-email-status.ts](file:///Users/ldixon/code/zxd/ilc-members-manager/functions/src/check-email-status.ts)
- **MED-3 (Abuse Prevention / Rate Limiting)**:
  - Add basic IP / attempt frequency throttling or leverage Firebase App Check tokens to hinder mass automated email scraping.

---

### Module 4: Frontend Sanitization (`src/app/`)

#### [MODIFY] [src/app/markdown-editor/markdown-viewer.ts](file:///Users/ldixon/code/zxd/ilc-members-manager/src/app/markdown-editor/markdown-viewer.ts)
- **HIGH-3 (Stored XSS Elimination)**:
  - Integrate `DOMPurify.sanitize(html)` to cleanse raw HTML produced by `compileMarkdownToHtml` before passing to `bypassSecurityTrustHtml`.
  - Configure DOMPurify to allow safe custom attributes (`data-bullet`, `class`, `figcaption`, etc.) while strictly stripping `<script>`, inline event handlers (`onload`, `onerror`), and `javascript:` URIs.

---

### Module 5: Hosting Security Headers (`firebase.json`)

#### [MODIFY] [firebase.json](file:///Users/ldixon/code/zxd/ilc-members-manager/firebase.json)
- **MED-4 (HTTP Security Headers)**:
  - Add standard security response headers to `"hosting"`:
    - `X-Content-Type-Options: nosniff`
    - `X-Frame-Options: SAMEORIGIN`
    - `Referrer-Policy: strict-origin-when-cross-origin`
    - `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`
    - `Permissions-Policy: camera=(), microphone=(), geolocation=()`

---

## Verification Plan

### Automated Tests
1. **Firestore Rules Test Suite (`tests/firestore.rules.spec.ts`)**:
   - `pnpm test:rules`
   - Add new test cases:
     - Student attempting to update grading status to `'passed'` -> `assertFails`.
     - Student attempting to update grading status to `'not-passed'` -> `assertFails`.
     - School manager attempting to update `isAdmin: true` on student -> `assertFails`.
     - School manager attempting to update `membershipType: 'Life'` on student -> `assertFails`.
     - School manager updating `notes` or allowed fields -> `assertSucceeds`.
     - Public user reading `/system/mail-secrets` -> `assertFails`.
     - Public user reading `/system/mail-settings` without secrets -> `assertSucceeds`.
     - User updating member `emails` omitting their authenticated email -> `assertFails`.
2. **Backend Unit Tests (`functions/src/**/*.spec.ts`)**:
   - `pnpm test:functions`
   - Test `deleteStorageFiles` prefix checking: paths outside `events/{id}/` are skipped.
   - Test `resolveWhitelistedHost` in `social-preview.spec.ts`: untrusted host headers return fallback domain.
   - Test `markEventRegistrationPaid` authorization with ACL admin document.
   - Test `getUnsubscribeSecret`: loads from `/system/mail-secrets` and does not write to `/system/mail-settings`.
3. **Frontend Unit Tests (`src/app/**/*.spec.ts`)**:
   - `pnpm test`
   - Test `MarkdownViewer`: verify that malicious inputs (`<script>alert(1)</script>`, `<img src=x onerror=alert(1)>`) are stripped while markdown styling remains intact.

### Manual Verification
- Verify that `pnpm build` and `pnpm build:functions` pass without any type errors or lint warnings.
- Run `pnpm start` (already running) and test the UI in the browser to confirm normal member, instructor, and event flows remain functional.
