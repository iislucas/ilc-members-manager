---
name: security-policy
description: Security principles, canonical authorization model, critical anti-patterns (such as synthetic fallback identities), and defense-in-depth guidelines for ILC Members Manager. Read when writing Cloud Functions, Firestore/Storage rules, or sensitive frontend permissions.
---

# Security Architecture & Authorization Guide

This skill records mandatory security principles, canonical authorization rules, critical anti-patterns, and defense-in-depth policies for developing and reviewing code in the ILC Members Manager platform.

---

## 1. Core Principles

1. **Authorization Authority**: Cloud Firestore `/acl/{email}` is the **sole canonical authority** for user permissions and role capabilities (`isAdmin`, `memberDocIds`, `schoolDocIds`, `instructorIds`, expiry timestamps).
2. **Default-Deny**: Every Firestore rule, Storage rule, and Cloud Function must deny access by default unless an explicit condition is satisfied.
3. **Fail Closed**: In every security check or permission resolution, missing records, errors, or unexpected states must cause access to be denied. **Never fail open.**
4. **No Synthetic Elevated Identities**: Never construct a fallback object with elevated privileges (`isAdmin: true`, manager rights) in error handlers or catch blocks.

---

## 2. Critical Anti-Patterns & Defenses

### Anti-Pattern 1: Synthetic Elevated Identity in Error Handlers (`try / catch` fallback)
- **The Pitfall**:
  Wrapping document retrieval in a `try / catch` block and fabricating a synthetic member or admin object in the `catch` handler:
  ```typescript
  // ❌ CRITICAL ANTI-PATTERN: Fails open and fabricates phantom identities
  try {
    const member = await getMemberByEmail(email, db);
    return { ...member, isAdmin: true };
  } catch {
    return { ...initMember(), emails: [email], isAdmin: true } as Member;
  }
  ```
- **Why It Is Dangerous**:
  - **Fails Open**: If a database error, transient failure, or missing document occurs, the system catches the error and fabricates an active administrator object instead of failing safely.
  - **Phantom Documents**: Downstream operations receive an object with empty `docId: ''` or missing required fields, causing corrupted writes, incorrect logging, or privilege leakage.
  - **Misleading Optics**: In security reviews, catch blocks that return elevated permissions appear as backdoors or severe privilege escalation vectors.
- **The Correct Pattern**:
  Always fail closed. If the record does not exist or an error occurs, let the error propagate or explicitly throw:
  ```typescript
  // ✅ SECURE: Fails closed, resolves actual record or rejects
  const member = await getMemberByEmail(email, db);
  return { ...member, isAdmin: true };
  ```

---

### Anti-Pattern 2: Trusting `member.isAdmin` Instead of `/acl/{email}`
- **The Pitfall**:
  Inspecting `member.isAdmin` on a `/members/{docId}` document to grant administrative access:
  ```typescript
  // ❌ ANTI-PATTERN: member profile is not the authorization authority
  const member = await getMemberByEmail(email, db);
  if (!member.isAdmin) {
    throw new HttpsError('permission-denied', 'Admin access required.');
  }
  ```
- **Why It Is Dangerous**:
  - **Privilege Revocation Bypass**: If an administrator's access is revoked by setting `/acl/{email}.isAdmin = false`, stale member profile documents retain `member.isAdmin: true`, allowing continued administrative actions.
  - **Lockout of Unlinked Admins**: A system administrator configured in `/acl/{email}` who has not yet created or linked a personal member profile is locked out.
- **The Correct Pattern**:
  Always query `/acl/{email}` directly for administrative capabilities:
  ```typescript
  // ✅ SECURE: Authoritative check against /acl/{email}
  const aclSnap = await db.collection('acl').doc(email).get();
  if (!aclSnap.exists || aclSnap.data()?.isAdmin !== true) {
    throw new HttpsError('permission-denied', 'Admin access required.');
  }
  ```

---

### Anti-Pattern 3: Checking Deprecated Token Custom Claims (`request.auth.token.admin`)
- **The Pitfall**:
  Checking Firebase Auth custom claims like `request.auth?.token?.admin === true`:
  ```typescript
  // ❌ ANTI-PATTERN: Custom token claims are not used or maintained
  if (request.auth?.token?.admin === true) {
    // grant admin access
  }
  ```
- **Why It Is Dangerous**:
  - Custom claims are deprecated in this platform. They are not updated during role changes, leading to either total lockout of legitimate admins or stale permissions.
- **The Correct Pattern**:
  Query `/acl/{email}`:
  ```typescript
  // ✅ SECURE:
  const callerEmail = (request.auth?.token?.email || '').toLowerCase().trim();
  let isAdmin = false;
  if (callerEmail) {
    const aclSnap = await db.collection(FirestoreCollection.Acl).doc(callerEmail).get();
    isAdmin = aclSnap.data()?.isAdmin === true;
  }
  ```

