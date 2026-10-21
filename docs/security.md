# ILC Members Manager — Security Architecture & Policy Guide

This document records the security architecture, authorization tiers, data access rules, and defense-in-depth policies implemented across the ILC Members Manager platform.

---

## 1. Authentication & Identity Architecture

- **Authentication Authority**: Firebase Authentication (Email/Password, Google OAuth).
- **Authorization Authority**: Cloud Firestore `/acl/{email}`.
  - Every authenticated user's permissions and role assignments are resolved via `/acl/{email}`.
  - Roles and capabilities:
    - `isAdmin`: Global administrative access.
    - `memberDocIds`: Linked member records owned or represented by this identity.
    - `schoolDocIds`: Schools owned or managed by this member.
    - `instructorIds`: Instructor credentials and licenses held.
    - `membershipExpires`, `instructorLicenseExpires`, `schoolLicenseExpires`: Expiration dates used by Storage and Firestore rules.
- **Account Linking & Email Integrity**:
  - Member profile updates strictly require that the authenticated email (`request.auth.token.email`) is preserved in `member.emails` if modified, preventing email hijacking or accidental identity detachment.
- **Active Session Email Authority vs. Contact Email Aliases**:
  - All administrative and elevated permissions are strictly bound to the actively authenticated session email (`request.auth.token.email`).
  - Contact aliases stored in `member.emails` are unverified document strings and must **never** be used to confer administrative privileges.
  - Adding an administrator's email to a member profile's `emails` array does not grant that member admin access. Furthermore, backend triggers (`onMemberUpdated`) actively prevent non-admin member profiles from attaching to or modifying administrator `/acl` records.
- **Case-Insensitive Emails (normalisation invariant)**:
  - Emails are stored trimmed and lower-cased everywhere (`/acl/{email}` ids, `member.emails`, event `ownerEmails`/`managerEmails`, registration `email`, video grant `memberEmail`). Code compares with `normalizeEmail()` ([`functions/src/data-model/email.ts`](../functions/src/data-model/email.ts)); rules compare with `request.auth.token.email.lower()` behind a `token.get('email', null) is string` guard.
  - Only the lower-cased token email is matched (stored emails and `/acl` ids are always lowercase). See [email-normalisation.md](email-normalisation.md) for the invariant, the backfill script and the rollout history.
- **Only Verified Emails Are Identities**:
  - Anyone can create an email/password account for an address they don't own (directly via the public Auth API, bypassing our UI). Until the email is verified, the token's `email` claim proves nothing.
  - Every email-derived identity check therefore requires `email_verified == true`:
    - Firestore rules: `hasAuthEmail()` in [firestore.rules](../firestore.rules) (all other email helpers go through it).
    - Storage rules: `getUserEmail()` in [storage.rules](../storage.rules) returns `''` for unverified emails.
    - Cloud Functions: `verifiedAuthEmail(request)` in [common.ts](../functions/src/common.ts) returns the normalised email or `''`; `assertAdmin` / `assertAdminOrSchoolManager` use it. Never read `request.auth.token.email` directly for authorization.
  - The client also gates unverified sessions (`LoginStatus.NeedsEmailVerification`) and `getUserDetails` refuses to link unverified accounts, but those are UX layers — the rules and functions are the enforcement.

---

## 2. Cloud Firestore Security Model

Firestore rules operate under a strict **default-deny** paradigm:

### 2.1 Member Profile Permissions (`/members/{memberDocId}`)
- **Read**:
  - Allowed for the profile owner (`isOwner()`), school manager (`isManagerOfMemberSchool()`), or admin (`isAdmin()`).
- **Create / Delete**:
  - Admin-only. Direct creation by school managers or anonymous clients is denied.
