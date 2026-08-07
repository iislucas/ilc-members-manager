---
name: debug-user-access
description: Workflow and troubleshooting guide for diagnosing user access, authorization, ACL desyncs, and resource download permissions in ILC Members Manager.
---

# Debugging User Access & Authorization

This skill details how user authentication, authorization (ACL), permissions, and protected resource downloads work in the ILC Members Manager, and provides a structured diagnostic workflow for troubleshooting user access issues.

---

## 1. Authorization Architecture Overview

The system uses a tiered, cached access control model:

```
┌─────────────────┐       ┌────────────────────────┐       ┌──────────────────────┐
│  Firebase Auth  │ ───>  │     Firestore ACL      │ <───  │   Member Documents   │
│  (login email)  │       │     `/acl/{email}`     │       │ `/members/{memberId}`│
└─────────────────┘       └────────────────────────┘       └──────────────────────┘
                                      │
                                      ▼
                        ┌───────────────────────────┐
                        │   Cloud Function / Rules  │
                        │  `getResourceDownloadUrl` │
                        │      `storage.rules`      │
                        │     `firestore.rules`     │
                        └───────────────────────────┘
```

### Key Data Stores

1. **Firebase Auth (`admin.auth()` / client auth):** Authenticates users by email and provides `request.auth.token.email`.
2. **Member Profiles (`/members/{docId}`):** Canonical source of truth for user details, containing:
   - `emails`: array of email addresses associated with the member.
   - `membershipType` & `currentMembershipExpires`: membership status and expiration (e.g. `'Annual'`, `'Life'`, `'2028-05-11'`).
   - `instructorId`, `instructorLicenseType`, `instructorLicenseExpires`: instructor licensing status.
   - `isAdmin`: global administrative access flag.
3. **Access Control List (`/acl/{email}`):** Fast lookup cache keyed by lowercase email address:
   - `memberDocIds`: list of member document IDs linked to this email.
   - `isAdmin`: boolean.
   - `instructorIds`: array of instructor IDs (e.g. `['289']`).
   - `membershipExpires`: best expiration string across linked profiles (`'life'`, `'YYYY-MM-DD'`, or `''`).
   - `instructorLicenseExpires`: best expiration string for instructor license (`'life'`, `'YYYY-MM-DD'`, or `''`).
   - `schoolDocIds` & `schoolLicenseExpires`: schools owned/managed and school license expiry.
   - `notYetLinkedToMember`: boolean flag for guest/unlinked accounts.

---

## 2. Resource Downloads & Access Tiers

Resource files in Firebase Storage are organised under access-level prefixes:
- `resources/public/`: Readable by anyone without authentication.
- `resources/members/`: Requires active membership (`acl.membershipExpires >= today` or `'life'`).
- `resources/instructors/`: Requires valid instructor license (`acl.instructorLicenseExpires >= today` or `'life'`).
- `resources/school-owners/`: Requires valid school license (`acl.schoolLicenseExpires >= today` or `'life'`).
- `resources/admins/`: Requires `acl.isAdmin === true`.

When a user visits `/resources/{accessLevel}/{fileName}` (e.g., `/resources/instructors/Instructor Packet 2026.pdf`), the frontend `DownloadResourceComponent` calls `getResourceDownloadUrl(fullPath)`. The Cloud Function calls `assertResourceAccess()` which inspects `/acl/{email}`.

---

## 3. Step-by-Step Diagnostic Workflow

When a user reports an access issue (e.g., "I cannot download the instructor packet; says I don't have an instructor license"):

### Step 1: Run the Diagnostic Script (Read-Only)

Run the debug script with the user's email or Member ID:

```bash
pnpm --prefix functions exec ts-node -O '{"module":"commonjs"}' ../scripts/debug-user-access.ts <user-email-or-memberId>
```

Examples:
```bash
# By email
pnpm --prefix functions exec ts-node -O '{"module":"commonjs"}' ../scripts/debug-user-access.ts tim@zxdpdx.com

# By Member ID
pnpm --prefix functions exec ts-node -O '{"module":"commonjs"}' ../scripts/debug-user-access.ts US544
```

The script inspects:
1. **Firebase Auth User**: Checks if the user account exists and is verified.
2. **Member Record**: Verifies `emails`, `instructorId`, `instructorLicenseExpires`, and `membershipExpires`.
3. **ACL Documents**: Checks `/acl/{email}` for all linked emails and flags desyncs (e.g. member is an instructor but ACL has `instructorLicenseExpires: ""`).
4. **Storage Files**: Confirms the resource file exists in the target storage bucket directory.

---

## 4. Common Causes & Resolutions

### Cause A: ACL Document Desync (Member updated, but ACL not refreshed)

* **Symptom:** Member profile has an active license (e.g., `instructorLicenseExpires: '2028-05-11'`), but `/acl/{email}` has `instructorLicenseExpires: ""`.
* **Root Cause:** When orders are fulfilled or members are updated, `updateACL()` in `functions/src/on-member-update.ts` must trigger `refreshACLAdminStatus()` when any of the following change:
  - `membershipType`
  - `currentMembershipExpires`
  - `instructorLicenseType`
  - `instructorLicenseExpires`
  - `instructorId`
  - `isAdmin`
  - `emails`
* **Resolution:** Ensure `updateACL()` monitors all expiry and license fields. To repair existing desynced ACL documents across the database, run:
  ```bash
  # Preview changes
  pnpm --prefix functions exec ts-node scripts/data-migrations/backfill-acl-expiry-1-may-2026.ts --dry-run

  # Apply fixes
  pnpm --prefix functions exec ts-node scripts/data-migrations/backfill-acl-expiry-1-may-2026.ts --project ilc-paris-class-tracker
  ```

---

### Cause B: Email Mismatch (Login email differs from Member profile email)

* **Symptom:** User logs in with email A (e.g., `tim@punkwood.studio`), but their membership profile only lists emails B and C (e.g., `tim@zxdpdx.com`, `tim.omalley@iliqchuan.com`).
* **Root Cause:** `/acl/{emailA}` does not exist or was auto-created as a guest profile (`notYetLinkedToMember: true`).
* **Resolution:**
  1. Add the user's login email to the `emails` array on their Member document in the Admin portal.
  2. The `onMemberUpdated` trigger will automatically update `/acl/{newEmail}` with `memberDocIds` and sync their licenses and permissions.

---

### Cause C: License Expired

* **Symptom:** User has `instructorLicenseExpires: "2024-05-11"` which is prior to today's date.
* **Resolution:** The user needs to purchase a license renewal. The download page displays the renewal link (`environment.links.license`).

---

### Cause D: "Life" License Expiration Comparison

* **Symptom:** User has Life membership/license (`membershipType: 'Life'`), but access check fails.
* **Root Cause:** `assertResourceAccess` should explicitly recognize `'life'` as non-expiring (`expires !== 'life' && expires < today`).
* **Resolution:** Verify `assertResourceAccess` in `functions/src/resources.ts` checks `expires !== 'life'`.