---

### Anti-Pattern 4: Frontend Form Constraints Disagreeing with Firestore Security Rules
- **The Pitfall**:
  Disabling fields on the client form for roles that Firestore security rules and `docs/security.md` explicitly permit (or enabling fields that rules deny):
  ```typescript
  // ❌ ANTI-PATTERN: School managers are permitted to update notes, but UI disables it
  disabled(schema.notes, () => !this.userIsAdmin());
  ```
- **Why It Is Dangerous**:
  - Breaks core business workflows for authorized operators (e.g. school managers unable to record student notes).
  - Also remember to check both `primarySchoolDocId` and `primarySchoolId` when matching `user.schoolsManaged`.
- **The Correct Pattern**:
  Align client-side disabled rules with `firestore.rules`:
  ```typescript
  // ✅ SECURE & CONSISTENT:
  disabled(schema.notes, () => !this.userIsSchoolManagerOrAdmin());
  ```

---

### Anti-Pattern 5: Unvalidated Storage Paths & Path Traversal
- **The Pitfall**:
  Deleting or reading Storage files based solely on client-provided paths without prefix assertions:
  ```typescript
  // ❌ CRITICAL ANTI-PATTERN: Arbitrary bucket deletion
  await bucket.file(clientProvidedPath).delete();
  ```
- **The Correct Pattern**:
  Enforce strict prefix matching and access-level containment:
  ```typescript
  // ✅ SECURE: Assert allowed prefix before deletion or signed URL generation
  const allowedPrefix = `events/${eventId}/`;
  if (!path.startsWith(allowedPrefix)) {
    logger.warn(`Security violation: ${path} outside ${allowedPrefix}`);
    return;
  }
  await bucket.file(path).delete();
  ```

---

### Anti-Pattern 6: Student Self-Promotion & Grading Status Elevation
- **The Pitfall**:
  Allowing student callers to transition grading status to `passed`, `not-passed`, or `awaiting-instructor-grading`.
- **The Correct Pattern**:
  - **In `firestore.rules`**: Before acceptance, students may only set status to `pending` or `awaiting-instructor-acceptance`. After acceptance, `'status'` is completely removed from allowed keys for students.
  - **In `on-grading-update`**: Defense-in-depth trigger verifies `statusChangedByMemberDocId !== studentMemberDocId` when `becamePassed` triggers. If a student initiates a `passed` transition, the trigger halts and logs a violation.

---

### Anti-Pattern 7: Client-Supplied Input Elevation to Admin (`auth?.email || data.email`)
- **The Pitfall**:
  Allowing `callerEmail` to fall back to unverified client request data before performing an admin check:
  ```typescript
  // ❌ ANTI-PATTERN: Unauthenticated callers supplying an admin's email in data.email get elevated to admin!
  const callerEmail = (request.auth?.token?.email || data.attendeeDetails.email || '').toLowerCase().trim();
  const aclSnap = await db.collection('acl').doc(callerEmail).get();
  const isAdmin = aclSnap.data()?.isAdmin === true;
  ```
- **Why It Is Dangerous**:
  - An unauthenticated user can pass an administrator's email in `data.attendeeDetails.email`.
  - The lookup to `/acl/{callerEmail}` succeeds and returns `isAdmin: true`.
  - The unauthenticated caller is elevated to an administrator, bypassing all ownership checks.
- **The Correct Pattern**:
  Admin status must **only** be derived from the cryptographically verified auth token:
  ```typescript
  // ✅ SECURE:
  const authEmail = (request.auth?.token?.email || '').toLowerCase().trim();
  const callerEmail = (authEmail || data.attendeeDetails?.email || '').toLowerCase().trim();

  let isAdmin = false;
  if (authEmail) {
    const aclSnap = await db.collection(FirestoreCollection.Acl).doc(authEmail).get();
    isAdmin = aclSnap.data()?.isAdmin === true;
  }
  ```

---

## 3. Pre-Commit Security Checklist

Before finalizing any changes to Cloud Functions, rules, or authorization logic:

- [ ] Does any new or modified callable check permissions against `/acl/{email}` rather than `member.isAdmin` or `token.admin`?
- [ ] Are all error handlers failing closed without fabricating synthetic user objects or default permissions?
- [ ] Do client-side form permission bindings (`disabled()`) match the operational whitelist in `firestore.rules` and `docs/security.md`?
- [ ] Are Cloud Storage operations validating resource prefixes and MIME types?
- [ ] Do all Firestore writes from non-admin clients validate `lastUpdated == request.time` (`serverTimestamp()`)?
- [ ] Have all automated test suites passed: `pnpm test:rules`, `pnpm test:functions`, `pnpm test`, and `pnpm test:docs`?
