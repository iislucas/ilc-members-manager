/* reconcile-event-mirrors.ts
 *
 * One-off repair: reconcile the per-member event mirror copies under
 * `members/{memberDocId}/events/{eventId}` against the canonical events in the
 * top-level `events` collection.
 *
 * Background: each event is mirrored into the subcollection of its owner and
 * managers (used by the "My Events" view). A bug in `onEventUpdated` could
 * leave a removed owner/manager's mirror copy orphaned (e.g. after an event's
 * ownership was transferred), so the My Events list showed a stale contact.
 *
 * For every mirror copy this script:
 *   - deletes it if the canonical event no longer exists, or if the member is
 *     no longer the event's owner or a manager (orphan);
 *   - otherwise re-writes it from the canonical event (minus the private
 *     owner/manager email fields) if it has drifted.
 * It then ensures every canonical event has an up-to-date mirror for each of
 * its current targets.
 *
 * Idempotent: a second run makes no further writes.
 *
 * Usage (Application Default Credentials, like the other admin scripts):
 *   # dry run — report what would change, write nothing:
 *   pnpm --prefix functions exec ts-node -O '{"module":"commonjs"}' \
 *     ../scripts/reconcile-event-mirrors.ts
 *   # apply the changes:
 *   pnpm --prefix functions exec ts-node -O '{"module":"commonjs"}' \
 *     ../scripts/reconcile-event-mirrors.ts --commit
 *   # target a different project (defaults to ilc-paris-class-tracker):
 *   pnpm --prefix functions exec ts-node -O '{"module":"commonjs"}' \
 *     ../scripts/reconcile-event-mirrors.ts --project=<project-id>
 */

import * as admin from 'firebase-admin';

const COMMIT = process.argv.includes('--commit');
const DEFAULT_PROJECT = 'ilc-paris-class-tracker';
const projectArg = process.argv.find((a) => a.startsWith('--project='));
const PROJECT_ID = projectArg ? projectArg.split('=')[1] : DEFAULT_PROJECT;

// Fields stripped from the mirror copy (private; never shown in My Events).
const PRIVATE_FIELDS = ['ownerEmails', 'managerEmails'] as const;

function mirrorData(canonical: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...canonical };
  for (const f of PRIVATE_FIELDS) delete copy[f];
  return copy;
}

function targetsOf(canonical: Record<string, unknown>): Set<string> {
  const owner = (canonical['ownerDocId'] as string) || '';
  const managers = (canonical['managerDocIds'] as string[]) || [];
  return new Set([owner, ...managers].filter(Boolean));
}

// Stable, key-order-independent comparison of mirror payloads.
function sameData(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const norm = (o: Record<string, unknown>) =>
    JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]));
  return norm(a) === norm(b);
}

async function main() {
  console.log(`Using project: ${PROJECT_ID}`);
  console.log(COMMIT ? 'MODE: COMMIT (writes enabled)' : 'MODE: DRY RUN (no writes)');
  admin.initializeApp({ projectId: PROJECT_ID });
  const db = admin.firestore();

  // Load all canonical events.
  const eventsSnap = await db.collection('events').get();
  const canonical = new Map<string, Record<string, unknown>>();
  eventsSnap.forEach((d) => canonical.set(d.id, d.data() as Record<string, unknown>));
  console.log(`Loaded ${canonical.size} canonical events.`);

  let deletes = 0;
  let updates = 0;

  // Pass 1: walk every existing mirror copy (collectionGroup matches the
  // top-level `events` collection too, so skip docs without a member parent).
  const mirrorsSnap = await db.collectionGroup('events').get();
  // Track which (member,event) mirrors already exist and are correct.
  for (const doc of mirrorsSnap.docs) {
    const memberDoc = doc.ref.parent.parent;
    if (!memberDoc || memberDoc.parent.id !== 'members') continue; // top-level event
    const memberDocId = memberDoc.id;
    const eventId = doc.id;

    const event = canonical.get(eventId);
    if (!event) {
      console.log(`DELETE orphan (no canonical event): members/${memberDocId}/events/${eventId}`);
      if (COMMIT) await doc.ref.delete();
      deletes++;
      continue;
    }
    if (!targetsOf(event).has(memberDocId)) {
      console.log(`DELETE orphan (member not owner/manager): members/${memberDocId}/events/${eventId}`);
      if (COMMIT) await doc.ref.delete();
      deletes++;
      continue;
    }
    const desired = mirrorData(event);
    if (!sameData(doc.data() as Record<string, unknown>, desired)) {
      console.log(`UPDATE drifted mirror: members/${memberDocId}/events/${eventId}`);
      if (COMMIT) await doc.ref.set(desired);
      updates++;
    }
  }

  // Pass 2: ensure each canonical event has a mirror for every current target.
  for (const [eventId, event] of canonical) {
    const desired = mirrorData(event);
    for (const memberDocId of targetsOf(event)) {
      const ref = db.collection('members').doc(memberDocId).collection('events').doc(eventId);
      const snap = await ref.get();
      if (!snap.exists) {
        console.log(`CREATE missing mirror: members/${memberDocId}/events/${eventId}`);
        if (COMMIT) await ref.set(desired);
        updates++;
      }
    }
  }

  console.log(`\nDone. ${deletes} delete(s), ${updates} create/update(s).` +
    (COMMIT ? '' : ' (dry run — re-run with --commit to apply)'));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
