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
  - Full feature streams (`/vod/{videoId}/{allFiles=**}`) require authentication (`request.auth != null`) or admin privileges.
  - Trailers (`isTrailer == true` in Firestore `/videos/{videoId}`) are publicly readable for preview playback.
- **Path Traversal Protection**:
  - Event asset cleanup triggers assert that any storage file path to be deleted begins with `events/${eventId}/`, blocking arbitrary file deletion across the bucket.

---

## 4. Cloud Functions Backend Hardening

- **Host Header & SSRF Defense (`socialPreview`)**:
  - Host headers (`X-Forwarded-Host`, `Host`) are validated via `resolveWhitelistedHost` against an approved domain whitelist (`app.iliqchuan.com`, `iliqchuan.com`, `localhost`, and project Firebase domains). Untrusted hosts fall back strictly to `app.iliqchuan.com`, preventing web cache poisoning and SSRF in SPA shell fetching.
- **Rate Limiting (`checkEmailStatus`)**:
  - An in-memory sliding window rate limiter throttles calls per client IP (30 requests/min), preventing mass automated email scraping.
- **Event Product Association (`submitProposedEvent`)**:
  - Re-linking products requires verifying product ownership or admin rights, preventing organizers from re-assigning foreign products to newly created events.
- **Admin Authorization Consistency (`markEventRegistrationPaid`)**:
  - Verified against `/acl/{email}` document rather than deprecated or missing token claims.

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