- **Update**:
  - **Admin**: Full update permission with server timestamp validation (`lastUpdated == request.time`).
  - **School Manager**: Restricted to whitelisted operational fields:
    - Personal & contact info: `name`, `address`, `city`, `countyOrState`, `zipCode`, `country`, `phone`, `emails`, `gender`, `dateOfBirth`.
    - School & instructor affiliations: `primaryInstructorId`, `primarySchoolId`, `primarySchoolDocId`.
    - Public profiles: `instructorWebsite`, `publicClassGoogleCalendarId`, `publicRegionOrCity`, `publicCountyOrState`, `publicEmail`, `publicPhone`, `publicProfileImageUrl`, `publicProfileImageThumbUrl`, `publicCoverImageUrl`, `publicBioMarkdown`.
    - Curriculum and license records: `membershipType`, `firstMembershipStarted`, `lastRenewalDate`, `currentMembershipExpires`, `studentLevel`, `applicationLevel`, `mastersLevels`, `instructorId`, `instructorLicenseExpires`, `instructorLicenseRenewalDate`, `instructorLicenseType`.
    - Management notes: `notes`, `notificationSettings`.
    - **Privilege Escalation Prevention**: School managers are strictly prohibited from modifying `isAdmin`, unique `memberId`, `gradingDocIds`, Stripe subscriptions, or class video library subscriptions.
  - **Owner**: Restricted to self-service profile fields; cannot modify `notes`, levels, membership types, or administrative settings.

### 2.2 Grading Workflow Security (`/gradings/{gradingId}`)
- **Read**: Admin, Student (`studentMemberDocId`), Grading Managers/Instructors (`gradingInstructorId` / `gradingManagerIds`), or Event Managers (`isGradingEventManager()`).
- **Student Status Transitions**:
  - **Pre-acceptance** (`!gradingIsAccepted()`): Students may only update their status to `pending` or `awaiting-instructor-acceptance`. Students are prevented from self-assigning `passed`, `not-passed`, or `awaiting-instructor-grading`.
  - **Post-acceptance** (`gradingIsAccepted()`): Once an instructor accepts a grading request, `'status'` is completely removed from the student's allowed update fields.
- **Backend Defense-in-Depth**:
  - The `on-grading-update` Cloud Function verifies that `statusChangedByMemberDocId !== studentMemberDocId` when `becamePassed` triggers. If a student initiates a `passed` transition, the level-promotion trigger halts and logs a security violation.

### 2.3 System Secrets (`/system/mail-secrets`)
- **Isolation**: Unsubscribe HMAC secrets and other sensitive keys are stored in `/system/mail-secrets`.
- **Rules**: Read and write access is restricted strictly to administrators (`isAdmin()`). Public users can read `/system/mail-settings` for status indicators, but cannot access secrets.

---

## 3. Cloud Storage Security Model

Storage paths enforce resource scoping and MIME-type restrictions:

- **Null-Safe Authentication**:
  - Helper functions (`isAdmin()`, `getUserMemberDocIds()`, `getUserSchoolDocIds()`, `hasActiveMembership()`, etc.) defensively verify `request.auth != null && request.auth.token.email != null` before path lookups to prevent unauthenticated rule evaluation crashes.
- **Media Upload Validation**:
  - `match /editor-images/{fileId}`:
    - Must be authenticated (`request.auth != null`).
    - File size must be under 5 MB (`request.resource.size < 5 * 1024 * 1024`).
    - Content type must match approved image MIME types: `image/(jpeg|png|webp|gif)`.
- **VOD Stream Protection**:
  - Full feature streams (`/vod/{videoId}/{allFiles=**}`) enforce granular entitlement verification (`isVodAuthorized()`):
    - Admins (`isAdmin()`) have unrestricted access.
    - Trailers (`isTrailer == true` in Firestore `/videos/{videoId}`) and `public` access tier videos are readable.
    - Active members (`hasActiveMembership()`) can access `members` tier videos.
    - Active instructors (`hasActiveInstructorLicense()`) can access `instructors` tier videos.
    - Direct video purchasers with an active grant record (`/video_grants/{email}_{videoId}`) can access purchased videos.
    - Anonymous or unauthorized requests are rejected, preventing paywall bypass on HLS manifests and media chunks.
