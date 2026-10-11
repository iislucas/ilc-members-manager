# Email Normalisation (Case-Insensitive Emails)

Emails identify people throughout ILC Members Manager: Firebase Auth sign-in,
`/acl/{email}` permission documents, `member.emails`, event organiser lists,
registrations and video grants. Firebase Auth preserves whatever case a user typed
(`Jane.Doe@Example.com`), so comparing emails by exact string equality denied
access to users whose auth email contains capitals.

## The invariant

> **Every email is stored lower-case (trimmed). Compare emails with
> `normalizeEmail()` in code and with `request.auth.token.email.lower()` in rules.**

- Shared helper (dependency-free, used by both the Angular client and Cloud Functions):
  [`functions/src/data-model/email.ts`](../functions/src/data-model/email.ts) —
  `normalizeEmail`, `normalizeEmails` (normalise + drop empties + de-duplicate, keeping the
  primary email first), `emailsMatch`, `emailListIncludes`.
- Displaying the stored (lower-cased) value to users is fine.

### Stored email fields covered

| Data | Field(s) | Normalised on write by |
|---|---|---|
| `/acl/{email}` | document id | `updateACL` / `refreshACLAdminStatus` ([on-member-update.ts](../functions/src/on-member-update.ts)), `getUserDetails`, `setAdminPrivilege` |
| `/members/{id}` | `emails`, `publicEmail` | client `DataManagerService.addMember/updateMember`, member form, imports, actions library, Stripe/Squarespace fulfilment, **and** a safety net in `onMemberCreated`/`onMemberUpdated` that rewrites non-normalised `emails` (same pattern as the existing memberId/instructorId upper-casing) |
| `/events/{id}` | `ownerEmails`, `managerEmails` (derived by triggers), `updatedByEmail` | [proposed-events.ts](../functions/src/proposed-events.ts) triggers, actions library, event edit form |
| `/schools/{id}` | `ownerEmails`, `managerEmails` (deprecated) | [on-school-update.ts](../functions/src/on-school-update.ts), school import |
| `registrations` (events + members) | `email` | `stripe-product-checkout.ts`, `stripe-fulfillment.ts` |
| `/video_grants`, `/members/{id}/videoGrants` | `memberEmail`, `giftedByEmail`, email-keyed ids `${email}_${targetId}` | `grant-video.ts`, `stripe-fulfillment.ts`, actions library |
| `/orders` | `customerEmail`, sheets-import `email`, `billingAddress.email` | `stripe-webhook.ts`, order import, backfill. The Squarespace order trigger ignores email-case-only changes ([order-change.ts](../functions/src/squarespace-orders/order-change.ts)) |

### Security rules

[firestore.rules](../firestore.rules) and [storage.rules](../storage.rules) compare the
lower-cased auth email (guarded by `request.auth.token.get('email', null) is string`)
everywhere the token email is matched against stored data or used as an ACL / grant doc id.
Only the lower-cased form is accepted, and ACL lookups use `/acl/{lowercase}` only. Tests:
"Case-insensitive email matching" in [tests/firestore.rules.spec.ts](../tests/firestore.rules.spec.ts).

> [!NOTE]
> During the rollout (October 2026) the rules temporarily also accepted the raw token email and
> fell back to `/acl/{raw}`. Those fallbacks were removed once the backfill below had been applied
> in production and a re-run reported zero remaining changes.

## Backfill of existing data

[`functions/scripts/normalize-emails.ts`](../functions/scripts/normalize-emails.ts) (pure
planning logic in [`functions/src/email-backfill.ts`](../functions/src/email-backfill.ts),
unit-tested) rewrites existing data. It is a **dry run by default**, idempotent, and prints a
per-collection summary:

- `/acl` docs whose id is not normalised are merged into the normalised id (permissions are
  unioned, never reduced) and the legacy doc is deleted.
- `members.emails` (normalised + de-duplicated) and `publicEmail`; event
  `ownerEmails`/`managerEmails`/`updatedByEmail`; school `ownerEmails`/`managerEmails`; every
  `registrations.email`; video grant `memberEmail`/`giftedByEmail`; email-keyed
  `/video_grants` ids are moved to the normalised id.
- `lastUpdated` is bumped where the doc has one so client caches refresh (except orders, below).
- `/orders`: `customerEmail`, sheets-import `email` and `billingAddress.email` are lower-cased
  **without** touching `lastUpdated` (it is the order date used for sorting). The
  `processSquarespaceOrder` trigger skips writes whose only change is email case
  ([`isEmailCaseOnlyChange`](../functions/src/squarespace-orders/order-change.ts)), so this does
  not re-run order processing — provided the functions from step 2 are deployed first.

```bash
cd functions
pnpm run normalize-emails --project <PROJECT_ID>           # dry run: review the report
pnpm run normalize-emails --project <PROJECT_ID> --apply   # write
```

## Rollout history

The rollout (completed October 2026) ran in this order, which any similar future migration should
follow:

1. Deploy rules that accept **both** the raw and lower-cased email (safe on mixed data).
2. Deploy functions and hosting, which normalise new writes and include the order trigger's
   email-case-only guard (must be live before the backfill rewrites `/orders`).
3. Run the backfill dry run, review it, then `--apply`; a second dry run must report zero changes.
4. Remove the raw-email fallbacks from the rules (and the raw-id ACL fallback in
   `resources.ts`) and deploy rules + functions.

The backfill script is kept: it is idempotent and can be re-run (dry run first) if non-normalised
data is ever imported again.

## Related

- Security model: [security.md](security.md)
- ACL cache pattern and data model: [codebase-architecture skill](../.agent/skills/codebase-architecture/SKILL.md)