- **Path Traversal Protection**:
  - Event asset cleanup triggers assert that any storage file path to be deleted begins with `events/${eventId}/`, blocking arbitrary file deletion across the bucket.

---

## 4. Cloud Functions Backend Hardening

- **Host Header & SSRF Defense (`socialPreview`)**:
  - Host headers (`X-Forwarded-Host`, `Host`) are validated via `resolveWhitelistedHost` against an approved domain whitelist (`app.iliqchuan.com`, `iliqchuan.com`, `localhost`, and project Firebase domains). Untrusted hosts fall back strictly to `app.iliqchuan.com`, preventing web cache poisoning and SSRF in SPA shell fetching.
- **Rate Limiting (`checkEmailStatus`)**:
  - An in-memory sliding window rate limiter throttles calls per client IP (30 requests/min), preventing mass automated email scraping.
  - As an accepted UX trade-off this unauthenticated call reveals, per email: whether a member record exists, whether an auth account exists, its providers, and whether its email is verified. Member records are resolved by `findMemberDocsForEmail` ([member-docs-for-email.ts](../functions/src/member-docs-for-email.ts)), the same lookup `getUserDetails` uses, so the pre- and post-sign-in answers agree.
- **Event Product Association (`submitProposedEvent`)**:
  - Re-linking products requires verifying product ownership or admin rights, preventing organizers from re-assigning foreign products to newly created events.
- **Event Updates Concurrency & Integrity (`firestore.rules`)**:
  - `match /events/{eventId}` updates enforce `hasValidEditUpdate()`, ensuring `lastUpdated == request.time` on every write to prevent stale overwrite races.
- **Event Checkout & Registration Authorization (`stripe-product-checkout`)**:
  - `createProductCheckoutSession` and `registerEventInPerson` require an active authenticated Firebase session (`request.auth.token.email`) when claiming member/instructor pricing tiers or registering for members-only events.
  - `updateProductRegistration` strictly mandates authentication (`request.auth.token.email`), verifying that the caller is the registration owner, an event manager, or an administrator. Unauthenticated callers cannot spoof attendee emails to modify attendee details or trigger unpaid registration upgrades.
- **Canonical Admin Authorization Authority & ACL Synchronization (`/acl/{email}`)**:
  - Administrative authority across all callable Cloud Functions (`assertAdmin`, `assertAdminOrSchoolManager`, `getUserDetails`, `markEventRegistrationPaid`, `unmarkEventRegistrationPaid`, `createProductCheckoutSession`, `updateProductRegistration`, etc.) is resolved strictly against `/acl/{email}.isAdmin === true`.
  - Deprecated Auth token custom claims (`request.auth.token.admin`) and unverified member profile fields (`member.isAdmin`) are not used as the authorization authority, eliminating privilege revocation desyncs and supporting administrative users before profile linkage.
  - `refreshACLAdminStatus` in `on-member-update.ts` preserves `isAdmin` from `/acl/{email}` without deriving it from member profiles and never deletes an administrator's ACL document even if no member profile is linked.

---

## 5. Frontend Sanitization & Hosting Headers

- **Stored XSS Neutralization (`MarkdownViewer`)**:
  - Markdown output compiled via `marked` is cleansed using `DOMPurify.sanitize()` before being passed to Angular's `DomSanitizer.bypassSecurityTrustHtml()`.
  - Strips malicious `<script>` tags, inline event handlers (`onload`, `onerror`), and `javascript:` URLs while safely preserving markdown typography, tables, and custom attributes (`data-bullet`).
- **Hosting HTTP Security Headers (`firebase.json`)**:
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: SAMEORIGIN`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`
  - `Permissions-Policy: camera=(), microphone=(), geolocation=()`
